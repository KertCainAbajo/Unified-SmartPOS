<?php

namespace App\Policies;

use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;

class TenantPolicy extends TenantScopedPolicy
{
    public function view(User $user, Tenant $tenant): bool
    {
        return $this->context()->hasTenant() && $this->context()->tenantId() === $tenant->id;
    }

    public function update(User $user, Tenant $tenant): bool
    {
        return $this->view($user, $tenant) && $this->allows(Permissions::TENANT_MANAGE);
    }
}
