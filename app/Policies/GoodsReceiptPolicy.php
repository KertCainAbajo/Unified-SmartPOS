<?php

namespace App\Policies;

use App\Models\GoodsReceipt;
use App\Models\User;
use App\Support\Permissions;

class GoodsReceiptPolicy extends TenantScopedPolicy
{
    public function view(User $user, GoodsReceipt $receipt): bool
    {
        return $this->allowsAtBranch($receipt, Permissions::PURCHASING_VIEW);
    }
}
