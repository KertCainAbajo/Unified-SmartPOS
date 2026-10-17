<?php

namespace App\Models;

use App\Enums\OnlineOrderStatus;
use App\Support\Money;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** An order placed on the online shop: picked up at the branch, or delivered and paid in cash to the rider. */
class OnlineOrder extends Model
{
    protected $guarded = [];

    protected $appends = ['change_due'];

    protected $attributes = [
        'status' => 'pending',
        'fulfilment' => 'pickup',
        'delivery_address' => null,
        'cash_amount' => null,
        'rider_name' => null,
        'rider_phone' => null,
        'dispatched_at' => null,
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
            'cash_amount' => 'decimal:2',
            'placed_at' => 'datetime',
            'dispatched_at' => 'datetime',
            'confirmed_at' => 'datetime',
            'ready_at' => 'datetime',
            'completed_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function isDelivery(): bool
    {
        return $this->fulfilment === 'delivery';
    }

    /** Change the rider must bring: cash the customer pays with, minus the estimated total. */
    protected function changeDue(): Attribute
    {
        return Attribute::get(fn () => $this->cash_amount === null ? null
            : Money::round(Money::max('0', Money::sub((string) $this->cash_amount, (string) $this->estimated_total))));
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
