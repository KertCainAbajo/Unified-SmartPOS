<?php

namespace App\Http\Controllers\Api\V1\Recruitment;

use App\Enums\ApplicationStatus;
use App\Http\Controllers\Api\V1\Staff\StaffController;
use App\Http\Controllers\Controller;
use App\Http\Resources\JobApplicationResource;
use App\Models\ApplicationDocument;
use App\Models\Interview;
use App\Models\JobApplication;
use App\Models\OnboardingTask;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\Vacancy;
use App\Services\Recruitment\RecruitmentService;
use App\Services\Staff\StaffService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * Hiring workflow for staff. Every action is validated and authorized by RecruitmentService; this controller only
 * validates input shape. Errors: 403 (not allowed for your role/branch/assignment), 422 `INVALID_APPLICATION_STATE`
 * / `INVALID_TRANSITION` (stage skipping), `ONBOARDING_INCOMPLETE` (account requested too early).
 *
 * @tags Recruitment
 */
class ApplicationController extends Controller
{
    private const DETAIL = ['vacancy.role', 'branch', 'interviews.interviewer.user', 'documents', 'onboardingTasks', 'events.actor'];

    public function __construct(private readonly RecruitmentService $recruitment) {}

    /** Applications visible to you. Filters: `status`, `vacancy_id`, `branch_id`, `q` (name, email, reference). */
    public function index(Request $request, Tenant $tenant): AnonymousResourceCollection
    {
        $query = $this->recruitment->visibleApplications()
            ->with(['vacancy', 'branch'])
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($request->query('vacancy_id'), fn ($q, $v) => $q->where('vacancy_id', $v))
            ->when($request->query('branch_id'), fn ($q, $b) => $q->where('branch_id', $b))
            ->when($request->query('q'), fn ($q, $term) => $q->where(fn ($w) => $w
                ->where('reference', 'like', "%{$term}%")->orWhere('email', 'like', "%{$term}%")
                ->orWhere('first_name', 'like', "%{$term}%")->orWhere('last_name', 'like', "%{$term}%")))
            ->latest('id');

        return JobApplicationResource::collection($query->paginate(min((int) $request->query('per_page', 20), 100)));
    }

    public function show(Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        $this->recruitment->assertVisible($application);

        return $this->detail($application);
    }

    /** People who may conduct the interview at `stage` for this application's branch. */
    public function interviewers(Request $request, Tenant $tenant, JobApplication $application): JsonResponse
    {
        $this->recruitment->assertVisible($application);
        $data = $request->validate(['stage' => ['required', Rule::in(array_map(fn ($s) => $s->value, ApplicationStatus::INTERVIEW_STAGES))]]);

        return response()->json(['data' => $this->recruitment->eligibleInterviewers($application, ApplicationStatus::from($data['stage']))
            ->map(fn (TenantMembership $m) => ['membership_id' => $m->id, 'name' => $m->user->name, 'roles' => $m->roles->pluck('name')])]);
    }

    public function startScreening(Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        return $this->detail($this->recruitment->startScreening($application));
    }

    /** HR screening outcome: `pass`, `incomplete` (with `applicant_message`) or `reject` (with `note`). */
    public function screen(Request $request, Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        $data = $request->validate([
            'decision' => ['required', Rule::in(['pass', 'incomplete', 'reject'])],
            'note' => ['nullable', 'string', 'max:2000'],
            'applicant_message' => ['nullable', 'string', 'max:2000'],
        ]);

        return $this->detail($this->recruitment->screen($application, $data['decision'], $data['note'] ?? null, $data['applicant_message'] ?? null));
    }

    /** Return to the applicant for clarification (keeps the current stage to resume later). */
    public function clarification(Request $request, Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        $data = $request->validate(['applicant_message' => ['required', 'string', 'max:2000'], 'note' => ['nullable', 'string', 'max:2000']]);

        return $this->detail($this->recruitment->requestClarification($application, $data['applicant_message'], $data['note'] ?? null));
    }

    public function resume(Request $request, Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:2000']]);

        return $this->detail($this->recruitment->resume($application, $data['note'] ?? null));
    }

    /** Schedule the interview for the current stage. */
    public function schedule(Request $request, Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        $data = $request->validate([
            'interviewer_membership_id' => ['required', 'integer'],
            'scheduled_at' => ['required', 'date', 'after:now'],
            'mode' => ['sometimes', Rule::in(Interview::MODES)],
            'location' => ['nullable', 'string', 'max:255'],
        ]);
        $this->recruitment->scheduleInterview($application, $data);

        return $this->detail($application);
    }

    public function reschedule(Request $request, Tenant $tenant, JobApplication $application, Interview $interview): JobApplicationResource
    {
        $data = $request->validate([
            'scheduled_at' => ['required', 'date', 'after:now'],
            'interviewer_membership_id' => ['sometimes', 'integer'],
            'mode' => ['sometimes', Rule::in(Interview::MODES)],
            'location' => ['sometimes', 'nullable', 'string', 'max:255'],
            'reason' => ['required', 'string', 'max:1000'],
        ]);
        $this->recruitment->rescheduleInterview($interview, $data);

        return $this->detail($application);
    }

    public function cancelInterview(Request $request, Tenant $tenant, JobApplication $application, Interview $interview): JobApplicationResource
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:1000']]);
        $this->recruitment->cancelInterview($interview, $data['reason']);

