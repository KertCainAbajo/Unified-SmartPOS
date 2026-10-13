<?php

namespace App\Services\Purchasing;

use App\Enums\PurchaseOrderStatus;
use App\Enums\StockMovementType;
use App\Exceptions\BusinessRuleException;
use App\Models\Branch;
use App\Models\GoodsReceipt;
use App\Models\PriceHistory;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Services\AuditLogger;
use App\Services\DocumentNumberer;
use App\Services\Inventory\StockAdjustmentService;
use App\Services\Inventory\StockLedger;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Receiving goods adds stock at the branch, updates the branch weighted-average cost,
 * updates the product's reference cost (with price history), and advances the purchase order.
 */
class GoodsReceiptService
{
    public function __construct(
        private readonly StockLedger $ledger,
        private readonly StockAdjustmentService $quantities,
        private readonly DocumentNumberer $numberer,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @param  array{purchase_order_id?: int|null, supplier_id?: int|null, supplier_invoice_number?: string|null, notes?: string|null,
     *               items: list<array{purchase_order_item_id?: int|null, product_id?: int|null, quantity: string|int|float, unit_cost?: string|int|float|null}>}  $data
     */
    public function receive(Branch $branch, array $data, int $userId): GoodsReceipt
    {
        return DB::transaction(function () use ($branch, $data, $userId) {
            $order = null;
            $poItems = collect();

            if (! empty($data['purchase_order_id'])) {
                $order = PurchaseOrder::query()->lockForUpdate()->findOrFail($data['purchase_order_id']);
                if ($order->branch_id !== $branch->id) {
                    throw new BusinessRuleException('Goods must be received at the purchase order branch.', 'WRONG_BRANCH');
                }
                if (! in_array($order->status, [PurchaseOrderStatus::Ordered, PurchaseOrderStatus::PartiallyReceived], true)) {
                    throw new BusinessRuleException("Purchase order is {$order->status->value}; only ordered POs can be received.", 'INVALID_PO_STATE');
                }
                $poItems = $order->items()->lockForUpdate()->get()->keyBy('id');
            }

            // Resolve each line to product, quantity and cost.
            $lines = [];
            foreach ($data['items'] as $i => $item) {
                $poItem = null;
                if ($order) {
                    $poItem = $poItems[$item['purchase_order_item_id'] ?? 0] ?? null;
                    if (! $poItem) {
                        throw new BusinessRuleException('Item does not belong to this purchase order.', 'INVALID_PO_ITEM',
                            ["items.{$i}.purchase_order_item_id" => ['Item does not belong to this purchase order.']]);
                    }
                }

                $product = Product::query()->where('tenant_id', $branch->tenant_id)
                    ->findOrFail($poItem?->product_id ?? $item['product_id']);
                if (! $product->track_inventory) {
                    throw new BusinessRuleException('Stock is not tracked for this product.', 'STOCK_NOT_TRACKED',
                        ["items.{$i}.product_id" => ['Stock is not tracked for this product.']]);
                }

                $quantity = Money::normalize((string) $item['quantity'], 3);
                $this->quantities->assertQuantityPrecision($product, $quantity, "items.{$i}.quantity");

                if ($poItem) {
                    $remaining = Money::sub((string) $poItem->quantity_ordered, (string) $poItem->quantity_received);
                    if (Money::cmp($quantity, $remaining) > 0) {
                        throw new BusinessRuleException("Cannot receive more than the {$remaining} outstanding.", 'OVER_RECEIPT',
                            ["items.{$i}.quantity" => ["Outstanding quantity is {$remaining}."]]);
                    }
                }

                $unitCost = isset($item['unit_cost'])
                    ? Money::normalize((string) $item['unit_cost'], 4)
                    : Money::normalize((string) ($poItem?->unit_cost ?? $product->cost_price), 4);

                $lines[] = compact('poItem', 'product', 'quantity', 'unitCost');
            }

            $receipt = GoodsReceipt::query()->create([
                'tenant_id' => $branch->tenant_id,
                'branch_id' => $branch->id,
                'purchase_order_id' => $order?->id,
                'supplier_id' => $order?->supplier_id ?? ($data['supplier_id'] ?? null),
                'reference' => $this->numberer->next($branch->tenant_id, 'goods_receipt'),
                'supplier_invoice_number' => $data['supplier_invoice_number'] ?? null,
                'received_at' => now(),
                'total_cost' => '0.00',
                'notes' => $data['notes'] ?? null,
                'received_by' => $userId,
            ]);

            $rows = $this->ledger->lockRows($branch->tenant_id, $branch->id, array_map(fn ($l) => $l['product']->id, $lines));
            $total = '0';

            foreach ($lines as ['poItem' => $poItem, 'product' => $product, 'quantity' => $quantity, 'unitCost' => $unitCost]) {
                $lineTotal = Money::round(Money::mul($quantity, $unitCost));
                $total = Money::add($total, $lineTotal);

                $receipt->items()->create([
                    'purchase_order_item_id' => $poItem?->id,
                    'product_id' => $product->id,
                    'quantity' => $quantity,
                    'unit_cost' => $unitCost,
                    'line_total' => $lineTotal,
                ]);

                $this->ledger->post($rows[$product->id], StockMovementType::PurchaseReceipt, $quantity, [
                    'unit_cost' => $unitCost,
                    'reference' => $receipt,
                    'reason' => "Goods receipt {$receipt->reference}",
                    'user_id' => $userId,
                ]);

                if ($poItem) {
                    $poItem->quantity_received = Money::round(Money::add((string) $poItem->quantity_received, $quantity), 3);
                    $poItem->save();
                }

                $this->updateReferenceCost($product, $unitCost, $receipt->reference, $userId);
            }

            $receipt->total_cost = Money::round($total);
            $receipt->save();

            if ($order) {
                $fullyReceived = $poItems->every(fn ($i) => Money::cmp((string) $i->quantity_received, (string) $i->quantity_ordered) >= 0);
                $order->status = $fullyReceived ? PurchaseOrderStatus::Received : PurchaseOrderStatus::PartiallyReceived;
                $order->save();
            }

            $this->audit->log('goods_receipt.posted', $receipt, null, [
                'reference' => $receipt->reference,
                'purchase_order_id' => $order?->id,
                'total_cost' => $receipt->total_cost,
                'items' => count($lines),
            ]);

            return $receipt;
        });
    }

    private function updateReferenceCost(Product $product, string $unitCost, string $reference, int $userId): void
    {
        $product = Product::query()->lockForUpdate()->findOrFail($product->id);
        $oldCost = (string) $product->cost_price;

        if (Money::cmp($oldCost, $unitCost) === 0) {
            return;
        }

        $product->cost_price = $unitCost;
        $product->save();

        PriceHistory::query()->create([
            'tenant_id' => $product->tenant_id,
            'product_id' => $product->id,
            'old_price' => $product->price,
            'new_price' => $product->price,
            'old_cost' => $oldCost,
            'new_cost' => $unitCost,
            'reason' => "Cost from goods receipt {$reference}",
            'changed_by' => $userId,
        ]);
    }
}
