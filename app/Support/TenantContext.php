<?php

namespace App\Support;

use App\Models\Tenant;
use App\Models\TenantMembership;
use RuntimeException;

/**
 * Request-scoped holder for the tenant being accessed and the caller's membership in it.
 * Populated by the ResolveTenant middleware; registered as a scoped singleton.
 */
class TenantContext
{
    private ?Tenant $tenant = null;

    private ?TenantMembership $membership = null;

    /** @var array<string, true> */
    private array $permissions = [];

    /** @var list<int>|null null means every branch of the tenant */
    private ?array $branchIds = null;

    public function set(Tenant $tenant, TenantMembership $membership): void
    {
        $this->tenant = $tenant;
        $this->membership = $membership;
        $this->permissions = array_fill_keys($membership->permissionKeys(), true);
        $this->branchIds = $membership->all_branches
            ? null
            : $membership->branches()->pluck('branches.id')->map(fn ($id) => (int) $id)->all();
    }

    public function hasTenant(): bool
    {
        return $this->tenant !== null;
    }

    public function tenant(): Tenant
    {
        return $this->tenant ?? throw new RuntimeException('Tenant context has not been resolved.');
    }

    public function membership(): TenantMembership
    {
        return $this->membership ?? throw new RuntimeException('Tenant context has not been resolved.');
    }

    public function tenantId(): int
    {
        return $this->tenant()->id;
    }

    public function can(string $permission): bool
    {
        return isset($this->permissions[$permission]);
    }

    /** @return list<string> */
    public function permissions(): array
    {
        return array_keys($this->permissions);
    }

    public function hasAllBranches(): bool
    {
        return $this->branchIds === null;
    }

    public function canAccessBranch(int|string|null $branchId): bool
    {
        if ($branchId === null) {
            return false;
        }

        return $this->branchIds === null || in_array((int) $branchId, $this->branchIds, true);
    }

    /** @return list<int>|null null when the member can access every branch */
    public function branchIds(): ?array
    {
        return $this->branchIds;
    }
}
