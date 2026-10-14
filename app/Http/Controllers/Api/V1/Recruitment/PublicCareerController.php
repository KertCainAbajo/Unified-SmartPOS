<?php

namespace App\Http\Controllers\Api\V1\Recruitment;

use App\Enums\ApplicationStatus as S;
use App\Http\Controllers\Controller;
use App\Models\Interview;
use App\Models\JobApplication;
use App\Models\Tenant;
use App\Models\Vacancy;
use App\Services\Recruitment\RecruitmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Public careers pages. No sign-in: applicants receive a reference and a secret token (shown once and emailed as a
 * link). Responses never contain interview scores, feedback, internal notes or rejection reasons.
 *
 * @tags Careers (public)
 *
 * @unauthenticated
 */
class PublicCareerController extends Controller
{
    public function __construct(private readonly RecruitmentService $recruitment) {}

    /** Open vacancies of a business (by business code). */
    public function vacancies(string $business): JsonResponse
    {
        $tenant = $this->tenant($business);
        $vacancies = $tenant->vacancies()->where('status', 'open')->with('branch')->latest('id')->get()
            ->map(fn (Vacancy $v) => [
                'id' => $v->id,
                'title' => $v->title,
                'description' => $v->description,
                'requirements' => $v->requirements,
                'employment_type' => $v->employment_type,
                'branch' => ['name' => $v->branch->name, 'address' => $v->branch->address],
                'required_documents' => collect($v->required_documents ?? [])->map(fn ($t) => ['type' => $t, 'label' => Vacancy::DOCUMENT_TYPES[$t] ?? $t])->values(),
            ]);

        return response()->json([
            'business' => ['name' => $tenant->name, 'code' => $tenant->slug],
            'document_types' => collect(Vacancy::DOCUMENT_TYPES)->map(fn ($label, $type) => ['type' => $type, 'label' => $label])->values(),
            'data' => $vacancies,
        ]);
    }

