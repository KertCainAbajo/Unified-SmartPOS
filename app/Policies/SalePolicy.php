<?php

namespace App\Policies;

use App\Models\Sale;
use App\Models\User;
use App\Support\Permissions;

class SalePolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::SALES_VIEW) || $this->allows(Permissions::SALES_VIEW_ALL);
    }

    /** `sales.view_all` sees every sale in authorized branches; `sales.view` only the caller's own. */
    public function view(User $user, Sale $sale): bool
    {
        if (! $this->owns($sale) || ! $this->context()->canAccessBranch($sale->branch_id)) {
            return false;
        }

        return $this->allows(Permissions::SALES_VIEW_ALL)
            || ($this->allows(Permissions::SALES_VIEW) && $sale->cashier_id === $user->id);
    }

    public function void(User $user, Sale $sale): bool
    {
        return $this->allowsAtBranch($sale, Permissions::SALES_VOID);
    }

    public function refund(User $user, Sale $sale): bool
    {
        return $this->allowsAtBranch($sale, Permissions::REFUNDS_CREATE);
    }
}
