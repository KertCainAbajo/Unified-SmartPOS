<?php

namespace App\Models;

use App\Enums\PaymentStatus;
use App\Enums\SaleDiscountType;
use App\Enums\SaleStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Completed sales are never deleted; reversals are voids or refunds. */
class Sale extends Model
{
    protected $guarded = [];

    protected $hidden = ['request_hash'];

    protected function casts(): array
    {
        return [
            'status' => SaleStatus::class,
            'payment_status' => PaymentStatus::class,
            'discount_type' => SaleDiscountType::class,
            'subtotal' => 'decimal:2',
            'discount_total' => 'decimal:2',
            'vat_exemption_amount' => 'decimal:2',
            'vatable_sales' => 'decimal:2',
            'vat_exempt_sales' => 'decimal:2',
            'zero_rated_sales' => 'decimal:2',
            'vat_amount' => 'decimal:2',
            'total' => 'decimal:2',
            'amount_tendered' => 'decimal:2',
            'change_due' => 'decimal:2',
            'refunded_total' => 'decimal:2',
            'business_date' => 'date:Y-m-d',
            'sold_at' => 'datetime',
            'voided_at' => 'datetime',
        ];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function register(): BelongsTo
    {
        return $this->belongsTo(Register::class);
    }

    public function registerSession(): BelongsTo
    {
        return $this->belongsTo(RegisterSession::class);
    }

    public function cashier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cashier_id');
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(SaleItem::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function refunds(): HasMany
    {
        return $this->hasMany(Refund::class);
    }
}