    /**
     * Apply (multipart). `documents[n][type]` + `documents[n][file]` (PDF/JPG/PNG, max 5 MB each).
     * Returns the reference and a secret `status_token` — shown once; keep it to check the application later.
     */
    public function apply(Request $request, string $business, int $vacancy): JsonResponse
    {
        $tenant = $this->tenant($business);
        $vacancyModel = $tenant->vacancies()->whereKey($vacancy)->firstOrFail();
        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email:rfc', 'max:255'],
            'phone' => ['required', 'string', 'max:30'],
            'address' => ['nullable', 'string', 'max:255'],
            'birth_date' => ['nullable', 'date', 'before:-15 years'],
            'work_experience' => ['nullable', 'string', 'max:5000'],
            'availability' => ['nullable', 'string', 'max:1000'],
            'cover_letter' => ['nullable', 'string', 'max:5000'],
            'documents' => ['array', 'max:8'],
            ...$this->documentRules(),
            'privacy_consent' => ['accepted'],
        ], ['birth_date.before' => 'Applicants must be at least 15 years old.', 'privacy_consent.accepted' => 'Please agree to the processing of your personal data.']);

        ['application' => $application, 'token' => $token] = $this->recruitment->submit($vacancyModel, $data, $data['documents'] ?? []);

        return response()->json([
            'reference' => $application->reference,
            // Shown once; only its hash is stored. Also emailed to the applicant as a link.
            'status_token' => $token,
            'message' => 'Application received. Keep your reference and the link we emailed you to check your status.',
        ], 201)->header('Cache-Control', 'no-store');
    }

    /** Application status for the applicant (reference + token). */
    public function status(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->publicView($this->applicant($request))]);
    }

    public function upload(Request $request): JsonResponse
    {
        $application = $this->applicant($request);
        $data = $request->validate(['documents' => ['required', 'array', 'min:1', 'max:8'], ...$this->documentRules()]);
        $this->recruitment->applicantUpload($application, $data['documents']);

        return response()->json(['data' => $this->publicView($application->refresh())]);
    }

    public function withdraw(Request $request): JsonResponse
    {
        $application = $this->applicant($request);
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:1000']]);
        $this->recruitment->applicantWithdraw($application, $data['reason'] ?? null);

        return response()->json(['data' => $this->publicView($application->refresh())]);
    }

    public function offerResponse(Request $request): JsonResponse
    {
        $application = $this->applicant($request);
        $data = $request->validate(['accept' => ['required', 'boolean']]);
        $this->recruitment->applicantRespondToOffer($application, $data['accept']);

        return response()->json(['data' => $this->publicView($application->refresh())]);
    }

    public function rescheduleRequest(Request $request): JsonResponse
    {
        $application = $this->applicant($request);
        $data = $request->validate(['interview_id' => ['required', 'integer'], 'reason' => ['required', 'string', 'max:1000']]);
        $interview = $application->interviews()->findOrFail($data['interview_id']);
        $this->recruitment->applicantRequestReschedule($application, $interview, $data['reason']);

        return response()->json(['data' => $this->publicView($application->refresh())]);
    }

    /** @return array<string, mixed> */
    private function publicView(JobApplication $application): array
    {
        $application->loadMissing(['vacancy', 'tenant', 'documents', 'interviews']);
        $status = $application->status;
        $timezone = $application->tenant->timezone;

        return [
            'reference' => $application->reference,
            'business' => $application->tenant->name,
            'position' => $application->vacancy->title,
            'name' => $application->fullName(),
            'status' => $status->value,
            'status_label' => $status->publicLabel(),
            // Coarse progress for the stepper; reveals nothing beyond the status label.
            'step' => match ($status) {
                S::Submitted, S::HrScreening, S::Incomplete => 1,
                S::HrInterview => 2,
                S::ManagerInterview => 3,
                S::OwnerFinalInterview => 4,
                S::Approved, S::OfferSent, S::OfferAccepted, S::OfferDeclined, S::Onboarding => 5,
                S::Hired => 6,
                S::Rejected, S::Withdrawn => null,
            },
            'closed' => $status->isClosed(),
            'message' => $status === S::Incomplete ? $application->applicant_message : null,
            'interviews' => $application->interviews->filter(fn (Interview $i) => $i->isOpen())->values()->map(fn (Interview $i) => [
                'id' => $i->id,
                'stage' => $i->stage->publicLabel(),
                'scheduled_at' => $i->scheduled_at->timezone($timezone)->toIso8601String(),
                'mode' => $i->mode,
                'location' => $i->location,
                'reschedule_requested' => $i->status === Interview::STATUS_RESCHEDULE_REQUESTED,
            ]),
            'offer' => in_array($status, [S::OfferSent, S::OfferAccepted, S::Onboarding, S::Hired], true) ? [
                'position' => $application->offer_position,
                'salary' => $application->offer_salary,
                'start_date' => $application->offer_start_date?->toDateString(),
                'terms' => $application->offer_terms,
            ] : null,
            'documents' => $application->documents->map(fn ($d) => [
                'type' => Vacancy::DOCUMENT_TYPES[$d->type] ?? $d->type, 'name' => $d->original_name, 'uploaded_at' => $d->created_at,
            ]),
            'can_upload' => in_array($status, [S::Submitted, S::HrScreening, S::Incomplete], true),
            'can_withdraw' => ! $status->isClosed(),
            'can_respond_to_offer' => $status === S::OfferSent,
        ];
    }

    private function applicant(Request $request): JobApplication
    {
        $data = $request->validate(['reference' => ['required', 'string', 'max:20'], 'token' => ['required', 'string', 'max:100']]);

        return $this->recruitment->forApplicant($data['reference'], $data['token']);
    }

    private function tenant(string $business): Tenant
    {
        return Tenant::query()->where('slug', mb_strtolower($business))->where('status', 'active')->firstOrFail();
    }

    /** @return array<string, mixed> */
    private function documentRules(): array
    {
        return [
            'documents.*.type' => ['required', Rule::in(array_keys(Vacancy::DOCUMENT_TYPES))],
            'documents.*.file' => ['required', 'file', 'mimes:pdf,jpg,jpeg,png', 'max:5120'],
        ];
    }
}
