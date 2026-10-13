<?php

namespace App\Http\Resources;

use App\Models\StockMovement;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin StockMovement */
class StockMovementResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'product_id' => $this->product_id,
            'product' => $this->whenLoaded('product', fn () => $this->product->only(['id', 'sku', 'name', 'unit'])),
            'type' => $this->type,
            'quantity_change' => $this->quantity_change,
            'quantity_before' => $this->quantity_before,
            'quantity_after' => $this->quantity_after,
            'unit_cost' => $this->unit_cost,
            'reason' => $this->reason,
            'reference_type' => $this->reference_type,
            'reference_id' => $this->reference_id,
            'user' => $this->whenLoaded('user', fn () => $this->user?->only(['id', 'name'])),
            'created_at' => $this->created_at,
        ];
    }
}
