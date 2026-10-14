<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Personal and employment details of a staff member in one business. Personal data: restrict access. */
#[Fillable([
    'job_title', 'hire_date', 'phone', 'address', 'birth_date',
    'emergency_contact_name', 'emergency_contact_phone', 'notes',
])]
class StaffProfile extends Model
{
    public const FIELDS = [
        'job_title', 'hire_date', 'phone', 'address', 'birth_date',
        'emergency_contact_name', 'emergency_contact_phone', 'notes',
    ];

    protected function casts(): array
    {
        return [
            'hire_date' => 'date:Y-m-d',
            'birth_date' => 'date:Y-m-d',
        ];
    }

    public function membership(): BelongsTo
    {
        return $this->belongsTo(TenantMembership::class, 'membership_id');
    }
}
