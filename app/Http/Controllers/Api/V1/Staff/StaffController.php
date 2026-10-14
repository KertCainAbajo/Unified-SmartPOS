<?php

namespace App\Http\Controllers\Api\V1\Staff;

use App\Http\Controllers\Controller;
use App\Http\Resources\StaffResource;
use App\Models\AuditLog;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Services\Staff\StaffService;
use App\Services\Staff\UsernameGenerator;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * Company-managed staff accounts. Every write is re-authorized by StaffService (permission, business,
 * self/owner protection, branch scope, privileged-role rules, permission coverage) and audited.
 * See docs/STAFF_ACCOUNTS.md.
 *
 * @tags Staff accounts
 */
class StaffController extends Controller
{
    private const RELATIONS = ['user', 'roles', 'branches', 'invitations', 'profile'];

    public function __construct(private readonly StaffService $staff) {}

    /** Staff visible to the caller. Filters: `status`, `q` (name, username, email, employee code), `branch_id`. Requires `staff.view`. */
    public function index(Request $request, Tenant $tenant): AnonymousResourceCollection
    {
        $this->staff->authorize(Permissions::STAFF_VIEW, null, 'list');
        $request->validate(['status' => ['sometimes', Rule::in(['invited', 'active', 'suspended', 'offboarded'])]]);

        $members = $this->staff->visibleMemberships()
            ->with(self::RELATIONS)
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('branch_id'), fn ($q) => $q->whereHas('branches', fn ($b) => $b->where('branches.id', $request->integer('branch_id'))))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->string('q')).'%';
                $q->where(fn ($w) => $w->where('employee_code', 'like', $term)
                    ->orWhereHas('user', fn ($u) => $u->where('name', 'like', $term)->orWhere('username', 'like', $term)->orWhere('email', 'like', $term)));
            })
            ->orderBy('id')
            ->paginate($this->perPage($request));

        return StaffResource::collection($members);
    }

    public function show(Tenant $tenant, TenantMembership $staff): StaffResource
    {
        $this->authorize('view', $staff);

        return new StaffResource($staff->load(self::RELATIONS));
    }

    /**
     * Suggest identifiers for a new staff member from the role, branch and business: username (e.g. `cashier.main01`),
     * next employee ID (`EMP-0004`) and, when the business has a staff email domain, a company email.
     * Requires `staff.create`.
     */
    public function suggestUsername(Request $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validate([
            'role_id' => ['nullable', 'integer'],
            'branch_id' => ['nullable', 'integer'],
        ]);

        return response()->json($this->staff->suggest($data['role_id'] ?? null, $data['branch_id'] ?? null));
    }

    /**
     * Create a company-managed staff account (pending activation).
     *
     * `delivery=manual` returns a one-time `activation_code` **once** for in-person hand-over;
     * `delivery=email` emails an activation link to the company email. Requires `staff.create`.
     */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->staff->authorize(Permissions::STAFF_CREATE, null, 'create');
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'username' => ['nullable', 'string', 'regex:'.UsernameGenerator::PATTERN,
                Rule::unique('users', 'username')->where('managed_by_tenant_id', $tenant->id)],
            'email' => ['nullable', 'email:rfc', 'max:255', 'unique:users,email'],
            'employee_code' => ['nullable', 'string', 'max:40', Rule::unique('tenant_memberships', 'employee_code')->where('tenant_id', $tenant->id)],
            'role_ids' => ['required', 'array', 'min:1'],
            'role_ids.*' => ['integer', 'distinct'],
            'all_branches' => ['sometimes', 'boolean'],
            'branch_ids' => ['sometimes', 'array'],
            'branch_ids.*' => ['integer', 'distinct'],
            'delivery' => ['required', Rule::in(StaffService::DELIVERIES)],
            // Generated password only: make it temporary (expires, must be changed at first sign-in). Default permanent.
            'require_password_change' => ['sometimes', 'boolean'],
            ...self::profileRules(),
        ], [
            'username.regex' => 'Use 3-50 lowercase letters, digits, dots, dashes or underscores.',
            'username.unique' => 'That username is already used in this business.',
        ]);

        $result = $this->staff->create($data);

        return $this->withCode($result, 201);
    }

    /**
     * Invite an existing personal account by email. Always answers 202 with the same message, whether or
     * not the email belongs to an account. The person must accept in `/me/memberships`. Requires `staff.create`.
     */
    public function inviteExisting(Request $request, Tenant $tenant): JsonResponse
    {
        $this->staff->authorize(Permissions::STAFF_CREATE, null, 'invite_existing');
        $data = $request->validate([
            'email' => ['required', 'email'],
            'role_ids' => ['required', 'array', 'min:1'],
            'role_ids.*' => ['integer', 'distinct'],
            'all_branches' => ['sometimes', 'boolean'],
            'branch_ids' => ['sometimes', 'array'],
            'branch_ids.*' => ['integer', 'distinct'],
        ]);

        $this->staff->inviteExisting($data);

        return response()->json(['message' => 'If an account with this email exists, it has been invited. The person must accept the invitation before gaining access.'], 202);
    }

    /** Update profile details. Company-managed: name, username, email, employee code. Personal: employee code only. Requires `staff.update`. */
    public function update(Request $request, Tenant $tenant, TenantMembership $staff): StaffResource
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'username' => ['sometimes', 'required', 'string', 'regex:'.UsernameGenerator::PATTERN,
                Rule::unique('users', 'username')->where('managed_by_tenant_id', $tenant->id)->ignore($staff->user_id)],
            'email' => ['sometimes', 'nullable', 'email:rfc', 'max:255', Rule::unique('users', 'email')->ignore($staff->user_id)],
            'employee_code' => ['sometimes', 'nullable', 'string', 'max:40',
                Rule::unique('tenant_memberships', 'employee_code')->where('tenant_id', $tenant->id)->ignore($staff->id)],
            ...self::profileRules(),
            // Role, branch and status changes have dedicated, separately-permissioned endpoints.
            'role_ids' => ['prohibited'],
            'branch_ids' => ['prohibited'],
            'all_branches' => ['prohibited'],
            'status' => ['prohibited'],
        ]);

        return new StaffResource($this->staff->updateProfile($staff, $data)->load(self::RELATIONS));
    }

    /** Replace the member's roles. Requires `staff.assign_roles`. */
    public function changeRoles(Request $request, Tenant $tenant, TenantMembership $staff): StaffResource
    {
        $data = $request->validate(['role_ids' => ['required', 'array', 'min:1'], 'role_ids.*' => ['integer', 'distinct']]);

        return new StaffResource($this->staff->changeRoles($staff, $data['role_ids'])->load(self::RELATIONS));
    }

    /** Replace the member's branch access (transfer, add or remove branches). Requires `staff.assign_branches`. */
    public function transferBranches(Request $request, Tenant $tenant, TenantMembership $staff): StaffResource
    {
        $data = $request->validate([
            'all_branches' => ['sometimes', 'boolean'],
            'branch_ids' => ['required_unless:all_branches,true', 'array'],
            'branch_ids.*' => ['integer', 'distinct'],
        ]);

        return new StaffResource($this->staff->transferBranches($staff, (bool) ($data['all_branches'] ?? false), $data['branch_ids'] ?? [])->load(self::RELATIONS));
    }

    /** Suspend access immediately (tokens and sessions revoked). Requires `staff.status`. */
    public function suspend(Request $request, Tenant $tenant, TenantMembership $staff): StaffResource
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);

        return new StaffResource($this->staff->suspend($staff, $data['reason'])->load(self::RELATIONS));
    }

    /**
     * Reactivate a suspended member, or rehire an offboarded one (returns to `invited` with a new activation
     * code). Requires `staff.status` (and `staff.credentials` for rehire).
     */
    public function reactivate(Request $request, Tenant $tenant, TenantMembership $staff): JsonResponse
    {
        $data = $request->validate(['delivery' => ['sometimes', Rule::in(StaffService::DELIVERIES)], 'require_password_change' => ['sometimes', 'boolean']]);

        return $this->withCode($this->staff->reactivate($staff, $data['delivery'] ?? StaffService::DELIVERY_TEMPORARY_PASSWORD, (bool) ($data['require_password_change'] ?? false)));
    }

    /**
     * Offboard: remove all access immediately and keep every historical record. Returns pending work to hand
     * over (open shifts, pending refunds, drafts). Requires `staff.offboard`.
     */
    public function offboard(Request $request, Tenant $tenant, TenantMembership $staff): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);
        $result = $this->staff->offboard($staff, $data['reason']);

        return response()->json([
            'data' => new StaffResource($result['membership']->load(self::RELATIONS)),
            'pending_work' => $result['pending_work'],
        ]);
    }

    /** Issue a new activation code (previous codes are revoked). Requires `staff.credentials`. */
    public function resendInvitation(Request $request, Tenant $tenant, TenantMembership $staff): JsonResponse
    {
        $data = $request->validate(['delivery' => ['required', Rule::in(StaffService::DELIVERIES)], 'require_password_change' => ['sometimes', 'boolean']]);

        return $this->withCode($this->staff->resendInvitation($staff, $data['delivery'], (bool) ($data['require_password_change'] ?? false)));
    }

    /**
     * Administrator-assisted password recovery for company-managed accounts (verify identity in person first).
     * The employee's current password keeps working until the code is redeemed. Requires `staff.credentials`.
     */
    public function recovery(Request $request, Tenant $tenant, TenantMembership $staff): JsonResponse
    {
        $data = $request->validate(['delivery' => ['required', Rule::in(StaffService::DELIVERIES)], 'require_password_change' => ['sometimes', 'boolean']]);

        return $this->withCode($this->staff->issueRecovery($staff, $data['delivery'], (bool) ($data['require_password_change'] ?? false)));
    }

    /** Pending work owned by a member (useful before offboarding). Requires `staff.offboard`. */
    public function pendingWork(Tenant $tenant, TenantMembership $staff): JsonResponse
    {
        $this->staff->authorize(Permissions::STAFF_OFFBOARD, $staff, 'pending_work');

        return response()->json(['data' => $this->staff->pendingWork($staff)]);
    }

    /**
     * Account-administration audit trail (staff.* and sign-in events for members the caller can see).
     * Requires `staff.audit`. The full audit log requires `audit_logs.view`.
     */
    public function auditLog(Request $request, Tenant $tenant): JsonResponse
    {
        $this->staff->authorize(Permissions::STAFF_AUDIT, null, 'audit_log');

        $visibleIds = $this->staff->visibleMemberships()->pluck('id');
        $visibleUserIds = $this->staff->visibleMemberships()->pluck('user_id');
        $morph = (new TenantMembership)->getMorphClass();

        $logs = AuditLog::query()
            ->where('tenant_id', $tenant->id)
            ->where(fn ($q) => $q->where('action', 'like', 'staff.%')->orWhere('action', 'like', 'auth.%'))
            ->when(! $this->tenantContext()->hasAllBranches(), fn ($q) => $q->where(fn ($w) => $w
                ->where(fn ($m) => $m->where('auditable_type', $morph)->whereIn('auditable_id', $visibleIds))
                ->orWhereIn('user_id', $visibleUserIds)))
            ->when($request->filled('membership_id'), fn ($q) => $q->where('auditable_type', $morph)->where('auditable_id', $request->integer('membership_id')))
            ->with('user:id,name')
            ->latest('id')
            ->paginate($this->perPage($request, 50));

        return response()->json($logs->through(fn (AuditLog $log) => [
            'id' => $log->id,
            'action' => $log->action,
            'actor' => $log->user?->only(['id', 'name']),
            'membership_id' => $log->auditable_type === $morph ? $log->auditable_id : null,
            'old_values' => $log->old_values,
            'new_values' => $log->new_values,
            'metadata' => $log->metadata,
            'ip_address' => $log->ip_address,
            'created_at' => $log->created_at,
        ]));
    }

    /** Personal/employment details (stored in staff_profiles). */
    private static function profileRules(): array
    {
        return [
            'profile' => ['sometimes', 'array:job_title,hire_date,phone,address,birth_date,emergency_contact_name,emergency_contact_phone,notes'],
            'profile.job_title' => ['nullable', 'string', 'max:100'],
            'profile.hire_date' => ['nullable', 'date_format:Y-m-d'],
            'profile.phone' => ['nullable', 'string', 'max:30'],
            'profile.address' => ['nullable', 'string', 'max:255'],
            'profile.birth_date' => ['nullable', 'date_format:Y-m-d', 'before:today'],
            'profile.emergency_contact_name' => ['nullable', 'string', 'max:255'],
            'profile.emergency_contact_phone' => ['nullable', 'string', 'max:30'],
            'profile.notes' => ['nullable', 'string', 'max:2000'],
        ];
    }

    /** @param  array{membership: TenantMembership, activation_code: string|null, expires_at: string|null}  $result */
    private function withCode(array $result, int $status = 200): JsonResponse
    {
        return response()->json([
            'data' => new StaffResource($result['membership']->load(self::RELATIONS)),
            // Shown once. Neither is stored in readable form or retrievable later; issue a new one if it is lost.
            'activation_code' => $result['activation_code'],
            'temporary_password' => $result['temporary_password'] ?? null,
            'code_expires_at' => $result['expires_at'],
        ], $status)->header('Cache-Control', 'no-store');
    }
}
