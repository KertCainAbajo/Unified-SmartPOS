<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Accepts printable alphanumeric barcodes (Code 128 / internal codes). Purely numeric values with
 * a GTIN length (EAN-8, UPC-A, EAN-13, GTIN-14) must carry a valid GS1 check digit.
 */
class Barcode implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! preg_match('/^[A-Za-z0-9\-.]{4,64}$/', $value)) {
            $fail('The :attribute must be 4-64 letters, digits, dashes or dots.');

            return;
        }

        if (ctype_digit($value) && in_array(strlen($value), [8, 12, 13, 14], true) && ! self::validGtin($value)) {
            $fail('The :attribute has an invalid check digit.');
        }
    }

    public static function validGtin(string $digits): bool
    {
        $body = substr($digits, 0, -1);
        $sum = 0;
        $weight = 3;

        for ($i = strlen($body) - 1; $i >= 0; $i--) {
            $sum += (int) $body[$i] * $weight;
            $weight = $weight === 3 ? 1 : 3;
        }

        return (10 - ($sum % 10)) % 10 === (int) substr($digits, -1);
    }
}
