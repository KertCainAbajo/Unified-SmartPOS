<?php

namespace Tests\Feature;

use App\Models\Inventory;
use App\Models\Refund;
use App\Models\Register;
use App\Models\Supplier;
use Tests\Feature\Pos\PosTestHelpers;
use Tests\TestCase;

/** Bugs found in the end-to-end flow review (2026-10-14). Each test failed before its fix. */
class RegressionTest extends TestCase
{
    use PosTestHelpers;

    public function test_partially_received_purchase_order_can_be_closed_short(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $supplier = Supplier::factory()->create(['tenant_id' => $tenant->id]);
        $product = $this->createProduct($tenant);
        $this->actingAsUser($owner);

        $po = $this->postJson($this->tenantUrl($tenant, 'purchase-orders'), [
            'branch_id' => $branch->id, 'supplier_id' => $supplier->id,
            'items' => [['product_id' => $product->id, 'quantity' => 10, 'unit_cost' => '5']],
        ])->json('data');
        $this->postJson($this->tenantUrl($tenant, "purchase-orders/{$po['id']}/order"))->assertOk();
        $this->postJson($this->tenantUrl($tenant, 'goods-receipts'), [
            'branch_id' => $branch->id, 'purchase_order_id' => $po['id'],
            'items' => [['purchase_order_item_id' => $po['items'][0]['id'], 'quantity' => 6]],
        ])->assertCreated();

        // Supplier will not deliver the remaining 4: close the PO; stock received so far stays.
        $this->postJson($this->tenantUrl($tenant, "purchase-orders/{$po['id']}/close"), ['reason' => 'Supplier out of stock'])
            ->assertOk()->assertJsonPath('data.status', 'closed');
        $this->assertSame('6.000', Inventory::query()->value('quantity'));

        // Closed POs cannot receive more.
        $this->postJson($this->tenantUrl($tenant, 'goods-receipts'), [
            'branch_id' => $branch->id, 'purchase_order_id' => $po['id'],
            'items' => [['purchase_order_item_id' => $po['items'][0]['id'], 'quantity' => 1]],
        ])->assertUnprocessable()->assertJsonPath('code', 'INVALID_PO_STATE');
    }

