<?php

namespace App\Policies;

use App\Models\TenantMembership;
use App\Models\User;
use App\Support\Permissions;

class TenantMembershipPolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::MEMBERS_VIEW);
    }

    public function view(User $user, TenantMembership $membership): bool
    {
        return $this->allowsFor($membership, Permissions::MEMBERS_VIEW) || $membership->user_id === $user->id;
    }

    public function create(User $user): bool
    {
        return $this->allows(Permissions::MEMBERS_MANAGE);
    }

    /**
     * Nobody may change their own roles/branches, and only the owner may change the owner's membership
     * (which, being their own, means nobody may). This blocks self-escalation and owner lock-out.
     */
    public function update(User $user, TenantMembership $membership): bool
    {
        return $this->allowsFor($membership, Permissions::MEMBERS_MANAGE)
            && $membership->user_id !== $user->id
            && $membership->user_id !== $this->context()->tenant()->owner_user_id;
    }
}
