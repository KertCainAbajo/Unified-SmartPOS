<?php

namespace Database\Seeders;

use App\Models\Branch;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * DEVELOPMENT DEMO DATA ONLY. Adds company-managed (username) staff accounts to the demo business.
 * Real accounts are always activated by the employee with a one-time code; these are pre-activated
 * with the public demo password for local testing. Idempotent; refuses to run in production.
 */
class DemoStaffSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('DemoStaffSeeder must not run in production.');
        }

        $tenant = Tenant::query()->where('slug', 'aling-nena-mini-mart')->first();
        if (! $tenant) {
            $this->command?->warn('Demo business not found; run DemoSeeder first.');

            return;
        }
        $main = $tenant->branches()->where('code', 'MAIN')->firstOrFail();

        $accounts = [
            // HR signs in with email; the others with username or employee ID.
            ['Rosa Villanueva', 'access.all01', Permissions::ROLE_ACCESS_MANAGER, null, 'EMP-101', 'hr@demo.smartpos.test'],
            ['Liza Marquez', 'cashier.main01', Permissions::ROLE_CASHIER, $main, 'EMP-102', null],
            ['Nestor Aquino', 'accountant.all01', Permissions::ROLE_ACCOUNTANT, null, 'EMP-103', null],
        ];

        foreach ($accounts as [$name, $username, $role, $branch, $code, $email]) {
            $this->account($tenant, $name, $username, $role, $branch, $code, $email);
        }

        $this->command?->info("Demo staff (business code: {$tenant->slug}, password: ".DemoSeeder::DEMO_PASSWORD.'): cashier.main01 (EMP-102), accountant.all01 (EMP-103); HR signs in with hr@demo.smartpos.test');
    }

    private function account(Tenant $tenant, string $name, string $username, string $role, ?Branch $branch, string $employeeCode, ?string $email): void
    {
        if (User::query()->where('managed_by_tenant_id', $tenant->id)->where('username', $username)->exists()) {
            return;
        }

        $user = User::query()->forceCreate([
            'name' => $name,
            'username' => $username,
            'email' => $email,
            'email_verified_at' => $email ? now() : null,
            'managed_by_tenant_id' => $tenant->id,
            'password' => DemoSeeder::DEMO_PASSWORD,
            'status' => 'active',
        ]);

        $membership = TenantMembership::query()->create([
            'tenant_id' => $tenant->id,
            'user_id' => $user->id,
            'employee_code' => $employeeCode,
            'status' => 'active',
            'all_branches' => $branch === null,
            'joined_at' => now(),
            'created_by' => $tenant->owner_user_id,
        ]);
        $membership->roles()->attach(Role::system($role)->id);
        if ($branch) {
            $membership->branches()->attach($branch->id);
        }
    }
}
