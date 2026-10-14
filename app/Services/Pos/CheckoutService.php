<?php

namespace App\Services\Pos;

use App\Enums\LineDiscountType;
use App\Enums\PaymentMethod;
use App\Enums\PaymentStatus;
use App\Enums\RegisterSessionStatus;
use App\Enums\SaleDiscountType;
use App\Enums\SaleStatus;
use App\Enums\StockMovementType;
use App\Exceptions\BusinessRuleException;
use App\Models\Branch;
use App\Models\Product;
use App\Models\Register;
use App\Models\RegisterSession;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\DocumentNumberer;
use App\Services\Inventory\StockAdjustmentService;
use App\Services\Inventory\StockLedger;
use App\Support\Money;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Checkout as a single business operation.
 *
 * The client sends product IDs, quantities, optional discount requests and tendered payments.
 * Prices, discounts, VAT, totals, change and stock are computed here, inside one transaction,
 * with inventory rows locked to prevent oversell. The (tenant, idempotency key) unique index
 * guarantees that a retried request can never create a second sale.
 */
class CheckoutService
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly StockLedger $ledger,
        private readonly StockAdjustmentService $quantities,
        private readonly DocumentNumberer $numberer,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated checkout payload
     * @return array{sale: Sale, replayed: bool}
     */
    public function checkout(Tenant $tenant, User $cashier, array $data, string $idempotencyKey): array
    {
        $requestHash = hash('sha256', json_encode($data, JSON_PRESERVE_ZERO_FRACTION));

        if ($existing = $this->findReplay($tenant, $cashier, $idempotencyKey, $requestHash)) {
            return ['sale' => $existing, 'replayed' => true];
        }

        try {
            $sale = DB::transaction(fn () => $this->createSale($tenant, $cashier, $data, $idempotencyKey, $requestHash));
        } catch (UniqueConstraintViolationException $e) {
            // A concurrent request with the same key committed first.
            if ($existing = $this->findReplay($tenant, $cashier, $idempotencyKey, $requestHash)) {
                return ['sale' => $existing, 'replayed' => true];
            }
            throw $e;
        }

        return ['sale' => $sale, 'replayed' => false];
    }

    private function findReplay(Tenant $tenant, User $cashier, string $key, string $hash): ?Sale
    {
        $sale = Sale::query()->where('tenant_id', $tenant->id)->where('idempotency_key', $key)->first();

        // Only the cashier who made the sale may replay it; anyone else reusing the key gets a conflict.
        if ($sale && ($sale->cashier_id !== $cashier->id || ! hash_equals($sale->request_hash, $hash))) {
            throw new BusinessRuleException(
                'This idempotency key was already used for a different checkout request.',
                'IDEMPOTENCY_KEY_REUSED',
                status: 409,
            );
        }

        return $sale;
    }

    private function createSale(Tenant $tenant, User $cashier, array $data, string $key, string $hash): Sale
    {
        // 1. Register and open shift (locked so a concurrent close cannot interleave).
        $register = Register::query()->where('tenant_id', $tenant->id)->findOrFail($data['register_id']);
        $session = RegisterSession::query()
            ->where('register_id', $register->id)
            ->where('status', RegisterSessionStatus::Open->value)
            ->lockForUpdate()
            ->first();

        if (! $register->is_active || ! $session) {
            throw new BusinessRuleException('Open a shift on this register before selling.', 'REGISTER_NOT_OPEN');
        }
        if ($session->opened_by !== $cashier->id && ! $this->context->can(Permissions::SHIFTS_VIEW_ALL)) {
            throw new AuthorizationException('This register shift belongs to another cashier.');
        }

        $branch = Branch::query()->findOrFail($register->branch_id);
        if (! $branch->is_active) {
            throw new BusinessRuleException('This branch is inactive.', 'BRANCH_INACTIVE');
        }

        // 2. Products and discounts (authoritative prices from the database).
        ['products' => $products, 'calculation' => $calculation, 'sale_discount' => $saleDiscount] = $this->price($tenant, $data);
        $totals = $calculation['totals'];

        // 3. Payments.
        $payments = $this->resolvePayments($data['payments'] ?? [], $totals['total']);

        // 4. Sale header.
        $now = now();
        $sale = Sale::query()->create([
            'tenant_id' => $tenant->id,
            'branch_id' => $branch->id,
            'register_id' => $register->id,
            'register_session_id' => $session->id,
            'cashier_id' => $cashier->id,
            'customer_id' => $data['customer_id'] ?? null,
            'receipt_number' => $this->numberer->next($tenant->id, 'receipt', $branch),
            'idempotency_key' => $key,
            'request_hash' => $hash,
            'status' => SaleStatus::Completed,
            'payment_status' => PaymentStatus::Paid,
            ...$totals,
            'amount_tendered' => $payments['tendered'],
            'change_due' => $payments['change'],
            'refunded_total' => '0.00',
            'discount_type' => $saleDiscount,
            'discount_id_number' => $saleDiscount === SaleDiscountType::None ? null : $data['discount']['id_number'],
            'discount_holder_name' => $saleDiscount === SaleDiscountType::None ? null : $data['discount']['holder_name'],
            'notes' => $data['notes'] ?? null,
            'business_date' => $now->copy()->setTimezone($tenant->timezone)->toDateString(),
            'sold_at' => $now,
        ]);

        // 5. Stock: lock rows in deterministic order, then deduct.
        $tracked = $products->filter(fn (Product $p) => $p->track_inventory);
        $rows = $this->ledger->lockRows($tenant->id, $branch->id, $tracked->keys()->all());

        foreach ($calculation['lines'] as $line) {
            /** @var Product $product */
            $product = $line['product'];
            $row = $rows[$product->id] ?? null;
            $unitCost = $this->unitCost($product, $row?->average_cost);

            $sale->items()->create([
                'product_id' => $product->id,
                'sku' => $product->sku,
                'barcode' => $product->barcode,
                'name' => $product->name,
                'unit' => $product->unit,
                'tax_type' => $product->tax_type,
                'quantity' => $line['quantity'],
                'unit_price' => $line['unit_price'],
                'unit_cost' => $unitCost,
                'gross_amount' => $line['gross_amount'],
                'discount_type' => $line['discount_type'],
                'discount_value' => $line['discount_value'],
                'discount_amount' => $line['discount_amount'],
                'vat_exemption_amount' => $line['vat_exemption_amount'],
                'vat_amount' => $line['vat_amount'],
                'line_total' => $line['line_total'],
                'quantity_refunded' => '0.000',
            ]);

            if ($row) {
                $this->ledger->post($row, StockMovementType::Sale, Money::sub('0', $line['quantity']), [
                    'reference' => $sale,
                    'reason' => "Sale {$sale->receipt_number}",
                    'user_id' => $cashier->id,
                    'allow_negative' => (bool) $tenant->allow_negative_stock,
                ]);
            }
        }

        // 6. Payments and shift cash.
        foreach ($payments['lines'] as $payment) {
            $sale->payments()->create(['tenant_id' => $tenant->id, ...$payment, 'status' => 'completed']);
        }
        if (Money::isPositive($payments['cash_applied'])) {
            $session->cash_sales = Money::round(Money::add((string) $session->cash_sales, $payments['cash_applied']));
            $session->save();
        }

        // 7. Audit.
        $this->audit->log('sale.completed', $sale, null, [
            'receipt_number' => $sale->receipt_number,
            'total' => $sale->total,
            'items' => count($calculation['lines']),
            'discount_type' => $saleDiscount->value,
            'payments' => array_map(fn ($p) => ['method' => $p['method']->value, 'amount' => $p['amount']], $payments['lines']),
        ]);

        return $sale;
    }

    /**
     * Price a cart without saving anything, so the POS can show the amount due before taking payment.
     * Uses exactly the same rules as checkout. Stock availability is reported per line but not enforced.
     *
     * @param  array<string, mixed>  $data  validated cart (register_id, items, discount)
     * @return array{totals: array<string, string>, lines: list<array<string, mixed>>}
     */
    public function quote(Tenant $tenant, array $data): array
    {
        ['calculation' => $calculation] = $this->price($tenant, $data);

        $register = Register::query()->where('tenant_id', $tenant->id)->findOrFail($data['register_id']);
        $stock = DB::table('inventory')
            ->where('branch_id', $register->branch_id)
            ->whereIn('product_id', array_map(fn ($l) => $l['product']->id, $calculation['lines']))
            ->pluck('quantity', 'product_id');

        // Sum requested quantities per product (the same product may appear on several lines).
        $requested = [];
        foreach ($calculation['lines'] as $line) {
            $id = $line['product']->id;
            $requested[$id] = Money::add($requested[$id] ?? '0', $line['quantity']);
        }

        return [
            'totals' => $calculation['totals'],
            'lines' => array_map(function (array $line) use ($stock, $requested, $tenant) {
                /** @var Product $product */
                $product = $line['product'];
                $available = $product->track_inventory ? Money::fromDatabase($stock[$product->id] ?? '0', 3) : null;

                return [
                    'product_id' => $product->id,
                    'sku' => $product->sku,
                    'name' => $product->name,
                    'unit' => $product->unit,
                    'tax_type' => $product->tax_type,
                    'quantity' => $line['quantity'],
                    'unit_price' => $line['unit_price'],
                    'gross_amount' => $line['gross_amount'],
                    'discount_amount' => $line['discount_amount'],
                    'vat_exemption_amount' => $line['vat_exemption_amount'],
                    'vat_amount' => $line['vat_amount'],
                    'line_total' => $line['line_total'],
                    'available_stock' => $available,
                    'in_stock' => $available === null
                        || (bool) $tenant->allow_negative_stock
                        || Money::cmp($available, $requested[$product->id]) >= 0,
                ];
            }, $calculation['lines']),
        ];
    }

    /**
     * Load products and compute line and sale totals with server prices.
     *
     * @return array{products: Collection<int, Product>, calculation: array, sale_discount: SaleDiscountType}
     */
    private function price(Tenant $tenant, array $data): array
    {
        $saleDiscount = SaleDiscountType::from($data['discount']['type'] ?? 'none');
        $products = Product::query()
            ->where('tenant_id', $tenant->id)
            ->whereIn('id', array_column($data['items'], 'product_id'))
            ->get()->keyBy('id');

        $lines = [];
        foreach ($data['items'] as $i => $item) {
            $product = $products[$item['product_id']];
            if (! $product->isActive()) {
                throw new BusinessRuleException("{$product->name} is archived and cannot be sold.", 'PRODUCT_INACTIVE',
                    ["items.{$i}.product_id" => ['Product is archived.']]);
            }
            $quantity = Money::normalize((string) $item['quantity'], 3);
            $this->quantities->assertQuantityPrecision($product, $quantity, "items.{$i}.quantity");

            $discountType = LineDiscountType::from($item['discount']['type'] ?? 'none');
            if ($discountType !== LineDiscountType::None) {
                if (! $this->context->can(Permissions::SALES_DISCOUNT)) {
                    throw new AuthorizationException('You are not allowed to apply manual discounts.');
                }
                if ($saleDiscount !== SaleDiscountType::None) {
                    throw new BusinessRuleException('Manual discounts cannot be combined with Senior Citizen/PWD discounts.',
                        'DISCOUNT_NOT_COMBINABLE', ["items.{$i}.discount" => ['Not combinable with SC/PWD discount.']]);
                }
            }

            $lines[] = [
                'product' => $product,
                'quantity' => $quantity,
                'discount_type' => $discountType,
                'discount_value' => (string) ($item['discount']['value'] ?? '0'),
            ];
        }

        return [
            'products' => $products,
            'calculation' => SaleCalculator::forTenant($tenant)->calculate($lines, $saleDiscount),
            'sale_discount' => $saleDiscount,
        ];
    }

    /**
     * Validate tendered payments against the server-computed total.
     *
     * Non-cash tenders may not exceed the total (no change is given on cards/e-wallets).
     * Change is returned from cash only. At most one cash line is accepted.
     *
     * @param  list<array{method: string, amount: string|int|float, reference_number?: string|null}>  $input
     * @return array{lines: list<array<string, mixed>>, tendered: string, change: string, cash_applied: string}
     */
    private function resolvePayments(array $input, string $total): array
    {
        $cash = '0';
        $nonCash = '0';
        $cashLines = 0;

        foreach ($input as $payment) {
            $amount = Money::normalize((string) $payment['amount']);
            if ($payment['method'] === PaymentMethod::Cash->value) {
                $cash = Money::add($cash, $amount);
                $cashLines++;
            } else {
                $nonCash = Money::add($nonCash, $amount);
            }
        }

        if ($cashLines > 1) {
            throw new BusinessRuleException('Combine cash into a single payment line.', 'INVALID_PAYMENT', ['payments' => ['Only one cash payment line is allowed.']]);
        }
        if (Money::cmp($nonCash, $total) > 0) {
            throw new BusinessRuleException('Non-cash payments exceed the amount due.', 'PAYMENT_EXCEEDS_TOTAL', ['payments' => ['Non-cash payments cannot exceed the total.']]);
        }

        $tendered = Money::round(Money::add($cash, $nonCash));
        if (Money::cmp($tendered, $total) < 0) {
            throw new BusinessRuleException("Insufficient payment. Amount due is {$total}.", 'INSUFFICIENT_PAYMENT', ['payments' => ["Amount due is {$total}."]]);
        }

        $change = Money::round(Money::sub($tendered, $total));
        $cashApplied = Money::round(Money::sub($cash, $change));

        if ($cashLines === 1 && ! Money::isPositive($cashApplied)) {
            throw new BusinessRuleException('Cash is not needed for this sale.', 'INVALID_PAYMENT', ['payments' => ['Remove the unnecessary cash payment.']]);
        }

        $lines = array_map(function (array $payment) use ($cashApplied) {
            $method = PaymentMethod::from($payment['method']);
            $tendered = Money::normalize((string) $payment['amount']);

            return [
                'method' => $method,
                'amount' => $method === PaymentMethod::Cash ? $cashApplied : $tendered,
                'tendered' => $tendered,
                'reference_number' => $payment['reference_number'] ?? null,
            ];
        }, $input);

        return ['lines' => $lines, 'tendered' => $tendered, 'change' => $change, 'cash_applied' => Money::round($cash === '0' ? '0' : $cashApplied)];
    }

    /** Branch weighted-average cost, falling back to the product's reference cost when unknown. */
    private function unitCost(Product $product, ?string $averageCost): string
    {
        if ($averageCost !== null && Money::isPositive($averageCost)) {
            return Money::normalize($averageCost, 4);
        }

        return Money::normalize((string) $product->cost_price, 4);
    }
}
