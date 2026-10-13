<?php

namespace Tests\Feature\Pos;

use App\Models\Branch;
use App\Models\Inventory;
use App\Models\Payment;
use App\Models\Register;
use App\Models\Sale;
use App\Models\StockMovement;
use Tests\TestCase;

class CheckoutTest extends TestCase
{
    use PosTestHelpers;

    public function test_checkout_computes_totals_server_side_and_deducts_stock(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $product = $this->createProduct($tenant, ['price' => '112.00', 'cost_price' => '70.0000']);
        $this->setStock($product, $branch, '10', '65.0000');
        $register = $this->mainRegister($branch);
        $session = $this->openShift($tenant, $cashier, $register);

        $response = $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 2]], [['method' => 'cash', 'amount' => '500']])
            ->assertCreated()
            ->assertHeader('Idempotent-Replayed', 'false')
            ->assertJsonPath('data.subtotal', '224.00')
            ->assertJsonPath('data.vatable_sales', '200.00')
            ->assertJsonPath('data.vat_amount', '24.00')
            ->assertJsonPath('data.total', '224.00')
            ->assertJsonPath('data.amount_tendered', '500.00')
            ->assertJsonPath('data.change_due', '276.00')
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.payment_status', 'paid')
            ->assertJsonPath('data.items.0.name', $product->name)
            ->assertJsonPath('data.payments.0.amount', '224.00')
            ->assertJsonPath('receipt.totals.total', '224.00')
            ->assertJsonPath('receipt.change', '276.00');

        $this->assertMatchesRegularExpression('/^OR-MAIN-\d{6}$/', $response->json('data.receipt_number'));

        $sale = Sale::query()->firstOrFail();
        $this->assertSame('8.000', Inventory::query()->where('product_id', $product->id)->value('quantity'));
        $this->assertDatabaseHas('stock_movements', [
            'type' => 'sale', 'product_id' => $product->id, 'quantity_change' => '-2.000',
            'reference_type' => $sale->getMorphClass(), 'reference_id' => $sale->id,
        ]);
        // Cost snapshot uses the branch weighted-average cost.
        $this->assertSame('65.0000', $sale->items()->first()->unit_cost);
        $this->assertSame('224.00', $session->fresh()->cash_sales);
        $this->assertDatabaseHas('audit_logs', ['action' => 'sale.completed', 'auditable_id' => $sale->id, 'user_id' => $cashier->id]);
    }

    public function test_sale_items_keep_historical_price_after_price_change(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['price' => '50.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $this->openShift($tenant, $owner, $register);

        $saleId = $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '50']])
            ->assertCreated()->json('data.id');

        $this->patchJson($this->tenantUrl($tenant, "products/{$product->id}/price"), ['price' => '75.00'])->assertOk();
        $this->patchJson($this->tenantUrl($tenant, "products/{$product->id}"), ['name' => 'Renamed'])->assertOk();

        $this->getJson($this->tenantUrl($tenant, "sales/{$saleId}"))
            ->assertJsonPath('data.items.0.unit_price', '50.00')
            ->assertJsonPath('data.items.0.name', $product->name);
    }

    public function test_client_cannot_submit_prices_or_totals(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['price' => '100.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $this->openShift($tenant, $owner, $register);

        $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => '1.00']],
            [['method' => 'cash', 'amount' => '1']], ['total' => '1.00'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.unit_price', 'total']);

        $this->assertSame(0, Sale::query()->count());
    }

    public function test_insufficient_stock_rejects_whole_sale_atomically(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $a = $this->createProduct($tenant, ['price' => '10.00']);
        $b = $this->createProduct($tenant, ['price' => '10.00']);
        $this->setStock($a, $branch, '5');
        $this->setStock($b, $branch, '1');
        $register = $this->mainRegister($branch);
        $this->openShift($tenant, $owner, $register);

        $this->checkout($tenant, $register, [
            ['product_id' => $a->id, 'quantity' => 2],
            ['product_id' => $b->id, 'quantity' => 3],
        ], [['method' => 'cash', 'amount' => '100']])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'INSUFFICIENT_STOCK');

        $this->assertSame(0, Sale::query()->count());
        $this->assertSame(0, StockMovement::query()->where('type', '!=', 'opening')->count());
        $this->assertSame('5.000', Inventory::query()->where('product_id', $a->id)->value('quantity'));

        // The receipt number was not consumed by the failed attempt.
        $this->checkout($tenant, $register, [['product_id' => $a->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '10']])
            ->assertCreated()->assertJsonPath('data.receipt_number', 'OR-MAIN-000001');
    }

    public function test_sequential_sales_cannot_oversell_last_unit(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['price' => '10.00']);
        $this->setStock($product, $branch, '1');
        $register = $this->mainRegister($branch);
        $this->openShift($tenant, $owner, $register);

        $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '10']])->assertCreated();
        $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '10']])
            ->assertUnprocessable()->assertJsonPath('code', 'INSUFFICIENT_STOCK');

        $this->assertSame('0.000', Inventory::query()->value('quantity'));
    }

    public function test_negative_stock_allowed_only_when_business_enables_it(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant(['allow_negative_stock' => true]);
        $product = $this->createProduct($tenant, ['price' => '10.00']);
        $register = $this->mainRegister($branch);
        $this->openShift($tenant, $owner, $register);

        $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 3]], [['method' => 'cash', 'amount' => '30']])->assertCreated();
        $this->assertSame('-3.000', Inventory::query()->value('quantity'));
    }

    public function test_duplicate_checkout_with_same_idempotency_key_returns_original_sale(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['price' => '20.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $this->openShift($tenant, $owner, $register);
        $items = [['product_id' => $product->id, 'quantity' => 1]];
        $payments = [['method' => 'cash', 'amount' => '20']];

        $first = $this->checkout($tenant, $register, $items, $payments, key: 'retry-key-0001')->assertCreated();
        $second = $this->checkout($tenant, $register, $items, $payments, key: 'retry-key-0001')
            ->assertOk()->assertHeader('Idempotent-Replayed', 'true');

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        $this->assertSame(1, Sale::query()->count());
        $this->assertSame(1, Payment::query()->count());
        $this->assertSame('9.000', Inventory::query()->value('quantity'));

        // Same key, different payload → conflict, nothing created.
        $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 2]], [['method' => 'cash', 'amount' => '40']], key: 'retry-key-0001')
            ->assertStatus(409)->assertJsonPath('code', 'IDEMPOTENCY_KEY_REUSED');
        $this->assertSame(1, Sale::query()->count());
    }

    public function test_idempotency_key_is_required(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $register = $this->mainRegister($branch);
        $product = $this->createProduct($tenant);

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'sales'), [
            'register_id' => $register->id, 'items' => [['product_id' => $product->id, 'quantity' => 1]], 'payments' => [],
        ])->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
    }

    public function test_invalid_payment_amounts_are_rejected(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['price' => '100.00']);
        $this->setStock($product, $branch, '50');
        $register = $this->mainRegister($branch);
        $this->openShift($tenant, $owner, $register);
        $items = [['product_id' => $product->id, 'quantity' => 1]];

        $this->checkout($tenant, $register, $items, [['method' => 'cash', 'amount' => '99.99']])
            ->assertUnprocessable()->assertJsonPath('code', 'INSUFFICIENT_PAYMENT');
        $this->checkout($tenant, $register, $items, [['method' => 'card', 'amount' => '150.00']])
            ->assertUnprocessable()->assertJsonPath('code', 'PAYMENT_EXCEEDS_TOTAL');
        $this->checkout($tenant, $register, $items, [['method' => 'cash', 'amount' => '-100']])
            ->assertUnprocessable()->assertJsonValidationErrors('payments.0.amount');
        $this->checkout($tenant, $register, $items, [['method' => 'cash', 'amount' => '100.001']])
            ->assertUnprocessable()->assertJsonValidationErrors('payments.0.amount');
        $this->checkout($tenant, $register, $items, [['method' => 'cash', 'amount' => '50'], ['method' => 'cash', 'amount' => '50']])
            ->assertUnprocessable()->assertJsonPath('code', 'INVALID_PAYMENT');
        $this->checkout($tenant, $register, $items, [['method' => 'bitcoin', 'amount' => '100']])
            ->assertUnprocessable()->assertJsonValidationErrors('payments.0.method');
        $this->checkout($tenant, $register, $items, [])
            ->assertUnprocessable()->assertJsonPath('code', 'INSUFFICIENT_PAYMENT');

        $this->assertSame(0, Sale::query()->count());
        $this->assertSame('50.000', Inventory::query()->value('quantity'));
    }

    public function test_split_payment_gives_change_from_cash_only(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['price' => '224.00']);
        $this->setStock($product, $branch, '5');
        $register = $this->mainRegister($branch);
        $session = $this->openShift($tenant, $owner, $register);

        $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [
            ['method' => 'gcash', 'amount' => '100', 'reference_number' => 'GC123'],
            ['method' => 'cash', 'amount' => '200'],
        ])->assertCreated()
            ->assertJsonPath('data.change_due', '76.00')
            ->assertJsonPath('data.payments.0.amount', '100.00')
            ->assertJsonPath('data.payments.1.amount', '124.00')
            ->assertJsonPath('data.payments.1.tendered', '200.00');

        $this->assertSame('124.00', $session->fresh()->cash_sales);
    }

    public function test_senior_citizen_discount_requires_id_and_is_computed_by_server(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $product = $this->createProduct($tenant, ['price' => '112.00']);
        $this->setStock($product, $branch, '5');
        $register = $this->mainRegister($branch);
        $this->openShift($tenant, $cashier, $register);
        $items = [['product_id' => $product->id, 'quantity' => 1]];

        $this->checkout($tenant, $register, $items, [['method' => 'cash', 'amount' => '80']], ['discount' => ['type' => 'senior_citizen']])
            ->assertUnprocessable()->assertJsonValidationErrors(['discount.id_number', 'discount.holder_name']);

        $this->checkout($tenant, $register, $items, [['method' => 'cash', 'amount' => '80']], [
            'discount' => ['type' => 'senior_citizen', 'id_number' => 'SC-12345', 'holder_name' => 'Lola Maria'],
        ])->assertCreated()
            ->assertJsonPath('data.vat_exemption_amount', '12.00')
            ->assertJsonPath('data.discount_total', '20.00')
            ->assertJsonPath('data.vat_amount', '0.00')
            ->assertJsonPath('data.total', '80.00')
            ->assertJsonPath('data.discount.id_number', 'SC-12345')
            ->assertJsonPath('receipt.lines.0.tax_code', 'E');
    }

    public function test_manual_discounts_require_permission(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $manager = $this->addMember($tenant, 'branch_manager', [$branch]);
        $product = $this->createProduct($tenant, ['price' => '112.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $items = [['product_id' => $product->id, 'quantity' => 2, 'discount' => ['type' => 'percent', 'value' => 10]]];

        $this->openShift($tenant, $cashier, $register);
        $this->checkout($tenant, $register, $items, [['method' => 'cash', 'amount' => '300']])->assertForbidden();
        $this->assertSame(0, Sale::query()->count());

        // Manager (sales.discount + shifts.view_all) can ring up on the cashier's open shift.
        $this->actingAsUser($manager);
        $this->checkout($tenant, $register, $items, [['method' => 'cash', 'amount' => '300']])
            ->assertCreated()
            ->assertJsonPath('data.discount_total', '22.40')
            ->assertJsonPath('data.total', '201.60')
            ->assertJsonPath('data.vat_amount', '21.60');
    }

    public function test_requires_open_shift_owned_by_cashier(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $cashierA = $this->addMember($tenant, 'cashier', [$branch]);
        $cashierB = $this->addMember($tenant, 'cashier', [$branch]);
        $product = $this->createProduct($tenant, ['price' => '10.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $items = [['product_id' => $product->id, 'quantity' => 1]];
        $pay = [['method' => 'cash', 'amount' => '10']];

        $this->actingAsUser($cashierA);
        $this->checkout($tenant, $register, $items, $pay)->assertUnprocessable()->assertJsonPath('code', 'REGISTER_NOT_OPEN');

        $this->openShift($tenant, $cashierA, $register);
        $this->actingAsUser($cashierB);
        $this->checkout($tenant, $register, $items, $pay)->assertForbidden();
    }

    public function test_cashier_cannot_sell_at_unauthorized_branch(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $other = $this->createBranch($tenant, 'B2');
        $cashier = $this->addMember($tenant, 'cashier', [$main]);
        $product = $this->createProduct($tenant, ['price' => '10.00']);
        $this->setStock($product, $other, '10');
        $otherRegister = $this->registerFor($other);
        $this->openShift($tenant, $owner, $otherRegister);

        $this->actingAsUser($cashier);
        $this->checkout($tenant, $otherRegister, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '10']])
            ->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, 'register-sessions'), ['register_id' => $otherRegister->id, 'opening_float' => 0])
            ->assertForbidden();
    }

    public function test_archived_and_foreign_products_cannot_be_sold(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        [$otherTenant] = $this->createTenant();
        $archived = $this->createProduct($tenant, ['status' => 'archived', 'price' => '10.00']);
        $foreign = $this->createProduct($otherTenant, ['price' => '10.00']);
        $register = $this->mainRegister($branch);
        $this->openShift($tenant, $owner, $register);

        $this->checkout($tenant, $register, [['product_id' => $archived->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '10']])
            ->assertUnprocessable()->assertJsonPath('code', 'PRODUCT_INACTIVE');
        $this->checkout($tenant, $register, [['product_id' => $foreign->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '10']])
            ->assertUnprocessable()->assertJsonValidationErrors('items.0.product_id');
    }

    public function test_cashier_sees_only_own_sales(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $product = $this->createProduct($tenant, ['price' => '10.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $reg2 = $this->createRegister($branch);

        $this->openShift($tenant, $owner, $register);
        $ownerSale = $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '10']])->json('data.id');
        $this->openShift($tenant, $cashier, $reg2);
        $this->checkout($tenant, $reg2, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '10']])->assertCreated();

        $this->getJson($this->tenantUrl($tenant, 'sales'))->assertOk()->assertJsonCount(1, 'data');
        $this->getJson($this->tenantUrl($tenant, "sales/{$ownerSale}"))->assertForbidden();
        $this->getJson($this->tenantUrl($tenant, 'payments'))->assertForbidden();

        $this->actingAsUser($owner)->getJson($this->tenantUrl($tenant, 'sales'))->assertJsonCount(2, 'data');
    }

    private function createRegister(Branch $branch): Register
    {
        return Register::query()->forceCreate([
            'tenant_id' => $branch->tenant_id, 'branch_id' => $branch->id, 'code' => 'REG-2', 'name' => 'Register 2',
        ]);
    }
}
