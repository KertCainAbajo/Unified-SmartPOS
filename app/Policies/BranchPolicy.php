<?php

namespace App\Policies;

use App\Models\Branch;
use App\Models\User;
use App\Support\Permissions;

class BranchPolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->context()->hasTenant();
    }

    public function view(User $user, Branch $branch): bool
    {
        return $this->owns($branch) && $this->context()->canAccessBranch($branch->id);
    }

    public function create(User $user): bool
    {
        return $this->allows(Permissions::BRANCHES_MANAGE);
    }

    public function update(User $user, Branch $branch): bool
    {
        return $this->allowsFor($branch, Permissions::BRANCHES_MANAGE)
            && $this->context()->canAccessBranch($branch->id);
    }
}
