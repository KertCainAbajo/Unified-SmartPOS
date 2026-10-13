<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** In-app notification for a user within a tenant (table: notifications). */
class AppNotification extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'notifications';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'data' => 'array',
            'read_at' => 'datetime',
        ];
    }
}
