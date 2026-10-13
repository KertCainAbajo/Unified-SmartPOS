<?php

namespace App\Enums;

enum TaxType: string
{
    case Vatable = 'vatable';
    case VatExempt = 'vat_exempt';
    case ZeroRated = 'zero_rated';

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
