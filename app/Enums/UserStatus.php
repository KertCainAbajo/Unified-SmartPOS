<?php

namespace App\Enums;

/** Global login status. Only `active` users can sign in or use existing credentials. */
enum UserStatus: string
{
    /** Created by a business, waiting for the employee to activate and choose a password. */
    case Pending = 'pending';
    case Active = 'active';
    case Disabled = 'disabled';

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
