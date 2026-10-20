<?php

namespace Tests\Feature\Shop;

use App\Models\CustomerAccount;
use App\Models\Tenant;
use App\Models\User;
use Tests\TestCase;

class RiderDeliveryTest extends TestCase
{
    private Tenant $tenant;

    private User $owner;

    private User $rider;

    private CustomerAccount $customer;

    private int $branchId;

    protected function setUp(): void
    {
        parent::setUp();
        [$this->tenant, $this->owner, $branch] = $this->createTenant();
        $this->branchId = $branch->id;
        $this->rider = $this->addMember($this->tenant, 'delivery_rider', [$branch]);
        $this->customer = CustomerAccount::query()->forceCreate([
            'tenant_id' => $this->tenant->id, 'name' => 'Ana Reyes', 'email' => 'ana@example.com', 'phone' => '0917', 'password' => 'long-password-1',
        ]);
    }

    /** A delivery order placed by the customer with a pinned location, prepared and ready to send. */
    private function readyDeliveryOrder(): int
    {
        $product = $this->createProduct($this->tenant, ['price' => '50.00']);
        $this->setStock($product, $this->tenant->branches()->findOrFail($this->branchId), '50');
        $id = $this->actingAs($this->customer, 'customer')->postJson("/api/v1/shop/{$this->tenant->slug}/orders", [
            'branch_id' => $this->branchId, 'contact_name' => 'Ana Reyes', 'contact_phone' => '0917', 'fulfilment' => 'delivery',
            'delivery_address' => 'Blk 4 Lot 12, Mahogany St., Davao City', 'delivery_lat' => 7.0731, 'delivery_lng' => 125.6128,
            'cash_amount' => '200', 'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->assertJsonPath('data.delivery_lat', 7.0731)->json('data.id');

        $this->actingAsUser($this->owner);
        $this->postJson($this->tenantUrl($this->tenant, "online-orders/{$id}/status"), ['status' => 'confirmed'])->assertOk();
        $this->postJson($this->tenantUrl($this->tenant, "online-orders/{$id}/status"), ['status' => 'ready'])->assertOk();

        return $id;
    }

    private function customerOrder(int $id): array
    {
        return collect($this->actingAs($this->customer, 'customer')->getJson("/api/v1/shop/{$this->tenant->slug}/orders")->assertOk()->json('data'))
            ->firstWhere('id', $id);
    }

    public function test_rider_is_assigned_shares_location_with_the_customer_and_hands_over(): void
    {
        $id = $this->readyDeliveryOrder();

        $riders = $this->actingAsUser($this->owner)->getJson($this->tenantUrl($this->tenant, "online-orders/riders?branch_id={$this->branchId}"))->assertOk()->json('data');
        $this->assertSame([$this->rider->id], array_column($riders, 'user_id')); // the owner is not listed as a rider

        $this->postJson($this->tenantUrl($this->tenant, "online-orders/{$id}/status"), ['status' => 'out_for_delivery', 'rider_user_id' => $this->rider->id])
            ->assertOk()->assertJsonPath('data.rider_name', $this->rider->name);

        $this->actingAsUser($this->rider)->getJson($this->tenantUrl($this->tenant, 'deliveries'))->assertOk()->assertJsonPath('data.0.id', $id);
        $this->postJson($this->tenantUrl($this->tenant, "deliveries/{$id}/location"), ['latitude' => 7.07, 'longitude' => 125.61])->assertOk();

        $order = $this->customerOrder($id);
        $this->assertSame(7.07, $order['rider_lat']);
        $this->assertArrayNotHasKey('rider_user_id', $order);

        $this->actingAsUser($this->rider)->postJson($this->tenantUrl($this->tenant, "deliveries/{$id}/delivered"))->assertOk();
        $order = $this->customerOrder($id);
        $this->assertArrayNotHasKey('rider_lat', $order); // location stops being shared once handed over
        $this->assertNotNull($order['delivered_at']);

        $this->actingAsUser($this->rider)->postJson($this->tenantUrl($this->tenant, "deliveries/{$id}/location"), ['latitude' => 1, 'longitude' => 1])->assertStatus(409);
    }

    public function test_only_the_assigned_rider_can_report_on_a_delivery(): void
    {
        $id = $this->readyDeliveryOrder();
        $this->postJson($this->tenantUrl($this->tenant, "online-orders/{$id}/status"), ['status' => 'out_for_delivery', 'rider_user_id' => $this->rider->id])->assertOk();
        $otherRider = $this->addMember($this->tenant, 'delivery_rider');

        $this->actingAsUser($otherRider)->postJson($this->tenantUrl($this->tenant, "deliveries/{$id}/location"), ['latitude' => 7, 'longitude' => 125])->assertNotFound();
        $cashier = $this->addMember($this->tenant, 'cashier');
        $this->actingAsUser($cashier)->getJson($this->tenantUrl($this->tenant, 'deliveries'))->assertForbidden();
    }

    public function test_rider_brings_an_order_back_with_a_reason(): void
    {
        $id = $this->readyDeliveryOrder();
        $this->postJson($this->tenantUrl($this->tenant, "online-orders/{$id}/status"), ['status' => 'out_for_delivery', 'rider_user_id' => $this->rider->id])->assertOk();

        $this->actingAsUser($this->rider)->postJson($this->tenantUrl($this->tenant, "deliveries/{$id}/return"), ['reason' => 'Nobody home'])
            ->assertOk()->assertJsonPath('data.status', 'ready')->assertJsonPath('data.delivery_issue', 'Nobody home')->assertJsonPath('data.rider_user_id', null);
    }

    public function test_dispatch_rejects_staff_who_are_not_riders(): void
    {
        $id = $this->readyDeliveryOrder();
        $cashier = $this->addMember($this->tenant, 'cashier');

        $this->postJson($this->tenantUrl($this->tenant, "online-orders/{$id}/status"), ['status' => 'out_for_delivery', 'rider_user_id' => $cashier->id])
            ->assertUnprocessable()->assertJsonValidationErrors('rider_user_id');
        $this->postJson($this->tenantUrl($this->tenant, "online-orders/{$id}/status"), ['status' => 'out_for_delivery', 'rider_name' => 'Outside courier'])
            ->assertOk()->assertJsonPath('data.rider_user_id', null);
    }

    public function test_customer_sees_branch_location_and_purchase_history(): void
    {
        $this->tenant->branches()->whereKey($this->branchId)->update(['latitude' => 7.0800, 'longitude' => 125.6100]);
        $this->getJson("/api/v1/shop/{$this->tenant->slug}")->assertOk()->assertJsonPath('branches.0.latitude', 7.08);

        $this->actingAs($this->customer, 'customer')->getJson("/api/v1/shop/{$this->tenant->slug}/purchases")->assertOk()->assertJsonPath('total', 0);
    }

    public function test_rider_takes_a_ready_order_and_sees_their_day(): void
    {
        $id = $this->readyDeliveryOrder();

        $day = $this->actingAsUser($this->rider)->getJson($this->tenantUrl($this->tenant, 'deliveries'))->assertOk()
            ->assertJsonPath('available.0.id', $id)->assertJsonPath('on_duty', true)->assertJsonPath('summary.on_the_way', 0);

        $this->postJson($this->tenantUrl($this->tenant, "deliveries/{$id}/claim"))->assertOk()
            ->assertJsonPath('data.status', 'out_for_delivery')->assertJsonPath('data.rider_user_id', $this->rider->id);

        $this->getJson($this->tenantUrl($this->tenant, 'deliveries'))->assertOk()
            ->assertJsonCount(0, 'available')
            ->assertJsonPath('summary.on_the_way', 1)
            ->assertJsonPath('summary.change_to_bring', '100.00'); // pays with 200 for a 100.00 order

        $this->postJson($this->tenantUrl($this->tenant, "deliveries/{$id}/delivered"))->assertOk();
        $this->getJson($this->tenantUrl($this->tenant, 'deliveries'))->assertOk()
            ->assertJsonPath('summary.delivered_today', 1)
            ->assertJsonPath('summary.to_hand_in', '100.00');

        // A second rider cannot take an order that is already on the way.
        $other = $this->addMember($this->tenant, 'delivery_rider');
        $this->actingAsUser($other)->postJson($this->tenantUrl($this->tenant, "deliveries/{$id}/claim"))->assertStatus(409);
    }

    public function test_off_duty_riders_cannot_take_orders_and_are_listed_last(): void
    {
        $id = $this->readyDeliveryOrder();
        $second = $this->addMember($this->tenant, 'delivery_rider');

        $this->actingAsUser($this->rider)->postJson($this->tenantUrl($this->tenant, 'deliveries/duty'), ['on_duty' => false])->assertOk()->assertJsonPath('on_duty', false);
        $this->postJson($this->tenantUrl($this->tenant, "deliveries/{$id}/claim"))->assertStatus(409);

        $riders = $this->actingAsUser($this->owner)->getJson($this->tenantUrl($this->tenant, "online-orders/riders?branch_id={$this->branchId}"))->assertOk()->json('data');
        $this->assertSame([$second->id, $this->rider->id], array_column($riders, 'user_id'));
        $this->assertFalse($riders[1]['on_duty']);
    }

    public function test_rider_history_covers_a_period_and_only_their_own_deliveries(): void
    {
        $first = $this->readyDeliveryOrder();
        $this->actingAsUser($this->rider)->postJson($this->tenantUrl($this->tenant, "deliveries/{$first}/claim"))->assertOk();
        $this->postJson($this->tenantUrl($this->tenant, "deliveries/{$first}/delivered"))->assertOk();

        // A delivery by another rider must not appear in this rider's history.
        $other = $this->addMember($this->tenant, 'delivery_rider');
        $second = $this->readyDeliveryOrder();
        $this->actingAsUser($other)->postJson($this->tenantUrl($this->tenant, "deliveries/{$second}/claim"))->assertOk();
        $this->postJson($this->tenantUrl($this->tenant, "deliveries/{$second}/delivered"))->assertOk();

        $today = now($this->tenant->timezone)->toDateString();
        $this->actingAsUser($this->rider)->getJson($this->tenantUrl($this->tenant, "deliveries/history?date_from={$today}&date_to={$today}"))->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $first)
            ->assertJsonPath('summary.deliveries', 1)
            ->assertJsonPath('summary.value', '100.00')
            ->assertJsonPath('summary.not_handed_in', '100.00')
            ->assertJsonPath('summary.days_worked', 1);

        $this->getJson($this->tenantUrl($this->tenant, 'deliveries/history?date_from=2020-01-01&date_to=2020-01-31'))->assertOk()->assertJsonPath('summary.deliveries', 0);
        $this->getJson($this->tenantUrl($this->tenant, "deliveries/history?date_from={$today}&date_to=2020-01-01"))->assertUnprocessable();
    }
}
