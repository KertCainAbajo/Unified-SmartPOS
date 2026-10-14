<?php

namespace App\Http\Controllers\Api\V1\Recruitment;

use App\Http\Controllers\Controller;
use App\Http\Resources\VacancyResource;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\Vacancy;
use App\Services\AuditLogger;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * @tags Recruitment
 */
class VacancyController extends Controller
{
    public function __construct(private readonly TenantContext $context, private readonly AuditLogger $audit) {}

    /** Vacancies of accessible branches. Requires `recruitment.view`. */
    public function index(Request $request, Tenant $tenant): AnonymousResourceCollection
    {
        $this->authorizeTo(Permissions::RECRUITMENT_VIEW);

        $vacancies = $tenant->vacancies()
            ->when(! $this->context->hasAllBranches(), fn ($q) => $q->whereIn('branch_id', $this->context->branchIds() ?? []))
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->with(['branch', 'role'])
            ->withCount('applications')
            ->latest('id')
            ->get();

        return VacancyResource::collection($vacancies);
    }

    /** Create a vacancy. Requires `recruitment.vacancies`. */
    public function store(Request $request, Tenant $tenant): VacancyResource
    {
        $this->authorizeTo(Permissions::RECRUITMENT_VACANCIES);
        $data = $request->validate($this->rules($tenant, true));
        $this->assertBranch((int) $data['branch_id']);

        $vacancy = $tenant->vacancies()->create([...$data, 'created_by' => $request->user()->id]);
        $this->audit->log('recruitment.vacancy_created', $vacancy, null, ['title' => $vacancy->title, 'status' => $vacancy->status]);

        return new VacancyResource($vacancy->load(['branch', 'role']));
    }

    /** Update or open/close a vacancy. Requires `recruitment.vacancies`. */
    public function update(Request $request, Tenant $tenant, Vacancy $vacancy): VacancyResource
    {
        $this->authorizeTo(Permissions::RECRUITMENT_VACANCIES);
        $this->assertBranch($vacancy->branch_id);
        $data = $request->validate($this->rules($tenant, false));
        if (isset($data['branch_id'])) {
            $this->assertBranch((int) $data['branch_id']);
        }

        $original = $vacancy->getOriginal();
        $vacancy->fill($data)->save();
        $this->audit->logChanges('recruitment.vacancy_updated', $vacancy, $original);

        return new VacancyResource($vacancy->load(['branch', 'role']));
    }

    /** @return array<string, mixed> */
    private function rules(Tenant $tenant, bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'title' => [$required, 'string', 'max:150'],
            'description' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'requirements' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'employment_type' => ['sometimes', Rule::in(['full_time', 'part_time', 'contractual', 'seasonal'])],
            'slots' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'status' => ['sometimes', Rule::in(Vacancy::STATUSES)],
            'branch_id' => [$required, 'integer', Rule::exists('branches', 'id')->where('tenant_id', $tenant->id)],
            'role_id' => [$required, 'integer', Rule::in(Role::query()->availableTo($tenant->id)->pluck('id')->all())],
            'required_documents' => [$required, 'array'],
            'required_documents.*' => ['string', 'distinct', Rule::in(array_keys(Vacancy::DOCUMENT_TYPES))],
        ];
    }

    private function authorizeTo(string $permission): void
    {
        if (! $this->context->can($permission)) {
            throw new AuthorizationException('You do not have permission to manage vacancies.');
        }
    }

    private function assertBranch(int $branchId): void
    {
        if (! $this->context->canAccessBranch($branchId)) {
            throw new AuthorizationException('This branch is outside your access.');
        }
    }
}
