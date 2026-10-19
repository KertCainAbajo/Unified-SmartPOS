<?php

namespace App\Services\Shop;

use App\Exceptions\BusinessRuleException;
use App\Models\CustomerAccount;
use App\Models\CustomerPasswordCode;
use App\Models\Tenant;
use App\Notifications\CustomerPasswordCodeNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Forgot-password for shop customers: email a 6-digit code, check it, then set a new password.
 * Requests never reveal whether an email has an account. A code lasts CODE_MINUTES, allows MAX_ATTEMPTS
 * wrong guesses, and works once; asking for a new code retires the old ones.
 */
class CustomerPasswordResetService
{
    public const CODE_MINUTES = 15;

    public const MAX_ATTEMPTS = 5;

    /** Seconds before another code may be emailed to the same account. */
    public const RESEND_SECONDS = 60;

    public function request(Tenant $tenant, string $email): void
    {
        $account = $this->account($tenant, $email);
        if (! $account) {
            return;
        }
        $latest = $account->passwordCodes()->where('purpose', 'reset')->latest('id')->first();
        if ($latest && $latest->created_at->diffInSeconds(now()) < self::RESEND_SECONDS) {
            return;
        }

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $row = DB::transaction(function () use ($account, $code) {
            $account->passwordCodes()->where('purpose', 'reset')->whereNull('used_at')->update(['used_at' => now()]);

            return $account->passwordCodes()->create(['purpose' => 'reset', 'code_hash' => Hash::make($code), 'expires_at' => now()->addMinutes(self::CODE_MINUTES)]);
        });

        try {
            $account->notify(new CustomerPasswordCodeNotification($tenant->name, $code, self::CODE_MINUTES));
        } catch (Throwable $e) {
            // Mail server problems (wrong SMTP password, no connection) are for the store to fix: log the details,
            // drop the unsent code so the customer can retry at once, and show the customer a plain message.
            $row->delete();
            Log::error('Shop password reset email could not be sent.', ['tenant_id' => $tenant->id, 'customer_account_id' => $account->id, 'error' => $e->getMessage()]);

            throw new BusinessRuleException('We could not send the email right now. Please try again in a few minutes, or contact the store.', 'MAIL_NOT_SENT', status: 503);
        }
    }

    /** Throws a validation error on `code` unless the code is current and correct. Wrong guesses are counted. */
    public function check(Tenant $tenant, string $email, string $code): CustomerPasswordCode
    {
        $account = $this->account($tenant, $email);
        $current = $account?->passwordCodes()->where('purpose', 'reset')->whereNull('used_at')->latest('id')->first();
        if (! $current || ! $current->isUsable()) {
            throw ValidationException::withMessages(['code' => 'This code is invalid or has expired. Request a new one.']);
        }
        if ($current->attempts >= self::MAX_ATTEMPTS) {
            throw ValidationException::withMessages(['code' => 'Too many wrong codes. Request a new one.']);
        }
        if (! Hash::check($code, $current->code_hash)) {
            $current->increment('attempts');
            $left = self::MAX_ATTEMPTS - $current->attempts;
            throw ValidationException::withMessages(['code' => $left > 0 ? "That code is not right. {$left} ".($left === 1 ? 'try' : 'tries').' left.' : 'Too many wrong codes. Request a new one.']);
        }

        return $current;
    }

    public function reset(Tenant $tenant, string $email, string $code, #[\SensitiveParameter] string $password): CustomerAccount
    {
        // Checked outside the transaction so a wrong guess is still counted when the check throws.
        $current = $this->check($tenant, $email, $code);

        return DB::transaction(function () use ($current, $password) {
            $account = $current->account;
            $account->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
            $account->passwordCodes()->where('purpose', 'reset')->whereNull('used_at')->update(['used_at' => now()]);

            return $account;
        });
    }

    private function account(Tenant $tenant, string $email): ?CustomerAccount
    {
        return $tenant->customerAccounts()->where('email', mb_strtolower(trim($email)))->where('status', 'active')->first();
    }
}
