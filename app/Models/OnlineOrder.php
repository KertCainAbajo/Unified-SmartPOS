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
        'delivery_lat' => null,
        'delivery_lng' => null,
        'rider_user_id' => null,
        'rider_lat' => null,
        'rider_lng' => null,
        'rider_location_at' => null,
        'delivered_at' => null,
        'delivery_issue' => null,
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
            'delivered_at' => 'datetime',
            'rider_location_at' => 'datetime',
            'delivery_lat' => 'float',
            'delivery_lng' => 'float',
            'rider_lat' => 'float',
            'rider_lng' => 'float',
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
        // Null when the order was loaded without its cash or total columns (e.g. a short list), instead of failing.
        return Attribute::get(fn () => ! array_key_exists('cash_amount', $this->attributes) || ! array_key_exists('estimated_total', $this->attributes) || $this->cash_amount === null ? null
            : Money::round(Money::max('0', Money::sub((string) $this->cash_amount, (string) $this->estimated_total))));
    }

    public function items(): HasMany
    {
        return $this->hasMany(OnlineOrderItem::class);
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
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

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_user_id');
    }

    /** The rider is on the way: delivery order, out for delivery and not yet handed over. */
    public function isBeingDelivered(): bool
    {
        return $this->isDelivery() && $this->status === OnlineOrderStatus::OutForDelivery && $this->delivered_at === null;
    }

    /**
     * What the customer who placed the order may see. The rider's position is only shared while that rider is on the
     * way with this order; staff-only fields stay hidden.
     */
    public function customerView(): array
    {
        $hidden = ['rider_user_id', 'handled_by', 'sale_id', 'delivery_issue', 'tenant_id', 'customer_account_id'];
        if (! $this->isBeingDelivered()) {
            $hidden = [...$hidden, 'rider_lat', 'rider_lng', 'rider_location_at'];
        }

        return $this->makeHidden($hidden)->toArray();
    }

    public function handler(): BelongsTo
    {
        return $this->belongsTo(User::class, 'handled_by');
    }
}
