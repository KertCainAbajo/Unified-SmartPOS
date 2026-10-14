<?php

namespace App\Services\Recruitment;

use App\Enums\ApplicationStatus as S;
use App\Enums\MembershipStatus;
use App\Exceptions\BusinessRuleException;
use App\Models\ApplicationDocument;
use App\Models\ApplicationEvent;
use App\Models\Interview;
use App\Models\JobApplication;
use App\Models\OnboardingTask;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\Vacancy;
use App\Notifications\ApplicantUpdate;
use App\Services\AuditLogger;
use App\Services\NotificationService;
use App\Services\Staff\StaffService;
use App\Support\Permissions as P;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * The hiring workflow. Every status change goes through transition(), which only allows the edges in TRANSITIONS,
 * records an append-only ApplicationEvent and an audit entry. Each action additionally checks who may perform it:
 *
 *  - HR (`recruitment.hr`): screening, HR interviews, scheduling, clarifications, offers, onboarding.
 *  - Branch managers (`recruitment.manager_interview`, own branches): the second interview.
 *  - Business owner, or an owner-granted delegate (`recruitment.final_approval`): final interview and approval.
 *  - Account administrators (`staff.create`, via StaffService rules): SmartPOS account at the very end.
 *
 * Interview results can only be recorded by the assigned interviewer, for the application's current stage.
 * Applicants act only through their reference + secret token, and only on their own application.
 */
class RecruitmentService
{
    /** @var array<string, list<S>> Allowed status changes. */
    private const TRANSITIONS = [
        'submitted' => [S::HrScreening, S::Rejected, S::Withdrawn],
        'hr_screening' => [S::HrInterview, S::Incomplete, S::Rejected, S::Withdrawn],
        'incomplete' => [S::HrScreening, S::HrInterview, S::ManagerInterview, S::OwnerFinalInterview, S::Rejected, S::Withdrawn],
        'hr_interview' => [S::ManagerInterview, S::Incomplete, S::Rejected, S::Withdrawn],
        'manager_interview' => [S::OwnerFinalInterview, S::HrInterview, S::Incomplete, S::Rejected, S::Withdrawn],
        'owner_final_interview' => [S::Approved, S::HrInterview, S::ManagerInterview, S::Incomplete, S::Rejected, S::Withdrawn],
        'approved' => [S::OfferSent, S::Rejected, S::Withdrawn],
        'offer_sent' => [S::OfferAccepted, S::OfferDeclined, S::Withdrawn],
        'offer_accepted' => [S::Onboarding, S::Withdrawn],
        'onboarding' => [S::Hired, S::Withdrawn],
    ];

    public function __construct(
        private readonly TenantContext $context,
        private readonly AuditLogger $audit,
        private readonly NotificationService $notifications,
        private readonly StaffService $staff,
    ) {}

    /* ======================================================================= Visibility */

    /**
     * Applications the current member may see: accessible branches only. Members who only interview at the
     * manager stage see applications from that stage on, or ones they are assigned to.
     */
    public function visibleApplications(): Builder
    {
        $this->require(P::RECRUITMENT_VIEW, null, 'list');
        $query = JobApplication::query()->where('tenant_id', $this->context->tenantId());

        if (! $this->context->hasAllBranches()) {
            $query->whereIn('branch_id', $this->context->branchIds() ?? []);
        }
        if (! $this->isOwner() && ! $this->context->can(P::RECRUITMENT_HR) && ! $this->context->can(P::RECRUITMENT_FINAL_APPROVAL)) {
            $membershipId = $this->context->membership()->id;
            // Only applicants who passed HR (reached the manager interview), or ones this member interviews.
            $query->where(fn (Builder $q) => $q
                ->whereHas('events', fn (Builder $e) => $e->where('to_status', S::ManagerInterview->value))
                ->orWhereHas('interviews', fn (Builder $i) => $i->where('interviewer_membership_id', $membershipId)));
        }

        return $query;
    }

    public function assertVisible(JobApplication $application): void
    {
        if (! $this->visibleApplications()->whereKey($application->id)->exists()) {
            $this->deny('view', $application, 'not_visible', 'You cannot access this application.');
        }
    }

    /* ======================================================================= Applicant (public) */

    /**
     * @param  array<string, mixed>  $data
     * @param  array<int, array{type: string, file: UploadedFile}>  $files
     * @return array{application: JobApplication, token: string}
     */
    public function submit(Vacancy $vacancy, array $data, array $files): array
    {
        if ($vacancy->status !== 'open') {
            throw new BusinessRuleException('This vacancy is not accepting applications.', 'VACANCY_CLOSED');
        }
        $alreadyApplied = JobApplication::query()
            ->where('vacancy_id', $vacancy->id)
            ->where('email', Str::lower(trim($data['email'])))
            ->whereNotIn('status', [S::Hired->value, S::Rejected->value, S::Withdrawn->value, S::OfferDeclined->value])
            ->exists();
        if ($alreadyApplied) {
            throw new BusinessRuleException('You already have an application for this position. Check its status from the link in your confirmation email.',
                'DUPLICATE_APPLICATION', ['email' => ['An application with this email is already in progress.']]);
        }
        $missing = array_diff($vacancy->required_documents ?? [], array_column($files, 'type'));
        if ($missing !== []) {
            throw new BusinessRuleException('Please upload all required documents.', 'DOCUMENTS_REQUIRED',
                ['documents' => ['Missing: '.implode(', ', array_map(fn ($t) => Vacancy::DOCUMENT_TYPES[$t] ?? $t, $missing))]]);
        }

        $token = Str::random(40);
        $application = DB::transaction(function () use ($vacancy, $data, $files, $token) {
            $application = JobApplication::query()->create([
                'tenant_id' => $vacancy->tenant_id,
                'vacancy_id' => $vacancy->id,
                'branch_id' => $vacancy->branch_id,
                'reference' => $this->newReference(),
                'status_token_hash' => hash('sha256', $token),
                'first_name' => $data['first_name'],
                'last_name' => $data['last_name'],
                'email' => Str::lower(trim($data['email'])),
                'phone' => $data['phone'],
                'address' => $data['address'] ?? null,
                'birth_date' => $data['birth_date'] ?? null,
                'work_experience' => $data['work_experience'] ?? null,
                'availability' => $data['availability'] ?? null,
                'cover_letter' => $data['cover_letter'] ?? null,
                'status' => S::Submitted,
            ]);
            foreach ($files as $file) {
                $this->storeDocument($application, $file['type'], $file['file'], 'applicant');
            }
            $this->event($application, 'submitted', null, S::Submitted, 'applicant');

            return $application;
        });

        $this->notifyHr($application, 'application_received', 'New job application', "{$application->fullName()} applied for {$vacancy->title}.");
        $this->mailApplicant($application, 'submitted', 'Application received', [
            "Thank you for applying for {$vacancy->title}. We have received your application and will review it.",
        ], $this->statusUrl($application, $token));

        return ['application' => $application->refresh(), 'token' => $token];
    }

