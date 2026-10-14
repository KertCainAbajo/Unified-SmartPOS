<?php

namespace App\Services\Inventory;

use App\Enums\StockMovementType;
use App\Enums\StockTransferStatus;
use App\Exceptions\BusinessRuleException;
use App\Models\Branch;
use App\Models\Product;
use App\Models\StockTransfer;
use App\Services\AuditLogger;
use App\Services\DocumentNumberer;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Inter-branch transfers: draft → in_transit (stock leaves source) → received (stock enters destination).
 */
class StockTransferService
{
    public function __construct(
        private readonly StockLedger $ledger,
        private readonly StockAdjustmentService $adjustments,
        private readonly DocumentNumberer $numberer,
        private readonly AuditLogger $audit,
    ) {}

    /** @param  list<array{product_id: int, quantity: string}>  $items */
    public function create(Branch $from, Branch $to, array $items, ?string $notes, int $userId): StockTransfer
    {
        if ($from->id === $to->id) {
            throw new BusinessRuleException('Source and destination branches must differ.', 'SAME_BRANCH');
        }

        return DB::transaction(function () use ($from, $to, $items, $notes, $userId) {
            $products = Product::query()->where('tenant_id', $from->tenant_id)
                ->whereIn('id', array_column($items, 'product_id'))->get()->keyBy('id');

            foreach ($items as $i => $item) {
                $product = $products[$item['product_id']];
                if (! $product->track_inventory) {
                    throw new BusinessRuleException('Stock is not tracked for this product.', 'STOCK_NOT_TRACKED',
                        ["items.{$i}.product_id" => ['Stock is not tracked for this product.']]);
                }
                $this->adjustments->assertQuantityPrecision($product, (string) $item['quantity'], "items.{$i}.quantity");
            }

            $transfer = StockTransfer::query()->create([
                'tenant_id' => $from->tenant_id,
                'reference' => $this->numberer->next($from->tenant_id, 'transfer'),
                'from_branch_id' => $from->id,
                'to_branch_id' => $to->id,
                'status' => StockTransferStatus::Draft,
                'notes' => $notes,
                'created_by' => $userId,
            ]);

            foreach ($items as $item) {
                $transfer->items()->create([
                    'product_id' => $item['product_id'],
                    'quantity' => Money::normalize((string) $item['quantity'], 3),
                ]);
            }

            $this->audit->log('stock_transfer.created', $transfer, null, ['reference' => $transfer->reference, 'items' => $items], branchId: $from->id);

            return $transfer;
        });
    }

    public function dispatch(StockTransfer $transfer, int $userId): StockTransfer
    {
        return DB::transaction(function () use ($transfer, $userId) {
            $transfer = $this->lockInStatus($transfer, StockTransferStatus::Draft);
            $items = $transfer->items()->get();
            $rows = $this->ledger->lockRows($transfer->tenant_id, $transfer->from_branch_id, $items->pluck('product_id')->all());

            foreach ($items as $item) {
                $row = $rows[$item->product_id];
                $item->unit_cost = $row->average_cost;
                $item->save();

                $this->ledger->post($row, StockMovementType::TransferOut, Money::sub('0', (string) $item->quantity), [
                    'reference' => $transfer,
                    'reason' => "Transfer {$transfer->reference}",
                    'user_id' => $userId,
                ]);
            }

            $transfer->forceFill([
                'status' => StockTransferStatus::InTransit,
                'dispatched_by' => $userId,
                'dispatched_at' => now(),
            ])->save();

            $this->audit->log('stock_transfer.dispatched', $transfer, ['status' => 'draft'], ['status' => 'in_transit'],
                branchId: $transfer->from_branch_id);

            return $transfer;
        });
    }

    /** Full receipt only: partial/damaged receipts are recorded via adjustments at the destination. */
    public function receive(StockTransfer $transfer, int $userId): StockTransfer
    {
        return DB::transaction(function () use ($transfer, $userId) {
            $transfer = $this->lockInStatus($transfer, StockTransferStatus::InTransit);
            $items = $transfer->items()->get();
            $rows = $this->ledger->lockRows($transfer->tenant_id, $transfer->to_branch_id, $items->pluck('product_id')->all());

            foreach ($items as $item) {
                $this->ledger->post($rows[$item->product_id], StockMovementType::TransferIn, (string) $item->quantity, [
                    'unit_cost' => (string) $item->unit_cost,
                    'reference' => $transfer,
                    'reason' => "Transfer {$transfer->reference}",
                    'user_id' => $userId,
                ]);
                $item->quantity_received = $item->quantity;
                $item->save();
            }

            $transfer->forceFill([
                'status' => StockTransferStatus::Received,
                'received_by' => $userId,
                'received_at' => now(),
            ])->save();

            $this->audit->log('stock_transfer.received', $transfer, ['status' => 'in_transit'], ['status' => 'received'],
                branchId: $transfer->to_branch_id);

            return $transfer;
        });
    }

    /**
     * Cancel a draft, or an in-transit transfer that will not arrive: the dispatched stock is returned to the
     * source branch at the cost it left with.
     */
    public function cancel(StockTransfer $transfer, ?int $userId = null): StockTransfer
    {
        return DB::transaction(function () use ($transfer, $userId) {
            $transfer = $this->lockInStatus($transfer, [StockTransferStatus::Draft, StockTransferStatus::InTransit]);
            $old = $transfer->status->value;

            if ($transfer->status === StockTransferStatus::InTransit) {
                $items = $transfer->items()->get();
                $rows = $this->ledger->lockRows($transfer->tenant_id, $transfer->from_branch_id, $items->pluck('product_id')->all());
                foreach ($items as $item) {
                    $this->ledger->post($rows[$item->product_id], StockMovementType::TransferReturn, (string) $item->quantity, [
                        'unit_cost' => (string) $item->unit_cost,
                        'reference' => $transfer,
                        'reason' => "Transfer {$transfer->reference} cancelled; stock returned",
                        'user_id' => $userId,
                    ]);
                }
            }

            $transfer->forceFill(['status' => StockTransferStatus::Cancelled])->save();
            $this->audit->log('stock_transfer.cancelled', $transfer, ['status' => $old], ['status' => 'cancelled'],
                ['stock_returned' => $old === StockTransferStatus::InTransit->value], branchId: $transfer->from_branch_id);

            return $transfer;
        });
    }

    /** @param  StockTransferStatus|list<StockTransferStatus>  $expected */
    private function lockInStatus(StockTransfer $transfer, StockTransferStatus|array $expected): StockTransfer
    {
        $locked = StockTransfer::query()->lockForUpdate()->findOrFail($transfer->id);
        $allowed = is_array($expected) ? $expected : [$expected];

        if (! in_array($locked->status, $allowed, true)) {
            throw new BusinessRuleException(
                "Transfer is {$locked->status->value}; expected ".implode(' or ', array_map(fn ($s) => $s->value, $allowed)).'.',
                'INVALID_TRANSFER_STATE',
            );
        }

        return $locked;
    }
}
