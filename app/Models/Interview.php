<?php

namespace App\Models;

use App\Enums\ApplicationStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One interview round at one stage. Scores, feedback and decision are confidential (staff only). */
class Interview extends Model
{
    public const STATUS_SCHEDULED = 'scheduled';

    public const STATUS_RESCHEDULE_REQUESTED = 'reschedule_requested';

    public const STATUS_COMPLETED = 'completed';

    public const STATUS_CANCELLED = 'cancelled';

    public const STATUS_NO_SHOW = 'no_show';

    /** Interviews that are still expected to happen. */
    public const OPEN_STATUSES = [self::STATUS_SCHEDULED, self::STATUS_RESCHEDULE_REQUESTED];

    public const MODES = ['in_person', 'phone', 'video'];

    /** Allowed decisions per interview stage. */
    public const DECISIONS = [
        'hr_interview' => ['pass', 'reject', 'request_info'],
        'manager_interview' => ['recommend', 'reject', 'reassess'],
        'owner_final_interview' => ['approve', 'reject', 'another_interview'],
    ];

    protected $guarded = [];

    protected $attributes = [
        'round' => 1,
        'mode' => 'in_person',
        'location' => null,
        'status' => self::STATUS_SCHEDULED,
        'reschedule_count' => 0,
        'cancel_reason' => null,
        'criteria' => null,
        'score' => null,
        'feedback' => null,
        'decision' => null,
        'decision_reason' => null,
        'decided_at' => null,
        'decided_by' => null,
        'scheduled_by' => null,
    ];

    protected function casts(): array
    {
        return [
            'stage' => ApplicationStatus::class,
            'scheduled_at' => 'datetime',
            'decided_at' => 'datetime',
            'criteria' => 'array',
            'score' => 'integer',
            'round' => 'integer',
            'reschedule_count' => 'integer',
        ];
    }

    public function isOpen(): bool
    {
        return in_array($this->status, self::OPEN_STATUSES, true);
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(JobApplication::class, 'application_id');
    }

    public function interviewer(): BelongsTo
    {
        return $this->belongsTo(TenantMembership::class, 'interviewer_membership_id');
    }
}