    /** Find an application by reference + secret token; the same 404 for a wrong reference or a wrong token. */
    public function forApplicant(string $reference, string $token): JobApplication
    {
        $application = JobApplication::query()->where('reference', Str::upper(trim($reference)))->first();
        if (! $application || ! hash_equals($application->status_token_hash, hash('sha256', $token))) {
            throw new BusinessRuleException('Application not found. Check the link from your confirmation email.', 'APPLICATION_NOT_FOUND', status: 404);
        }

        return $application;
    }

    /** @param  array<int, array{type: string, file: UploadedFile}>  $files */
    public function applicantUpload(JobApplication $application, array $files): void
    {
        $this->assertStatus($application, [S::Submitted, S::HrScreening, S::Incomplete], 'upload documents');
        DB::transaction(function () use ($application, $files) {
            foreach ($files as $file) {
                $document = $this->storeDocument($application, $file['type'], $file['file'], 'applicant');
                $this->event($application, 'document_uploaded', null, null, 'applicant', metadata: ['type' => $document->type, 'document_id' => $document->id]);
            }
        });
        $this->notifyHr($application, 'application_documents', 'Applicant sent documents', "{$application->fullName()} ({$application->reference}) uploaded documents.");
    }

    public function applicantWithdraw(JobApplication $application, ?string $reason): void
    {
        $this->withdraw($application, $reason, 'applicant');
        $this->notifyHr($application, 'application_withdrawn', 'Applicant withdrew', "{$application->fullName()} ({$application->reference}) withdrew their application.");
    }

    public function applicantRespondToOffer(JobApplication $application, bool $accept): void
    {
        $this->respondToOffer($application, $accept, null, 'applicant');
        $this->notifyHr($application, 'offer_response', $accept ? 'Offer accepted' : 'Offer declined',
            "{$application->fullName()} ({$application->reference}) ".($accept ? 'accepted' : 'declined').' the job offer.');
    }

    public function applicantRequestReschedule(JobApplication $application, Interview $interview, string $reason): void
    {
        if ($interview->application_id !== $application->id || $interview->status !== Interview::STATUS_SCHEDULED) {
            throw new BusinessRuleException('This interview cannot be rescheduled.', 'INVALID_INTERVIEW_STATE');
        }
        DB::transaction(function () use ($application, $interview, $reason) {
            $interview->forceFill(['status' => Interview::STATUS_RESCHEDULE_REQUESTED])->save();
            $this->event($application, 'reschedule_requested', null, null, 'applicant', $interview, metadata: ['reason' => Str::limit($reason, 500)]);
        });
        $this->notifications->notifyUser($application->tenant_id, $interview->interviewer->user_id, 'interview_reschedule_requested',
            'Applicant asked to reschedule', "{$application->fullName()} asked to move the interview on {$interview->scheduled_at->toDayDateTimeString()}.");
        $this->notifyHr($application, 'interview_reschedule_requested', 'Applicant asked to reschedule', "{$application->fullName()} ({$application->reference}): {$reason}");
    }

    /* ======================================================================= Screening and clarification */

    public function startScreening(JobApplication $application): JobApplication
    {
        $this->require(P::RECRUITMENT_HR, $application, 'start_screening');

        return $this->transition($application, S::HrScreening, 'screening_started', expect: [S::Submitted]);
    }

    /** HR screening outcome: `pass` → HR interview, `incomplete` → back to the applicant, `reject`. */
    public function screen(JobApplication $application, string $decision, ?string $note, ?string $applicantMessage): JobApplication
    {
        $this->require(P::RECRUITMENT_HR, $application, 'screen');

        return match ($decision) {
            'pass' => $this->transition($application, S::HrInterview, 'screening_passed', $note, expect: [S::HrScreening]),
            'incomplete' => $this->toIncomplete($application, $applicantMessage, $note, 'screening_incomplete', [S::HrScreening]),
            'reject' => $this->close($application, S::Rejected, 'screening_rejected', $note, [S::HrScreening]),
        };
    }

    /** Return the application to the applicant for clarification; the current stage is kept to resume later. */
    public function requestClarification(JobApplication $application, string $applicantMessage, ?string $note): JobApplication
    {
        $this->require(P::RECRUITMENT_HR, $application, 'request_clarification');

        return $this->toIncomplete($application, $applicantMessage, $note, 'clarification_requested',
            [S::HrScreening, S::HrInterview, S::ManagerInterview, S::OwnerFinalInterview]);
    }

