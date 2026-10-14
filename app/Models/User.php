<?php

namespace App\Models;

use App\Enums\MembershipStatus;
use App\Enums\UserStatus;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'phone', 'password'])]
#[Hidden(['password', 'remember_token', 'temporary_password_expires_at'])]
class User extends Authenticatable implements MustVerifyEmail
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    /** Mirrors database defaults so freshly created instances are complete. */
    protected $attributes = [
        'is_platform_admin' => false,
        'status' => 'active',
        'email' => null,
        'username' => null,
        'managed_by_tenant_id' => null,
        'must_change_password' => false,
        'temporary_password_expires_at' => null,
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
            'is_platform_admin' => 'boolean',
            'must_change_password' => 'boolean',
            'temporary_password_expires_at' => 'datetime',
        ];
    }

    public function memberships(): HasMany
    {
        return $this->hasMany(TenantMembership::class);
    }

    public function tenants(): BelongsToMany
    {
        return $this->belongsToMany(Tenant::class, 'tenant_memberships')
            ->withPivot(['id', 'status', 'all_branches'])
            ->withTimestamps();
    }

    public function activeMembershipFor(int $tenantId): ?TenantMembership
    {
        return $this->memberships()
            ->where('tenant_id', $tenantId)
            ->where('status', MembershipStatus::Active->value)
            ->first();
    }

    public function isActive(): bool
    {
        return $this->status === UserStatus::Active->value;
    }

    /** Company-managed account: created by a business, logs in with business code + username. */
    public function isCompanyManaged(): bool
    {
        return $this->managed_by_tenant_id !== null;
    }

    public function managedBy(): BelongsTo
    {
        return $this->belongsTo(Tenant::class, 'managed_by_tenant_id');
    }
}
