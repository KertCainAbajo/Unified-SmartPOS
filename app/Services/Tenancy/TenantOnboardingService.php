<?php

namespace App\Services\Tenancy;

use App\Models\Role;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\AuditLogger;
use App\Support\Permissions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class TenantOnboardingService
{
    private const DEFAULT_EXPENSE_CATEGORIES = [
        'Rent', 'Utilities', 'Salaries and Wages', 'Supplies', 'Transportation', 'Repairs and Maintenance', 'Miscellaneous',
    ];

    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * Register a new user together with their first business.
     *
     * @param  array{name: string, email: string, password: string, phone?: string|null}  $userData
     * @param  array<string, mixed>  $businessData
     * @return array{user: User, tenant: Tenant}
     */
    public function registerOwner(array $userData, array $businessData): array
    {
        return DB::transaction(function () use ($userData, $businessData) {
            $user = User::query()->create($userData);
            $tenant = $this->createBusiness($user, $businessData);

            return ['user' => $user, 'tenant' => $tenant];
        });
    }

    /**
     * Create a business owned by an existing user: tenant, main branch, owner membership, defaults.
     *
     * @param  array<string, mixed>  $data
     */
    public function createBusiness(User $owner, array $data): Tenant
    {
        return DB::transaction(function () use ($owner, $data) {
            $tenant = new Tenant(collect($data)->only([
                'name', 'legal_name', 'tin', 'address', 'phone', 'email', 'vat_registered',
            ])->all());
            $tenant->slug = $this->uniqueSlug($data['name']);
            $tenant->owner_user_id = $owner->id;
            $tenant->status = 'active';
            $tenant->save();

            $branch = $tenant->branches()->create([
                'code' => 'MAIN',
                'name' => $data['branch_name'] ?? 'Main Branch',
                'address' => $data['address'] ?? null,
                'phone' => $data['phone'] ?? null,
            ]);

            $tenant->registers()->create([
                'branch_id' => $branch->id,
                'code' => 'REG-1',
                'name' => 'Register 1',
            ]);

            foreach (self::DEFAULT_EXPENSE_CATEGORIES as $name) {
                $tenant->expenseCategories()->create(['name' => $name]);
            }

            $membership = TenantMembership::query()->create([
                'tenant_id' => $tenant->id,
                'user_id' => $owner->id,
                'status' => 'active',
                'all_branches' => true,
                'joined_at' => now(),
            ]);
            $membership->roles()->attach(Role::system(Permissions::ROLE_OWNER)->id);

            $this->audit->log('tenant.created', $tenant, null, $tenant->only(['name', 'slug', 'vat_registered']),
                tenantId: $tenant->id, userId: $owner->id);

            return $tenant;
        });
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'business';
        $slug = $base;

        while (Tenant::query()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.Str::lower(Str::random(5));
        }

        return $slug;
    }
}
