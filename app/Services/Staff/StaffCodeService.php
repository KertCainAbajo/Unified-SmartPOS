<?php

namespace App\Services\Staff;

use App\Models\StaffInvitation;
use App\Models\TenantMembership;
use Illuminate\Support\Str;

/**
 * Issues and verifies one-time activation/recovery codes.
 *
 * - Manual codes (handed over in person) look like ABCD-EFGH-JKLM: 12 characters from a 32-symbol alphabet
 *   without look-alikes (~60 bits). Email codes are 40 random characters embedded in the link.
 * - Only a SHA-256 hash is stored. Codes expire, are single-use, and are revoked after
 *   StaffInvitation::MAX_FAILED_ATTEMPTS wrong guesses. Issuing a code revokes earlier codes.
 */
class StaffCodeService
{
    private const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public function __construct(private readonly AccessRevoker $revoker) {}

    /** @return array{invitation: StaffInvitation, code: string} */
    public function issue(TenantMembership $membership, string $purpose, string $channel, ?int $actorId): array
    {
        $this->revoker->revokeCodes($membership->user, $membership->tenant_id);

        $code = $channel === StaffInvitation::CHANNEL_MANUAL ? $this->manualCode() : Str::random(40);

        $invitation = StaffInvitation::query()->create([
            'tenant_id' => $membership->tenant_id,
            'membership_id' => $membership->id,
            'user_id' => $membership->user_id,
            'purpose' => $purpose,
            'channel' => $channel,
            'code_hash' => self::hash($code),
            'expires_at' => now()->addHours((int) config('smartpos.staff_code_ttl_hours', 72)),
            'failed_attempts' => 0,
            'created_by' => $actorId,
        ]);

        return ['invitation' => $invitation, 'code' => $code];
    }

    public function matches(StaffInvitation $invitation, string $code): bool
    {
        return hash_equals($invitation->code_hash, self::hash($code));
    }

    /** Normalize so "abcd efgh-jklm" and "ABCD-EFGH-JKLM" match; long email codes are case-sensitive. */
    public static function hash(string $code): string
    {
        $trimmed = trim($code);
        $normalized = strlen(preg_replace('/[\s-]/', '', $trimmed)) === 12
            ? strtoupper(preg_replace('/[\s-]/', '', $trimmed))
            : $trimmed;

        return hash('sha256', $normalized);
    }

    private function manualCode(): string
    {
        $chars = '';
        for ($i = 0; $i < 12; $i++) {
            $chars .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }

        return implode('-', str_split($chars, 4));
    }
}
