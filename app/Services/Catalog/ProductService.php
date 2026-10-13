<?php

namespace App\Services\Catalog;

use App\Enums\ProductStatus;
use App\Models\PriceHistory;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\AuditLogger;
use App\Support\Money;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

class ProductService
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** @param  array<string, mixed>  $data  validated input including price and optional cost_price */
    public function create(Tenant $tenant, array $data, int $userId): Product
    {
        return DB::transaction(function () use ($tenant, $data, $userId) {
            $product = new Product(Arr::except($data, ['price', 'cost_price']));
            $product->tenant_id = $tenant->id;
            $product->price = Money::normalize((string) $data['price']);
            $product->cost_price = Money::normalize((string) ($data['cost_price'] ?? '0'), 4);
            $product->status = ProductStatus::Active;
            $product->save();

            PriceHistory::query()->create([
                'tenant_id' => $tenant->id,
                'product_id' => $product->id,
                'old_price' => null,
                'new_price' => $product->price,
                'old_cost' => null,
                'new_cost' => $product->cost_price,
                'reason' => 'Initial price',
                'changed_by' => $userId,
            ]);

            $this->audit->log('product.created', $product, null, $product->only([
                'sku', 'barcode', 'name', 'price', 'cost_price', 'tax_type', 'track_inventory',
            ]));

            return $product;
        });
    }

    /** Update non-price attributes. */
    public function update(Product $product, array $data): Product
    {
        $original = $product->getOriginal();
        $product->fill($data)->save();
        $this->audit->logChanges('product.updated', $product, $original);

        return $product;
    }

    /** Change selling price and/or reference cost, recording price history. */
    public function changePrice(Product $product, ?string $price, ?string $cost, ?string $reason, ?int $userId): Product
    {
        return DB::transaction(function () use ($product, $price, $cost, $reason, $userId) {
            $product = Product::query()->lockForUpdate()->findOrFail($product->id);

            $oldPrice = (string) $product->price;
            $oldCost = (string) $product->cost_price;
            $newPrice = $price !== null ? Money::normalize($price) : $oldPrice;
            $newCost = $cost !== null ? Money::normalize($cost, 4) : $oldCost;

            if (Money::cmp($oldPrice, $newPrice) === 0 && Money::cmp($oldCost, $newCost) === 0) {
                return $product;
            }

            $product->price = $newPrice;
            $product->cost_price = $newCost;
            $product->save();

            PriceHistory::query()->create([
                'tenant_id' => $product->tenant_id,
                'product_id' => $product->id,
                'old_price' => $oldPrice,
                'new_price' => $newPrice,
                'old_cost' => $oldCost,
                'new_cost' => $newCost,
                'reason' => $reason,
                'changed_by' => $userId,
            ]);

            $this->audit->log('product.price_changed', $product,
                ['price' => $oldPrice, 'cost_price' => $oldCost],
                ['price' => $newPrice, 'cost_price' => $newCost],
                ['reason' => $reason]);

            return $product;
        });
    }

    public function archive(Product $product): Product
    {
        $product->forceFill(['status' => ProductStatus::Archived, 'archived_at' => now()])->save();
        $this->audit->log('product.archived', $product, ['status' => 'active'], ['status' => 'archived']);

        return $product;
    }

    public function restore(Product $product): Product
    {
        $product->forceFill(['status' => ProductStatus::Active, 'archived_at' => null])->save();
        $this->audit->log('product.restored', $product, ['status' => 'archived'], ['status' => 'active']);

        return $product;
    }
}
