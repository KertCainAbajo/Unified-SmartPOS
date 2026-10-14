<?php

namespace App\Services\Staff;

use App\Enums\MembershipStatus;
use App\Enums\UserStatus;
use App\Models\StaffInvitation;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\NotificationService;
use App\Support\Permissions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Validation\ValidationException;

/**
 * Public (unauthenticated) side of staff onboarding and recovery.
 * Responses never reveal whether a business, username or code exists.
 */
class StaffActivationService
{
    private const GENERIC_FAILURE = 'The code is invalid or has expired. Ask your manager for a new one.';

    public function __construct(
        private readonly StaffCodeService $codes,
        private readonly AccessRevoker $revoker,
        private readonly AuditLogger $audit,
        private readonly NotificationService $notifications,
    ) {}

    /** Redeem an activation or recovery code and set the employee's own password. */
    public function redeem(string $businessCode, string $username, #[\SensitiveParameter] string $code, #[\SensitiveParameter] string $password): void
    {
        [$tenant, $user] = $this->locate($businessCode, $username);
        $invitation = $user ? StaffInvitation::query()
            ->where('tenant_id', $tenant->id)->where('user_id', $user->id)->outstanding()->latest('id')->first() : null;

        if (! $invitation) {
            $this->fail($tenant, $user, 'no_outstanding_code');
        }
        if ($invitation->expires_at->isPast()) {
            $invitation->forceFill(['revoked_at' => now()])->save();
            $this->audit->log('staff.invitation_expired', $invitation->membership, null, null, ['purpose' => $invitation->purpose], tenantId: $tenant->id, userId: $user->id);
            $this->fail($tenant, $user, 'expired');
        }
        if (! $this->codes->matches($invitation, $code)) {
            $attempts = $invitation->failed_attempts + 1;
            $invitation->forceFill([
                'failed_attempts' => $attempts,
                'revoked_at' => $attempts >= StaffInvitation::MAX_FAILED_ATTEMPTS ? now() : null,
            ])->save();
            if ($attempts >= StaffInvitation::MAX_FAILED_ATTEMPTS) {
                $this->audit->log('staff.code_locked', $invitation->membership, null, null, ['purpose' => $invitation->purpose], tenantId: $tenant->id, userId: $user->id);
            }
            $this->fail($tenant, $user, 'wrong_code');
        }

        DB::transaction(function () use ($invitation, $user, $tenant, $password) {
            $invitation = StaffInvitation::query()->lockForUpdate()->findOrFail($invitation->id);
            $membership = TenantMembership::query()->lockForUpdate()->findOrFail($invitation->membership_id);
            $recovery = $invitation->purpose === StaffInvitation::PURPOSE_RECOVERY;

            $validState = $recovery
                ? $membership->hasStatus(MembershipStatus::Active) && $user->isActive()
                : $membership->hasStatus(MembershipStatus::Invited) && $user->status === UserStatus::Pending->value;
            if (! $invitation->isUsable() || ! $validState) {
                $this->fail($tenant, $user, 'invalid_state');
            }

            // Sign out everywhere first (recovery: an attacker may hold a session), then set the new password.
            $this->revoker->revokeAll($user);
            $invitation->forceFill(['used_at' => now()])->save();
            $user->forceFill(['password' => $password, 'status' => UserStatus::Active->value])->save();

            if (! $recovery) {
                $membership->forceFill(['status' => MembershipStatus::Active->value, 'joined_at' => now()])->save();
            }

            $this->audit->log($recovery ? 'staff.recovery_completed' : 'staff.activated', $membership, null, null, [
                'issued_by' => $invitation->created_by,
                'channel' => $invitation->channel,
            ], tenantId: $tenant->id, userId: $user->id);

            if ($recovery) {
                // Detection: the employee sees this on next sign-in; the issuer is named.
                $issuer = $invitation->created_by ? User::query()->find($invitation->created_by)?->name : null;
                $this->notifications->notifyUser($tenant->id, $user->id, 'password_recovered', 'Your password was reset',
                    'Your password was changed with a recovery code'.($issuer ? " issued by {$issuer}" : '').' on '.now($tenant->timezone)->format('M j, Y g:i A').'. If this was not you, tell your manager immediately.');
            }
        });
    }

    /**
     * "Forgot password" for company-managed accounts. Accounts with a company email get the standard reset
     * link; others alert the business's staff administrators. The response never varies.
     */
    public function requestHelp(string $businessCode, string $username): void
    {
        [$tenant, $user] = $this->locate($businessCode, $username);
        if (! $tenant || ! $user || ! $user->isActive()) {
            return;
        }
        $membership = TenantMembership::query()->where('tenant_id', $tenant->id)->where('user_id', $user->id)
            ->where('status', MembershipStatus::Active->value)->first();
        if (! $membership) {
            return;
        }

        if ($user->email) {
            Password::sendResetLink(['email' => $user->email]);
        } else {
            $branchIds = $membership->all_branches ? [null] : $membership->branchIds();
            foreach (array_unique($branchIds) as $branchId) {
                $this->notifications->notifyPermissionHolders($tenant->id, $branchId, Permissions::STAFF_CREDENTIALS, 'staff_recovery_requested',
                    "{$user->name} needs a password reset",
                    "Username {$user->username} asked for help signing in. Verify their identity in person, then issue a recovery code.",
                    ['membership_id' => $membership->id], exceptUserId: $user->id);
            }
        }

        $this->audit->log('staff.recovery_requested', $membership, null, null, ['channel' => $user->email ? 'email' : 'administrator'], tenantId: $tenant->id, userId: $user->id);
    }

    /** @return array{0: Tenant|null, 1: User|null} */
    private function locate(string $businessCode, string $username): array
    {
        $tenant = Tenant::query()->where('slug', strtolower(trim($businessCode)))->first();
        $user = $tenant ? User::query()->where('managed_by_tenant_id', $tenant->id)
            ->where('username', UsernameGenerator::normalize($username))->first() : null;

        return [$tenant, $user];
    }

    private function fail(?Tenant $tenant, ?User $user, string $reason): never
    {
        $this->audit->log('staff.activation_failed', null, null, null, ['reason' => $reason, 'target_user_id' => $user?->id], tenantId: $tenant?->id, userId: null);

        throw ValidationException::withMessages(['code' => self::GENERIC_FAILURE]);
    }
}
