<?php

namespace App\Policies;

use App\Models\Supplier;
use App\Models\User;
use App\Support\Permissions;

class SupplierPolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::SUPPLIERS_VIEW);
    }

    public function view(User $user, Supplier $supplier): bool
    {
        return $this->allowsFor($supplier, Permissions::SUPPLIERS_VIEW);
    }

    public function create(User $user): bool
    {
        return $this->allows(Permissions::SUPPLIERS_MANAGE);
    }

    public function update(User $user, Supplier $supplier): bool
    {
        return $this->allowsFor($supplier, Permissions::SUPPLIERS_MANAGE);
    }
}
