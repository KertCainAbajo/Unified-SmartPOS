<?php

namespace Tests\Feature\Inventory;

use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\Inventory;
use App\Models\StockMovement;
use Tests\TestCase;

class InventoryTest extends TestCase
{
    public function test_adjustment_changes_stock_and_writes_ledger_and_audit(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant);

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), [
            'branch_id' => $branch->id,
            'reason' => 'opening',
            'items' => [['product_id' => $product->id, 'quantity_change' => 50, 'unit_cost' => '12.5']],
        ])->assertCreated()->assertJsonPath('data.0.quantity_after', '50.000');

        $this->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), [
            'branch_id' => $branch->id,
            'reason' => 'damaged',
            'notes' => 'Dropped carton',
            'items' => [['product_id' => $product->id, 'quantity_change' => -3]],
        ])->assertCreated()->assertJsonPath('data.0.quantity_before', '50.000')->assertJsonPath('data.0.quantity_after', '47.000');

        $inventory = Inventory::query()->where('product_id', $product->id)->first();
        $this->assertSame('47.000', $inventory->quantity);
        $this->assertSame('12.5000', $inventory->average_cost);
        $this->assertSame('47.000', number_format((float) StockMovement::query()->where('product_id', $product->id)->sum('quantity_change'), 3, '.', ''));
        $this->assertSame(2, StockMovement::query()->count());
        $this->assertDatabaseHas('stock_movements', ['type' => 'adjustment', 'reason' => 'damaged: Dropped carton', 'user_id' => $owner->id]);
        $this->assertSame(2, AuditLog::query()->where('action', 'inventory.adjusted')->count());
    }

    public function test_adjustment_cannot_make_stock_negative(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant);
        $this->setStock($product, $branch, '2');

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), [
            'branch_id' => $branch->id, 'reason' => 'lost', 'items' => [['product_id' => $product->id, 'quantity_change' => -5]],
        ])->assertUnprocessable()->assertJsonPath('code', 'INSUFFICIENT_STOCK');

        $this->assertSame('2.000', Inventory::query()->first()->quantity);
        $this->assertSame(0, StockMovement::query()->where('type', '!=', 'opening')->count());
    }

    public function test_whole_unit_products_reject_fractional_quantities(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant);

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), [
            'branch_id' => $branch->id, 'reason' => 'found', 'items' => [['product_id' => $product->id, 'quantity_change' => '1.5']],
        ])->assertUnprocessable()->assertJsonPath('code', 'WHOLE_UNITS_ONLY');
    }

    public function test_inventory_staff_cannot_adjust_an_unauthorized_branch(): void
    {
        [$tenant, , $main] = $this->createTenant();
        $other = $this->createBranch($tenant, 'B2');
        $product = $this->createProduct($tenant);
        $staff = $this->addMember($tenant, 'inventory_staff', [$main]);
        $this->actingAsUser($staff);

        $this->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), [
            'branch_id' => $main->id, 'reason' => 'found', 'items' => [['product_id' => $product->id, 'quantity_change' => 1]],
        ])->assertCreated();

        $this->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), [
            'branch_id' => $other->id, 'reason' => 'found', 'items' => [['product_id' => $product->id, 'quantity_change' => 1]],
        ])->assertForbidden();

        $this->setStock($product, $other, '9');
        $branchIds = array_column($this->getJson($this->tenantUrl($tenant, 'inventory'))->assertOk()->json('data'), 'branch_id');
        $this->assertSame([$main->id], array_values(array_unique($branchIds)));
        $this->getJson($this->tenantUrl($tenant, 'stock-movements?branch_id='.$other->id))->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_cashier_cannot_adjust_stock(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $product = $this->createProduct($tenant);

        $this->actingAsUser($this->addMember($tenant, 'cashier'))->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), [
            'branch_id' => $branch->id, 'reason' => 'found', 'items' => [['product_id' => $product->id, 'quantity_change' => 100]],
        ])->assertForbidden();
    }

    public function test_cannot_adjust_another_tenants_product(): void
    {
        [$tenantA, $ownerA, $branchA] = $this->createTenant();
        [$tenantB] = $this->createTenant();
        $foreign = $this->createProduct($tenantB);

        $this->actingAsUser($ownerA)->postJson($this->tenantUrl($tenantA, 'inventory/adjustments'), [
            'branch_id' => $branchA->id, 'reason' => 'found', 'items' => [['product_id' => $foreign->id, 'quantity_change' => 1]],
        ])->assertUnprocessable()->assertJsonValidationErrors('items.0.product_id');
    }

    public function test_low_stock_report_and_notification_when_crossing_reorder_level(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $low = $this->createProduct($tenant, ['reorder_level' => '10']);
        $neverStocked = $this->createProduct($tenant, ['reorder_level' => '5']);
        $healthy = $this->createProduct($tenant, ['reorder_level' => '5']);
        $this->setStock($low, $branch, '12');
        $this->setStock($healthy, $branch, '100');
        $this->actingAsUser($owner);

        $this->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), [
            'branch_id' => $branch->id, 'reason' => 'damaged', 'items' => [['product_id' => $low->id, 'quantity_change' => -4]],
        ])->assertCreated();

        $ids = array_column($this->getJson($this->tenantUrl($tenant, 'inventory/low-stock'))->assertOk()->json('data'), 'product_id');
        $this->assertEqualsCanonicalizing([$low->id, $neverStocked->id], $ids);

        $this->assertDatabaseHas('notifications', ['tenant_id' => $tenant->id, 'user_id' => $owner->id, 'type' => 'low_stock']);
        $this->getJson($this->tenantUrl($tenant, 'notifications'))->assertOk()->assertJsonPath('data.0.type', 'low_stock');
        $this->assertSame(1, AppNotification::query()->count());
    }

    public function test_stock_transfer_lifecycle_moves_stock_and_cost(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $b2 = $this->createBranch($tenant, 'B2');
        $product = $this->createProduct($tenant);
        $this->setStock($product, $main, '20', '10.0000');
        $this->actingAsUser($owner);

        $id = $this->postJson($this->tenantUrl($tenant, 'stock-transfers'), [
            'from_branch_id' => $main->id, 'to_branch_id' => $b2->id,
            'items' => [['product_id' => $product->id, 'quantity' => 8]],
        ])->assertCreated()->assertJsonPath('data.status', 'draft')->json('data.id');

        $this->postJson($this->tenantUrl($tenant, "stock-transfers/{$id}/receive"))->assertUnprocessable()->assertJsonPath('code', 'INVALID_TRANSFER_STATE');
        $this->postJson($this->tenantUrl($tenant, "stock-transfers/{$id}/dispatch"))->assertOk()->assertJsonPath('data.status', 'in_transit');
        $this->assertSame('12.000', Inventory::query()->where('branch_id', $main->id)->first()->quantity);

        $this->postJson($this->tenantUrl($tenant, "stock-transfers/{$id}/receive"))->assertOk()->assertJsonPath('data.status', 'received');
        $dest = Inventory::query()->where('branch_id', $b2->id)->first();
        $this->assertSame('8.000', $dest->quantity);
        $this->assertSame('10.0000', $dest->average_cost);
        $this->assertDatabaseHas('stock_movements', ['type' => 'transfer_out', 'branch_id' => $main->id, 'quantity_change' => '-8.000']);
        $this->assertDatabaseHas('stock_movements', ['type' => 'transfer_in', 'branch_id' => $b2->id, 'quantity_change' => '8.000']);
    }

    public function test_transfer_dispatch_fails_without_enough_stock_and_receive_requires_destination_access(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $b2 = $this->createBranch($tenant, 'B2');
        $product = $this->createProduct($tenant);
        $this->setStock($product, $main, '3');
        $mainStaff = $this->addMember($tenant, 'inventory_staff', [$main]);

        $this->actingAsUser($mainStaff);
        $id = $this->postJson($this->tenantUrl($tenant, 'stock-transfers'), [
            'from_branch_id' => $main->id, 'to_branch_id' => $b2->id, 'items' => [['product_id' => $product->id, 'quantity' => 5]],
        ])->assertCreated()->json('data.id');
        $this->postJson($this->tenantUrl($tenant, "stock-transfers/{$id}/dispatch"))->assertUnprocessable()->assertJsonPath('code', 'INSUFFICIENT_STOCK');

        $this->setStock($product, $main, '10');
        $this->postJson($this->tenantUrl($tenant, "stock-transfers/{$id}/dispatch"))->assertOk();
        $this->postJson($this->tenantUrl($tenant, "stock-transfers/{$id}/receive"))->assertForbidden();
    }

    public function test_stock_count_books_variance_against_locked_balance(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $a = $this->createProduct($tenant);
        $b = $this->createProduct($tenant);
        $this->setStock($a, $branch, '10');
        $this->setStock($b, $branch, '5');
        $this->actingAsUser($owner);

        $id = $this->postJson($this->tenantUrl($tenant, 'stock-counts'), [
            'branch_id' => $branch->id,
            'items' => [['product_id' => $a->id, 'counted_quantity' => 7], ['product_id' => $b->id, 'counted_quantity' => 5]],
        ])->assertCreated()->json('data.id');

        $response = $this->postJson($this->tenantUrl($tenant, "stock-counts/{$id}/complete"))->assertOk()->assertJsonPath('data.status', 'completed');
        $items = collect($response->json('data.items'))->keyBy('product_id');
        $this->assertSame('-3.000', $items[$a->id]['variance']);
        $this->assertSame('0.000', $items[$b->id]['variance']);

        $this->assertSame('7.000', Inventory::query()->where('product_id', $a->id)->first()->quantity);
        $this->assertSame(1, StockMovement::query()->where('type', 'stock_count')->count());
        $this->postJson($this->tenantUrl($tenant, "stock-counts/{$id}/complete"))->assertUnprocessable();
    }
}
