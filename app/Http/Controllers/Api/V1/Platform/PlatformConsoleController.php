<?php

namespace App\Http\Controllers\Api\V1\Platform;

use App\Enums\UserStatus;
use App\Exceptions\BusinessRuleException;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\CustomerAccount;
use App\Models\Tenant;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
        $data = $request->validate(['q' => ['nullable', 'string', 'max:100'], 'filter' => ['nullable', 'in:admins,disabled']]);
        $term = trim((string) ($data['q'] ?? ''));

        $users = User::query()
            ->when($term !== '', fn ($q) => $q->where(fn ($w) => $w->where('name', 'like', "%{$term}%")->orWhere('email', 'like', "%{$term}%")->orWhere('username', 'like', "%{$term}%")))
            ->when(($data['filter'] ?? null) === 'admins', fn ($q) => $q->where('is_platform_admin', true))
            ->when(($data['filter'] ?? null) === 'disabled', fn ($q) => $q->where('status', UserStatus::Disabled->value))
            ->with(['memberships' => fn ($q) => $q->select('id', 'tenant_id', 'user_id', 'status')->with('tenant:id,name,slug')])
            ->orderByDesc('is_platform_admin')->orderBy('name')
            ->paginate($this->perPage($request, 25));

        return response()->json($users->through(fn (User $u) => $this->presentUser($u)));
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
            if (! $grant && User::query()->where('is_platform_admin', true)->lockForUpdate()->count() <= 1) {
                throw new BusinessRuleException('The platform needs at least one administrator.', 'LAST_PLATFORM_ADMIN', status: 409);
            }
            $user->forceFill(['is_platform_admin' => $grant, ...($converted ? ['managed_by_tenant_id' => null] : [])])->save();
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
            $user ??= (new User())->forceFill(['name' => $customerAccount->name, 'email' => $email, 'phone' => $customerAccount->phone, 'status' => UserStatus::Active->value]);
            // The shop password hash is copied, so they sign in with the password they chose in the shop; nobody sees it.
            $user->forceFill([
                'password' => $customerAccount->getAttributes()['password'], 'must_change_password' => false, 'temporary_password_expires_at' => null,
                'is_platform_admin' => true, 'managed_by_tenant_id' => null,
            ])->save();
            if (! $user->wasRecentlyCreated) {
                $user->tokens()->delete(); // devices signed in with the old password must sign in again
            }
            $closed = CustomerAccount::query()->where('email', $email)->where('status', 'active')
                ->update(['status' => CustomerAccount::STATUS_MOVED_TO_ADMIN, 'remember_token' => null]);

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
        $page = $this->platformLog()->paginate($this->perPage($request, 30));

        return response()->json($page->through($this->presentLog(...)));
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

    /** @return array<int, \Illuminate\Support\Carbon> latest member sign-in per business */
    private function lastActivityByTenant(?int $tenantId = null): array
    {
        return DB::table('tenant_memberships')->join('users', 'users.id', '=', 'tenant_memberships.user_id')
            ->when($tenantId, fn ($q) => $q->where('tenant_memberships.tenant_id', $tenantId))
            ->whereNotNull('users.last_login_at')
            ->selectRaw('tenant_memberships.tenant_id, max(users.last_login_at) as last')->groupBy('tenant_memberships.tenant_id')
            ->pluck('last', 'tenant_id')->map(fn ($v) => \Illuminate\Support\Carbon::parse($v))->all();
    }
}
