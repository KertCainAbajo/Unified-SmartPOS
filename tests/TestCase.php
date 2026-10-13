<?php

namespace Tests;

use App\Enums\StockMovementType;
use App\Models\Branch;
use App\Models\Inventory;
use App\Models\Product;
use App\Models\Register;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\Inventory\StockLedger;
use App\Services\Tenancy\TenantOnboardingService;
use App\Support\Money;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    /**
     * RefreshDatabase drops every table. Refuse to run against anything that is not an in-memory
     * SQLite database or a MySQL database whose name clearly marks it as a test database.
     */
    protected function beforeRefreshingDatabase(): void
    {
        $connection = config('database.default');
        $database = (string) config("database.connections.{$connection}.database");

        $safe = $database === ':memory:' || preg_match('/_(test|testing)$/', $database) === 1;
        if (! $safe) {
            throw new \RuntimeException("Refusing to run tests against database [{$database}]. Use :memory: or a *_testing database.");
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    /** Create a business through the real onboarding service. Returns [tenant, owner, mainBranch]. */
    protected function createTenant(array $overrides = [], ?User $owner = null): array
    {
        $owner ??= User::factory()->create();
        $tenant = app(TenantOnboardingService::class)->createBusiness($owner, ['name' => 'Test Store '.uniqid()]);

        if ($overrides !== []) {
            $tenant->forceFill($overrides)->save();
        }

        return [$tenant->fresh(), $owner, $tenant->branches()->first()];
    }

    /** @param  list<Branch>|null  $branches  null = all branches */
    protected function addMember(Tenant $tenant, string $roleKey, ?array $branches = null, ?User $user = null): User
    {
        $user ??= User::factory()->create();

        $membership = TenantMembership::query()->create([
            'tenant_id' => $tenant->id,
            'user_id' => $user->id,
            'status' => 'active',
            'all_branches' => $branches === null,
            'joined_at' => now(),
        ]);
        $membership->roles()->attach(Role::system($roleKey)->id);
        $membership->branches()->attach(collect($branches ?? [])->pluck('id'));

        return $user;
    }

    protected function createBranch(Tenant $tenant, string $code = 'B2'): Branch
    {
        return $tenant->branches()->create(['code' => $code, 'name' => $code.' Branch']);
    }

    protected function createProduct(Tenant $tenant, array $attributes = []): Product
    {
        return Product::factory()->create(['tenant_id' => $tenant->id, ...$attributes]);
    }

    /**
     * Bring a stock balance to an exact quantity through the StockLedger (an opening/adjustment movement),
     * so the ledger invariant (balance = sum of movements) holds in every test.
     */
    protected function setStock(Product $product, Branch $branch, string $quantity, string $averageCost = '0'): Inventory
    {
        return DB::transaction(function () use ($product, $branch, $quantity, $averageCost) {
            $ledger = app(StockLedger::class);
            $row = $ledger->lockRows($product->tenant_id, $branch->id, [$product->id])[$product->id];
            $change = Money::sub(Money::normalize($quantity, 3), (string) $row->quantity);

            if (! Money::isZero($change)) {
                $ledger->post($row, StockMovementType::Opening, $change, [
                    'unit_cost' => Money::isPositive($change) ? $averageCost : null,
                    'reason' => 'test setup',
                    'allow_negative' => true,
                ]);
            }
            if (Money::cmp((string) $row->average_cost, Money::normalize($averageCost, 4)) !== 0) {
                $row->forceFill(['average_cost' => $averageCost])->save();
            }

            return $row->refresh();
        });
    }

    protected function registerFor(Branch $branch): Register
    {
        return Register::query()->where('branch_id', $branch->id)->first()
            ?? Register::query()->forceCreate([
                'tenant_id' => $branch->tenant_id,
                'branch_id' => $branch->id,
                'code' => 'REG-'.$branch->code,
                'name' => 'Register '.$branch->code,
            ]);
    }

    protected function actingAsUser(User $user): static
    {
        Sanctum::actingAs($user);

        return $this;
    }

    protected function tenantUrl(Tenant $tenant, string $path = ''): string
    {
        return '/api/v1/tenants/'.$tenant->id.($path === '' ? '' : '/'.ltrim($path, '/'));
    }
}
