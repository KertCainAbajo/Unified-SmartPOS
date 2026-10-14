<?php

namespace App\Http\Resources;

use App\Enums\ApplicationStatus;
use App\Models\ApplicationDocument;
use App\Models\ApplicationEvent;
use App\Models\Interview;
use App\Models\JobApplication;
use App\Models\OnboardingTask;
use App\Models\Vacancy;
use App\Services\Recruitment\RecruitmentService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A job application as seen by staff (contains confidential interview feedback; never sent to applicants).
 *
 * @mixin JobApplication
 */
class JobApplicationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            'return_status' => $this->return_status?->value,
            'first_name' => $this->first_name,
            'last_name' => $this->last_name,
            'name' => $this->fullName(),
            'email' => $this->email,
            'phone' => $this->phone,
            'address' => $this->address,
            'birth_date' => $this->birth_date?->toDateString(),
            'work_experience' => $this->work_experience,
            'availability' => $this->availability,
            'cover_letter' => $this->cover_letter,
            'applicant_message' => $this->applicant_message,
            'rejection_reason' => $this->rejection_reason,
            'branch_id' => $this->branch_id,
            'branch' => $this->whenLoaded('branch', fn () => ['id' => $this->branch->id, 'name' => $this->branch->name]),
            'vacancy' => $this->whenLoaded('vacancy', fn () => [
                'id' => $this->vacancy->id,
                'title' => $this->vacancy->title,
                'role' => $this->vacancy->relationLoaded('role') ? ['id' => $this->vacancy->role->id, 'name' => $this->vacancy->role->name] : null,
                'required_documents' => $this->vacancy->required_documents ?? [],
            ]),
            'approved_at' => $this->approved_at,
            'offer' => $this->offer_sent_at ? [
                'position' => $this->offer_position,
                'salary' => $this->offer_salary,
                'start_date' => $this->offer_start_date?->toDateString(),
                'terms' => $this->offer_terms,
                'sent_at' => $this->offer_sent_at,
                'responded_at' => $this->offer_responded_at,
                'response_source' => $this->offer_response_source,
            ] : null,
            'onboarding_started_at' => $this->onboarding_started_at,
            'hired_membership_id' => $this->hired_membership_id,
            'hired_at' => $this->hired_at,
            'closed_at' => $this->closed_at,
            'interviews' => $this->whenLoaded('interviews', fn () => $this->interviews->sortBy('id')->values()->map(fn (Interview $i) => [
                'id' => $i->id,
                'stage' => $i->stage->value,
                'stage_label' => $i->stage->label(),
                'round' => $i->round,
                'interviewer_membership_id' => $i->interviewer_membership_id,
                'interviewer_name' => $i->interviewer?->user?->name,
                'scheduled_at' => $i->scheduled_at,
                'mode' => $i->mode,
                'location' => $i->location,
                'status' => $i->status,
                'reschedule_count' => $i->reschedule_count,
                'cancel_reason' => $i->cancel_reason,
                'criteria' => $i->criteria,
                'score' => $i->score,
                'feedback' => $i->feedback,
                'decision' => $i->decision,
                'decision_reason' => $i->decision_reason,
                'decided_at' => $i->decided_at,
            ])),
            'documents' => $this->whenLoaded('documents', fn () => $this->documents->map(fn (ApplicationDocument $d) => [
                'id' => $d->id,
                'type' => $d->type,
                'type_label' => Vacancy::DOCUMENT_TYPES[$d->type] ?? $d->type,
                'original_name' => $d->original_name,
                'mime_type' => $d->mime_type,
                'size' => $d->size,
                'uploaded_by_type' => $d->uploaded_by_type,
                'verified_at' => $d->verified_at,
                'created_at' => $d->created_at,
            ])),
            'onboarding_tasks' => $this->whenLoaded('onboardingTasks', fn () => $this->onboardingTasks->map(fn (OnboardingTask $t) => [
                'id' => $t->id, 'key' => $t->key, 'label' => $t->label, 'required' => $t->required,
                'completed_at' => $t->completed_at, 'note' => $t->note,
            ])),
            'events' => $this->whenLoaded('events', fn () => $this->events->sortBy('id')->values()->map(fn (ApplicationEvent $e) => [
                'id' => $e->id,
                'action' => $e->action,
                'from_status' => $e->from_status,
                'to_status' => $e->to_status,
                'to_label' => $e->to_status ? ApplicationStatus::from($e->to_status)->label() : null,
                'actor_type' => $e->actor_type,
                'actor_name' => $e->actor?->name,
                'interview_id' => $e->interview_id,
                'note' => $e->note,
                'metadata' => $e->metadata,
                'created_at' => $e->created_at,
            ])),
            'provisioning_blockers' => $this->when(
                $this->status === ApplicationStatus::Onboarding,
                fn () => app(RecruitmentService::class)->provisioningBlockers($this->resource),
            ),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
