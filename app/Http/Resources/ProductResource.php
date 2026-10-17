<?php

namespace App\Http\Resources;

use App\Models\Product;
use App\Services\Catalog\ProductImageService;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Product */
class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $context = app(TenantContext::class);
        $showCost = $context->hasTenant() && ($context->can('products.price') || $context->can('reports.financial'));

        return [
            'id' => $this->id,
            'sku' => $this->sku,
            'barcode' => $this->barcode,
            'name' => $this->name,
            'description' => $this->description,
            'image_url' => $this->image_path ? route('api.v1.tenants.products.image', [$this->tenant_id, $this->id, 'v' => ProductImageService::version($this->resource)], false) : null,
            'category_id' => $this->category_id,
            'category' => $this->whenLoaded('category', fn () => $this->category ? ['id' => $this->category->id, 'name' => $this->category->name] : null),
            'unit' => $this->unit,
            'price' => $this->price,
            'cost_price' => $this->when($showCost, $this->cost_price),
            'tax_type' => $this->tax_type,
            'track_inventory' => $this->track_inventory,
            'allow_decimal_quantity' => $this->allow_decimal_quantity,
            'reorder_level' => $this->reorder_level,
            'show_online' => $this->show_online,
            'status' => $this->status,
            'archived_at' => $this->archived_at,
            'stock' => $this->whenLoaded('inventory', fn () => $this->inventory->map(fn ($row) => [
                'branch_id' => $row->branch_id,
                'quantity' => $row->quantity,
            ])->values()),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
