<?php

namespace App\Models;

use App\Enums\RegisterSessionStatus;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable(['branch_id', 'code', 'name', 'is_active'])]
class Register extends Model
{
    /** Mirrors database defaults so freshly created instances are complete. */
    protected $attributes = [
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(RegisterSession::class);
    }

    public function openSession(): HasOne
    {
        return $this->hasOne(RegisterSession::class)->where('status', RegisterSessionStatus::Open->value);
    }
}
