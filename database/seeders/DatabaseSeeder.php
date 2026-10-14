<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Roles and permissions are required in every environment.
     * Demo data is only seeded in local/testing environments.
     */
    public function run(): void
    {
        $this->call(RolesAndPermissionsSeeder::class);

        if (app()->environment(['local', 'testing'])) {
            $this->call(DemoSeeder::class);
            $this->call(DemoStaffSeeder::class);
            $this->call(DemoRecruitmentSeeder::class);
        }
    }
}
