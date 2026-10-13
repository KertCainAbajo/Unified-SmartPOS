<?php

namespace App\Policies;

use App\Models\Refund;
use App\Models\User;
use App\Support\Permissions;

class RefundPolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::REFUNDS_CREATE) || $this->allows(Permissions::REFUNDS_APPROVE);
    }

    /** Requesters see their own refunds; approvers and `sales.view_all` see all in authorized branches. */
    public function view(User $user, Refund $refund): bool
    {
        if (! $this->owns($refund) || ! $this->context()->canAccessBranch($refund->branch_id)) {
            return false;
        }

        return $refund->requested_by === $user->id
            || $this->allows(Permissions::REFUNDS_APPROVE)
            || $this->allows(Permissions::SALES_VIEW_ALL);
    }

    public function approve(User $user, Refund $refund): bool
    {
        return $this->allowsAtBranch($refund, Permissions::REFUNDS_APPROVE);
    }
}
