<?php

namespace Database\Seeders;

use App\Models\Permission;
use App\Models\Role;
use App\Support\Permissions;
use Illuminate\Database\Seeder;

/** Idempotent: safe to run in every environment, including production. */
class RolesAndPermissionsSeeder extends Seeder
{
    public function run(): void
    {
        foreach (Permissions::catalogue() as $key => $definition) {
            Permission::query()->updateOrCreate(['key' => $key], $definition);
        }

        $permissionIds = Permission::query()->pluck('id', 'key');

        foreach (Permissions::systemRoles() as $key => $definition) {
            $role = Role::query()->whereNull('tenant_id')->where('key', $key)->first()
                ?? new Role(['key' => $key, 'tenant_id' => null]);

            $role->fill([
                'name' => $definition['name'],
                'description' => $definition['description'],
                'is_system' => true,
            ])->save();

            $role->permissions()->sync($permissionIds->only($definition['permissions'])->values());
        }
    }
}
