<?php

namespace App\Services\Pos;

use App\Enums\PaymentMethod;
use App\Enums\PaymentStatus;
use App\Enums\RefundStatus;
use App\Enums\SaleStatus;
use App\Enums\StockMovementType;
use App\Exceptions\BusinessRuleException;
use App\Models\Branch;
use App\Models\Refund;
use App\Models\RegisterSession;
use App\Models\Sale;
use App\Models\Tenant;
use App\Services\AuditLogger;
use App\Services\DocumentNumberer;
use App\Services\Inventory\StockAdjustmentService;
use App\Services\Inventory\StockLedger;
use App\Services\NotificationService;
use App\Support\Money;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Partial or full refunds of completed sales.
 *
 * A refund is "restricted" when its total exceeds the business's refund_approval_threshold or the sale
 * is older than refund_window_days. Members with `refunds.approve` complete any refund immediately;
 * others may complete unrestricted refunds, while restricted ones wait in `pending_approval` until a
 * member with `refunds.approve` approves or rejects them. Pending refunds reserve their quantities.
 */
class RefundService
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly StockLedger $ledger,
        private readonly StockAdjustmentService $quantities,
        private readonly DocumentNumberer $numberer,
        private readonly NotificationService $notifications,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @param  array{items: list<array{sale_item_id: int, quantity: string|int|float, restock?: bool}>, reason: string,
     *               refund_method?: string|null, register_session_id?: int|null}  $data
     */
    public function request(Sale $sale, array $data, int $userId): Refund
    {
        $refund = DB::transaction(function () use ($sale, $data, $userId) {
            $sale = Sale::query()->lockForUpdate()->findOrFail($sale->id);
            $tenant = Tenant::query()->findOrFail($sale->tenant_id);

            if ($sale->status !== SaleStatus::Completed) {
                throw new BusinessRuleException('Only completed sales can be refunded.', 'SALE_NOT_REFUNDABLE');
            }

            $session = $this->resolveSession($sale, $data['register_session_id'] ?? null, $userId);
            $lines = $this->buildLines($sale, $data['items']);
            $total = Money::round(Money::add(...array_column($lines, 'amount')));
            $vat = Money::round(Money::add(...array_column($lines, 'vat_amount')));

            $restricted = Money::cmp($total, (string) $tenant->refund_approval_threshold) > 0
                || $sale->sold_at->lt(now()->subDays((int) $tenant->refund_window_days));
            $canApprove = $this->context->can(Permissions::REFUNDS_APPROVE);

            $refund = Refund::query()->create([
                'tenant_id' => $sale->tenant_id,
                'branch_id' => $sale->branch_id,
                'sale_id' => $sale->id,
                'register_session_id' => $session?->id,
                'reference' => $this->numberer->next($sale->tenant_id, 'refund', Branch::query()->findOrFail($sale->branch_id)),
                'status' => RefundStatus::PendingApproval,
                'reason' => $data['reason'],
                'refund_method' => PaymentMethod::from($data['refund_method'] ?? PaymentMethod::Cash->value),
                'subtotal' => Money::round(Money::sub($total, $vat)),
                'vat_amount' => $vat,
                'total' => $total,
                'requested_by' => $userId,
            ]);

            foreach ($lines as $line) {
                $refund->items()->create($line);
            }

            $this->audit->log('refund.requested', $refund, null, [
                'reference' => $refund->reference,
                'sale_id' => $sale->id,
                'total' => $total,
                'restricted' => $restricted,
            ]);

            if (! $restricted || $canApprove) {
                return $this->complete($refund, $sale, $canApprove ? $userId : null);
            }

            $this->notifications->afterCommit(fn () => $this->notifications->notifyPermissionHolders(
                $refund->tenant_id,
                $refund->branch_id,
                Permissions::REFUNDS_APPROVE,
                'refund_pending_approval',
                "Refund {$refund->reference} needs approval",
                "Refund of {$total} on receipt {$sale->receipt_number}.",
                ['refund_id' => $refund->id, 'sale_id' => $sale->id, 'total' => $total],
                exceptUserId: $userId,
            ));

            return $refund;
        });

        return $refund->fresh(['items']);
    }

    public function approve(Refund $refund, int $userId): Refund
    {
        return DB::transaction(function () use ($refund, $userId) {
            $sale = Sale::query()->lockForUpdate()->findOrFail($refund->sale_id);
            $refund = $this->lockPending($refund);

            if ($refund->requested_by === $userId) {
                throw new AuthorizationException('Refunds cannot be approved by the person who requested them.');
            }
            if ($sale->status !== SaleStatus::Completed) {
                throw new BusinessRuleException('The sale is no longer refundable.', 'SALE_NOT_REFUNDABLE');
            }

            return $this->complete($refund, $sale, $userId)->load('items');
        });
    }

    public function reject(Refund $refund, string $reason, int $userId): Refund
    {
        return DB::transaction(function () use ($refund, $reason, $userId) {
            $refund = $this->lockPending($refund);
            $refund->forceFill([
                'status' => RefundStatus::Rejected,
                'rejected_by' => $userId,
                'rejected_at' => now(),
                'rejection_reason' => $reason,
            ])->save();

            $this->audit->log('refund.rejected', $refund, ['status' => 'pending_approval'], ['status' => 'rejected'], ['reason' => $reason]);

            return $refund->load('items');
        });
    }

    /** Apply a refund: restock, update sale counters and shift cash. Caller holds the sale lock. */
    private function complete(Refund $refund, Sale $sale, ?int $approverId): Refund
    {
        $items = $refund->items()->with(['saleItem', 'product'])->get();

        $restock = $items->filter(fn ($i) => $i->restock && $i->product->track_inventory);
        $rows = $this->ledger->lockRows($sale->tenant_id, $sale->branch_id, $restock->pluck('product_id')->all());

        foreach ($items as $item) {
            $saleItem = $item->saleItem;
            $saleItem->quantity_refunded = Money::round(Money::add((string) $saleItem->quantity_refunded, (string) $item->quantity), 3);
            $saleItem->save();

            if ($item->restock && $item->product->track_inventory) {
                $this->ledger->post($rows[$item->product_id], StockMovementType::Refund, (string) $item->quantity, [
                    'unit_cost' => (string) $item->unit_cost,
                    'reference' => $refund,
                    'reason' => "Refund {$refund->reference}",
                    'user_id' => $approverId ?? $refund->requested_by,
                ]);
            }
        }

        $sale->refunded_total = Money::round(Money::add((string) $sale->refunded_total, (string) $refund->total));
        $sale->payment_status = Money::cmp((string) $sale->refunded_total, (string) $sale->total) >= 0
            ? PaymentStatus::Refunded
            : PaymentStatus::PartiallyRefunded;
        $sale->save();

        if ($refund->register_session_id && $refund->refund_method === PaymentMethod::Cash) {
            $session = RegisterSession::query()->lockForUpdate()->findOrFail($refund->register_session_id);
            if ($session->isOpen()) {
                $session->cash_refunds = Money::round(Money::add((string) $session->cash_refunds, (string) $refund->total));
                $session->save();
            }
        }

        $refund->forceFill([
            'status' => RefundStatus::Completed,
            'approved_by' => $approverId,
            'approved_at' => $approverId ? now() : null,
            'completed_at' => now(),
        ])->save();

        $this->audit->log('refund.completed', $refund, ['status' => 'pending_approval'], [
            'status' => 'completed',
            'total' => $refund->total,
            'approved_by' => $approverId,
        ], ['sale_id' => $sale->id, 'receipt_number' => $sale->receipt_number]);

        return $refund;
    }

    /**
     * @param  list<array{sale_item_id: int, quantity: string|int|float, restock?: bool}>  $requested
     * @return list<array<string, mixed>>
     */
    private function buildLines(Sale $sale, array $requested): array
    {
        $saleItems = $sale->items()->with('product')->get()->keyBy('id');
        $reserved = $this->reservedBySaleItem($sale);
        $lines = [];

        foreach ($requested as $i => $request) {
            $item = $saleItems[$request['sale_item_id']] ?? null;
            if (! $item) {
                throw new BusinessRuleException('Item does not belong to this sale.', 'INVALID_SALE_ITEM',
                    ["items.{$i}.sale_item_id" => ['Item does not belong to this sale.']]);
            }

            $quantity = Money::normalize((string) $request['quantity'], 3);
            $this->quantities->assertQuantityPrecision($item->product, $quantity, "items.{$i}.quantity");

            $already = $reserved[$item->id] ?? ['quantity' => '0', 'amount' => '0', 'vat' => '0'];
            $available = Money::sub((string) $item->quantity, $already['quantity']);

            if (Money::cmp($quantity, $available) > 0) {
                throw new BusinessRuleException("Only {$available} of {$item->name} can still be refunded.", 'REFUND_EXCEEDS_SOLD',
                    ["items.{$i}.quantity" => ["Refundable quantity is {$available}."]]);
            }

            // Last units absorb rounding so the sum of refunds equals the line total exactly.
            if (Money::cmp($quantity, $available) === 0) {
                $amount = Money::round(Money::sub((string) $item->line_total, $already['amount']));
                $vat = Money::round(Money::sub((string) $item->vat_amount, $already['vat']));
            } else {
                $ratio = Money::div($quantity, (string) $item->quantity);
                $amount = Money::round(Money::mul((string) $item->line_total, $ratio));
                $vat = Money::round(Money::mul((string) $item->vat_amount, $ratio));
            }

            $lines[] = [
                'sale_item_id' => $item->id,
                'product_id' => $item->product_id,
                'quantity' => $quantity,
                'amount' => $amount,
                'vat_amount' => $vat,
                'unit_cost' => $item->unit_cost,
                'restock' => (bool) ($request['restock'] ?? true),
            ];
        }

        return $lines;
    }

    /** Quantities and amounts already refunded or awaiting approval, per sale item. */
    private function reservedBySaleItem(Sale $sale): array
    {
        /** @var Collection<int, object> $rows */
        $rows = DB::table('refund_items')
            ->join('refunds', 'refunds.id', '=', 'refund_items.refund_id')
            ->where('refunds.sale_id', $sale->id)
            ->whereIn('refunds.status', [RefundStatus::Completed->value, RefundStatus::PendingApproval->value])
            ->groupBy('refund_items.sale_item_id')
            ->selectRaw('refund_items.sale_item_id, SUM(refund_items.quantity) as quantity, SUM(refund_items.amount) as amount, SUM(refund_items.vat_amount) as vat')
            ->get();

        return $rows->mapWithKeys(fn ($r) => [$r->sale_item_id => [
            'quantity' => (string) $r->quantity,
            'amount' => (string) $r->amount,
            'vat' => (string) $r->vat,
        ]])->all();
    }

    private function resolveSession(Sale $sale, ?int $sessionId, int $userId): ?RegisterSession
    {
        if ($sessionId === null) {
            return null;
        }

        $session = RegisterSession::query()->where('tenant_id', $sale->tenant_id)->find($sessionId);
        if (! $session || ! $session->isOpen() || $session->branch_id !== $sale->branch_id) {
            throw new BusinessRuleException('Refund cash must come from an open shift at the sale branch.', 'INVALID_SHIFT',
                ['register_session_id' => ['Choose an open shift at the sale branch.']]);
        }
        if ($session->opened_by !== $userId && ! $this->context->can(Permissions::SHIFTS_VIEW_ALL)) {
            throw new AuthorizationException('This shift belongs to another cashier.');
        }

        return $session;
    }

    private function lockPending(Refund $refund): Refund
    {
        $locked = Refund::query()->lockForUpdate()->findOrFail($refund->id);

        if ($locked->status !== RefundStatus::PendingApproval) {
            throw new BusinessRuleException("Refund is already {$locked->status->value}.", 'INVALID_REFUND_STATE');
        }

        return $locked;
    }
}
