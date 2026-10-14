<?php

namespace App\Services\Inventory;

use App\Enums\StockCountStatus;
use App\Enums\StockMovementType;
use App\Exceptions\BusinessRuleException;
use App\Models\Branch;
use App\Models\Product;
use App\Models\StockCount;
use App\Services\AuditLogger;
use App\Services\DocumentNumberer;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Physical counts. The client submits counted quantities; the server snapshots the system balance at that
 * moment, and on completion books the variance (counted − snapshot) as a movement. Movements that happened
 * after the count (e.g. sales) are therefore kept. Clients never set balances directly.
 */
class StockCountService
{
    public function __construct(
        private readonly StockLedger $ledger,
        private readonly StockAdjustmentService $adjustments,
        private readonly DocumentNumberer $numberer,
        private readonly AuditLogger $audit,
    ) {}

    /** @param  list<array{product_id: int, counted_quantity: string}>  $items */
    public function create(Branch $branch, array $items, ?string $notes, int $userId): StockCount
    {
        return DB::transaction(function () use ($branch, $items, $notes, $userId) {
            $products = Product::query()->where('tenant_id', $branch->tenant_id)
                ->whereIn('id', array_column($items, 'product_id'))->get()->keyBy('id');

            foreach ($items as $i => $item) {
                $product = $products[$item['product_id']];
                if (! $product->track_inventory) {
                    throw new BusinessRuleException('Stock is not tracked for this product.', 'STOCK_NOT_TRACKED',
                        ["items.{$i}.product_id" => ['Stock is not tracked for this product.']]);
                }
                $this->adjustments->assertQuantityPrecision($product, (string) $item['counted_quantity'], "items.{$i}.counted_quantity");
            }

            $count = StockCount::query()->create([
                'tenant_id' => $branch->tenant_id,
                'branch_id' => $branch->id,
                'reference' => $this->numberer->next($branch->tenant_id, 'stock_count'),
                'status' => StockCountStatus::Draft,
                'notes' => $notes,
                'created_by' => $userId,
            ]);

            // Snapshot the system balance at the moment of counting. Sales or receipts that happen
            // between counting and completion are then preserved instead of being overwritten.
            $rows = $this->ledger->lockRows($branch->tenant_id, $branch->id, array_column($items, 'product_id'));
            foreach ($items as $item) {
                $count->items()->create([
                    'product_id' => $item['product_id'],
                    'expected_quantity' => Money::normalize((string) $rows[$item['product_id']]->quantity, 3),
                    'counted_quantity' => Money::normalize((string) $item['counted_quantity'], 3),
                ]);
            }

            $this->audit->log('stock_count.created', $count, null, ['reference' => $count->reference, 'items' => count($items)]);

            return $count;
        });
    }

    public function complete(StockCount $count, int $userId): StockCount
    {
        return DB::transaction(function () use ($count, $userId) {
            $count = $this->lockDraft($count);
            $items = $count->items()->get();
            $rows = $this->ledger->lockRows($count->tenant_id, $count->branch_id, $items->pluck('product_id')->all());
            $variances = [];

            foreach ($items as $item) {
                $row = $rows[$item->product_id];
                // Variance is measured against the balance when the count was taken.
                $expected = Money::normalize((string) ($item->expected_quantity ?? $row->quantity), 3);
                $variance = Money::round(Money::sub((string) $item->counted_quantity, $expected), 3);

                $item->expected_quantity = $expected;
                $item->variance = $variance;
                $item->save();

                if (! Money::isZero($variance)) {
                    $this->ledger->post($row, StockMovementType::StockCount, $variance, [
                        'reference' => $count,
                        'reason' => "Stock count {$count->reference}",
                        'user_id' => $userId,
                    ]);
                    $variances[] = ['product_id' => $item->product_id, 'expected' => $expected, 'counted' => (string) $item->counted_quantity, 'variance' => $variance];
                }
            }

            $count->forceFill([
                'status' => StockCountStatus::Completed,
                'completed_by' => $userId,
                'completed_at' => now(),
            ])->save();

            $this->audit->log('stock_count.completed', $count, ['status' => 'draft'], ['status' => 'completed', 'variances' => $variances]);

            return $count;
        });
    }

    public function cancel(StockCount $count): StockCount
    {
        return DB::transaction(function () use ($count) {
            $count = $this->lockDraft($count);
            $count->forceFill(['status' => StockCountStatus::Cancelled])->save();
            $this->audit->log('stock_count.cancelled', $count, ['status' => 'draft'], ['status' => 'cancelled']);

            return $count;
        });
    }

    private function lockDraft(StockCount $count): StockCount
    {
        $locked = StockCount::query()->lockForUpdate()->findOrFail($count->id);

        if ($locked->status !== StockCountStatus::Draft) {
            throw new BusinessRuleException("Stock count is already {$locked->status->value}.", 'INVALID_COUNT_STATE');
        }

        return $locked;
    }
}
