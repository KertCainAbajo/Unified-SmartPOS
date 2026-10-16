<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One line of an online order, with the name and price captured when it was placed. */
class OnlineOrderItem extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['unit_price' => 'decimal:2', 'quantity' => 'decimal:3', 'line_total' => 'decimal:2'];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(OnlineOrder::class, 'online_order_id');
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
