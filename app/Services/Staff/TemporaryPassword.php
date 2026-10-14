<?php

namespace App\Services\Staff;

/**
 * Readable random temporary passwords such as `Kp7m-Xq3t-Rw9z`: 12 characters from an alphabet without look-alikes
 * (~70 bits), always containing upper case, lower case and digits so they satisfy the password policy.
 */
final class TemporaryPassword
{
    private const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

    private const LOWER = 'abcdefghijkmnpqrstuvwxyz';

    private const DIGITS = '23456789';

    public static function generate(): string
    {
        $all = self::UPPER.self::LOWER.self::DIGITS;
        $chars = [self::pick(self::UPPER), self::pick(self::LOWER), self::pick(self::DIGITS)];
        while (count($chars) < 12) {
            $chars[] = self::pick($all);
        }

        // Fisher–Yates shuffle with a CSPRNG.
        for ($i = count($chars) - 1; $i > 0; $i--) {
            $j = random_int(0, $i);
            [$chars[$i], $chars[$j]] = [$chars[$j], $chars[$i]];
        }

        return implode('-', str_split(implode('', $chars), 4));
    }

    private static function pick(string $alphabet): string
    {
        return $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
}
