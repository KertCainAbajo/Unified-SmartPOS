<?php

namespace App\Services\Staff;

use App\Models\StaffInvitation;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Removes every credential that could let a user act without signing in again:
 * API tokens, database sessions, Laravel password-reset tokens and outstanding staff codes.
 */
class AccessRevoker
{
    /** @return array{tokens: int, sessions: int, reset_tokens: int, codes: int} */
    public function revokeAll(User $user): array
    {
        $tokens = $user->tokens()->delete();

        $sessions = 0;
        if (config('session.driver') === 'database') {
            $sessions = DB::table(config('session.table', 'sessions'))->where('user_id', $user->id)->delete();
        }

        $resetTokens = $user->email
            ? DB::table(config('auth.passwords.users.table', 'password_reset_tokens'))->where('email', $user->email)->delete()
            : 0;

        return [
            'tokens' => $tokens,
            'sessions' => $sessions,
            'reset_tokens' => $resetTokens,
            'codes' => $this->revokeCodes($user),
        ];
    }

    /** Revoke outstanding activation/recovery codes, optionally only for one business. */
    public function revokeCodes(User $user, ?int $tenantId = null): int
    {
        return StaffInvitation::query()
            ->where('user_id', $user->id)
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->outstanding()
            ->update(['revoked_at' => now()]);
    }
}
