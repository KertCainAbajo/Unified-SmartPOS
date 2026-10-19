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

    /** The shop account was moved to a platform administrator login; it no longer signs in to the shop. */
    public const STATUS_MOVED_TO_ADMIN = 'moved_to_admin';

    /** Signed up but has not entered the code emailed to them yet; cannot sign in or order. */
    public const STATUS_UNVERIFIED = 'unverified';

    protected $guarded = [];

    /** True when this email belongs to a platform administrator: such an email no longer shops as a customer. */
    public static function emailIsPlatformAdmin(?string $email): bool
    {
        return $email !== null && $email !== '' && User::query()->where('email', mb_strtolower($email))->where('is_platform_admin', true)->exists();
    }

    /** Close every shop account using this email (it moved to a platform administrator login). Returns how many. */
    public static function closeForAdmin(string $email): int
    {
        return static::query()->where('email', mb_strtolower($email))->where('status', 'active')
            ->update(['status' => self::STATUS_MOVED_TO_ADMIN, 'remember_token' => null]);
    }

    protected $hidden = ['password', 'remember_token'];

    protected $attributes = [
        'status' => 'active',
        'customer_id' => null,
        'last_login_at' => null,
    ];

    protected function casts(): array
    {
        return ['password' => 'hashed', 'last_login_at' => 'datetime', 'email_verified_at' => 'datetime'];
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
