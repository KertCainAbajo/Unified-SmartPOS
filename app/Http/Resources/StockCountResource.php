<?php

namespace App\Http\Resources;

use App\Models\StockCount;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin StockCount */
class StockCountResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'branch_id' => $this->branch_id,
            'status' => $this->status,
            'notes' => $this->notes,
            'items' => $this->whenLoaded('items', fn () => $this->items->map(fn ($item) => [
                'product_id' => $item->product_id,
                'product' => $item->relationLoaded('product') ? $item->product->only(['id', 'sku', 'name', 'unit']) : null,
                'counted_quantity' => $item->counted_quantity,
                'expected_quantity' => $item->expected_quantity,
                'variance' => $item->variance,
            ])),
            'created_by' => $this->created_by,
            'completed_by' => $this->completed_by,
            'completed_at' => $this->completed_at,
            'created_at' => $this->created_at,
        ];
    }
}
