<?php

namespace App\Policies;

use App\Models\Register;
use App\Models\User;
use App\Support\Permissions;

class RegisterPolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::SHIFTS_OPERATE) || $this->allows(Permissions::REGISTERS_MANAGE);
    }

    public function update(User $user, Register $register): bool
    {
        return $this->allowsAtBranch($register, Permissions::REGISTERS_MANAGE);
    }

    public function openShift(User $user, Register $register): bool
    {
        return $this->allowsAtBranch($register, Permissions::SHIFTS_OPERATE);
    }
}
