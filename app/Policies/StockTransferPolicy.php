<?php

namespace App\Policies;

use App\Models\StockTransfer;
use App\Models\User;
use App\Support\Permissions;

class StockTransferPolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::INVENTORY_VIEW);
    }

    /** Visible to members of either branch. */
    public function view(User $user, StockTransfer $transfer): bool
    {
        return $this->allowsFor($transfer, Permissions::INVENTORY_VIEW)
            && ($this->context()->canAccessBranch($transfer->from_branch_id)
                || $this->context()->canAccessBranch($transfer->to_branch_id));
    }

    /** Dispatch and cancel happen at the source branch. */
    public function dispatch(User $user, StockTransfer $transfer): bool
    {
        return $this->allowsAtBranch($transfer, Permissions::INVENTORY_TRANSFER, 'from_branch_id');
    }

    /** Receiving happens at the destination branch. */
    public function receive(User $user, StockTransfer $transfer): bool
    {
        return $this->allowsAtBranch($transfer, Permissions::INVENTORY_TRANSFER, 'to_branch_id');
    }
}
