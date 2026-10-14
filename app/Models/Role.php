<?php

namespace App\Models;

use App\Support\Permissions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Role extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['is_system' => 'boolean'];
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_permissions');
    }

    /** System roles plus the tenant's own custom roles. */
    public function scopeAvailableTo(Builder $query, int $tenantId): Builder
    {
        return $query->where(fn (Builder $q) => $q->whereNull('tenant_id')->orWhere('tenant_id', $tenantId));
    }

    public static function system(string $key): self
    {
        // A missing system role is a deployment error (seeder not run), not a client 404.
        return static::query()->whereNull('tenant_id')->where('key', $key)->first()
            ?? throw new \RuntimeException("System role [{$key}] is not seeded. Run RolesAndPermissionsSeeder.");
    }

    /** Business Owner or any role carrying an administrative permission: only the owner can grant it. */
    public function isAdministrative(): bool
    {
        return ($this->tenant_id === null && $this->key === Permissions::ROLE_OWNER)
            || $this->permissions->pluck('key')->intersect(Permissions::PRIVILEGED)->isNotEmpty();
    }

    /** Holders of this role must sign in with email (see Permissions::EMAIL_SIGN_IN_ROLES). */
    public function requiresEmailSignIn(): bool
    {
        if (($this->tenant_id === null && in_array($this->key, Permissions::EMAIL_SIGN_IN_ROLES, true))) {
            return true;
        }

        return $this->permissions->pluck('key')->intersect(Permissions::PRIVILEGED)->isNotEmpty();
    }
}
