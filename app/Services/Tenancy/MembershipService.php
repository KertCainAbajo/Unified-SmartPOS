<?php

namespace App\Services\Tenancy;

use App\Exceptions\BusinessRuleException;
use App\Models\Role;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\AuditLogger;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

class MembershipService
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Add a person to the current tenant. Existing users are linked; new users are created
     * without a usable password and receive a password-setup (reset) link.
     *
     * @param  array{email: string, name?: string|null, role_ids: list<int>, all_branches?: bool, branch_ids?: list<int>}  $data
     */
    public function add(array $data): TenantMembership
    {
        $tenant = $this->context->tenant();
        $roles = $this->resolveAssignableRoles($data['role_ids']);
        $this->assertCanGrantAllBranches((bool) ($data['all_branches'] ?? false));

        [$membership, $isNewUser] = DB::transaction(function () use ($tenant, $data, $roles) {
            $email = mb_strtolower(trim($data['email']));
            $user = User::query()->where('email', $email)->first();
            $isNewUser = $user === null;

            if ($isNewUser) {
                $user = User::query()->create([
                    'name' => $data['name'] ?? Str::before($email, '@'),
                    'email' => $email,
                    'password' => Str::random(64),
                ]);
            } elseif ($tenant->memberships()->where('user_id', $user->id)->exists()) {
                throw new BusinessRuleException('This user is already a member of the business.', 'ALREADY_MEMBER');
            }

            $membership = TenantMembership::query()->create([
                'tenant_id' => $tenant->id,
                'user_id' => $user->id,
                'status' => 'active',
                'all_branches' => (bool) ($data['all_branches'] ?? false),
                'joined_at' => now(),
            ]);
            $membership->roles()->sync($roles->modelKeys());
            $membership->branches()->sync($this->validBranchIds($data['branch_ids'] ?? []));

            $this->audit->log('member.added', $membership, null, [
                'user_id' => $user->id,
                'roles' => $roles->pluck('key')->all(),
                'all_branches' => $membership->all_branches,
                'branch_ids' => $data['branch_ids'] ?? [],
            ]);

            return [$membership, $isNewUser];
        });

        if ($isNewUser) {
            Password::sendResetLink(['email' => $membership->user->email]);
        }

        return $membership->load(['user', 'roles', 'branches']);
    }

    /**
     * @param  array{role_ids?: list<int>, all_branches?: bool, branch_ids?: list<int>, status?: string}  $data
     */
    public function update(TenantMembership $membership, array $data): TenantMembership
    {
        return DB::transaction(function () use ($membership, $data) {
            $old = [
                'status' => $membership->status,
                'all_branches' => $membership->all_branches,
                'roles' => $membership->roles()->pluck('key')->all(),
                'branch_ids' => $membership->branches()->pluck('branches.id')->all(),
            ];

            // Members holding permissions the actor lacks cannot be modified by that actor.
            $this->assertActorCovers($membership->roles()->with('permissions')->get());

            if (array_key_exists('role_ids', $data)) {
                $membership->roles()->sync($this->resolveAssignableRoles($data['role_ids'])->modelKeys());
            }
            if (array_key_exists('branch_ids', $data)) {
                $membership->branches()->sync($this->validBranchIds($data['branch_ids']));
            }
            if (array_key_exists('all_branches', $data)) {
                $this->assertCanGrantAllBranches((bool) $data['all_branches']);
            }
            // Suspension is tenant-specific: the user's tokens stay valid for their other businesses.
            $membership->fill(array_intersect_key($data, array_flip(['all_branches', 'status'])))->save();

            $membership->load(['user', 'roles', 'branches']);
            $this->audit->log('member.updated', $membership, $old, [
                'status' => $membership->status,
                'all_branches' => $membership->all_branches,
                'roles' => $membership->roles->pluck('key')->all(),
                'branch_ids' => $membership->branches->pluck('id')->all(),
            ]);

            return $membership;
        });
    }

    /**
     * Roles must be system roles or this tenant's roles, and the actor may only grant permissions they hold.
     * Only the business owner may grant the Business Owner role.
     *
     * @param  list<int>  $roleIds
     * @return Collection<int, Role>
     */
    private function resolveAssignableRoles(array $roleIds): Collection
    {
        $roles = Role::query()
            ->availableTo($this->context->tenantId())
            ->whereIn('id', $roleIds)
            ->with('permissions')
            ->get();

        if ($roles->count() !== count(array_unique($roleIds))) {
            throw new BusinessRuleException('One or more roles are invalid.', 'INVALID_ROLE', ['role_ids' => ['One or more roles are invalid.']]);
        }

        $actorIsOwner = $this->context->membership()->user_id === $this->context->tenant()->owner_user_id;
        if (! $actorIsOwner && $roles->contains(fn (Role $r) => $r->key === Permissions::ROLE_OWNER && $r->tenant_id === null)) {
            throw new BusinessRuleException('Only the business owner can grant the Business Owner role.', 'ROLE_ESCALATION', status: 403);
        }

        $this->assertActorCovers($roles);

        return $roles;
    }

    /** @param  Collection<int, Role>  $roles */
    private function assertActorCovers(Collection $roles): void
    {
        $missing = $roles->flatMap(fn (Role $role) => $role->permissions->pluck('key'))
            ->unique()
            ->reject(fn (string $key) => $this->context->can($key));

        if ($missing->isNotEmpty()) {
            throw new BusinessRuleException(
                'You cannot grant or modify permissions you do not hold.',
                'ROLE_ESCALATION',
                status: 403,
            );
        }
    }

    private function assertCanGrantAllBranches(bool $allBranches): void
    {
        if ($allBranches && ! $this->context->hasAllBranches()) {
            throw new BusinessRuleException('You cannot grant access to all branches.', 'BRANCH_ESCALATION', status: 403);
        }
    }

    /**
     * @param  list<int>  $branchIds
     * @return list<int>
     */
    private function validBranchIds(array $branchIds): array
    {
        $valid = $this->context->tenant()->branches()->whereIn('id', $branchIds)->pluck('id')->all();

        if (count($valid) !== count(array_unique($branchIds))) {
            throw new BusinessRuleException('One or more branches are invalid.', 'INVALID_BRANCH', ['branch_ids' => ['One or more branches are invalid.']]);
        }

        foreach ($valid as $branchId) {
            if (! $this->context->canAccessBranch($branchId)) {
                throw new BusinessRuleException('You cannot grant access to a branch you cannot access.', 'BRANCH_ESCALATION', status: 403);
            }
        }

        return $valid;
    }
}
