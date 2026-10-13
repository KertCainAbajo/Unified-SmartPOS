<?php

namespace App\Policies;

use App\Models\Customer;
use App\Models\User;
use App\Support\Permissions;

class CustomerPolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::CUSTOMERS_VIEW);
    }

    public function view(User $user, Customer $customer): bool
    {
        return $this->allowsFor($customer, Permissions::CUSTOMERS_VIEW);
    }

    public function create(User $user): bool
    {
        return $this->allows(Permissions::CUSTOMERS_MANAGE);
    }

    public function update(User $user, Customer $customer): bool
    {
        return $this->allowsFor($customer, Permissions::CUSTOMERS_MANAGE);
    }
}
