<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class TenantMembership extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'all_branches' => 'boolean',
            'joined_at' => 'datetime',
        ];
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class, 'membership_roles', 'membership_id', 'role_id');
    }

    public function branches(): BelongsToMany
    {
        return $this->belongsToMany(Branch::class, 'membership_branches', 'membership_id', 'branch_id');
    }

    /** @return list<string> */
    public function permissionKeys(): array
    {
        return Permission::query()
            ->join('role_permissions', 'role_permissions.permission_id', '=', 'permissions.id')
            ->join('membership_roles', 'membership_roles.role_id', '=', 'role_permissions.role_id')
            ->where('membership_roles.membership_id', $this->id)
            ->distinct()
            ->pluck('permissions.key')
            ->all();
    }

    public function isOwnerMembership(): bool
    {
        return $this->tenant->owner_user_id === $this->user_id;
    }
}
