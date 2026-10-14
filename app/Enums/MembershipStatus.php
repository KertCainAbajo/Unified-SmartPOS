<?php

namespace App\Enums;

/** Status of a person's membership in one business. Only `active` grants access. */
enum MembershipStatus: string
{
    case Invited = 'invited';
    case Active = 'active';
    case Suspended = 'suspended';
    case Offboarded = 'offboarded';

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
