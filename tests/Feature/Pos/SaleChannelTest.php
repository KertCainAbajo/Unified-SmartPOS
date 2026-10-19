<?php

namespace Tests\Feature\Pos;

use App\Models\CustomerAccount;
use App\Models\OnlineOrder;
use Tests\TestCase;

/** Sales show whether they were rung up at the counter or completed an online pickup or delivery order. */
class SaleChannelTest extends TestCase
{
    use PosTestHelpers;

    public function test_sales_are_labelled_and_filtered_by_where_they_came_from(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['price' => '50.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $this->actingAsUser($owner);
        $this->openShift($tenant, $owner, $register);

        $counter = $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '50']])->assertCreated()->json('data.id');
        $online = $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '50']])->assertCreated()->json('data.id');

        $account = CustomerAccount::query()->forceCreate(['tenant_id' => $tenant->id, 'name' => 'Ana', 'email' => 'ana@example.com', 'phone' => '0917', 'password' => 'long-password-1']);
        OnlineOrder::query()->forceCreate([
            'tenant_id' => $tenant->id, 'branch_id' => $branch->id, 'customer_account_id' => $account->id, 'order_number' => 'ORD-1',
            'status' => 'completed', 'fulfilment' => 'delivery', 'contact_name' => 'Ana', 'contact_phone' => '0917',
            'delivery_address' => 'Mahogany St., Agdao', 'rider_name' => 'Ben', 'estimated_total' => '50.00', 'placed_at' => now(), 'sale_id' => $online,
        ]);

        $rows = collect($this->getJson($this->tenantUrl($tenant, 'sales'))->assertOk()->json('data'))->keyBy('id');
        $this->assertSame('in_store', $rows[$counter]['channel']);
        $this->assertSame('delivery', $rows[$online]['channel']);
        $this->assertSame('ORD-1', $rows[$online]['online_order']['order_number']);

        $this->getJson($this->tenantUrl($tenant, 'sales?channel=delivery'))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $online);
        $this->getJson($this->tenantUrl($tenant, 'sales?channel=in_store'))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $counter);
        $this->getJson($this->tenantUrl($tenant, 'sales?channel=pickup'))->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->tenantUrl($tenant, "sales/{$online}"))->assertOk()->assertJsonPath('data.channel', 'delivery')->assertJsonPath('data.online_order.rider_name', 'Ben');
    }
}
