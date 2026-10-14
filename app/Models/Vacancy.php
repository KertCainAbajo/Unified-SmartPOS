<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** An open position at a branch. The hired employee receives `role_id` at `branch_id`. */
class Vacancy extends Model
{
    public const STATUSES = ['draft', 'open', 'closed'];

    /** Document types an applicant can upload. */
    public const DOCUMENT_TYPES = [
        'resume' => 'Resume / CV',
        'valid_id' => 'Valid government ID',
        'nbi_clearance' => 'NBI clearance',
        'barangay_clearance' => 'Barangay clearance',
        'medical_certificate' => 'Medical certificate',
        'birth_certificate' => 'Birth certificate (PSA)',
        'diploma' => 'Diploma / transcript',
        'other' => 'Other',
    ];

    protected $guarded = [];

    protected $attributes = [
        'description' => null,
        'requirements' => null,
        'employment_type' => 'full_time',
        'slots' => 1,
        'status' => 'draft',
        'created_by' => null,
    ];

    protected function casts(): array
    {
        return ['required_documents' => 'array', 'slots' => 'integer'];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }

    public function applications(): HasMany
    {
        return $this->hasMany(JobApplication::class);
    }
}
