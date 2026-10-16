<?php

namespace App\Http\Controllers\Api\V1\Tenancy;

use App\Http\Controllers\Controller;
use App\Http\Resources\BranchResource;
use App\Http\Resources\TenantResource;
use App\Models\Tenant;
use App\Services\AuditLogger;
use App\Services\Tenancy\TenantOnboardingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * @tags Businesses
 */
class TenantController extends Controller
{
    /** Create an additional business owned by the current user. */
    public function store(Request $request, TenantOnboardingService $onboarding): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'legal_name' => ['nullable', 'string', 'max:255'],
            'tin' => ['nullable', 'string', 'max:30'],
            'address' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'email:rfc', 'max:255'],
            'vat_registered' => ['sometimes', 'boolean'],
            'branch_name' => ['nullable', 'string', 'max:255'],
        ]);

        $tenant = $onboarding->createBusiness($request->user(), $data);

        return (new TenantResource($tenant))->response()->setStatusCode(201);
    }

    /** Business profile and settings. */
    public function show(Tenant $tenant): TenantResource
    {
        $this->authorize('view', $tenant);

        return new TenantResource($tenant);
    }

    /**
     * Update business settings.
     *
     * Requires `tenant.manage`.
     */
    public function update(Request $request, Tenant $tenant, AuditLogger $audit): TenantResource
    {
        $this->authorize('update', $tenant);

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'legal_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'tin' => ['sometimes', 'nullable', 'string', 'max:30'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'email' => ['sometimes', 'nullable', 'email:rfc', 'max:255'],
            // Domain used to suggest company emails for staff, e.g. alingnena.com (you must own its mailboxes).
            'staff_email_domain' => ['sometimes', 'nullable', 'string', 'max:100', 'regex:/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i'],
            'timezone' => ['sometimes', 'required', 'timezone:all'],
            'vat_registered' => ['sometimes', 'boolean'],
            'vat_rate' => ['sometimes', 'numeric', 'decimal:0,2', 'min:0', 'max:100'],
            'prices_include_vat' => ['sometimes', 'boolean'],
            'allow_negative_stock' => ['sometimes', 'boolean'],
            'refund_approval_threshold' => ['sometimes', 'numeric', 'decimal:0,2', 'min:0'],
            'refund_window_days' => ['sometimes', 'integer', 'min:0', 'max:3650'],
            // Hiring policy: may whoever recommended an applicant (manager interview) also give final approval?
            'recruitment_allow_self_approval' => ['sometimes', 'boolean'],
            'shop_enabled' => ['sometimes', 'boolean'],
        ]);

        $original = $tenant->getOriginal();
        $tenant->fill($data)->save();
        $audit->logChanges('tenant.settings_updated', $tenant, $original);

        return new TenantResource($tenant);
    }

    /**
     * Caller's context in this business: permissions and accessible branches.
     *
     * Clients use this to adapt their UI. The server enforces every permission independently.
     */
    public function context(Tenant $tenant): JsonResponse
    {
        $context = $this->tenantContext();
        $branches = $this->scopeToAccessibleBranches($tenant->branches(), 'id')->orderBy('name')->get();

        return response()->json([
            'tenant' => new TenantResource($tenant),
            'membership_id' => $context->membership()->id,
            'roles' => $context->membership()->roles()->pluck('key'),
            'permissions' => $context->permissions(),
            'all_branches' => $context->hasAllBranches(),
            'branches' => BranchResource::collection($branches),
        ]);
    }
}
