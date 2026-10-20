<?php

namespace App\Services\Security;

use App\Exceptions\BusinessRuleException;
use App\Models\LoginChallenge;
use App\Models\TrustedDevice;
use App\Models\User;
use App\Notifications\SignInCodeNotification;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Cookie;
use Throwable;

/**
 * Two-step sign-in for accounts that sign in with email (owners, managers, HR, platform admins):
 * on a browser the account has not confirmed before, a correct password is not enough. A 6-digit code is
 * emailed and must be entered too. A confirmed browser is remembered with a cookie for TRUST_DAYS.
 */
class NewDeviceVerification
{
    public const COOKIE = 'smartpos_device';

    public const CODE_MINUTES = 10;

    public const RESEND_SECONDS = 60;

    public const MAX_ATTEMPTS = 5;

    public const TRUST_DAYS = 30;

    public function enabled(): bool
    {
        return (bool) config('smartpos.new_device_codes');
    }

    /** Whether this browser was confirmed by this user (and is still within its trust period). */
    public function isTrusted(User $user, Request $request): bool
    {
        $device = $this->currentDevice($user, $request);
        $device?->forceFill(['last_used_at' => now(), 'ip_address' => $request->ip()])->save();

        return $device !== null;
    }

    public function currentDevice(User $user, Request $request): ?TrustedDevice
    {
        $value = $request->cookie(self::COOKIE);
        if (! is_string($value) || strlen($value) < 40) {
            return null;
        }

        return TrustedDevice::query()->where('user_id', $user->id)->where('token_hash', hash('sha256', $value))
            ->where('expires_at', '>', now())->first();
    }

    /**
     * Email a code and return what the sign-in page needs to ask for it.
     *
     * @return array<string, mixed>
     */
    public function start(User $user, Request $request, ?string $deviceName): array
    {
        $challenge = Str::random(48);
        $code = $this->newCode();
        $row = LoginChallenge::query()->create([
            'user_id' => $user->id,
            'challenge_hash' => hash('sha256', $challenge),
            'code_hash' => Hash::make($code),
            'device_name' => $deviceName,
            'ip_address' => $request->ip(),
            'sent_at' => now(),
            'expires_at' => now()->addMinutes(self::CODE_MINUTES),
        ]);
        $this->send($user, $code, $request, fn () => $row->delete());

        return [
            'two_factor_required' => true,
            'challenge' => $challenge,
            'email_hint' => self::maskEmail($user->email),
            'expires_in_minutes' => self::CODE_MINUTES,
            'resend_after_seconds' => self::RESEND_SECONDS,
        ];
    }

    /** Send another code for the same sign-in. Returns the seconds to wait (0 when sent). */
    public function resend(string $challenge, Request $request): int
    {
        $row = $this->pending($challenge);
        $elapsed = (int) $row->sent_at->diffInSeconds(now());
        if ($elapsed < self::RESEND_SECONDS) {
            return self::RESEND_SECONDS - $elapsed;
        }
        $code = $this->newCode();
        $row->forceFill(['code_hash' => Hash::make($code), 'attempts' => 0, 'sent_at' => now(), 'expires_at' => now()->addMinutes(self::CODE_MINUTES)])->save();
        $this->send($row->user, $code, $request);

        return 0;
    }

    /** Check the code. Returns the challenge (with its user) once; it cannot be used again. */
    public function verify(string $challenge, string $code): LoginChallenge
    {
        $row = $this->pending($challenge);
        if ($row->attempts >= self::MAX_ATTEMPTS) {
            $row->forceFill(['used_at' => now()])->save();
            throw ValidationException::withMessages(['code' => 'Too many wrong codes. Sign in again to get a new code.']);
        }
        if (! Hash::check(trim($code), $row->code_hash)) {
            $row->increment('attempts');
            $left = self::MAX_ATTEMPTS - $row->attempts;
            if ($left <= 0) {
                $row->forceFill(['used_at' => now()])->save();
            }
            throw ValidationException::withMessages(['code' => $left > 0
                ? "That code is not right. {$left} ".($left === 1 ? 'try' : 'tries').' left.'
                : 'Too many wrong codes. Sign in again to get a new code.']);
        }
        $row->forceFill(['used_at' => now()])->save();

        return $row->load('user');
    }

    /** Remember this browser for the user; returns the cookie to attach to the response. */
    public function trust(User $user, Request $request): Cookie
    {
        $value = Str::random(64);
        TrustedDevice::query()->create([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $value),
            'label' => self::deviceLabel((string) $request->userAgent()),
            'ip_address' => $request->ip(),
            'last_used_at' => now(),
            'expires_at' => now()->addDays(self::TRUST_DAYS),
        ]);

        return cookie(self::COOKIE, $value, self::TRUST_DAYS * 24 * 60, '/', null, $request->isSecure() ?: null, true, false, 'lax');
    }

    /** Forget every remembered browser of the user, except optionally the one making this request. */
    public function forgetDevices(User $user, ?Request $keepCurrent = null): int
    {
        $keep = $keepCurrent ? $this->currentDevice($user, $keepCurrent)?->id : null;

        return TrustedDevice::query()->where('user_id', $user->id)->when($keep, fn ($q) => $q->whereKeyNot($keep))->delete();
    }

    public static function maskEmail(string $email): string
    {
        [$name, $domain] = array_pad(explode('@', $email, 2), 2, '');

        return mb_substr($name, 0, 1).str_repeat('•', max(2, min(6, mb_strlen($name) - 1))).'@'.$domain;
    }

    /** "Chrome on Windows" style label from a user agent (good enough for an email or a device list). */
    public static function deviceLabel(string $agent): string
    {
        $browser = match (true) {
            str_contains($agent, 'Edg/') => 'Edge',
            str_contains($agent, 'OPR/') => 'Opera',
            str_contains($agent, 'Firefox/') => 'Firefox',
            str_contains($agent, 'Chrome/') => 'Chrome',
            str_contains($agent, 'Safari/') => 'Safari',
            default => 'A browser',
        };
        $os = match (true) {
            str_contains($agent, 'Android') => 'Android',
            str_contains($agent, 'iPhone') || str_contains($agent, 'iPad') => 'iPhone/iPad',
            str_contains($agent, 'Windows') => 'Windows',
            str_contains($agent, 'Mac OS') => 'Mac',
            str_contains($agent, 'Linux') => 'Linux',
            default => null,
        };

        return $os ? "{$browser} on {$os}" : $browser;
    }

    private function pending(string $challenge): LoginChallenge
    {
        $row = LoginChallenge::query()->where('challenge_hash', hash('sha256', $challenge))->whereNull('used_at')->with('user')->first();
        if (! $row || $row->expires_at->isPast() || ! $row->user) {
            throw ValidationException::withMessages(['code' => 'This sign-in has expired. Sign in again to get a new code.']);
        }

        return $row;
    }

    private function newCode(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    private function send(User $user, string $code, Request $request, ?callable $onFail = null): void
    {
        try {
            $user->notify(new SignInCodeNotification(config('app.name'), $code, self::CODE_MINUTES, $request->ip(), self::deviceLabel((string) $request->userAgent())));
        } catch (Throwable $e) {
            if ($onFail) {
                $onFail();
            }
            Log::error('Sign-in code email could not be sent.', ['user_id' => $user->id, 'error' => $e->getMessage()]);

            throw new BusinessRuleException('We could not email your sign-in code right now. Please try again in a few minutes.', 'MAIL_NOT_SENT', status: 503);
        }
    }
}