    public function resume(JobApplication $application, ?string $note): JobApplication
    {
        $this->require(P::RECRUITMENT_HR, $application, 'resume');
        $this->assertStatus($application, [S::Incomplete], 'resume');

        $application->applicant_message = null;
        $target = $application->return_status ?? S::HrScreening;
        $application->return_status = null;

        return $this->transition($application, $target, 'resumed', $note, expect: [S::Incomplete]);
    }

    /* ======================================================================= Interviews */

    /** @return Collection<int, TenantMembership> */
    public function eligibleInterviewers(JobApplication $application, S $stage): Collection
    {
        return TenantMembership::query()
            ->where('tenant_id', $application->tenant_id)
            ->where('status', MembershipStatus::Active->value)
            ->with(['user', 'roles', 'branches'])
            ->get()
            ->filter(fn (TenantMembership $m) => $this->isEligibleInterviewer($m, $stage, $application))
            ->values();
    }

    /** @param  array{interviewer_membership_id: int, scheduled_at: string, mode?: string, location?: string|null}  $data */
    public function scheduleInterview(JobApplication $application, array $data): Interview
    {
        $stage = $application->status;
        if (! $stage->isInterviewStage()) {
            throw new BusinessRuleException("Interviews can only be scheduled during an interview stage (now: {$stage->label()}).", 'INVALID_APPLICATION_STATE');
        }
        $this->requireScheduler($application, $stage, 'schedule_interview');
        if ($application->interviews()->where('stage', $stage->value)->whereIn('status', Interview::OPEN_STATUSES)->exists()) {
            throw new BusinessRuleException('An interview for this stage is already scheduled. Reschedule or cancel it first.', 'INTERVIEW_ALREADY_SCHEDULED');
        }
        $interviewer = $this->interviewerFor($application, $stage, (int) $data['interviewer_membership_id']);

        $interview = DB::transaction(function () use ($application, $stage, $interviewer, $data) {
            $interview = Interview::query()->create([
                'tenant_id' => $application->tenant_id,
                'application_id' => $application->id,
                'stage' => $stage,
                'round' => $application->interviews()->where('stage', $stage->value)->count() + 1,
                'interviewer_membership_id' => $interviewer->id,
                'scheduled_at' => Carbon::parse($data['scheduled_at']),
                'mode' => $data['mode'] ?? 'in_person',
                'location' => $data['location'] ?? null,
                'scheduled_by' => $this->actorUserId(),
            ]);
            $this->event($application, 'interview_scheduled', null, null, 'staff', $interview, metadata: [
                'stage' => $stage->value, 'round' => $interview->round, 'interviewer_membership_id' => $interviewer->id,
                'scheduled_at' => $interview->scheduled_at->toIso8601String(),
            ]);

            return $interview;
        });

        $this->notifications->notifyUser($application->tenant_id, $interviewer->user_id, 'interview_assigned', 'Interview assigned',
            "{$stage->label()} with {$application->fullName()} on {$interview->scheduled_at->toDayDateTimeString()}.");
        $this->mailApplicant($application, 'interview_scheduled', 'Interview scheduled', $this->interviewLines($interview, 'Your interview has been scheduled.'));

        return $interview;
    }

    /** @param  array{scheduled_at: string, mode?: string, location?: string|null, interviewer_membership_id?: int, reason: string}  $data */
    public function rescheduleInterview(Interview $interview, array $data): Interview
    {
        $application = $interview->application;
        $this->requireInterviewManagement($interview, 'reschedule_interview');
        if (! $interview->isOpen()) {
            throw new BusinessRuleException('Only scheduled interviews can be rescheduled.', 'INVALID_INTERVIEW_STATE');
        }
        $interviewer = isset($data['interviewer_membership_id'])
            ? $this->interviewerFor($application, $interview->stage, (int) $data['interviewer_membership_id'])
            : $interview->interviewer;

        DB::transaction(function () use ($interview, $application, $interviewer, $data) {
            $old = ['scheduled_at' => $interview->scheduled_at->toIso8601String(), 'interviewer_membership_id' => $interview->interviewer_membership_id];
            $interview->forceFill([
                'scheduled_at' => Carbon::parse($data['scheduled_at']),
                'mode' => $data['mode'] ?? $interview->mode,
                'location' => array_key_exists('location', $data) ? $data['location'] : $interview->location,
                'interviewer_membership_id' => $interviewer->id,
                'status' => Interview::STATUS_SCHEDULED,
                'reschedule_count' => $interview->reschedule_count + 1,
            ])->save();
            $this->event($application, 'interview_rescheduled', null, null, 'staff', $interview, $data['reason'], [
                'old' => $old, 'new' => ['scheduled_at' => $interview->scheduled_at->toIso8601String(), 'interviewer_membership_id' => $interviewer->id],
            ]);
        });

        $this->notifications->notifyUser($application->tenant_id, $interviewer->user_id, 'interview_assigned', 'Interview rescheduled',
            "{$interview->stage->label()} with {$application->fullName()} moved to {$interview->scheduled_at->toDayDateTimeString()}.");
        $this->mailApplicant($application, 'interview_rescheduled', 'Interview rescheduled', $this->interviewLines($interview, 'Your interview has been moved.'));

        return $interview;
    }

    public function cancelInterview(Interview $interview, string $reason): Interview
    {
        $this->requireInterviewManagement($interview, 'cancel_interview');
        if (! $interview->isOpen()) {
            throw new BusinessRuleException('Only scheduled interviews can be cancelled.', 'INVALID_INTERVIEW_STATE');
        }
        DB::transaction(function () use ($interview, $reason) {
            $interview->forceFill(['status' => Interview::STATUS_CANCELLED, 'cancel_reason' => $reason])->save();
            $this->event($interview->application, 'interview_cancelled', null, null, 'staff', $interview, $reason);
        });
        $this->mailApplicant($interview->application, 'interview_cancelled', 'Interview cancelled', [
            "Your {$interview->stage->publicLabel()} on {$interview->scheduled_at->toDayDateTimeString()} has been cancelled. We will contact you about next steps.",
        ]);

        return $interview;
    }