        return $this->detail($application);
    }

    public function noShow(Request $request, Tenant $tenant, JobApplication $application, Interview $interview): JobApplicationResource
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:1000']]);
        $this->recruitment->markNoShow($interview, $data['note'] ?? null);

        return $this->detail($application);
    }

    /**
     * Record the interview outcome (assigned interviewer only). `decision` by stage — HR: pass | reject |
     * request_info; manager: recommend | reject | reassess; owner: approve | reject | another_interview (+ `next_stage`).
     */
    public function result(Request $request, Tenant $tenant, JobApplication $application, Interview $interview): JobApplicationResource
    {
        $data = $request->validate([
            'decision' => ['required', 'string'],
            'score' => ['required', 'integer', 'min:0', 'max:100'],
            'feedback' => ['required', 'string', 'max:5000'],
            'criteria' => ['sometimes', 'array', 'max:12'],
            'criteria.*.name' => ['required', 'string', 'max:100'],
            'criteria.*.score' => ['required', 'integer', 'min:1', 'max:5'],
            'reason' => ['nullable', 'string', 'max:2000'],
            'applicant_message' => ['nullable', 'string', 'max:2000'],
            'next_stage' => ['nullable', Rule::in(array_map(fn ($s) => $s->value, ApplicationStatus::INTERVIEW_STAGES))],
        ]);

        return $this->detail($this->recruitment->recordResult($interview, $data));
    }

    /** HR asks for another interview at the current or an earlier stage. */
    public function anotherInterview(Request $request, Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        $data = $request->validate([
            'stage' => ['required', Rule::in(array_map(fn ($s) => $s->value, ApplicationStatus::INTERVIEW_STAGES))],
            'reason' => ['required', 'string', 'max:2000'],
        ]);

        return $this->detail($this->recruitment->requestAnotherInterview($application, ApplicationStatus::from($data['stage']), $data['reason']));
    }

    public function reject(Request $request, Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:2000']]);

        return $this->detail($this->recruitment->reject($application, $data['reason']));
    }

    public function withdraw(Request $request, Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:2000']]);

        return $this->detail($this->recruitment->withdrawOnBehalf($application, $data['reason']));
    }

    public function offer(Request $request, Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        $data = $request->validate([
            'position' => ['required', 'string', 'max:150'],
            'salary' => ['nullable', 'numeric', 'min:0', 'decimal:0,2'],
            'start_date' => ['required', 'date', 'after_or_equal:today'],
            'terms' => ['nullable', 'string', 'max:5000'],
        ]);

        return $this->detail($this->recruitment->sendOffer($application, $data));
    }

    public function offerResponse(Request $request, Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        $data = $request->validate(['accepted' => ['required', 'boolean'], 'note' => ['nullable', 'string', 'max:2000']]);

        return $this->detail($this->recruitment->recordOfferResponse($application, $data['accepted'], $data['note'] ?? null));
    }

    public function startOnboarding(Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        return $this->detail($this->recruitment->startOnboarding($application));
    }

    public function updateTask(Request $request, Tenant $tenant, JobApplication $application, OnboardingTask $onboardingTask): JobApplicationResource
    {
        $data = $request->validate(['done' => ['required', 'boolean'], 'note' => ['nullable', 'string', 'max:255']]);
        $this->recruitment->setTask($onboardingTask, $data['done'], $data['note'] ?? null);

        return $this->detail($application);
    }

    public function uploadDocument(Request $request, Tenant $tenant, JobApplication $application): JobApplicationResource
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(array_keys(Vacancy::DOCUMENT_TYPES))],
            'file' => ['required', 'file', 'mimes:pdf,jpg,jpeg,png', 'max:5120'],
        ]);
        $this->recruitment->staffUpload($application, $data['type'], $data['file']);

        return $this->detail($application);
    }

    public function verifyDocument(Request $request, Tenant $tenant, JobApplication $application, ApplicationDocument $document): JobApplicationResource
    {
        $data = $request->validate(['verified' => ['required', 'boolean']]);
        $this->recruitment->verifyDocument($document, $data['verified']);

        return $this->detail($application);
    }

    public function downloadDocument(Tenant $tenant, JobApplication $application, ApplicationDocument $document): Response
    {
        $contents = $this->recruitment->documentContents($document);

        return response($contents, 200, [
            'Content-Type' => $document->mime_type,
            'Content-Disposition' => 'attachment; filename="'.addslashes($document->original_name).'"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /**
     * Create the hire's SmartPOS account (approved role and branch) once onboarding is complete. Requires
     * `staff.create` and follows all staff-account rules. Returns one-time sign-in details like staff creation.
     */
    public function provision(Request $request, Tenant $tenant, JobApplication $application): JsonResponse
    {
        $data = $request->validate([
            'email' => ['nullable', 'email:rfc', 'max:255', 'unique:users,email'],
            'username' => ['nullable', 'string', 'max:50'],
            'delivery' => ['sometimes', Rule::in(StaffService::DELIVERIES)],
            'require_password_change' => ['sometimes', 'boolean'],
        ]);

        return StaffController::withCode($this->recruitment->provision($application, $data), 201);
    }

    private function detail(JobApplication $application): JobApplicationResource
    {
        return new JobApplicationResource($application->fresh(self::DETAIL));
    }
}
