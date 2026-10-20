<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A sign-in waiting for the emailed code (the password was already correct). */
class LoginChallenge extends Model
{
    protected $fillable = ['user_id', 'challenge_hash', 'code_hash', 'attempts', 'device_name', 'ip_address', 'sent_at', 'expires_at', 'used_at'];

    protected $hidden = ['challenge_hash', 'code_hash'];

    protected function casts(): array
    {
        return ['sent_at' => 'datetime', 'expires_at' => 'datetime', 'used_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
