<?php

namespace App\Enums;

enum SaleStatus: string
{
    case Completed = 'completed';
    case Voided = 'voided';

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
