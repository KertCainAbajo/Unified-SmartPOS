<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** Append-only application history. Rows are never updated or deleted, so earlier decisions are never overwritten. */
class ApplicationEvent extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = [];

    protected $attributes = ['from_status' => null, 'to_status' => null, 'actor_user_id' => null, 'interview_id' => null, 'note' => null, 'metadata' => null];

    protected function casts(): array
    {
        return ['metadata' => 'array'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Application history is append-only.'));
        static::deleting(fn () => throw new LogicException('Application history is append-only.'));
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}
