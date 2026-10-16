<?php

namespace Tests\Feature;

use App\Exceptions\BusinessRuleException;
use App\Models\Supplier;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Tests\Feature\Pos\PosTestHelpers;
use Tests\TestCase;

/** Guards that keep in-progress work (open shifts, stock in transit) from being stranded. */
class FlowGuardsTest extends TestCase
{
    use PosTestHelpers;

    public function test_register_with_an_open_shift_cannot_be_deactivated(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $register = $this->registerFor($main);
        $this->openShift($tenant, $owner, $register);

        $this->actingAsUser($owner)->patchJson($this->tenantUrl($tenant, "registers/{$register->id}"), ['is_active' => false])
            ->assertUnprocessable()->assertJsonPath('code', 'REGISTER_IN_USE');
        // Renaming is still fine.
        $this->patchJson($this->tenantUrl($tenant, "registers/{$register->id}"), ['name' => 'Front counter'])->assertOk();
    }

    public function test_branch_with_open_shift_transfer_in_transit_or_last_active_cannot_be_deactivated(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $this->actingAsUser($owner);

        // The only active branch.
        $this->patchJson($this->tenantUrl($tenant, "branches/{$main->id}"), ['is_active' => false])
            ->assertUnprocessable()->assertJsonPath('code', 'LAST_ACTIVE_BRANCH');

        $davao = $this->createBranch($tenant, 'DVO');
        $this->openShift($tenant, $owner, $this->registerFor($davao));
        $this->actingAsUser($owner)->patchJson($this->tenantUrl($tenant, "branches/{$davao->id}"), ['is_active' => false])
            ->assertUnprocessable()->assertJsonPath('code', 'BRANCH_HAS_OPEN_SHIFTS');

        $makati = $this->createBranch($tenant, 'MKT');
        $product = $this->createProduct($tenant);
        $this->setStock($product, $main, '10', '5.0000');
        $id = $this->postJson($this->tenantUrl($tenant, 'stock-transfers'), [
            'from_branch_id' => $main->id, 'to_branch_id' => $makati->id, 'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->json('data.id');
        $this->postJson($this->tenantUrl($tenant, "stock-transfers/{$id}/dispatch"))->assertOk();
        $this->patchJson($this->tenantUrl($tenant, "branches/{$makati->id}"), ['is_active' => false])
            ->assertUnprocessable()->assertJsonPath('code', 'BRANCH_HAS_TRANSFERS_IN_TRANSIT');

        $this->postJson($this->tenantUrl($tenant, "stock-transfers/{$id}/receive"))->assertOk();
        $this->patchJson($this->tenantUrl($tenant, "branches/{$makati->id}"), ['is_active' => false])->assertOk()->assertJsonPath('data.is_active', false);
    }

    public function test_purchase_orders_cannot_be_raised_for_an_inactive_branch(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $closed = $this->createBranch($tenant, 'OLD');
        $closed->forceFill(['is_active' => false])->save();
        $supplier = Supplier::query()->forceCreate(['tenant_id' => $tenant->id, 'name' => 'Acme', 'is_active' => true]);
        $product = $this->createProduct($tenant);

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'purchase-orders'), [
            'branch_id' => $closed->id, 'supplier_id' => $supplier->id,
            'items' => [['product_id' => $product->id, 'quantity' => 5, 'unit_cost' => '10']],
        ])->assertUnprocessable()->assertJsonValidationErrors('branch_id');
    }

    public function test_low_stock_quantities_are_decimal_strings_like_the_rest_of_the_api(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $low = $this->createProduct($tenant, ['reorder_level' => '10.000', 'track_inventory' => true]);
        $this->setStock($low, $main, '3');
        $this->createProduct($tenant, ['reorder_level' => '5.000', 'track_inventory' => true]); // never stocked → 0

        $rows = $this->actingAsUser($owner)->getJson($this->tenantUrl($tenant, 'inventory/low-stock'))->assertOk()->json('data');
        $this->assertCount(2, $rows);
        foreach ($rows as $row) {
            $this->assertIsString($row['quantity']);
            $this->assertIsString($row['reorder_level']);
        }
        $this->assertEqualsCanonicalizing(['3.000', '0.000'], array_column($rows, 'quantity'));
    }

    public function test_business_rule_violations_are_not_logged_as_errors(): void
    {
        $this->assertFalse(app(ExceptionHandler::class)->shouldReport(new BusinessRuleException('Insufficient stock.')));
    }
}
