<?php

namespace App\Policies;

use App\Models\TenantMembership;
use App\Models\User;
use App\Services\Staff\StaffService;
use App\Support\Permissions;

/**
 * Read access to staff records. Write access is enforced by StaffService::authorize(), which applies the
 * full rule set (self/owner/privileged/branch scope/coverage) and audits denials.
 */
class TenantMembershipPolicy extends TenantScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allows(Permissions::STAFF_VIEW);
    }

    public function view(User $user, TenantMembership $membership): bool
    {
        if (! $this->owns($membership)) {
            return false;
        }
        if ($membership->user_id === $user->id) {
            return true;
        }

        return $this->allows(Permissions::STAFF_VIEW) && app(StaffService::class)->canSee($membership);
    }
}