    public function markNoShow(Interview $interview, ?string $note): Interview
    {
        $this->requireInterviewManagement($interview, 'mark_no_show', allowInterviewer: true);
        if ($interview->status !== Interview::STATUS_SCHEDULED) {
            throw new BusinessRuleException('Only scheduled interviews can be marked as no-show.', 'INVALID_INTERVIEW_STATE');
        }
        DB::transaction(function () use ($interview, $note) {
            $interview->forceFill(['status' => Interview::STATUS_NO_SHOW])->save();
            $this->event($interview->application, 'interview_no_show', null, null, 'staff', $interview, $note);
        });

        return $interview;
    }

    /**
     * The assigned interviewer records the outcome. Decisions by stage:
     *  HR: pass → manager interview · reject · request_info → applicant (returns to HR interview)
     *  Manager: recommend → final interview · reject · reassess (another manager round)
     *  Owner: approve → hiring approved · reject · another_interview (back to `next_stage`)
     *
     * @param  array{decision: string, score: int, feedback: string, criteria?: list<array{name: string, score: int}>, reason?: string|null, applicant_message?: string|null, next_stage?: string|null}  $data
     */
    public function recordResult(Interview $interview, array $data): JobApplication
    {
        $application = $interview->application;
        $stage = $interview->stage;
        $membership = $this->context->membership();

        if ($interview->interviewer_membership_id !== $membership->id) {
            $this->deny('record_result', $application, 'not_assigned_interviewer', 'Only the assigned interviewer can record this result.');
        }
        if (! $this->isEligibleInterviewer($membership, $stage, $application)) {
            $this->deny('record_result', $application, 'not_eligible', 'You are no longer authorized to conduct this interview.');
        }
        if ($interview->status !== Interview::STATUS_SCHEDULED) {
            throw new BusinessRuleException('This interview is not awaiting a result.', 'INVALID_INTERVIEW_STATE');
        }
        $this->assertStatus($application, [$stage], 'record an interview result');

        $decision = $data['decision'];
        if (! in_array($decision, Interview::DECISIONS[$stage->value], true)) {
            throw new BusinessRuleException('That decision is not available at this stage.', 'INVALID_DECISION',
                ['decision' => ['Allowed: '.implode(', ', Interview::DECISIONS[$stage->value])]]);
        }
        if ($decision !== 'pass' && $decision !== 'recommend' && $decision !== 'approve' && empty($data['reason'])) {
            throw new BusinessRuleException('Give a reason for this decision.', 'REASON_REQUIRED', ['reason' => ['Required for this decision.']]);
        }
        if ($decision === 'approve') {
            $this->assertMayApprove($application);
        }

        return DB::transaction(function () use ($interview, $application, $stage, $decision, $data) {
            $interview->forceFill([
                'status' => Interview::STATUS_COMPLETED,
                'score' => $data['score'],
                'criteria' => $data['criteria'] ?? null,
                'feedback' => $data['feedback'],
                'decision' => $decision,
                'decision_reason' => $data['reason'] ?? null,
                'decided_at' => now(),
                'decided_by' => $this->actorUserId(),
            ])->save();
            $this->event($application, 'interview_result', null, null, 'staff', $interview, $data['reason'] ?? null, [
                'stage' => $stage->value, 'round' => $interview->round, 'decision' => $decision, 'score' => (int) $data['score'],
            ]);

            return match ($decision) {
                'pass' => $this->transition($application, S::ManagerInterview, 'hr_interview_passed', interview: $interview),
                'recommend' => $this->transition($application, S::OwnerFinalInterview, 'manager_recommended', interview: $interview),
                'approve' => $this->approve($application, $interview),
                'reject' => $this->close($application, S::Rejected, "{$stage->value}_rejected", $data['reason'], [$stage], $interview),
                'request_info' => $this->toIncomplete($application, $data['applicant_message'] ?? $data['reason'], $data['reason'], 'information_requested', [$stage], $interview),
                'reassess' => $this->sameStageAgain($application, $interview, 'reassessment_requested', $data['reason']),
                'another_interview' => $this->backToStage($application, S::tryFrom($data['next_stage'] ?? '')
                    ?? throw new BusinessRuleException('Choose which interview stage to repeat.', 'INVALID_STAGE', ['next_stage' => ['Required.']]),
                    'another_interview_requested', $data['reason'], $interview),
            };
        });
    }

    /** HR asks for another interview at the current or an earlier interview stage; earlier decisions stay on record. */
    public function requestAnotherInterview(JobApplication $application, S $stage, string $reason): JobApplication
    {
        $this->require(P::RECRUITMENT_HR, $application, 'request_another_interview');
        $this->assertStatus($application, S::INTERVIEW_STAGES, 'request another interview');

        return DB::transaction(fn () => $stage === $application->status
            ? $this->sameStageAgain($application, null, 'another_interview_requested', $reason)
            : $this->backToStage($application, $stage, 'another_interview_requested', $reason));
    }

    /* ======================================================================= Rejection and withdrawal */

    /** HR may reject during screening; the owner (or final approver) at any open stage before the offer. */
    public function reject(JobApplication $application, string $reason): JobApplication
    {
        $this->assertVisible($application);
        $finalAuthority = $this->isOwner() || $this->context->can(P::RECRUITMENT_FINAL_APPROVAL);
        $allowed = $finalAuthority
            ? [S::Submitted, S::HrScreening, S::Incomplete, S::HrInterview, S::ManagerInterview, S::OwnerFinalInterview, S::Approved]
            : [S::HrScreening, S::Incomplete];
        if (! $finalAuthority) {
            $this->require(P::RECRUITMENT_HR, $application, 'reject');
        }

        return $this->close($application, S::Rejected, 'rejected', $reason, $allowed);
    }

