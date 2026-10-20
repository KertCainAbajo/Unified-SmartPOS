<?php

namespace App\Services\Security;

use Closure;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;

/**
 * Pauses sign-in for one account after too many wrong passwords, whatever IP address they come from
 * (the per-IP rate limits alone do not stop an attacker who keeps changing addresses).
 * Keyed by what was typed (email, or store + username), so it never reveals whether the account exists.
 */
class AccountLockout
{
    public const MAX_FAILURES = 5;

    public const WINDOW_MINUTES = 15;

    public const LOCK_MINUTES = 15;

    /** Refuse sign-in while the account is paused. */
    public function ensureNotLocked(string $key, string $field): void
    {
        $until = Cache::get($this->lockKey($key));
        if ($until && $until > now()->getTimestamp()) {
            $minutes = max(1, (int) ceil(($until - now()->getTimestamp()) / 60));
            throw ValidationException::withMessages([
                $field => "Too many wrong passwords. For your safety, sign-in to this account is paused for {$minutes} more ".($minutes === 1 ? 'minute' : 'minutes').'. You can reset your password instead.',
            ]);
        }
    }

    /** Count a wrong password; on the last allowed one the account is paused and `$onLock` runs once. */
    public function recordFailure(string $key, ?Closure $onLock = null): void
    {
        $failures = $this->failuresKey($key);
        Cache::add($failures, 0, now()->addMinutes(self::WINDOW_MINUTES));
        $count = (int) Cache::increment($failures);

        if ($count >= self::MAX_FAILURES) {
            Cache::put($this->lockKey($key), now()->addMinutes(self::LOCK_MINUTES)->getTimestamp(), now()->addMinutes(self::LOCK_MINUTES));
            Cache::forget($failures);
            $onLock?->__invoke();
        }
    }

    public function clear(string $key): void
    {
        Cache::forget($this->failuresKey($key));
        Cache::forget($this->lockKey($key));
    }

    private function failuresKey(string $key): string
    {
        return 'login-failures:'.hash('sha256', $key);
    }

    private function lockKey(string $key): string
    {
        return 'login-locked:'.hash('sha256', $key);
    }
}
