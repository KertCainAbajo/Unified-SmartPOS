<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One item of a hire's onboarding checklist. Required items gate account provisioning. */
class OnboardingTask extends Model
{
    protected $guarded = [];

    protected $attributes = ['required' => true, 'completed_at' => null, 'completed_by' => null, 'note' => null];

    protected function casts(): array
    {
        return ['required' => 'boolean', 'completed_at' => 'datetime'];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(JobApplication::class, 'application_id');
    }
}
