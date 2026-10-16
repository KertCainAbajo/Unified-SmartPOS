<?php

namespace App\Models;

use App\Enums\OnlineOrderStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** An order placed on the online shop, picked up and paid for at the branch. */
class OnlineOrder extends Model
{
    protected $guarded = [];

    protected $attributes = [
        'status' => 'pending',
        'note' => null,
        'confirmed_at' => null,
        'ready_at' => null,
        'completed_at' => null,
        'cancelled_at' => null,
        'cancelled_by' => null,
        'cancel_reason' => null,
        'sale_id' => null,
        'handled_by' => null,
    ];

    protected function casts(): array
    {
        return [
            'status' => OnlineOrderStatus::class,
            'estimated_total' => 'decimal:2',
            'placed_at' => 'datetime',
            'confirmed_at' => 'datetime',
            'ready_at' => 'datetime',
            'completed_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function items(): HasMany
    {
        return $this->hasMany(OnlineOrderItem::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(CustomerAccount::class, 'customer_account_id');
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    public function handler(): BelongsTo
    {
        return $this->belongsTo(User::class, 'handled_by');
    }
}
