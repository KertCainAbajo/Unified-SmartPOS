<?php

namespace App\Services\Inventory;

use App\Enums\StockMovementType;
use App\Exceptions\BusinessRuleException;
use App\Models\Branch;
use App\Models\Product;
use App\Models\StockMovement;
use App\Services\AuditLogger;
use App\Support\Money;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class StockAdjustmentService
{
    public const REASONS = ['opening', 'damaged', 'expired', 'lost', 'theft', 'found', 'internal_use', 'correction', 'other'];

    public function __construct(
        private readonly StockLedger $ledger,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Apply signed quantity changes. Adjustments can never take stock below zero.
     *
     * @param  list<array{product_id: int, quantity_change: string, unit_cost?: string|null}>  $items
     * @return Collection<int, StockMovement>
     */
    public function adjust(Branch $branch, string $reason, ?string $notes, array $items, int $userId): Collection
    {
        return DB::transaction(function () use ($branch, $reason, $notes, $items, $userId) {
            $products = Product::query()
                ->where('tenant_id', $branch->tenant_id)
                ->whereIn('id', array_column($items, 'product_id'))
                ->get()->keyBy('id');

            foreach ($items as $i => $item) {
                $product = $products[$item['product_id']] ?? null;
                if (! $product?->track_inventory) {
                    throw new BusinessRuleException('Stock is not tracked for this product.', 'STOCK_NOT_TRACKED',
                        ["items.{$i}.product_id" => ['Stock is not tracked for this product.']]);
                }
                $this->assertQuantityPrecision($product, (string) $item['quantity_change'], "items.{$i}.quantity_change");
            }

            $rows = $this->ledger->lockRows($branch->tenant_id, $branch->id, array_column($items, 'product_id'));
            $type = $reason === 'opening' ? StockMovementType::Opening : StockMovementType::Adjustment;
            $label = $notes ? "{$reason}: {$notes}" : $reason;

            $movements = collect($items)->map(fn (array $item) => $this->ledger->post(
                $rows[$item['product_id']],
                $type,
                (string) $item['quantity_change'],
                [
                    'unit_cost' => isset($item['unit_cost']) ? (string) $item['unit_cost'] : null,
                    'reason' => mb_substr($label, 0, 255),
                    'user_id' => $userId,
                ],
            ));

            $this->audit->log('inventory.adjusted', $branch, null, [
                'reason' => $reason,
                'notes' => $notes,
                'items' => $movements->map(fn (StockMovement $m) => [
                    'product_id' => $m->product_id,
                    'change' => $m->quantity_change,
                    'before' => $m->quantity_before,
                    'after' => $m->quantity_after,
                ])->all(),
            ], branchId: $branch->id);

            return $movements;
        });
    }

    public function assertQuantityPrecision(Product $product, string $quantity, string $field): void
    {
        if (! $product->allow_decimal_quantity && ! Money::isZero(Money::sub($quantity, Money::round($quantity, 0)))) {
            throw new BusinessRuleException("{$product->name} must be sold and counted in whole units.", 'WHOLE_UNITS_ONLY',
                [$field => ['Whole quantities only for this product.']]);
        }
    }
}
