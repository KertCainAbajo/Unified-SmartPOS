<?php

namespace Tests\Feature\Purchasing;

use App\Models\Inventory;
use App\Models\Supplier;
use Tests\TestCase;

class PurchasingTest extends TestCase
{
    public function test_purchase_order_partial_and_full_receipt_updates_stock_and_weighted_cost(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $supplier = Supplier::factory()->create(['tenant_id' => $tenant->id]);
        $product = $this->createProduct($tenant, ['cost_price' => '10.0000']);
        $this->setStock($product, $branch, '10', '10.0000');
        $this->actingAsUser($owner);

        $po = $this->postJson($this->tenantUrl($tenant, 'purchase-orders'), [
            'branch_id' => $branch->id, 'supplier_id' => $supplier->id,
            'items' => [['product_id' => $product->id, 'quantity' => 20, 'unit_cost' => '13.00']],
        ])->assertCreated()->assertJsonPath('data.total', '260.00')->assertJsonPath('data.status', 'draft')->json('data');

        $poItemId = $po['items'][0]['id'];

        // Draft POs cannot be received.
        $this->postJson($this->tenantUrl($tenant, 'goods-receipts'), [
            'branch_id' => $branch->id, 'purchase_order_id' => $po['id'], 'items' => [['purchase_order_item_id' => $poItemId, 'quantity' => 5]],
        ])->assertUnprocessable()->assertJsonPath('code', 'INVALID_PO_STATE');

        $this->postJson($this->tenantUrl($tenant, "purchase-orders/{$po['id']}/order"))->assertOk()->assertJsonPath('data.status', 'ordered');

        $this->postJson($this->tenantUrl($tenant, 'goods-receipts'), [
            'branch_id' => $branch->id, 'purchase_order_id' => $po['id'], 'supplier_invoice_number' => 'INV-1',
            'items' => [['purchase_order_item_id' => $poItemId, 'quantity' => 10]],
        ])->assertCreated()->assertJsonPath('data.total_cost', '130.00');

        $inventory = Inventory::query()->first();
        $this->assertSame('20.000', $inventory->quantity);
        $this->assertSame('11.5000', $inventory->average_cost); // (10×10 + 10×13) / 20
        $this->assertSame('partially_received', $this->getJson($this->tenantUrl($tenant, "purchase-orders/{$po['id']}"))->json('data.status'));
        $this->assertSame('13.0000', $product->fresh()->cost_price);
        $this->assertDatabaseHas('price_history', ['product_id' => $product->id, 'new_cost' => '13.0000']);

        // Over-receipt is rejected.
        $this->postJson($this->tenantUrl($tenant, 'goods-receipts'), [
            'branch_id' => $branch->id, 'purchase_order_id' => $po['id'], 'items' => [['purchase_order_item_id' => $poItemId, 'quantity' => 11]],
        ])->assertUnprocessable()->assertJsonPath('code', 'OVER_RECEIPT');

        $this->postJson($this->tenantUrl($tenant, 'goods-receipts'), [
            'branch_id' => $branch->id, 'purchase_order_id' => $po['id'], 'items' => [['purchase_order_item_id' => $poItemId, 'quantity' => 10]],
        ])->assertCreated();

        $this->getJson($this->tenantUrl($tenant, "purchase-orders/{$po['id']}"))->assertJsonPath('data.status', 'received');
        $this->assertSame('30.000', Inventory::query()->value('quantity'));
        $this->assertDatabaseHas('stock_movements', ['type' => 'purchase_receipt', 'quantity_change' => '10.000', 'unit_cost' => '13.0000']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'goods_receipt.posted']);
    }

    public function test_direct_receipt_without_purchase_order(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $staff = $this->addMember($tenant, 'inventory_staff', [$branch]);
        $product = $this->createProduct($tenant);

        $this->actingAsUser($staff)->postJson($this->tenantUrl($tenant, 'goods-receipts'), [
            'branch_id' => $branch->id, 'items' => [['product_id' => $product->id, 'quantity' => 12, 'unit_cost' => '7.25']],
        ])->assertCreated()->assertJsonPath('data.total_cost', '87.00');

        $this->assertSame('12.000', Inventory::query()->value('quantity'));
    }

    public function test_inventory_staff_cannot_create_purchase_orders_and_cashier_cannot_receive(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $supplier = Supplier::factory()->create(['tenant_id' => $tenant->id]);
        $product = $this->createProduct($tenant);

        $this->actingAsUser($this->addMember($tenant, 'inventory_staff'))->postJson($this->tenantUrl($tenant, 'purchase-orders'), [
            'branch_id' => $branch->id, 'supplier_id' => $supplier->id, 'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_cost' => '1']],
        ])->assertForbidden();

        $this->actingAsUser($this->addMember($tenant, 'cashier'))->postJson($this->tenantUrl($tenant, 'goods-receipts'), [
            'branch_id' => $branch->id, 'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_cost' => '1']],
        ])->assertForbidden();
    }

    public function test_suppliers_are_tenant_scoped(): void
    {
        [$tenantA, $ownerA] = $this->createTenant();
        [$tenantB] = $this->createTenant();
        $foreign = Supplier::factory()->create(['tenant_id' => $tenantB->id]);
        $this->actingAsUser($ownerA);

        $this->postJson($this->tenantUrl($tenantA, 'suppliers'), ['name' => 'Acme Trading'])->assertCreated();
        $this->getJson($this->tenantUrl($tenantA, 'suppliers'))->assertJsonCount(1, 'data');
        $this->getJson($this->tenantUrl($tenantA, "suppliers/{$foreign->id}"))->assertNotFound();
    }
}