    public function withdrawOnBehalf(JobApplication $application, string $reason): JobApplication
    {
        $this->require(P::RECRUITMENT_HR, $application, 'withdraw');

        return $this->withdraw($application, $reason, 'staff');
    }

    /* ======================================================================= Offer and onboarding */

    /** @param  array{position: string, salary?: string|null, start_date: string, terms?: string|null}  $data */
    public function sendOffer(JobApplication $application, array $data): JobApplication
    {
        $this->require(P::RECRUITMENT_HR, $application, 'send_offer');
        $this->assertStatus($application, [S::Approved], 'send an offer');
        if ($application->approved_at === null) {
            throw new BusinessRuleException('Hiring has not been approved.', 'NOT_APPROVED');
        }

        $application->forceFill([
            'offer_position' => $data['position'],
            'offer_salary' => $data['salary'] ?? null,
            'offer_start_date' => $data['start_date'],
            'offer_terms' => $data['terms'] ?? null,
            'offer_sent_at' => now(),
        ]);
        $application = $this->transition($application, S::OfferSent, 'offer_sent', metadata: ['position' => $data['position'], 'start_date' => $data['start_date']]);

        $lines = ["We are pleased to offer you the position of {$data['position']}.", "Start date: {$application->offer_start_date->toFormattedDateString()}."];
        if (! empty($data['salary'])) {
            $lines[] = 'Salary: PHP '.number_format((float) $data['salary'], 2).'.';
        }
        if (! empty($data['terms'])) {
            $lines[] = $data['terms'];
        }
        $lines[] = 'Please accept or decline the offer from your application page, or reply to HR.';
        $this->mailApplicant($application, 'offer_sent', 'Job offer', $lines);

        return $application;
    }

    /** HR records the applicant's answer (e.g. given in person). */
    public function recordOfferResponse(JobApplication $application, bool $accept, ?string $note): JobApplication
    {
        $this->require(P::RECRUITMENT_HR, $application, 'record_offer_response');

        return $this->respondToOffer($application, $accept, $note, 'staff');
    }

    public function startOnboarding(JobApplication $application): JobApplication
    {
        $this->require(P::RECRUITMENT_HR, $application, 'start_onboarding');
        $this->assertStatus($application, [S::OfferAccepted], 'start onboarding');

        return DB::transaction(function () use ($application) {
            foreach (config('smartpos.onboarding_tasks') as $task) {
                OnboardingTask::query()->firstOrCreate(
                    ['application_id' => $application->id, 'key' => $task['key']],
                    ['tenant_id' => $application->tenant_id, 'label' => $task['label'], 'required' => $task['required']],
                );
            }
            $application->onboarding_started_at = now();

            return $this->transition($application, S::Onboarding, 'onboarding_started');
        });
    }

    public function setTask(OnboardingTask $task, bool $done, ?string $note): OnboardingTask
    {
        $application = $task->application;
        $this->require(P::RECRUITMENT_HR, $application, 'onboarding_task');
        $this->assertStatus($application, [S::Onboarding], 'update onboarding');

        DB::transaction(function () use ($task, $application, $done, $note) {
            $task->forceFill([
                'completed_at' => $done ? now() : null,
                'completed_by' => $done ? $this->actorUserId() : null,
                'note' => $note ?? $task->note,
            ])->save();
            $this->event($application, $done ? 'onboarding_task_completed' : 'onboarding_task_reopened', null, null, 'staff', note: $note, metadata: ['task' => $task->key]);
        });

        return $task;
    }

    public function staffUpload(JobApplication $application, string $type, UploadedFile $file): ApplicationDocument
    {
        $this->require(P::RECRUITMENT_HR, $application, 'upload_document');
        if ($application->status->isClosed()) {
            throw new BusinessRuleException('This application is closed.', 'INVALID_APPLICATION_STATE');
        }

        return DB::transaction(function () use ($application, $type, $file) {
            $document = $this->storeDocument($application, $type, $file, 'staff');
            $this->event($application, 'document_uploaded', null, null, 'staff', metadata: ['type' => $type, 'document_id' => $document->id]);

            return $document;
        });
    }

    public function verifyDocument(ApplicationDocument $document, bool $verified): ApplicationDocument
    {
        $application = $document->application;
        $this->require(P::RECRUITMENT_HR, $application, 'verify_document');
        DB::transaction(function () use ($document, $application, $verified) {
            $document->forceFill(['verified_at' => $verified ? now() : null, 'verified_by' => $verified ? $this->actorUserId() : null])->save();
            $this->event($application, $verified ? 'document_verified' : 'document_unverified', null, null, 'staff', metadata: ['document_id' => $document->id, 'type' => $document->type]);
        });

        return $document;
    }

    /** What still blocks account creation (empty when ready). @return list<string> */
    public function provisioningBlockers(JobApplication $application): array
    {
        $blockers = [];
        if ($application->status !== S::Onboarding) {
            $blockers[] = 'The application must be in onboarding.';
        }
        if ($application->approved_at === null) {
            $blockers[] = 'Hiring has not been approved.';
        }
        if ($application->offer_responded_at === null || $application->status === S::OfferDeclined) {
            $blockers[] = 'The job offer has not been accepted.';
        }
        foreach ($application->onboardingTasks()->where('required', true)->whereNull('completed_at')->get() as $task) {
            $blockers[] = "Onboarding step not done: {$task->label}.";
        }
        $verified = $application->documents()->whereNotNull('verified_at')->pluck('type')->unique()->all();
        foreach (array_diff($application->vacancy->required_documents ?? [], $verified) as $type) {
            $blockers[] = 'Document not verified: '.(Vacancy::DOCUMENT_TYPES[$type] ?? $type).'.';
        }

        return $blockers;
    }

