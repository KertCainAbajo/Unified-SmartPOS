<?php

namespace App\Models;

use App\Enums\MembershipStatus;
use App\Support\Permissions;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class TenantMembership extends Model
{
    protected $guarded = [];

    /** Mirrors database defaults so freshly created instances are complete. */
    protected $attributes = [
        'status' => 'active',
        'all_branches' => false,
        'employee_code' => null,
        'status_reason' => null,
        'suspended_at' => null,
        'offboarded_at' => null,
        'offboarded_by' => null,
        'created_by' => null,
    ];

    protected function casts(): array
    {
        return [
            'all_branches' => 'boolean',
            'joined_at' => 'datetime',
            'suspended_at' => 'datetime',
            'offboarded_at' => 'datetime',
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

    public function profile(): HasOne
    {
        return $this->hasOne(StaffProfile::class, 'membership_id');
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(StaffInvitation::class, 'membership_id');
    }

    public function hasStatus(MembershipStatus $status): bool
    {
        return $this->status === $status->value;
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

    /** @return list<int> */
    public function branchIds(): array
    {
        return $this->branches()->pluck('branches.id')->map(fn ($id) => (int) $id)->all();
    }

    /** Owners, managers and HR sign in with email only; everyone else may use username or employee ID. */
    public function requiresEmailSignIn(): bool
    {
        return $this->isOwnerMembership()
            || ($this->relationLoaded('roles') ? $this->roles : $this->roles()->get())
                ->contains(fn (Role $r) => $r->tenant_id === null && in_array($r->key, Permissions::EMAIL_SIGN_IN_ROLES, true))
            || array_intersect($this->permissionKeys(), Permissions::PRIVILEGED) !== [];
    }

    public function isOwnerMembership(): bool
    {
        return $this->tenant->owner_user_id === $this->user_id;
    }
}
