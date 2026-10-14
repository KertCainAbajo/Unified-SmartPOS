<?php

namespace App\Services\Staff;

use Illuminate\Support\Str;

/**
 * Simple, easy-to-type staff passwords based on the business name, e.g. `AlingNena-4827` for "Aling Nena Mini Mart".
 * The 4 digits are random (CSPRNG) and differ per employee, so the password cannot be worked out from the company
 * name or employee details; together with the login rate limit this keeps guessing impractical. Always satisfies the
 * password policy (8+ characters, upper and lower case, digits).
 */
final class CompanyPassword
{
    public static function generate(string $companyName): string
    {
        return self::prefix($companyName).'-'.str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);
    }

    /** "Aling Nena Mini Mart" → "AlingNena": whole words until at least 6 letters, at most 12. */
    public static function prefix(string $companyName): string
    {
        $words = preg_split('/[^A-Za-z]+/', Str::ascii($companyName), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $prefix = '';
        foreach ($words as $word) {
            if (strlen($prefix) >= 6) {
                break;
            }
            $prefix .= ucfirst(strtolower($word));
        }
        $prefix = substr($prefix, 0, 12);

        // Needs both cases for the password policy (a one-letter or all-initials name has no lower case).
        return preg_match('/[A-Z]/', $prefix) && preg_match('/[a-z]/', $prefix) ? $prefix : 'Staff';
    }
}
