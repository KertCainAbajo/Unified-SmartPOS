<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * Decimal-string arithmetic for money, costs and quantities.
 *
 * All values are numeric strings; floats are never used. Intermediate results keep
 * extra precision and are rounded half-up (away from zero) only where a result is stored.
 */
final class Money
{
    private const WORK_SCALE = 10;

    public static function normalize(string|int $value, int $scale = 2): string
    {
        $value = trim((string) $value);

        if (! preg_match('/^-?\d+(\.\d+)?$/', $value)) {
            throw new InvalidArgumentException("Invalid decimal value [{$value}].");
        }

        return self::round($value, $scale);
    }

    /**
     * Normalize an aggregate returned by the database driver. MySQL returns DECIMAL sums as exact
     * strings; SQLite (tests) may return floats, which are converted without scientific notation.
     */
    public static function fromDatabase(mixed $value, int $scale = 2): string
    {
        if ($value === null || $value === '') {
            return self::round('0', $scale);
        }
        if (is_float($value)) {
            $value = number_format($value, 8, '.', '');
        }

        return self::round((string) $value, $scale);
    }

    public static function add(string ...$values): string
    {
        $sum = '0';
        foreach ($values as $value) {
            $sum = bcadd($sum, $value, self::WORK_SCALE);
        }

        return $sum;
    }

    public static function sub(string $a, string $b): string
    {
        return bcsub($a, $b, self::WORK_SCALE);
    }

    public static function mul(string $a, string $b): string
    {
        return bcmul($a, $b, self::WORK_SCALE);
    }

    public static function div(string $a, string $b): string
    {
        if (bccomp($b, '0', self::WORK_SCALE) === 0) {
            throw new InvalidArgumentException('Division by zero.');
        }

        return bcdiv($a, $b, self::WORK_SCALE);
    }

    /** Round half away from zero to the given scale. */
    public static function round(string $value, int $scale = 2): string
    {
        $offset = '0.'.str_repeat('0', $scale).'5';
        $adjusted = self::isNegative($value)
            ? bcsub($value, $offset, $scale + 1)
            : bcadd($value, $offset, $scale + 1);

        $result = bcadd($adjusted, '0', $scale);

        // Avoid "-0.00".
        return bccomp($result, '0', $scale) === 0 ? bcadd('0', '0', $scale) : $result;
    }

    public static function cmp(string $a, string $b): int
    {
        return bccomp($a, $b, self::WORK_SCALE);
    }

    public static function isNegative(string $value): bool
    {
        return bccomp($value, '0', self::WORK_SCALE) < 0;
    }

    public static function isZero(string $value): bool
    {
        return bccomp($value, '0', self::WORK_SCALE) === 0;
    }

    public static function isPositive(string $value): bool
    {
        return bccomp($value, '0', self::WORK_SCALE) > 0;
    }

    public static function min(string $a, string $b): string
    {
        return self::cmp($a, $b) <= 0 ? $a : $b;
    }

    public static function max(string $a, string $b): string
    {
        return self::cmp($a, $b) >= 0 ? $a : $b;
    }

    /** Percentage of an amount, e.g. percent('100.00', '12') = '12'. */
    public static function percent(string $amount, string $rate): string
    {
        return self::div(self::mul($amount, $rate), '100');
    }
}