    public function test_purchase_order_default_date_uses_business_timezone(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $supplier = Supplier::factory()->create(['tenant_id' => $tenant->id]);
        $product = $this->createProduct($tenant);

        // 17:30 UTC = 01:30 next day in Manila.
        $this->travelTo(now()->setTimezone('UTC')->setDate(2026, 10, 14)->setTime(17, 30));
        $po = $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'purchase-orders'), [
            'branch_id' => $branch->id, 'supplier_id' => $supplier->id,
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_cost' => '1']],
        ])->assertCreated();

        $this->assertSame('2026-10-15', $po->json('data.order_date'));
    }

    public function test_stock_count_keeps_sales_made_after_the_physical_count(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['price' => '10.00']);
        $this->setStock($product, $branch, '10');
        $this->actingAsUser($owner);

        // Staff count 9 on the shelf (1 missing) and save the count…
        $countId = $this->postJson($this->tenantUrl($tenant, 'stock-counts'), [
            'branch_id' => $branch->id, 'items' => [['product_id' => $product->id, 'counted_quantity' => 9]],
        ])->assertCreated()->json('data.id');

        // …then 2 units are sold before the manager completes the count.
        $this->openShift($tenant, $owner, $this->registerFor($branch));
        $this->checkout($tenant, $this->registerFor($branch), [['product_id' => $product->id, 'quantity' => 2]], [['method' => 'cash', 'amount' => '20']])->assertCreated();

        $this->postJson($this->tenantUrl($tenant, "stock-counts/{$countId}/complete"))->assertOk()
            ->assertJsonPath('data.items.0.expected_quantity', '10.000')
            ->assertJsonPath('data.items.0.variance', '-1.000');

        // 10 − 1 missing − 2 sold = 7 (not 9, which would erase the sale).
        $this->assertSame('7.000', Inventory::query()->value('quantity'));
        $this->artisan('smartpos:verify-integrity')->assertSuccessful();
    }

    public function test_decimal_inputs_with_leading_dot_or_plus_sign_do_not_crash(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $rice = $this->createProduct($tenant, ['price' => '50.00', 'allow_decimal_quantity' => true, 'unit' => 'kg']);
        $this->actingAsUser($owner);

        $this->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), [
            'branch_id' => $branch->id, 'reason' => 'found',
            'items' => [['product_id' => $rice->id, 'quantity_change' => '+.5']],
        ])->assertCreated()->assertJsonPath('data.0.quantity_after', '0.500');

        $this->openShift($tenant, $owner, $this->registerFor($branch));
        $this->checkout($tenant, $this->registerFor($branch), [['product_id' => $rice->id, 'quantity' => '.25']], [['method' => 'cash', 'amount' => '12.5']])
            ->assertCreated()->assertJsonPath('data.total', '12.50');
    }

    public function test_zero_stock_adjustment_is_a_validation_error_not_a_server_error(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant);

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), [
            'branch_id' => $branch->id, 'reason' => 'correction',
            'items' => [['product_id' => $product->id, 'quantity_change' => '0.000']],
        ])->assertUnprocessable();
    }

    public function test_cash_refund_approved_after_shift_closed_is_paid_from_approvers_open_shift(): void
    {
        [$tenant, , $branch] = $this->createTenant(['refund_approval_threshold' => '0.00']);
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $manager = $this->addMember($tenant, 'branch_manager', [$branch]);
        $product = $this->createProduct($tenant, ['price' => '100.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->registerFor($branch);
        $cashierShift = $this->openShift($tenant, $cashier, $register);
        $sale = $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '100']])->json('data');

        $refundId = $this->postJson($this->tenantUrl($tenant, 'refunds'), [
            'sale_id' => $sale['id'], 'reason' => 'Defect', 'register_session_id' => $cashierShift->id,
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()->assertJsonPath('data.status', 'pending_approval')->json('data.id');
        $this->postJson($this->tenantUrl($tenant, "register-sessions/{$cashierShift->id}/close"), ['counted_cash' => '1100'])->assertOk();

        // The manager approves later and hands over the cash from their own open drawer.
        $managerShift = $this->openShift($tenant, $manager, Register::query()->forceCreate([
            'tenant_id' => $tenant->id, 'branch_id' => $branch->id, 'code' => 'REG-M', 'name' => 'Manager register',
        ]));
        $this->postJson($this->tenantUrl($tenant, "refunds/{$refundId}/approve"))->assertOk();

        $this->assertSame('100.00', $managerShift->fresh()->cash_refunds);
        $this->assertSame('0.00', $cashierShift->fresh()->cash_refunds);
        $this->assertSame($managerShift->id, Refund::query()->find($refundId)->register_session_id);
    }

    public function test_in_transit_transfer_can_be_cancelled_and_stock_returns_to_source(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $b2 = $this->createBranch($tenant, 'B2');
        $product = $this->createProduct($tenant);
        $this->setStock($product, $main, '10', '5.0000');
        $this->actingAsUser($owner);

        $id = $this->postJson($this->tenantUrl($tenant, 'stock-transfers'), [
            'from_branch_id' => $main->id, 'to_branch_id' => $b2->id, 'items' => [['product_id' => $product->id, 'quantity' => 4]],
        ])->json('data.id');
        $this->postJson($this->tenantUrl($tenant, "stock-transfers/{$id}/dispatch"))->assertOk();
        $this->assertSame('6.000', Inventory::query()->where('branch_id', $main->id)->value('quantity'));

        $this->postJson($this->tenantUrl($tenant, "stock-transfers/{$id}/cancel"))->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertSame('10.000', Inventory::query()->where('branch_id', $main->id)->value('quantity'));
        $this->postJson($this->tenantUrl($tenant, "stock-transfers/{$id}/receive"))->assertUnprocessable();
        $this->artisan('smartpos:verify-integrity')->assertSuccessful();
    }

    public function test_category_parent_cycles_are_rejected(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $this->actingAsUser($owner);
        $a = $this->postJson($this->tenantUrl($tenant, 'categories'), ['name' => 'Food'])->json('data.id');
        $b = $this->postJson($this->tenantUrl($tenant, 'categories'), ['name' => 'Snacks', 'parent_id' => $a])->json('data.id');

        $this->patchJson($this->tenantUrl($tenant, "categories/{$a}"), ['parent_id' => $b])
            ->assertUnprocessable()->assertJsonPath('code', 'INVALID_PARENT');
    }

    public function test_idempotency_key_of_another_cashier_does_not_return_their_sale(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $other = $this->addMember($tenant, 'branch_manager', [$branch]);
        $product = $this->createProduct($tenant, ['price' => '10.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->registerFor($branch);
        $this->openShift($tenant, $owner, $register);
        $payload = [[['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '10']]];

        $this->checkout($tenant, $register, ...$payload, key: 'shared-key-123')->assertCreated();

        $this->actingAsUser($other);
        $this->checkout($tenant, $register, ...$payload, key: 'shared-key-123')
            ->assertStatus(409)->assertJsonPath('code', 'IDEMPOTENCY_KEY_REUSED');
    }
}
