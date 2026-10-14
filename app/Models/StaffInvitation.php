<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A single-use, expiring activation or recovery code. Only the SHA-256 hash of the code is stored.
 */
class StaffInvitation extends Model
{
    public const PURPOSE_ACTIVATION = 'activation';

    public const PURPOSE_RECOVERY = 'recovery';

    public const CHANNEL_EMAIL = 'email';

    public const CHANNEL_MANUAL = 'manual';

    public const MAX_FAILED_ATTEMPTS = 5;

    protected $guarded = [];

    protected $hidden = ['code_hash'];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'used_at' => 'datetime',
            'revoked_at' => 'datetime',
            'failed_attempts' => 'integer',
        ];
    }

    /** Not used, not revoked (may still be expired). */
    public function scopeOutstanding(Builder $query): Builder
    {
        return $query->whereNull('used_at')->whereNull('revoked_at');
    }

    public function isUsable(): bool
    {
        return $this->used_at === null && $this->revoked_at === null && $this->expires_at->isFuture();
    }

    public function membership(): BelongsTo
    {
        return $this->belongsTo(TenantMembership::class, 'membership_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
