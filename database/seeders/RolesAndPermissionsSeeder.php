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

        // Remove permissions that are no longer in the catalogue (e.g. members.* replaced by staff.*);
        // role_permissions rows cascade, so no role keeps a permission the code no longer checks.
        Permission::query()->whereNotIn('key', array_keys(Permissions::catalogue()))->delete();

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