    /**
     * Create the employee's SmartPOS account with the approved role and branch, through the normal staff-account
     * rules (staff.create, branch scope, owner-only administrative roles). Only possible at the very end.
     *
     * @param  array{email?: string|null, username?: string|null, delivery?: string, require_password_change?: bool}  $data
     * @return array<string, mixed> StaffService result (membership + one-time sign-in details)
     */
    public function provision(JobApplication $application, array $data): array
    {
        $this->assertVisible($application);
        $blockers = $this->provisioningBlockers($application);
        if ($blockers !== []) {
            throw new BusinessRuleException('The employee account cannot be created yet.', 'ONBOARDING_INCOMPLETE', ['application' => $blockers]);
        }

        return DB::transaction(function () use ($application, $data) {
            $vacancy = $application->vacancy;
            $result = $this->staff->create([
                'name' => $application->fullName(),
                'email' => $data['email'] ?? null,
                'username' => $data['username'] ?? null,
                'employee_code' => null,
                'role_ids' => [$vacancy->role_id],
                'all_branches' => false,
                'branch_ids' => [$application->branch_id],
                'delivery' => $data['delivery'] ?? StaffService::DELIVERY_TEMPORARY_PASSWORD,
                'require_password_change' => (bool) ($data['require_password_change'] ?? false),
                'profile' => [
                    'job_title' => $application->offer_position ?? $vacancy->title,
                    'hire_date' => ($application->offer_start_date ?? now())->toDateString(),
                    'phone' => $application->phone,
                    'address' => $application->address,
                    'birth_date' => $application->birth_date?->toDateString(),
                ],
            ]);
            $application->forceFill(['hired_membership_id' => $result['membership']->id, 'hired_at' => now()]);
            $this->transition($application, S::Hired, 'hired', metadata: ['membership_id' => $result['membership']->id]);
            $this->closeVacancyWhenFilled($vacancy);
            $this->mailApplicant($application, 'hired', 'Welcome to the team', [
                'Your onboarding is complete. Your manager will give you your SmartPOS sign-in details.',
            ]);

            return $result;
        });
    }

    /* ======================================================================= Internals */

    /** All openings filled: stop taking applications (the careers page hides it). */
    private function closeVacancyWhenFilled(Vacancy $vacancy): void
    {
        $hired = $vacancy->applications()->where('status', S::Hired->value)->count();
        if ($vacancy->status === 'open' && $hired >= $vacancy->slots) {
            $vacancy->forceFill(['status' => 'closed'])->save();
            $this->audit->log('recruitment.vacancy_filled', $vacancy, ['status' => 'open'], ['status' => 'closed'], ['hired' => $hired, 'slots' => $vacancy->slots]);
        }
    }

    private function approve(JobApplication $application, Interview $interview): JobApplication
    {
        $application->forceFill(['approved_by' => $this->actorUserId(), 'approved_at' => now()]);
        $application = $this->transition($application, S::Approved, 'hiring_approved', interview: $interview);
        $this->mailApplicant($application, 'approved', 'Good news', ['You have been selected. HR will send you a job offer shortly.']);

        return $application;
    }

    /** Final approval: owner, or a delegate who did not make the manager-stage recommendation (unless policy allows). */
    private function assertMayApprove(JobApplication $application): void
    {
        if ($this->isOwner()) {
            return;
        }
        if (! $this->context->can(P::RECRUITMENT_FINAL_APPROVAL)) {
            $this->deny('approve', $application, 'not_final_approver', 'Only the business owner or an authorized delegate can approve hiring.');
        }
        $recommendedBySelf = $application->interviews()
            ->where('stage', S::ManagerInterview->value)
            ->where('decision', 'recommend')
            ->where('decided_by', $this->actorUserId())
            ->exists();
        if ($recommendedBySelf && ! $application->tenant->recruitment_allow_self_approval) {
            $this->deny('approve', $application, 'self_approval', 'You recommended this applicant, so another approver must make the final decision.');
        }
    }

    private function respondToOffer(JobApplication $application, bool $accept, ?string $note, string $source): JobApplication
    {
        $this->assertStatus($application, [S::OfferSent], 'respond to the offer');
        $application->forceFill(['offer_responded_at' => now(), 'offer_response_source' => $source]);
        if (! $accept) {
            $application->closed_at = now();
        }

        return $this->transition($application, $accept ? S::OfferAccepted : S::OfferDeclined, $accept ? 'offer_accepted' : 'offer_declined', $note, actorType: $source);
    }

    private function withdraw(JobApplication $application, ?string $reason, string $actorType): JobApplication
    {
        if ($application->status->isClosed()) {
            throw new BusinessRuleException('This application is already closed.', 'INVALID_APPLICATION_STATE');
        }

        return DB::transaction(function () use ($application, $reason, $actorType) {
            $this->cancelOpenInterviews($application, 'Application withdrawn');
            $application->closed_at = now();

            return $this->transition($application, S::Withdrawn, 'withdrawn', $reason, actorType: $actorType);
        });
    }

