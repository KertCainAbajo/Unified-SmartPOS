<?php

namespace Database\Seeders;

use App\Enums\TaxType;
use App\Models\Branch;
use App\Models\Product;
use App\Models\Register;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\Catalog\ProductService;
use App\Services\Inventory\StockAdjustmentService;
use App\Services\Pos\CheckoutService;
use App\Services\Pos\RegisterSessionService;
use App\Services\Purchasing\PurchaseOrderService;
use App\Services\Tenancy\TenantOnboardingService;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * DEVELOPMENT DEMO DATA ONLY. Creates a demo business with well-known passwords.
 * Refuses to run in production. All data is created through the real services so it obeys the
 * same rules (ledger entries, price history, audit logs) as production data.
 */
class DemoSeeder extends Seeder
{
    /** Demo password for every demo account. Never use outside local development. */
    public const DEMO_PASSWORD = 'DemoPass123';

    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('DemoSeeder must not run in production.');
        }

        if (User::query()->where('email', 'owner@demo.smartpos.test')->exists()) {
            $this->command?->warn('Demo data already present; skipping.');

            return;
        }

        $owner = $this->user('Maria Santos', 'owner@demo.smartpos.test');
        $tenant = app(TenantOnboardingService::class)->createBusiness($owner, [
            'name' => 'Aling Nena Mini Mart',
            'legal_name' => 'Aling Nena Trading',
            'tin' => '000-123-456-000',
            'address' => '123 Rizal Ave., Quezon City',
            'phone' => '02-8123-4567',
            'vat_registered' => true,
            'branch_name' => 'Main Branch - Quezon City',
        ]);
        $tenant->forceFill(['refund_approval_threshold' => '500.00'])->save();

        $main = $tenant->branches()->where('code', 'MAIN')->firstOrFail();
        $makati = $tenant->branches()->create(['code' => 'MKT', 'name' => 'Makati Branch', 'address' => '45 Ayala Ave., Makati City']);
        Register::query()->forceCreate(['tenant_id' => $tenant->id, 'branch_id' => $makati->id, 'code' => 'MKT-1', 'name' => 'Makati Register 1']);

        $manager = $this->member($tenant, 'Jose Reyes', 'manager@demo.smartpos.test', Permissions::ROLE_MANAGER, [$main]);
        $cashier = $this->member($tenant, 'Ana Cruz', 'cashier@demo.smartpos.test', Permissions::ROLE_CASHIER, [$main]);
        $this->member($tenant, 'Ben Garcia', 'cashier.makati@demo.smartpos.test', Permissions::ROLE_CASHIER, [$makati]);
        $this->member($tenant, 'Carlo Mendoza', 'inventory@demo.smartpos.test', Permissions::ROLE_INVENTORY, [$main, $makati]);

        $admin = $this->user('Platform Admin', 'admin@demo.smartpos.test');
        $admin->forceFill(['is_platform_admin' => true])->save();

        // Act as the owner for audit attribution and permission checks inside services.
        $context = app(TenantContext::class);
        $context->set($tenant, $tenant->memberships()->where('user_id', $owner->id)->firstOrFail());

        $products = $this->catalog($tenant, $owner);
        $this->openingStock($main, $makati, $products, $owner);
        $this->suppliers($tenant, $main, $products, $owner);
        $this->sampleSales($tenant, $main, $products, $cashier, $owner);
        $this->expenses($tenant, $main, $owner);

        $this->command?->info('Demo business created. Accounts (password: '.self::DEMO_PASSWORD.'):');
        foreach (['owner', 'manager', 'cashier', 'cashier.makati', 'inventory', 'admin'] as $who) {
            $this->command?->line("  {$who}@demo.smartpos.test");
        }
    }

    private function user(string $name, string $email): User
    {
        return User::query()->forceCreate([
            'name' => $name,
            'email' => $email,
            'password' => self::DEMO_PASSWORD,
            'email_verified_at' => now(),
        ]);
    }

    /** @param  list<Branch>  $branches */
    private function member(Tenant $tenant, string $name, string $email, string $role, array $branches): User
    {
        $user = $this->user($name, $email);
        $membership = TenantMembership::query()->create([
            'tenant_id' => $tenant->id,
            'user_id' => $user->id,
            'status' => 'active',
            'all_branches' => false,
            'joined_at' => now(),
        ]);
        $membership->roles()->attach(Role::system($role)->id);
        $membership->branches()->attach(array_map(fn (Branch $b) => $b->id, $branches));

        return $user;
    }

    /** @return array<string, Product> keyed by SKU */
    private function catalog(Tenant $tenant, User $owner): array
    {
        $categories = [];
        foreach (['Beverages', 'Snacks', 'Canned Goods', 'Rice & Grains', 'Household', 'Personal Care'] as $i => $name) {
            $categories[$name] = $tenant->categories()->create(['name' => $name, 'slug' => Str::slug($name), 'sort_order' => $i]);
        }

        $rows = [
            // sku, name, category, price, cost, unit, tax, decimal qty
            ['BEV-COKE-1L', 'Coca-Cola 1L', 'Beverages', '65.00', '48.00', 'pc'],
            ['BEV-WATER-500', 'Mineral Water 500ml', 'Beverages', '20.00', '12.50', 'pc'],
            ['BEV-COFFEE-3IN1', 'Coffee 3-in-1 Sachet', 'Beverages', '9.00', '6.20', 'pc'],
            ['SNK-CHIPS-60', 'Potato Chips 60g', 'Snacks', '38.00', '27.00', 'pc'],
            ['SNK-CRACKERS', 'Crackers 10-pack', 'Snacks', '52.00', '38.00', 'pc'],
            ['CAN-SARDINES-155', 'Sardines in Tomato Sauce 155g', 'Canned Goods', '24.00', '18.00', 'pc'],
            ['CAN-CORNEDBEEF-150', 'Corned Beef 150g', 'Canned Goods', '45.00', '34.00', 'pc'],
            ['RICE-DINORADO', 'Dinorado Rice (per kg)', 'Rice & Grains', '62.00', '50.00', 'kg', TaxType::VatExempt, true],
            ['RICE-WELLMILLED', 'Well-milled Rice (per kg)', 'Rice & Grains', '48.00', '40.00', 'kg', TaxType::VatExempt, true],
            ['HH-DETERGENT-1KG', 'Laundry Detergent 1kg', 'Household', '115.00', '86.00', 'pc'],
            ['HH-DISHWASH-250', 'Dishwashing Liquid 250ml', 'Household', '42.00', '30.00', 'pc'],
            ['PC-SHAMPOO-SACHET', 'Shampoo Sachet', 'Personal Care', '8.00', '5.50', 'pc'],
            ['PC-SOAP-90', 'Bath Soap 90g', 'Personal Care', '35.00', '25.00', 'pc'],
            ['PC-TOOTHPASTE-150', 'Toothpaste 150ml', 'Personal Care', '98.00', '72.00', 'pc'],
        ];

        $service = app(ProductService::class);
        $products = [];
        foreach ($rows as $i => $row) {
            [$sku, $name, $category, $price, $cost, $unit] = $row;
            $products[$sku] = $service->create($tenant, [
                'sku' => $sku,
                'barcode' => $this->ean13('4800999'.str_pad((string) ($i + 1), 5, '0', STR_PAD_LEFT)),
                'name' => $name,
                'category_id' => $categories[$category]->id,
                'unit' => $unit,
                'price' => $price,
                'cost_price' => $cost,
                'tax_type' => $row[6] ?? TaxType::Vatable,
                'allow_decimal_quantity' => $row[7] ?? false,
                'reorder_level' => '10',
            ], $owner->id);
        }

        return $products;
    }

    /** @param  array<string, Product>  $products */
    private function openingStock(Branch $main, Branch $makati, array $products, User $owner): void
    {
        $service = app(StockAdjustmentService::class);
        foreach ([[$main, 60], [$makati, 25]] as [$branch, $quantity]) {
            $service->adjust($branch, 'opening', 'Demo opening stock', array_values(array_map(fn (Product $p) => [
                'product_id' => $p->id,
                'quantity_change' => (string) $quantity,
                'unit_cost' => (string) $p->cost_price,
            ], $products)), $owner->id);
        }
    }

    /** @param  array<string, Product>  $products */
    private function suppliers(Tenant $tenant, Branch $main, array $products, User $owner): void
    {
        $distributor = $tenant->suppliers()->create([
            'name' => 'Metro Manila Distributors Inc.', 'contact_person' => 'Liza Tan', 'email' => 'orders@mmdist.example', 'phone' => '02-8555-0101',
        ]);
        $tenant->suppliers()->create(['name' => 'Bulacan Rice Traders', 'contact_person' => 'Pedro Dizon', 'phone' => '0917-555-0102']);

        app(PurchaseOrderService::class)->create($main, [
            'supplier_id' => $distributor->id,
            'notes' => 'Demo purchase order (draft)',
            'items' => [
                ['product_id' => $products['BEV-COKE-1L']->id, 'quantity' => '48', 'unit_cost' => '47.50'],
                ['product_id' => $products['SNK-CHIPS-60']->id, 'quantity' => '36', 'unit_cost' => '26.50'],
            ],
        ], $owner->id);

    }

    /** @param  array<string, Product>  $products */
    private function sampleSales(Tenant $tenant, Branch $main, array $products, User $cashier, User $owner): void
    {
        $register = Register::query()->where('branch_id', $main->id)->firstOrFail();
        $session = app(RegisterSessionService::class)->open($register, '2000.00', $cashier->id, 'Demo shift');
        $checkout = app(CheckoutService::class);

        $baskets = [
            [[['BEV-COKE-1L', '2'], ['SNK-CHIPS-60', '3']], [['method' => 'cash', 'amount' => '500']]],
            [[['RICE-DINORADO', '2.500'], ['CAN-SARDINES-155', '4']], [['method' => 'gcash', 'amount' => '251.00', 'reference_number' => 'GC-DEMO-0001']]],
            [[['HH-DETERGENT-1KG', '1'], ['PC-SOAP-90', '2']], [['method' => 'card', 'amount' => '185.00', 'reference_number' => 'AUTH-123456']]],
            [[['BEV-COFFEE-3IN1', '10'], ['PC-SHAMPOO-SACHET', '5']], [['method' => 'cash', 'amount' => '200']]],
        ];

        foreach ($baskets as $i => [$lines, $payments]) {
            $checkout->checkout($tenant, $cashier, [
                'register_id' => $register->id,
                'items' => array_map(fn ($l) => ['product_id' => $products[$l[0]]->id, 'quantity' => $l[1]], $lines),
                'payments' => $payments,
            ], 'demo-sale-'.($i + 1));
        }

        // A Senior Citizen sale.
        $checkout->checkout($tenant, $cashier, [
            'register_id' => $register->id,
            'items' => [['product_id' => $products['PC-TOOTHPASTE-150']->id, 'quantity' => '1']],
            'discount' => ['type' => 'senior_citizen', 'id_number' => 'SC-QC-000123', 'holder_name' => 'Lola Remedios'],
            'payments' => [['method' => 'cash', 'amount' => '100']],
        ], 'demo-sale-sc');

    }

    private function expenses(Tenant $tenant, Branch $main, User $owner): void
    {
        $categories = $tenant->expenseCategories()->pluck('id', 'name');
        foreach ([
            ['Rent', '25000.00', 'Monthly rent - Main', $main->id],
            ['Utilities', '6850.75', 'Meralco electric bill', $main->id],
            ['Salaries and Wages', '42000.00', 'Semi-monthly payroll', null],
        ] as [$category, $amount, $description, $branchId]) {
            $expense = $tenant->expenses()->make([
                'branch_id' => $branchId,
                'expense_category_id' => $categories[$category],
                'amount' => $amount,
                'expense_date' => now($tenant->timezone)->toDateString(),
                'description' => $description,
                'payment_method' => 'bank_transfer',
            ]);
            $expense->recorded_by = $owner->id;
            $expense->save();
        }
    }

    private function ean13(string $twelveDigits): string
    {
        $sum = 0;
        foreach (str_split($twelveDigits) as $i => $digit) {
            $sum += (int) $digit * ($i % 2 === 0 ? 1 : 3);
        }

        return $twelveDigits.((10 - $sum % 10) % 10);
    }
}
