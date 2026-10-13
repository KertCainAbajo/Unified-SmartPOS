<?php

namespace App\Enums;

enum SaleDiscountType: string
{
    case None = 'none';
    case SeniorCitizen = 'senior_citizen';
    case Pwd = 'pwd';

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
