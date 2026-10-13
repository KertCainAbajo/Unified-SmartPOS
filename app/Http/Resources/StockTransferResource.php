<?php

namespace App\Http\Resources;

use App\Models\StockTransfer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin StockTransfer */
class StockTransferResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'from_branch_id' => $this->from_branch_id,
            'to_branch_id' => $this->to_branch_id,
            'status' => $this->status,
            'notes' => $this->notes,
            'items' => $this->whenLoaded('items', fn () => $this->items->map(fn ($item) => [
                'id' => $item->id,
                'product_id' => $item->product_id,
                'product' => $item->relationLoaded('product') ? $item->product->only(['id', 'sku', 'name', 'unit']) : null,
                'quantity' => $item->quantity,
                'quantity_received' => $item->quantity_received,
            ])),
            'created_by' => $this->created_by,
            'dispatched_by' => $this->dispatched_by,
            'dispatched_at' => $this->dispatched_at,
            'received_by' => $this->received_by,
            'received_at' => $this->received_at,
            'created_at' => $this->created_at,
        ];
    }
}
