<?php

namespace App\Policies;

use App\Models\RegisterSession;
use App\Models\User;
use App\Support\Permissions;

class RegisterSessionPolicy extends TenantScopedPolicy
{
    /** Own shifts, or any shift in an authorized branch with `shifts.view_all`. */
    public function view(User $user, RegisterSession $session): bool
    {
        if (! $this->owns($session) || ! $this->context()->canAccessBranch($session->branch_id)) {
            return false;
        }

        return $this->allows(Permissions::SHIFTS_VIEW_ALL)
            || ($this->allows(Permissions::SHIFTS_OPERATE) && $session->opened_by === $user->id);
    }

    public function close(User $user, RegisterSession $session): bool
    {
        return $this->view($user, $session);
    }
}
