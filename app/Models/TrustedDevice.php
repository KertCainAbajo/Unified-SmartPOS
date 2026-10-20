<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A browser the user confirmed with an emailed sign-in code; it skips the code until it expires. */
class TrustedDevice extends Model
{
    protected $fillable = ['user_id', 'token_hash', 'label', 'ip_address', 'last_used_at', 'expires_at'];

    protected $hidden = ['token_hash'];

    protected function casts(): array
    {
        return ['last_used_at' => 'datetime', 'expires_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
