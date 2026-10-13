<?php

namespace App\Services\Purchasing;

use App\Enums\PurchaseOrderStatus;
use App\Exceptions\BusinessRuleException;
use App\Models\Branch;
use App\Models\PurchaseOrder;
use App\Services\AuditLogger;
use App\Services\DocumentNumberer;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/** Purchase order lifecycle: draft → ordered → partially_received → received; draft/ordered → cancelled. */
class PurchaseOrderService
{
    public function __construct(
        private readonly DocumentNumberer $numberer,
        private readonly AuditLogger $audit,
    ) {}

    /** @param  array<string, mixed>  $data */
    public function create(Branch $branch, array $data, int $userId): PurchaseOrder
    {
        return DB::transaction(function () use ($branch, $data, $userId) {
            $order = PurchaseOrder::query()->create([
                'tenant_id' => $branch->tenant_id,
                'branch_id' => $branch->id,
                'supplier_id' => $data['supplier_id'],
                'reference' => $this->numberer->next($branch->tenant_id, 'purchase_order'),
                'status' => PurchaseOrderStatus::Draft,
                'order_date' => $data['order_date'] ?? now()->toDateString(),
                'expected_date' => $data['expected_date'] ?? null,
                'notes' => $data['notes'] ?? null,
                'created_by' => $userId,
            ]);
            $this->replaceItems($order, $data['items']);
            $this->audit->log('purchase_order.created', $order, null, ['reference' => $order->reference, 'total' => $order->total]);

            return $order;
        });
    }

    /** @param  array<string, mixed>  $data */
    public function update(PurchaseOrder $order, array $data): PurchaseOrder
    {
        return DB::transaction(function () use ($order, $data) {
            $order = $this->lockInStatus($order, [PurchaseOrderStatus::Draft]);
            $old = ['total' => $order->total, 'supplier_id' => $order->supplier_id];

            $order->fill(array_intersect_key($data, array_flip(['supplier_id', 'order_date', 'expected_date', 'notes'])))->save();
            if (isset($data['items'])) {
                $this->replaceItems($order, $data['items']);
            }
            $this->audit->log('purchase_order.updated', $order, $old, ['total' => $order->total, 'supplier_id' => $order->supplier_id]);

            return $order;
        });
    }

    public function markOrdered(PurchaseOrder $order): PurchaseOrder
    {
        return DB::transaction(function () use ($order) {
            $order = $this->lockInStatus($order, [PurchaseOrderStatus::Draft]);
            $order->forceFill(['status' => PurchaseOrderStatus::Ordered, 'ordered_at' => now()])->save();
            $this->audit->log('purchase_order.ordered', $order, ['status' => 'draft'], ['status' => 'ordered']);

            return $order;
        });
    }

    public function cancel(PurchaseOrder $order, ?string $reason): PurchaseOrder
    {
        return DB::transaction(function () use ($order, $reason) {
            $order = $this->lockInStatus($order, [PurchaseOrderStatus::Draft, PurchaseOrderStatus::Ordered]);
            $old = $order->status->value;
            $order->forceFill(['status' => PurchaseOrderStatus::Cancelled, 'cancelled_at' => now()])->save();
            $this->audit->log('purchase_order.cancelled', $order, ['status' => $old], ['status' => 'cancelled'], ['reason' => $reason]);

            return $order;
        });
    }

    /** @param  list<array{product_id: int, quantity: string|int|float, unit_cost: string|int|float}>  $items */
    private function replaceItems(PurchaseOrder $order, array $items): void
    {
        $order->items()->delete();
        $total = '0';

        foreach ($items as $item) {
            $quantity = Money::normalize((string) $item['quantity'], 3);
            $unitCost = Money::normalize((string) $item['unit_cost'], 4);
            $lineTotal = Money::round(Money::mul($quantity, $unitCost));
            $total = Money::add($total, $lineTotal);

            $order->items()->create([
                'product_id' => $item['product_id'],
                'quantity_ordered' => $quantity,
                'quantity_received' => '0.000',
                'unit_cost' => $unitCost,
                'line_total' => $lineTotal,
            ]);
        }

        $order->total = Money::round($total);
        $order->save();
    }

    /** @param  list<PurchaseOrderStatus>  $allowed */
    private function lockInStatus(PurchaseOrder $order, array $allowed): PurchaseOrder
    {
        $locked = PurchaseOrder::query()->lockForUpdate()->findOrFail($order->id);

        if (! in_array($locked->status, $allowed, true)) {
            throw new BusinessRuleException("Purchase order is {$locked->status->value}.", 'INVALID_PO_STATE');
        }

        return $locked;
    }
}
