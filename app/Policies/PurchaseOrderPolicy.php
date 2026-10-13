<?php

namespace App\Policies;

use App\Models\PurchaseOrder;
use App\Models\User;
use App\Support\Permissions;

class PurchaseOrderPolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::PURCHASING_VIEW);
    }

    public function view(User $user, PurchaseOrder $order): bool
    {
        return $this->allowsAtBranch($order, Permissions::PURCHASING_VIEW);
    }

    public function update(User $user, PurchaseOrder $order): bool
    {
        return $this->allowsAtBranch($order, Permissions::PURCHASING_MANAGE);
    }
}
