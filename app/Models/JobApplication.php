<?php

namespace App\Models;

use App\Enums\ApplicationStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A candidate's application. Applicants have no SmartPOS account; they use a reference + secret status token. */
class JobApplication extends Model
{
    protected $guarded = [];

    protected $hidden = ['status_token_hash'];

    protected $attributes = [
        'address' => null,
        'birth_date' => null,
        'work_experience' => null,
        'availability' => null,
        'cover_letter' => null,
        'return_status' => null,
        'applicant_message' => null,
        'rejection_reason' => null,
        'approved_by' => null,
        'approved_at' => null,
        'offer_position' => null,
        'offer_salary' => null,
        'offer_start_date' => null,
        'offer_terms' => null,
        'offer_sent_at' => null,
        'offer_responded_at' => null,
        'offer_response_source' => null,
        'onboarding_started_at' => null,
        'hired_membership_id' => null,
        'hired_at' => null,
        'closed_at' => null,
    ];

    protected function casts(): array
    {
        return [
            'status' => ApplicationStatus::class,
            'return_status' => ApplicationStatus::class,
            'birth_date' => 'date:Y-m-d',
            'offer_start_date' => 'date:Y-m-d',
            'offer_salary' => 'decimal:2',
            'approved_at' => 'datetime',
            'offer_sent_at' => 'datetime',
            'offer_responded_at' => 'datetime',
            'onboarding_started_at' => 'datetime',
            'hired_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }

    public function fullName(): string
    {
        return trim($this->first_name.' '.$this->last_name);
    }

    public function vacancy(): BelongsTo
    {
        return $this->belongsTo(Vacancy::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function interviews(): HasMany
    {
        return $this->hasMany(Interview::class, 'application_id');
    }

    public function documents(): HasMany
    {
        return $this->hasMany(ApplicationDocument::class, 'application_id');
    }

    public function onboardingTasks(): HasMany
    {
        return $this->hasMany(OnboardingTask::class, 'application_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(ApplicationEvent::class, 'application_id');
    }

    public function hiredMembership(): BelongsTo
    {
        return $this->belongsTo(TenantMembership::class, 'hired_membership_id');
    }
}
