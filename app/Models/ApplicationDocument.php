<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A file uploaded for an application, stored on the private disk (never publicly reachable). */
class ApplicationDocument extends Model
{
    protected $guarded = [];

    protected $hidden = ['path'];

    protected $attributes = ['uploaded_by' => null, 'verified_at' => null, 'verified_by' => null];

    protected function casts(): array
    {
        return ['verified_at' => 'datetime', 'size' => 'integer'];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(JobApplication::class, 'application_id');
    }
}