    /** @param  list<S>  $expect */
    private function close(JobApplication $application, S $to, string $action, ?string $reason, array $expect, ?Interview $interview = null): JobApplication
    {
        $this->assertStatus($application, $expect, 'close');
        if ($to === S::Rejected && blank($reason)) {
            throw new BusinessRuleException('Give a reason for the rejection.', 'REASON_REQUIRED', ['reason' => ['Required.']]);
        }

        return DB::transaction(function () use ($application, $to, $action, $reason, $interview) {
            $this->cancelOpenInterviews($application, 'Application closed');
            $application->forceFill(['rejection_reason' => $reason, 'closed_at' => now()]);
            $application = $this->transition($application, $to, $action, $reason, interview: $interview);
            $this->mailApplicant($application, 'rejected', 'Your application', [
                "Thank you for your interest in the {$application->vacancy->title} position. After careful consideration, we will not be moving forward with your application.",
                'We wish you the best in your job search.',
            ]);

            return $application;
        });
    }

    /** @param  list<S>  $expect */
    private function toIncomplete(JobApplication $application, ?string $applicantMessage, ?string $note, string $action, array $expect, ?Interview $interview = null): JobApplication
    {
        $this->assertStatus($application, $expect, 'request information');
        if (blank($applicantMessage)) {
            throw new BusinessRuleException('Tell the applicant what is needed.', 'MESSAGE_REQUIRED', ['applicant_message' => ['Required.']]);
        }
        $application->forceFill(['return_status' => $application->status, 'applicant_message' => $applicantMessage]);
        $application = $this->transition($application, S::Incomplete, $action, $note, interview: $interview);
        $this->mailApplicant($application, 'information_requested', 'More information needed', [
            'We need a little more from you before we continue:', $applicantMessage,
            'You can upload documents from your application page.',
        ]);

        return $application;
    }

    private function sameStageAgain(JobApplication $application, ?Interview $interview, string $action, ?string $reason): JobApplication
    {
        $this->event($application, $action, $application->status, $application->status, 'staff', $interview, $reason);
        $this->audit->log("recruitment.{$action}", $application, metadata: ['stage' => $application->status->value]);

        return $application;
    }

    private function backToStage(JobApplication $application, S $target, string $action, ?string $reason, ?Interview $interview = null): JobApplication
    {
        $current = $application->status;
        if (! $target->isInterviewStage() || $target->interviewIndex() > $current->interviewIndex()) {
            throw new BusinessRuleException('Choose the current or an earlier interview stage.', 'INVALID_STAGE', ['next_stage' => ['Must be an interview stage up to the current one.']]);
        }
        if ($target === $current) {
            return $this->sameStageAgain($application, $interview, $action, $reason);
        }
        $this->cancelOpenInterviews($application, 'Moved back to an earlier interview stage');

        return $this->transition($application, $target, $action, $reason, interview: $interview);
    }

    private function cancelOpenInterviews(JobApplication $application, string $reason): void
    {
        foreach ($application->interviews()->whereIn('status', Interview::OPEN_STATUSES)->get() as $open) {
            $open->forceFill(['status' => Interview::STATUS_CANCELLED, 'cancel_reason' => $reason])->save();
            $this->event($application, 'interview_cancelled', null, null, 'system', $open, $reason);
        }
    }

    /**
     * The only place an application's status changes.
     *
     * @param  list<S>|null  $expect  statuses the action itself requires (clearer errors than the generic edge check)
     * @param  array<string, mixed>  $metadata
     */
    private function transition(
        JobApplication $application,
        S $to,
        string $action,
        ?string $note = null,
        ?array $expect = null,
        ?Interview $interview = null,
        array $metadata = [],
        string $actorType = 'staff',
    ): JobApplication {
        $from = $application->status;
        if ($expect !== null) {
            $this->assertStatus($application, $expect, str_replace('_', ' ', $action));
        }
        if (! in_array($to, self::TRANSITIONS[$from->value] ?? [], true)) {
            throw new BusinessRuleException("Cannot move an application from {$from->label()} to {$to->label()}.", 'INVALID_TRANSITION');
        }

        return DB::transaction(function () use ($application, $from, $to, $action, $note, $interview, $metadata, $actorType) {
            $application->status = $to;
            $application->save();
            $this->event($application, $action, $from, $to, $actorType, $interview, $note, $metadata);
            $this->audit->log("recruitment.{$action}", $application, ['status' => $from->value], ['status' => $to->value],
                ['reference' => $application->reference, 'actor_type' => $actorType], tenantId: $application->tenant_id,
                branchId: $application->branch_id, userId: $actorType === 'staff' ? $this->actorUserId() : null);

            return $application;
        });
    }

    /** @param  array<string, mixed>  $metadata */
    private function event(JobApplication $application, string $action, ?S $from, ?S $to, string $actorType, ?Interview $interview = null, ?string $note = null, array $metadata = []): void
    {
        ApplicationEvent::query()->create([
            'tenant_id' => $application->tenant_id,
            'application_id' => $application->id,
            'action' => $action,
            'from_status' => $from?->value,
            'to_status' => $to?->value,
            'actor_type' => $actorType,
            'actor_user_id' => $actorType === 'staff' ? $this->actorUserId() : null,
            'interview_id' => $interview?->id,
            'note' => $note,
            'metadata' => $metadata === [] ? null : $metadata,
        ]);
    }

    /** @param  list<S>  $allowed */
    private function assertStatus(JobApplication $application, array $allowed, string $action): void
    {
        if (! in_array($application->status, $allowed, true)) {
            throw new BusinessRuleException("Cannot {$action} while the application is at \"{$application->status->label()}\".", 'INVALID_APPLICATION_STATE');
        }
    }

    private function isEligibleInterviewer(TenantMembership $membership, S $stage, JobApplication $application): bool
    {
        if ($membership->tenant_id !== $application->tenant_id || $membership->status !== MembershipStatus::Active->value) {
            return false;
        }
        $owner = $membership->isOwnerMembership();
        if (! $owner && ! $membership->all_branches && ! in_array($application->branch_id, $membership->branchIds(), true)) {
            return false;
        }
        $permissions = $membership->permissionKeys();

        return match ($stage) {
            S::HrInterview => $owner || in_array(P::RECRUITMENT_HR, $permissions, true),
            S::ManagerInterview => $owner || in_array(P::RECRUITMENT_MANAGER_INTERVIEW, $permissions, true),
            S::OwnerFinalInterview => $owner || in_array(P::RECRUITMENT_FINAL_APPROVAL, $permissions, true),
            default => false,
        };
    }

