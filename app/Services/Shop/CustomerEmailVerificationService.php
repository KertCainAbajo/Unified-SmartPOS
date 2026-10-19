<?php

namespace App\Services\Shop;

use App\Exceptions\BusinessRuleException;
use App\Models\CustomerAccount;
use App\Models\Tenant;
use App\Notifications\CustomerVerifyEmailNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Confirms a new shop account's email with a 6-digit code before the account can be used. Same rules as the
 * forgot-password code: hashed, short-lived, a few wrong guesses allowed, one minute between emails.
 */
class CustomerEmailVerificationService
{
    public const PURPOSE = 'verify';

    public const CODE_MINUTES = 15;

    public const MAX_ATTEMPTS = 5;

    public const RESEND_SECONDS = 60;

    /** Email a fresh code. Returns the seconds to wait before another can be sent (0 when one was just sent). */
    public function send(Tenant $tenant, CustomerAccount $account): int
    {
        $latest = $account->passwordCodes()->where('purpose', self::PURPOSE)->latest('id')->first();
        if ($latest && $latest->created_at->diffInSeconds(now()) < self::RESEND_SECONDS) {
            return self::RESEND_SECONDS - (int) $latest->created_at->diffInSeconds(now());
        }

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $row = DB::transaction(function () use ($account, $code) {
            $account->passwordCodes()->where('purpose', self::PURPOSE)->whereNull('used_at')->update(['used_at' => now()]);

            return $account->passwordCodes()->create([
                'purpose' => self::PURPOSE, 'code_hash' => Hash::make($code), 'expires_at' => now()->addMinutes(self::CODE_MINUTES),
            ]);
        });

        try {
            $account->notify(new CustomerVerifyEmailNotification($tenant->name, $code, self::CODE_MINUTES));
        } catch (Throwable $e) {
            $row->delete();
            Log::error('Shop sign-up verification email could not be sent.', ['tenant_id' => $tenant->id, 'customer_account_id' => $account->id, 'error' => $e->getMessage()]);

            throw new BusinessRuleException('We could not send the email right now. Please try again in a few minutes, or contact the store.', 'MAIL_NOT_SENT', status: 503);
        }

        return 0;
    }

    /** Check the code and activate the account. Throws a validation error on `code` otherwise. */
    public function verify(Tenant $tenant, string $email, string $code): CustomerAccount
    {
        $account = $tenant->customerAccounts()->where('email', mb_strtolower(trim($email)))->where('status', CustomerAccount::STATUS_UNVERIFIED)->first();
        $current = $account?->passwordCodes()->where('purpose', self::PURPOSE)->whereNull('used_at')->latest('id')->first();
        if (! $current || ! $current->isUsable()) {
            throw ValidationException::withMessages(['code' => 'This code is invalid or has expired. Send a new one.']);
        }
        if ($current->attempts >= self::MAX_ATTEMPTS) {
            throw ValidationException::withMessages(['code' => 'Too many wrong codes. Send a new one.']);
        }
        if (! Hash::check($code, $current->code_hash)) {
            $current->increment('attempts');
            $left = self::MAX_ATTEMPTS - $current->attempts;
            throw ValidationException::withMessages(['code' => $left > 0 ? "That code is not right. {$left} ".($left === 1 ? 'try' : 'tries').' left.' : 'Too many wrong codes. Send a new one.']);
        }

        return DB::transaction(function () use ($account, $current) {
            $current->forceFill(['used_at' => now()])->save();
            $account->forceFill(['status' => 'active', 'email_verified_at' => now()])->save();

            return $account;
        });
    }
}
