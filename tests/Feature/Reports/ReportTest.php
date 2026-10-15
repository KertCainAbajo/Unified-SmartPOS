<?php

namespace Tests\Feature\Reports;

use Tests\Feature\Pos\PosTestHelpers;
use Tests\TestCase;

class ReportTest extends TestCase
{
    use PosTestHelpers;

    /** Two branches with one sale each, a refund, and expenses. */
    private function scenario(): array
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $b2 = $this->createBranch($tenant, 'B2');
        $product = $this->createProduct($tenant, ['price' => '112.00', 'cost_price' => '50.0000']);
        $this->setStock($product, $main, '100', '50.0000');
        $this->setStock($product, $b2, '100', '60.0000');

        $this->openShift($tenant, $owner, $this->registerFor($main));
        $this->checkout($tenant, $this->registerFor($main), [['product_id' => $product->id, 'quantity' => 2]], [['method' => 'cash', 'amount' => '224']])->assertCreated();

        $manager2 = $this->addMember($tenant, 'branch_manager', [$b2]);
        $this->openShift($tenant, $manager2, $this->registerFor($b2));
        $saleB2 = $this->checkout($tenant, $this->registerFor($b2), [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'card', 'amount' => '112']])
            ->assertCreated()->json('data');

        // Refund the B2 sale fully with restock.
        $this->postJson($this->tenantUrl($tenant, 'refunds'), [
            'sale_id' => $saleB2['id'], 'reason' => 'Defect', 'refund_method' => 'card',
            'items' => [['sale_item_id' => $saleB2['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()->assertJsonPath('data.status', 'completed');

        $this->actingAsUser($owner);
        $rent = $tenant->expenseCategories()->where('name', 'Rent')->value('id');
        $this->postJson($this->tenantUrl($tenant, 'expenses'), [
            'expense_category_id' => $rent, 'amount' => '30.00', 'expense_date' => now('Asia/Manila')->toDateString(), 'description' => 'Main rent share', 'branch_id' => $main->id,
        ])->assertCreated();
        $this->postJson($this->tenantUrl($tenant, 'expenses'), [
            'expense_category_id' => $rent, 'amount' => '20.00', 'expense_date' => now('Asia/Manila')->toDateString(), 'description' => 'HQ',
        ])->assertCreated();

        return [$tenant, $owner, $main, $b2, $manager2];
    }

    public function test_profit_report_calculations(): void
    {
        [$tenant, $owner] = $this->scenario();

        $data = $this->actingAsUser($owner)->getJson($this->tenantUrl($tenant, 'reports/profit'))->assertOk()->json('data');

        // Sales ex-VAT: (224 − 24) + (112 − 12) = 300; refund ex-VAT 100 → net revenue 200.
        $this->assertSame('300.00', $data['net_sales_excluding_vat']);
        $this->assertSame('100.00', $data['refunds_excluding_vat']);
        $this->assertSame('200.00', $data['net_revenue']);
        // COGS: 2×50 + 1×60 − restocked 1×60 = 100.
        $this->assertSame('100.00', $data['cost_of_goods_sold']);
        $this->assertSame('100.00', $data['gross_profit']);
        $this->assertSame('50.00', $data['operating_expenses']);
        $this->assertSame('50.00', $data['estimated_operating_profit']);
        $this->assertTrue($data['data_quality']['cogs_complete']);
        $this->assertArrayNotHasKey('net_profit', $data);

        // Ledger, payment and refund invariants hold after sales, refunds and receipts.
        $this->artisan('smartpos:verify-integrity')->assertSuccessful();
    }

    public function test_sales_reports_by_branch_cashier_method_and_period(): void
    {
        [$tenant, $owner, $main, $b2] = $this->scenario();
        $this->actingAsUser($owner);

        $byBranch = collect($this->getJson($this->tenantUrl($tenant, 'reports/sales-by-branch'))->assertOk()->json('data'))->keyBy('branch_id');
        $this->assertSame('224.00', $byBranch[$main->id]['net_sales']);
        $this->assertSame('112.00', $byBranch[$b2->id]['net_sales']);

        $methods = collect($this->getJson($this->tenantUrl($tenant, 'reports/sales-by-payment-method'))->json('data'))->keyBy('method');
        $this->assertSame('224.00', $methods['cash']['net']);
        $this->assertSame('0.00', $methods['card']['net']);

        $this->assertCount(2, $this->getJson($this->tenantUrl($tenant, 'reports/sales-by-cashier'))->json('data'));

        $summary = $this->getJson($this->tenantUrl($tenant, 'reports/sales-summary?group_by=month'))->json('data.0');
        $this->assertSame(2, $summary['transactions']);
        $this->assertSame('336.00', $summary['net_sales']);
        $this->assertSame('112.00', $summary['refunds']);
        $this->assertSame('224.00', $summary['net_after_refunds']);

        $best = $this->getJson($this->tenantUrl($tenant, 'reports/best-sellers'))->json('data.0');
        $this->assertSame('2.000', $best['net_quantity']);

        $refunds = $this->getJson($this->tenantUrl($tenant, 'reports/discounts-refunds'))->json('data.refunds');
        $this->assertSame(1, $refunds['completed_count']);

        $movements = collect($this->getJson($this->tenantUrl($tenant, 'reports/inventory-movements'))->json('data'))->keyBy('type');
        $this->assertSame('-3.000', $movements['sale']['quantity']);
    }

    public function test_reports_are_scoped_to_authorized_branches(): void
    {
        [$tenant, , $main, $b2, $manager2] = $this->scenario();
        $this->actingAsUser($manager2);

        $branches = array_column($this->getJson($this->tenantUrl($tenant, 'reports/sales-by-branch'))->assertOk()->json('data'), 'branch_id');
        $this->assertSame([$b2->id], $branches);

        $this->getJson($this->tenantUrl($tenant, 'reports/sales-by-branch?branch_id='.$main->id))->assertForbidden();

        // Profit and cost reports are for the owner (and finance roles), not branch managers.
        $this->getJson($this->tenantUrl($tenant, 'reports/profit'))->assertForbidden();
        $this->getJson($this->tenantUrl($tenant, 'reports/expenses'))->assertForbidden();
        $this->getJson($this->tenantUrl($tenant, 'audit-logs'))->assertForbidden();

        // Business-wide expenses are excluded for branch-restricted members (here: an accountant of one branch).
        $this->actingAsUser($this->addMember($tenant, 'accountant', [$b2]));
        $profit = $this->getJson($this->tenantUrl($tenant, 'reports/profit'))->assertOk()->json('data');
        $this->assertSame('0.00', $profit['operating_expenses']);
        $this->assertFalse($profit['data_quality']['business_wide_expenses_included']);
    }

    public function test_reports_are_scoped_to_tenant_and_permission(): void
    {
        [$tenant] = $this->scenario();
        [$otherTenant, $otherOwner] = $this->createTenant();

        $this->actingAsUser($otherOwner)->getJson($this->tenantUrl($otherTenant, 'reports/sales-by-branch'))
            ->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->tenantUrl($tenant, 'reports/sales-by-branch'))->assertNotFound();

        $cashier = $this->addMember($tenant, 'cashier');
        $this->actingAsUser($cashier)->getJson($this->tenantUrl($tenant, 'reports/sales-summary'))->assertForbidden();

        // Inventory staff do not hold reports.financial.
        $staff = $this->addMember($tenant, 'inventory_staff');
        $this->actingAsUser($staff)->getJson($this->tenantUrl($tenant, 'reports/profit'))->assertForbidden();
    }

    public function test_report_date_validation(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $this->actingAsUser($owner);

        $this->getJson($this->tenantUrl($tenant, 'reports/sales-summary?date_from=2026-01-10&date_to=2026-01-01'))->assertUnprocessable();
        $this->getJson($this->tenantUrl($tenant, 'reports/sales-summary?date_from=2024-01-01&date_to=2026-01-01'))->assertUnprocessable();
        $this->getJson($this->tenantUrl($tenant, 'reports/sales-summary?date_from=2026-01-01&date_to=2026-01-31'))
            ->assertOk()->assertJsonPath('filters.timezone', 'Asia/Manila');
    }
}