    private function interviewerFor(JobApplication $application, S $stage, int $membershipId): TenantMembership
    {
        $interviewer = TenantMembership::query()->where('tenant_id', $application->tenant_id)->find($membershipId);
        if (! $interviewer || ! $this->isEligibleInterviewer($interviewer, $stage, $application)) {
            throw new BusinessRuleException('That person cannot conduct this interview.', 'INVALID_INTERVIEWER',
                ['interviewer_membership_id' => ["Choose someone allowed to conduct the {$stage->label()} for this branch."]]);
        }

        return $interviewer;
    }

    /** HR schedules every stage; managers their own stage; the owner / final approvers the final stage. */
    private function requireScheduler(JobApplication $application, S $stage, string $action): void
    {
        $this->assertVisible($application);
        $ok = $this->context->can(P::RECRUITMENT_HR)
            || ($stage === S::ManagerInterview && $this->context->can(P::RECRUITMENT_MANAGER_INTERVIEW))
            || ($stage === S::OwnerFinalInterview && ($this->isOwner() || $this->context->can(P::RECRUITMENT_FINAL_APPROVAL)));
        if (! $ok) {
            $this->deny($action, $application, 'cannot_schedule', 'You cannot schedule interviews for this stage.');
        }
    }

    private function requireInterviewManagement(Interview $interview, string $action, bool $allowInterviewer = false): void
    {
        if ($allowInterviewer && $interview->interviewer_membership_id === $this->context->membership()->id) {
            $this->assertVisible($interview->application);

            return;
        }
        $this->requireScheduler($interview->application, $interview->stage, $action);
    }

    private function require(string $permission, ?JobApplication $application, string $action): void
    {
        if (! $this->context->can($permission) && ! ($permission !== P::RECRUITMENT_VIEW && $this->isOwner())) {
            $this->deny($action, $application, "missing_permission:{$permission}", 'You do not have permission to do this.');
        }
        if ($application !== null) {
            if ($application->tenant_id !== $this->context->tenantId() || ! $this->context->canAccessBranch($application->branch_id)) {
                $this->deny($action, $application, 'branch_scope', 'This application belongs to a branch outside your access.');
            }
        }
    }

    private function deny(string $action, ?JobApplication $application, string $reason, string $message): never
    {
        $this->audit->log('recruitment.unauthorized_attempt', $application, metadata: ['action' => $action, 'reason' => $reason],
            tenantId: $this->context->tenantId());

        throw new AuthorizationException($message);
    }

    private function isOwner(): bool
    {
        return $this->context->tenant()->owner_user_id === $this->actorUserId();
    }

    private function actorUserId(): ?int
    {
        return $this->context->hasTenant() ? $this->context->membership()->user_id : null;
    }

    private function storeDocument(JobApplication $application, string $type, UploadedFile $file, string $by): ApplicationDocument
    {
        $path = $file->storeAs("recruitment/{$application->tenant_id}/{$application->id}", Str::uuid().'.'.($file->guessExtension() ?: $file->getClientOriginalExtension()), 'local');

        return ApplicationDocument::query()->create([
            'tenant_id' => $application->tenant_id,
            'application_id' => $application->id,
            'type' => $type,
            'original_name' => Str::limit($file->getClientOriginalName(), 200, ''),
            'path' => $path,
            'mime_type' => $file->getMimeType() ?? 'application/octet-stream',
            'size' => $file->getSize(),
            'uploaded_by_type' => $by,
            'uploaded_by' => $by === 'staff' ? $this->actorUserId() : null,
        ]);
    }

    public function documentContents(ApplicationDocument $document): string
    {
        $this->assertVisible($document->application);

        return Storage::disk('local')->get($document->path) ?? '';
    }

    private function newReference(): string
    {
        do {
            $reference = 'APP-'.Str::upper(Str::random(8));
        } while (JobApplication::query()->where('reference', $reference)->exists());

        return $reference;
    }

    private function statusUrl(JobApplication $application, string $token): string
    {
        return rtrim((string) config('smartpos.frontend_url'), '/').'/applications/status?'.http_build_query(['ref' => $application->reference, 'token' => $token]);
    }

    /** @return list<string> */
    private function interviewLines(Interview $interview, string $intro): array
    {
        return [
            $intro,
            "{$interview->stage->publicLabel()}: {$interview->scheduled_at->timezone($interview->application->tenant->timezone)->toDayDateTimeString()}",
            'Format: '.str_replace('_', ' ', $interview->mode).($interview->location ? " — {$interview->location}" : ''),
            'If you cannot attend, request a new schedule from your application page.',
        ];
    }

    /** @param  list<string>  $lines */
    private function mailApplicant(JobApplication $application, string $event, string $subject, array $lines, ?string $statusUrl = null): void
    {
        $tenant = $application->tenant ?? Tenant::query()->find($application->tenant_id);
        $notification = new ApplicantUpdate($event, $tenant->name, $application->reference, $subject, $lines, $statusUrl);
        DB::afterCommit(fn () => Notification::route('mail', $application->email)->notify($notification));
    }

    private function notifyHr(JobApplication $application, string $type, string $title, string $body): void
    {
        DB::afterCommit(fn () => $this->notifications->notifyPermissionHolders(
            $application->tenant_id, $application->branch_id, P::RECRUITMENT_HR, $type, $title, $body, ['application_id' => $application->id],
        ));
    }
}
