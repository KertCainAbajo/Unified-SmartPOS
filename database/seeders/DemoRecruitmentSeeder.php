<?php

namespace Database\Seeders;

use App\Models\Role;
use App\Models\Tenant;
use App\Support\Permissions;
use Illuminate\Database\Seeder;
use RuntimeException;

/** DEVELOPMENT DEMO DATA ONLY. Open vacancies so the public careers page has something to apply for. */
class DemoRecruitmentSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('DemoRecruitmentSeeder must not run in production.');
        }

        $tenant = Tenant::query()->where('slug', 'aling-nena-mini-mart')->first();
        if (! $tenant || $tenant->vacancies()->exists()) {
            return;
        }
        $main = $tenant->branches()->where('code', 'MAIN')->firstOrFail();

        $tenant->vacancies()->create([
            'branch_id' => $main->id,
            'role_id' => Role::system(Permissions::ROLE_CASHIER)->id,
            'title' => 'Store Cashier',
            'description' => "Handle customer payments at the register, issue receipts and keep the counter tidy.\nShifts: 7am–3pm or 2pm–10pm, 6 days a week.",
            'requirements' => "At least senior high school graduate\nComfortable with basic math and handling cash\nWith or without experience",
            'employment_type' => 'full_time',
            'slots' => 2,
            'required_documents' => ['resume', 'valid_id'],
            'status' => 'open',
            'created_by' => $tenant->owner_user_id,
        ]);
        $tenant->vacancies()->create([
            'branch_id' => $main->id,
            'role_id' => Role::system(Permissions::ROLE_INVENTORY)->id,
            'title' => 'Stock Clerk',
            'description' => 'Receive deliveries, restock shelves and help with monthly stock counts.',
            'requirements' => 'Physically fit, organized, can lift up to 20 kg',
            'employment_type' => 'full_time',
            'slots' => 1,
            'required_documents' => ['resume', 'valid_id', 'nbi_clearance'],
            'status' => 'open',
            'created_by' => $tenant->owner_user_id,
        ]);

        $this->command?->info("Demo careers page: /careers/{$tenant->slug}");
    }
}
