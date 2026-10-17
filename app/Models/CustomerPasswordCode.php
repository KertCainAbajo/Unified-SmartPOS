<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A hashed one-time code emailed to a shop customer who forgot their password. */
class CustomerPasswordCode extends Model
{
    protected $guarded = [];

    protected $hidden = ['code_hash'];

    protected $attributes = ['attempts' => 0, 'used_at' => null];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'used_at' => 'datetime', 'attempts' => 'integer'];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(CustomerAccount::class, 'customer_account_id');
    }

    public function isUsable(): bool
    {
        return $this->used_at === null && $this->expires_at->isFuture();
    }
}
