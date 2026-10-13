<?php

namespace App\Enums;

enum RefundStatus: string
{
    case PendingApproval = 'pending_approval';
    case Completed = 'completed';
    case Rejected = 'rejected';

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
