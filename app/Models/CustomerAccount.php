<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

/**
 * A shopper's account on one store's online shop. Completely separate from staff `users`: a customer account
 * can never sign in to the POS, and it only ever sees its own orders.
 */
class CustomerAccount extends Authenticatable
{
    use Notifiable;

    protected $guarded = [];

    protected $hidden = ['password', 'remember_token'];

    protected $attributes = [
        'status' => 'active',
        'customer_id' => null,
        'last_login_at' => null,
    ];

    protected function casts(): array
    {
        return ['password' => 'hashed', 'last_login_at' => 'datetime'];
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** The POS customer record this account shops as, so counter and online history stay together. */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(OnlineOrder::class);
    }

    public function passwordCodes(): HasMany
    {
        return $this->hasMany(CustomerPasswordCode::class);
    }
}
