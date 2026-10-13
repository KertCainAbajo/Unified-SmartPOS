<?php

namespace App\Policies;

use App\Models\StockCount;
use App\Models\User;
use App\Support\Permissions;

class StockCountPolicy extends TenantScopedPolicy
{
    public function view(User $user, StockCount $count): bool
    {
        return $this->allowsAtBranch($count, Permissions::INVENTORY_VIEW);
    }

    public function complete(User $user, StockCount $count): bool
    {
        return $this->allowsAtBranch($count, Permissions::INVENTORY_COUNT);
    }
}
