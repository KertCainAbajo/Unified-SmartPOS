<?php

namespace App\Policies;

use App\Models\Role;
use App\Models\User;
use App\Support\Permissions;

class RolePolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::MEMBERS_VIEW);
    }

    public function create(User $user): bool
    {
        return $this->allows(Permissions::ROLES_MANAGE);
    }

    /** System roles are read-only; custom roles must belong to the current tenant. */
    public function update(User $user, Role $role): bool
    {
        return ! $role->is_system && $this->allowsFor($role, Permissions::ROLES_MANAGE);
    }

    public function delete(User $user, Role $role): bool
    {
        return $this->update($user, $role);
    }
}
