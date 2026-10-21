<?php

namespace App\Http\Controllers\Api\V1\Platform;

use App\Enums\UserStatus;
use App\Exceptions\BusinessRuleException;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\CustomerAccount;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Staff\AccessRevoker;
use App\Services\Staff\EmployeeCodeGenerator;
use App\Services\Staff\UsernameGenerator;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Platform Super Admin console: overview of the platform, one business's account details, sign-in accounts, platform
 * admins and the platform's own activity log.
 *
 * Like the business directory, it exposes no sales, payments, products or customer records of any business: only
 * account-level facts (who owns it, its branches, how many people use it, when it was last used).
 *
 * @tags Platform administration
 */
class PlatformConsoleController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** Platform totals, newest businesses and businesses that need attention. */
    public function overview(): JsonResponse
    {
        $byStatus = Tenant::query()->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $lastActivity = $this->lastActivityByTenant();
        $quietSince = now()->subDays(14);

        $tenants = Tenant::query()->with('owner:id,name,email')->withCount(['branches', 'memberships'])->latest('id')->get();
        $present = fn (Tenant $t) => [
            'id' => $t->id, 'name' => $t->name, 'slug' => $t->slug, 'status' => $t->status,
            'owner' => $t->owner?->name, 'branches_count' => $t->branches_count, 'members_count' => $t->memberships_count,
            'created_at' => $t->created_at, 'last_activity_at' => $lastActivity[$t->id] ?? null,
        ];

        return response()->json([
            'businesses' => [
                'total' => (int) $byStatus->sum(),
                'active' => (int) ($byStatus['active'] ?? 0),
                'suspended' => (int) ($byStatus['suspended'] ?? 0),
                'new_this_month' => Tenant::query()->where('created_at', '>=', now()->startOfMonth())->count(),
                'online_shops' => Tenant::query()->where('shop_enabled', true)->where('status', 'active')->count(),
            ],
            'branches' => DB::table('branches')->count(),
            'staff_accounts' => DB::table('tenant_memberships')->where('status', 'active')->count(),
            'customer_accounts' => DB::table('customer_accounts')->count(),
            'platform_admins' => User::query()->where('is_platform_admin', true)->count(),
            'disabled_accounts' => User::query()->where('status', UserStatus::Disabled->value)->count(),
            'newest' => $tenants->take(5)->map($present)->values(),
            // Active businesses nobody has signed in to for two weeks, and suspended ones.
            'attention' => $tenants->filter(fn (Tenant $t) => $t->status === 'suspended'
                || ($t->status === 'active' && (! isset($lastActivity[$t->id]) || $lastActivity[$t->id] < $quietSince)))
                ->take(8)->map($present)->values(),
        ]);
    }

    /** One business: profile, branches, people by role and status, and its suspension history. */
    public function showTenant(Tenant $tenant): JsonResponse
    {
        $tenant->load('owner:id,name,email,phone');
        $branches = $tenant->branches()->orderBy('id')->get(['id', 'name', 'code', 'address', 'is_active']);
        $people = DB::table('tenant_memberships')->where('tenant_id', $tenant->id)->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $roles = DB::table('tenant_memberships')
            ->join('membership_roles', 'membership_roles.membership_id', '=', 'tenant_memberships.id')
            ->join('roles', 'roles.id', '=', 'membership_roles.role_id')
            ->where('tenant_memberships.tenant_id', $tenant->id)->where('tenant_memberships.status', '!=', 'offboarded')
            ->selectRaw('roles.name as role, count(distinct tenant_memberships.id) as total')->groupBy('roles.name')->orderByDesc('total')
            ->get();

        return response()->json(['data' => [
            'id' => $tenant->id, 'name' => $tenant->name, 'slug' => $tenant->slug, 'status' => $tenant->status,
            'legal_name' => $tenant->legal_name, 'tin' => $tenant->tin, 'address' => $tenant->address, 'phone' => $tenant->phone,
            'email' => $tenant->email, 'timezone' => $tenant->timezone, 'currency' => $tenant->currency,
            'vat_registered' => (bool) $tenant->vat_registered, 'shop_enabled' => (bool) $tenant->shop_enabled,
            'created_at' => $tenant->created_at, 'last_activity_at' => $this->lastActivityByTenant($tenant->id)[$tenant->id] ?? null,
            'owner' => $tenant->owner?->only(['id', 'name', 'email', 'phone']),
            'branches' => $branches,
            'people' => ['active' => (int) ($people['active'] ?? 0), 'invited' => (int) ($people['invited'] ?? 0), 'suspended' => (int) ($people['suspended'] ?? 0), 'offboarded' => (int) ($people['offboarded'] ?? 0)],
            'roles' => $roles,
            'customer_accounts' => $tenant->customerAccounts()->count(),
            'status_history' => $this->platformLog()->where('tenant_id', $tenant->id)->where('action', 'platform.tenant_status_changed')->limit(20)->get()->map($this->presentLog(...)),
        ]]);
    }

    /** Find sign-in accounts by name, email or username, with the businesses they belong to. */
    public function users(Request $request): JsonResponse
    {
        $data = $request->validate(['q' => ['nullable', 'string', 'max:100'], 'filter' => ['nullable', 'in:admins,disabled,never']]);
        $term = trim((string) ($data['q'] ?? ''));

        $users = User::query()
            ->when($term !== '', fn ($q) => $q->where(fn ($w) => $w->whereLike('name', "%{$term}%")->orWhereLike('email', "%{$term}%")->orWhereLike('username', "%{$term}%")))
            ->when(($data['filter'] ?? null) === 'admins', fn ($q) => $q->where('is_platform_admin', true))
            ->when(($data['filter'] ?? null) === 'disabled', fn ($q) => $q->where('status', UserStatus::Disabled->value))
            ->when(($data['filter'] ?? null) === 'never', fn ($q) => $q->whereNull('last_login_at'))
            ->with(['memberships' => fn ($q) => $q->select('id', 'tenant_id', 'user_id', 'status')->with('tenant:id,name,slug')])
            ->orderByDesc('is_platform_admin')->orderBy('name')
            ->paginate($this->perPage($request, 25));

        return response()->json([...$users->through(fn (User $u) => $this->presentUser($u))->toArray(), 'summary' => [
            'total' => User::query()->count(),
            'admins' => User::query()->where('is_platform_admin', true)->count(),
            'disabled' => User::query()->where('status', UserStatus::Disabled->value)->count(),
            'never' => User::query()->whereNull('last_login_at')->count(),
        ]]);
    }

    /** Available businesses, branches and safe system roles for provisioning a staff account. */
    public function staffOptions(Tenant $tenant): JsonResponse
    {
        $roles = Role::query()->whereNull('tenant_id')->where('is_system', true)->with('permissions:id,key')->orderBy('name')->get()
            ->reject(fn (Role $role) => $role->isAdministrative()
                && ! in_array($role->key, [Permissions::ROLE_OWNER, Permissions::ROLE_MANAGER], true))
            ->map(fn (Role $role) => ['id' => $role->id, 'key' => $role->key, 'name' => $role->name]);

        return response()->json(['data' => [
            'tenant' => ['id' => $tenant->id, 'name' => $tenant->name, 'status' => $tenant->status],
            'branches' => $tenant->branches()->where('is_active', true)->orderBy('name')->get(['id', 'name', 'code']),
            'roles' => $roles->values(),
        ]]);
    }

    /** Create an active company-managed account with a one-time password and an allowed system role. */
    public function createStaffAccount(Request $request, Tenant $tenant, UsernameGenerator $usernames, EmployeeCodeGenerator $employeeCodes): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'max:255', 'unique:users,email'],
            'role_id' => ['required', 'integer', 'exists:roles,id'],
            'branch_id' => ['nullable', 'integer', 'exists:branches,id'],
        ]);
        if (! $tenant->isActive()) {
            throw new BusinessRuleException('Staff accounts can only be created for an active business.', 'TENANT_INACTIVE', status: 409);
        }

        $role = Role::query()->whereKey($data['role_id'])->whereNull('tenant_id')->where('is_system', true)->with('permissions:id,key')->first();
        if (! $role || ($role->isAdministrative() && ! in_array($role->key, [Permissions::ROLE_OWNER, Permissions::ROLE_MANAGER], true))) {
            throw new BusinessRuleException('Choose a supported system role. User & Access Manager remains controlled by the business owner.', 'ROLE_NOT_ALLOWED', status: 422);
        }
        if ($role->requiresEmailSignIn() && empty($data['email'])) {
            throw new BusinessRuleException('Business Owners and Managers must have an email address for sign-in.', 'EMAIL_REQUIRED', ['email' => ['Required for Business Owner and Manager roles.']]);
        }
        $isOwnerRole = $role->key === Permissions::ROLE_OWNER;
        $branch = $isOwnerRole ? null : Branch::query()->whereKey($data['branch_id'] ?? null)->where('tenant_id', $tenant->id)->where('is_active', true)->first();
        if (! $isOwnerRole && ! $branch) {
            throw new BusinessRuleException('Choose an active branch from the selected business.', 'BRANCH_NOT_ALLOWED', status: 422);
        }

        $username = $usernames->suggest($tenant->id, $role->key, $branch?->code);
        $temporaryPassword = Str::password(20);
        $expiresAt = now()->addHours(24);
        $membership = DB::transaction(function () use ($request, $tenant, $data, $role, $branch, $isOwnerRole, $username, $temporaryPassword, $expiresAt, $employeeCodes) {
            $user = User::query()->forceCreate([
                'name' => trim($data['name']), 'email' => isset($data['email']) ? mb_strtolower(trim($data['email'])) : null,
                'username' => $username, 'managed_by_tenant_id' => $tenant->id, 'password' => $temporaryPassword,
                'status' => UserStatus::Active->value, 'must_change_password' => true, 'temporary_password_expires_at' => $expiresAt,
            ]);
            $membership = TenantMembership::query()->create([
                'tenant_id' => $tenant->id, 'user_id' => $user->id, 'employee_code' => $employeeCodes->next($tenant->id),
                'status' => 'active', 'all_branches' => $isOwnerRole, 'joined_at' => now(), 'created_by' => $request->user()->id,
            ]);
            $membership->roles()->attach($role->id);
            if ($branch) {
                $membership->branches()->attach($branch->id);
            }
            $this->audit->log('platform.staff_account_created', $user, null, [
                'tenant_id' => $tenant->id, 'role' => $role->key, 'branch_id' => $branch?->id, 'username' => $username,
                'temporary_password_expires_at' => $expiresAt->toIso8601String(),
            ], tenantId: $tenant->id);

            return $membership->load(['user', 'roles:id,name,key', 'branches:id,name']);
        });

        return response()->json(['data' => [
            'id' => $membership->user->id, 'name' => $membership->user->name, 'email' => $membership->user->email,
            'business_code' => $tenant->slug, 'username' => $username, 'employee_code' => $membership->employee_code,
            'role' => $role->name, 'role_key' => $role->key,
            'branch' => $branch?->name ?? 'All branches', 'temporary_password' => $temporaryPassword, 'expires_at' => $expiresAt->toIso8601String(),
        ]], 201);
    }

    /** Issue another user's one-time password; sessions and outstanding recovery credentials are revoked. */
    public function resetUserPassword(Request $request, User $user, AccessRevoker $revoker): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);
        if ($user->is($request->user())) {
            throw new BusinessRuleException('You cannot reset your own password from this console. Use Forgot password instead.', 'PLATFORM_SELF_CHANGE', status: 409);
        }
        if ($user->status !== UserStatus::Active->value) {
            throw new BusinessRuleException('Only active accounts can receive a temporary password.', 'ACCOUNT_NOT_ACTIVE', status: 409);
        }

        $temporaryPassword = Str::password(20);
        $expiresAt = now()->addHours(24);
        DB::transaction(function () use ($user, $temporaryPassword, $expiresAt, $revoker, $request, $data) {
            $user->forceFill(['password' => $temporaryPassword, 'must_change_password' => true, 'temporary_password_expires_at' => $expiresAt])->save();
            $revoker->revokeAll($user);
            $this->audit->log('platform.user_password_reset', $user, null, ['temporary_password_expires_at' => $expiresAt->toIso8601String()], ['reason' => trim($data['reason'])]);
        });

        return response()->json(['data' => ['temporary_password' => $temporaryPassword, 'expires_at' => $expiresAt->toIso8601String()]]);
    }

    /** Add platform administration by email: promote an existing login/customer, or create a new login. */
    public function createAdminAccount(Request $request): JsonResponse
    {
        $request->merge(['email' => mb_strtolower(trim((string) $request->input('email')))]);
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
        ]);
        $email = $data['email'];
        if (mb_strtolower((string) $request->user()->email) === $email) {
            throw new BusinessRuleException('This is already your Super Admin account. Enter another person’s email.', 'PLATFORM_SELF_CHANGE', status: 409);
        }

        $temporaryPassword = null;
        $expiresAt = null;
        [$admin, $source, $converted, $shopAccountsClosed] = DB::transaction(function () use ($request, $email, &$temporaryPassword, &$expiresAt) {
            $admin = User::query()->where('email', $email)->lockForUpdate()->first();
            $customer = CustomerAccount::query()->where('email', $email)
                ->where('status', '!=', CustomerAccount::STATUS_MOVED_TO_ADMIN)->lockForUpdate()->first();

            if ($admin?->is($request->user())) {
                throw new BusinessRuleException('This is already your Super Admin account. Enter another person’s email.', 'PLATFORM_SELF_CHANGE', status: 409);
            }
            if ($admin && $admin->status !== UserStatus::Active->value) {
                throw new BusinessRuleException('This email already has an inactive sign-in account. Enable it first.', 'PLATFORM_ADMIN_NOT_ELIGIBLE', status: 409);
            }
            if ($admin?->is_platform_admin) {
                throw new BusinessRuleException('This email is already a Super Admin.', 'ALREADY_PLATFORM_ADMIN', status: 409);
            }
            if (! $admin && $customer && ! $customer->isActive()) {
                throw new BusinessRuleException('This email has an unverified or inactive online-shop account. Ask the person to verify it before adding them.', 'CUSTOMER_ACCOUNT_NOT_ACTIVE', status: 409);
            }

            $converted = $admin !== null && $admin->managed_by_tenant_id !== null;
            $created = $admin === null;
            $source = $admin ? 'existing_login' : ($customer ? 'shop_customer' : 'new_email');
            if ($created) {
                $name = $customer?->name ?: Str::headline(Str::before($email, '@'));
                $attributes = [
                    'name' => $name, 'email' => $email, 'status' => UserStatus::Active->value,
                    'is_platform_admin' => true, 'managed_by_tenant_id' => null,
                ];
                if ($customer) {
                    // Preserve the verified shop customer's existing password.
                    $attributes['password'] = $customer->getAttributes()['password'];
                    $attributes['phone'] = $customer->phone;
                    $attributes['must_change_password'] = false;
                    $attributes['temporary_password_expires_at'] = null;
                } else {
                    $temporaryPassword = Str::password(20);
                    $expiresAt = now()->addHours(24);
                    $attributes['password'] = $temporaryPassword;
                    $attributes['must_change_password'] = true;
                    $attributes['temporary_password_expires_at'] = $expiresAt;
                }
                $admin = (new User)->forceFill($attributes);
            } else {
                $admin->forceFill(['is_platform_admin' => true, 'managed_by_tenant_id' => null]);
            }
            $admin->save();
            if (! $created) {
                $admin->tokens()->delete();
            }
            $shopAccountsClosed = CustomerAccount::closeForAdmin($email);
            $this->audit->log('platform.admin_granted', $admin, null, null, array_filter([
                'reason' => 'Added from Super Admin by email', 'source' => $source, 'email' => $email,
                'login_created' => $created, 'converted_to_personal' => $converted ?: null,
                'shop_accounts_closed' => $shopAccountsClosed,
                'temporary_password_expires_at' => $expiresAt?->toIso8601String(),
            ]), userId: $request->user()->id);

            return [$admin, $source, $converted, $shopAccountsClosed];
        });

        return response()->json(['data' => [
            'id' => $admin->id, 'name' => $admin->name, 'email' => $admin->email,
            'source' => $source, 'temporary_password' => $temporaryPassword,
            'expires_at' => $expiresAt?->toIso8601String(), 'converted_to_personal' => $converted,
            'shop_accounts_closed' => $shopAccountsClosed,
        ]], $temporaryPassword !== null ? 201 : 200);
    }

    /** Disable or re-enable a sign-in account everywhere. A disabled account is signed out on its next request. */
    public function updateUserStatus(Request $request, User $user): JsonResponse
    {
        $data = $request->validate(['status' => ['required', 'in:active,disabled'], 'reason' => ['required', 'string', 'max:255']]);
        if ($user->is($request->user())) {
            throw new BusinessRuleException('You cannot change your own account here.', 'PLATFORM_SELF_CHANGE', status: 409);
        }
        if ($data['status'] === 'active' && $user->status === UserStatus::Pending->value) {
            throw new BusinessRuleException('This account has not been activated by its owner yet.', 'ACCOUNT_PENDING', status: 409);
        }

        $old = $user->status;
        DB::transaction(function () use ($user, $data) {
            $user->forceFill(['status' => $data['status']])->save();
            if ($data['status'] === 'disabled') {
                $user->tokens()->delete();
                DB::table('sessions')->where('user_id', $user->id)->delete();
            }
        });
        $this->audit->log('platform.user_status_changed', $user, ['status' => $old], ['status' => $user->status], ['reason' => trim($data['reason'])]);

        return response()->json(['data' => $this->presentUser($user->load('memberships.tenant:id,name,slug'))]);
    }

    /**
     * Grant or remove platform administration. The last administrator cannot be removed, nor can you remove yourself.
     *
     * An account created by a business (company-managed) is first turned into a personal account, so that business's
     * owner or HR can no longer reset the password of a platform administrator. The person keeps their job and
     * password at the business and signs in with their email.
     */
    public function updateAdmin(Request $request, User $user): JsonResponse
    {
        $data = $request->validate(['is_platform_admin' => ['required', 'boolean'], 'reason' => ['required', 'string', 'max:255']]);
        $grant = (bool) $data['is_platform_admin'];
        if (! $grant && $user->is($request->user())) {
            throw new BusinessRuleException('You cannot remove your own platform access. Ask another administrator.', 'PLATFORM_SELF_CHANGE', status: 409);
        }
        if ($grant && ($user->status !== UserStatus::Active->value || ! $user->email)) {
            throw new BusinessRuleException('Only an active account with an email address can become a platform administrator.', 'PLATFORM_ADMIN_NOT_ELIGIBLE', status: 409);
        }
        $converted = $grant && $user->managed_by_tenant_id !== null;

        DB::transaction(function () use ($user, $grant, $converted) {
            if (! $grant && User::query()->where('is_platform_admin', true)->lockForUpdate()->pluck('id')->count() <= 1) {
                throw new BusinessRuleException('The platform needs at least one administrator.', 'LAST_PLATFORM_ADMIN', status: 409);
            }
            $user->forceFill(['is_platform_admin' => $grant, ...($converted ? ['managed_by_tenant_id' => null] : [])])->save();
            if ($grant && $user->email) {
                CustomerAccount::closeForAdmin($user->email); // an admin email no longer shops as a customer
            }
        });
        $this->audit->log($grant ? 'platform.admin_granted' : 'platform.admin_revoked', $user, null, null,
            ['reason' => trim($data['reason']), 'email' => $user->email, ...($converted ? ['converted_to_personal' => true] : [])]);

        return response()->json(['data' => $this->presentUser($user->load('memberships.tenant:id,name,slug'))]);
    }

    /**
     * Find online-shop customer accounts by their exact email, so someone who signed up in a shop can be made a platform
     * administrator. Only an exact match is returned: the console never lists a business's customers.
     */
    public function customerLookup(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email', 'max:255']]);
        $email = mb_strtolower(trim($data['email']));
        $login = User::query()->where('email', $email)->first();

        $accounts = CustomerAccount::query()->where('email', $email)->where('status', '!=', CustomerAccount::STATUS_MOVED_TO_ADMIN)->with('tenant:id,name')->orderBy('id')->get()
            ->map(fn (CustomerAccount $c) => [
                'id' => $c->id, 'name' => $c->name, 'email' => $c->email, 'phone' => $c->phone, 'status' => $c->status,
                'shop' => $c->tenant?->name, 'created_at' => $c->created_at,
            ]);

        return response()->json(['data' => $accounts, 'login' => $login ? [
            'id' => $login->id, 'name' => $login->name, 'status' => $login->status, 'is_platform_admin' => (bool) $login->is_platform_admin,
        ] : null]);
    }

    /**
     * Move a shop customer to platform administration. Their console login (created, or the existing login with that
     * email) takes the password they chose in the shop, and every shop account with that email is closed: from now on
     * the email signs in only on the Management sign-in.
     */
    public function promoteCustomer(Request $request, CustomerAccount $customerAccount): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);
        if (! $customerAccount->isActive() || ! $customerAccount->email) {
            throw new BusinessRuleException('This shop account is not active.', 'PLATFORM_ADMIN_NOT_ELIGIBLE', status: 409);
        }
        $email = mb_strtolower($customerAccount->email);

        [$user, $created, $converted, $closed] = DB::transaction(function () use ($customerAccount, $email) {
            $user = User::query()->where('email', $email)->lockForUpdate()->first();
            if ($user && $user->status !== UserStatus::Active->value) {
                throw new BusinessRuleException('A sign-in account with this email exists but is not active. Enable it first.', 'PLATFORM_ADMIN_NOT_ELIGIBLE', status: 409);
            }
            $converted = $user !== null && $user->managed_by_tenant_id !== null;
            $user ??= (new User)->forceFill(['name' => $customerAccount->name, 'email' => $email, 'phone' => $customerAccount->phone, 'status' => UserStatus::Active->value]);
            // The shop password hash is copied, so they sign in with the password they chose in the shop; nobody sees it.
            $user->forceFill([
                'password' => $customerAccount->getAttributes()['password'], 'must_change_password' => false, 'temporary_password_expires_at' => null,
                'is_platform_admin' => true, 'managed_by_tenant_id' => null,
            ])->save();
            if (! $user->wasRecentlyCreated) {
                $user->tokens()->delete(); // devices signed in with the old password must sign in again
            }
            $closed = CustomerAccount::closeForAdmin($email);

            return [$user, $user->wasRecentlyCreated, $converted, $closed];
        });
        $this->audit->log('platform.admin_granted', $user, null, null, array_filter([
            'reason' => trim($data['reason']), 'email' => $email, 'source' => 'shop_customer',
            'shop' => $customerAccount->tenant?->name, 'login_created' => $created ?: null, 'converted_to_personal' => $converted ?: null,
            'shop_accounts_closed' => $closed, 'password_from_shop' => true,
        ]));

        return response()->json(['data' => $this->presentUser($user->load('memberships.tenant:id,name,slug')), 'login_created' => $created]);
    }

    /** Everything platform administrators did: suspensions, account changes and admin grants, with their reasons. */
    public function activity(Request $request): JsonResponse
    {
        $data = $request->validate(['type' => ['nullable', 'in:businesses,accounts,admins']]);
        $actions = ['businesses' => ['platform.tenant_status_changed'], 'accounts' => ['platform.user_status_changed', 'platform.user_password_reset', 'platform.staff_account_created'], 'admins' => ['platform.admin_granted', 'platform.admin_revoked']];
        $page = $this->platformLog()->when($data['type'] ?? null, fn ($q, $type) => $q->whereIn('action', $actions[$type]))
            ->paginate($this->perPage($request, 30));
        $counts = AuditLog::query()->where('action', 'like', 'platform.%')->selectRaw('action, count(*) as total')->groupBy('action')->pluck('total', 'action');
        $sum = fn (array $list) => (int) collect($list)->sum(fn ($a) => $counts[$a] ?? 0);

        return response()->json([...$page->through($this->presentLog(...))->toArray(), 'summary' => [
            'total' => (int) $counts->sum(),
            'businesses' => $sum($actions['businesses']), 'accounts' => $sum($actions['accounts']), 'admins' => $sum($actions['admins']),
            'this_week' => AuditLog::query()->where('action', 'like', 'platform.%')->where('created_at', '>=', now()->subDays(7))->count(),
        ]]);
    }

    private function platformLog()
    {
        return AuditLog::query()->where('action', 'like', 'platform.%')->with('user:id,name')->latest('id');
    }

    private function presentLog(AuditLog $log): array
    {
        $tenantName = $log->tenant_id ? Tenant::query()->whereKey($log->tenant_id)->value('name') : null;
        $target = match ($log->auditable_type) {
            User::class => User::query()->whereKey($log->auditable_id)->value('name'),
            Tenant::class => $tenantName,
            default => null,
        };

        return [
            'id' => $log->id, 'action' => $log->action, 'by' => $log->user?->name, 'target' => $target, 'business' => $tenantName,
            'old' => $log->old_values, 'new' => $log->new_values, 'reason' => $log->metadata['reason'] ?? null, 'created_at' => $log->created_at,
        ];
    }

    private function presentUser(User $u): array
    {
        return [
            'id' => $u->id, 'name' => $u->name, 'email' => $u->email, 'username' => $u->username, 'status' => $u->status,
            'is_platform_admin' => (bool) $u->is_platform_admin, 'company_managed' => $u->managed_by_tenant_id !== null,
            'last_login_at' => $u->last_login_at, 'created_at' => $u->created_at,
            'businesses' => $u->memberships->map(fn ($m) => ['name' => $m->tenant?->name, 'slug' => $m->tenant?->slug, 'status' => $m->status])->values(),
        ];
    }

    /** @return array<int, Carbon> latest member sign-in per business */
    private function lastActivityByTenant(?int $tenantId = null): array
    {
        return DB::table('tenant_memberships')->join('users', 'users.id', '=', 'tenant_memberships.user_id')
            ->when($tenantId, fn ($q) => $q->where('tenant_memberships.tenant_id', $tenantId))
            ->whereNotNull('users.last_login_at')
            ->selectRaw('tenant_memberships.tenant_id, max(users.last_login_at) as last')->groupBy('tenant_memberships.tenant_id')
            ->pluck('last', 'tenant_id')->map(fn ($v) => Carbon::parse($v))->all();
    }
}
