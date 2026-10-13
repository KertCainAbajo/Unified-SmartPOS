<?php

namespace App\Services\Inventory;

use App\Enums\StockMovementType;
use App\Exceptions\BusinessRuleException;
use App\Models\Inventory;
use App\Models\StockMovement;
use App\Services\NotificationService;
use App\Support\Money;
use App\Support\Permissions;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * The only component allowed to change stock balances.
 *
 * Callers must run inside a DB transaction, lock rows with lockRows() first, then post() changes.
 * Every change writes an immutable stock_movements row with before/after quantities.
 */
class StockLedger
{
    public function __construct(private readonly NotificationService $notifications) {}

    /**
     * Lock (SELECT … FOR UPDATE) the inventory rows for the given products at a branch,
     * creating zero-balance rows when missing. Rows are locked in ascending product order so
     * concurrent transactions acquire locks in the same order and cannot deadlock each other.
     *
     * @param  list<int>  $productIds
     * @return array<int, Inventory> keyed by product id
     */
    public function lockRows(int $tenantId, int $branchId, array $productIds): array
    {
        $this->assertInTransaction();

        $productIds = array_values(array_unique(array_map('intval', $productIds)));
        sort($productIds);

        if ($productIds === []) {
            return [];
        }

        $now = now();
        Inventory::query()->insertOrIgnore(array_map(fn (int $productId) => [
            'tenant_id' => $tenantId,
            'branch_id' => $branchId,
            'product_id' => $productId,
            'quantity' => '0.000',
            'average_cost' => '0.0000',
            'created_at' => $now,
            'updated_at' => $now,
        ], $productIds));

        return Inventory::query()
            ->where('tenant_id', $tenantId)
            ->where('branch_id', $branchId)
            ->whereIn('product_id', $productIds)
            ->orderBy('product_id')
            ->lockForUpdate()
            ->with('product')
            ->get()
            ->keyBy('product_id')
            ->all();
    }

    /**
     * Apply a signed quantity change to a locked inventory row and record the movement.
     *
     * @param  array{unit_cost?: string|null, reason?: string|null, reference?: Model|null, user_id?: int|null, allow_negative?: bool}  $options
     */
    public function post(Inventory $row, StockMovementType $type, string $change, array $options = []): StockMovement
    {
        $this->assertInTransaction();

        $change = Money::normalize($change, 3);
        if (Money::isZero($change)) {
            throw new LogicException('Stock movements must change the quantity.');
        }

        $before = Money::normalize((string) $row->quantity, 3);
        $after = Money::round(Money::add($before, $change), 3);
        $product = $row->product;

        if (Money::isNegative($after) && ! ($options['allow_negative'] ?? false)) {
            throw new BusinessRuleException(
                "Insufficient stock for {$product->sku} ({$product->name}). Available: {$before}.",
                'INSUFFICIENT_STOCK',
                ['product_id' => [(string) $product->id]],
            );
        }

        $currentAverage = (string) $row->average_cost;
        $unitCost = $options['unit_cost'] ?? null;

        if (Money::isPositive($change) && $unitCost !== null) {
            $row->average_cost = $this->weightedAverage($before, $currentAverage, $change, $unitCost);
        }

        $row->quantity = $after;
        $row->save();

        $movement = StockMovement::query()->create([
            'tenant_id' => $row->tenant_id,
            'branch_id' => $row->branch_id,
            'product_id' => $row->product_id,
            'type' => $type,
            'quantity_change' => $change,
            'quantity_before' => $before,
            'quantity_after' => $after,
            'unit_cost' => Money::normalize($unitCost ?? $currentAverage, 4),
            'reason' => $options['reason'] ?? null,
            'reference_type' => isset($options['reference']) ? $options['reference']->getMorphClass() : null,
            'reference_id' => isset($options['reference']) ? $options['reference']->getKey() : null,
            'user_id' => $options['user_id'] ?? null,
        ]);

        if (Money::isNegative($change)) {
            $this->notifyIfCrossedReorderLevel($row, $before, $after);
        }

        return $movement;
    }

    /**
     * Weighted-average cost after receiving stock. Negative on-hand stock is treated as zero so a
     * prior oversell does not distort the cost of newly received goods.
     */
    public function weightedAverage(string $quantityBefore, string $averageBefore, string $quantityIn, string $unitCost): string
    {
        $base = Money::max($quantityBefore, '0');
        $totalQuantity = Money::add($base, $quantityIn);

        if (! Money::isPositive($totalQuantity)) {
            return Money::normalize($unitCost, 4);
        }

        $totalValue = Money::add(Money::mul($base, $averageBefore), Money::mul($quantityIn, $unitCost));

        return Money::round(Money::div($totalValue, $totalQuantity), 4);
    }

    private function notifyIfCrossedReorderLevel(Inventory $row, string $before, string $after): void
    {
        $product = $row->product;
        $level = (string) ($row->reorder_level ?? $product->reorder_level);

        if (! $product->track_inventory || ! Money::isPositive($level)) {
            return;
        }

        if (Money::cmp($before, $level) > 0 && Money::cmp($after, $level) <= 0) {
            $tenantId = (int) $row->tenant_id;
            $branchId = (int) $row->branch_id;
            $this->notifications->afterCommit(fn () => $this->notifications->notifyPermissionHolders(
                $tenantId,
                $branchId,
                Permissions::INVENTORY_ADJUST,
                'low_stock',
                "Low stock: {$product->name}",
                "{$product->sku} is at {$after} {$product->unit} (reorder level {$level}).",
                ['product_id' => $product->id, 'branch_id' => $branchId, 'quantity' => $after, 'reorder_level' => $level],
            ));
        }
    }

    private function assertInTransaction(): void
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Stock changes must run inside a database transaction.');
        }
    }
}
