<?php

namespace Tests\Feature\Shop;

use App\Models\AppNotification;
use App\Models\CustomerAccount;
use App\Models\Tenant;
use App\Models\User;
use App\Notifications\CustomerOrderUpdateNotification;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\Feature\Pos\PosTestHelpers;
use Tests\TestCase;

/** Notifications, customer service cancelling, the customer's own account, and the sales-by-channel report. */
class OnlineOrderFeaturesTest extends TestCase
{
    use PosTestHelpers;

    private Tenant $tenant;

    private User $owner;

    private User $cashier;

    private User $rider;

    private CustomerAccount $customer;

    private int $branchId;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        [$this->tenant, $this->owner, $branch] = $this->createTenant();
        $this->branchId = $branch->id;
        $this->cashier = $this->addMember($this->tenant, 'cashier', [$branch]);
        $this->rider = $this->addMember($this->tenant, 'delivery_rider', [$branch]);
        $this->customer = CustomerAccount::query()->forceCreate([
            'tenant_id' => $this->tenant->id, 'name' => 'Ana Reyes', 'email' => 'ana@example.com', 'phone' => '0917', 'password' => 'long-password-1',
        ]);
    }

    private function placeDelivery(): int
    {
        $product = $this->createProduct($this->tenant, ['price' => '50.00']);

        return $this->actingAs($this->customer, 'customer')->postJson("/api/v1/shop/{$this->tenant->slug}/orders", [
            'branch_id' => $this->branchId, 'contact_name' => 'Ana Reyes', 'contact_phone' => '0917', 'fulfilment' => 'delivery',
            'delivery_address' => 'Blk 4 Lot 12, Mahogany St., Davao City', 'cash_amount' => '200', 'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->json('data.id');
    }

    private function moveOrder(int $id, array $body): \Illuminate\Testing\TestResponse
    {
        return $this->postJson($this->tenantUrl($this->tenant, "online-orders/{$id}/status"), $body);
    }

    public function test_staff_rider_and_customer_are_told_as_the_order_moves(): void
    {
        $id = $this->placeDelivery();
        $this->assertTrue(AppNotification::query()->where('user_id', $this->cashier->id)->where('type', 'online_order_new')->exists(), 'Branch staff hear about the new order.');

        $this->actingAsUser($this->cashier);
        $this->moveOrder($id, ['status' => 'confirmed'])->assertOk();
        $this->moveOrder($id, ['status' => 'ready'])->assertOk();
        $this->moveOrder($id, ['status' => 'out_for_delivery', 'rider_user_id' => $this->rider->id])->assertOk();

        Notification::assertSentToTimes($this->customer, CustomerOrderUpdateNotification::class, 3);
        $this->assertTrue(AppNotification::query()->where('user_id', $this->rider->id)->where('type', 'delivery_assigned')->exists(), 'The rider hears about the delivery.');

        $this->actingAsUser($this->rider)->postJson($this->tenantUrl($this->tenant, "deliveries/{$id}/delivered"))->assertOk();
        $this->assertTrue(AppNotification::query()->where('user_id', $this->cashier->id)->where('type', 'delivery_delivered')->exists(), 'Staff know cash is coming in.');
    }

    public function test_customer_service_can_cancel_but_not_prepare_online_orders(): void
    {
        $id = $this->placeDelivery();
        $service = $this->addMember($this->tenant, 'customer_service');

        $this->actingAsUser($service);
        $this->moveOrder($id, ['status' => 'confirmed'])->assertForbidden();
        $this->moveOrder($id, ['status' => 'cancelled', 'cancel_reason' => 'Customer called to cancel'])->assertOk()->assertJsonPath('data.status', 'cancelled');
        Notification::assertSentTo($this->customer, CustomerOrderUpdateNotification::class);
    }

    public function test_customer_updates_their_details_and_password(): void
    {
        $shop = "/api/v1/shop/{$this->tenant->slug}";
        $this->actingAs($this->customer, 'customer')->patchJson("{$shop}/me", ['name' => 'Ana R. Reyes', 'phone' => '09998887777'])
            ->assertOk()->assertJsonPath('data.phone', '09998887777');

        $this->withHeaders(['Origin' => 'http://localhost', 'Referer' => 'http://localhost/'])
            ->putJson("{$shop}/me/password", ['current_password' => 'wrong-password-1', 'password' => 'brand-new-pass', 'password_confirmation' => 'brand-new-pass'])
            ->assertUnprocessable()->assertJsonValidationErrors('current_password');
        $this->withHeaders(['Origin' => 'http://localhost', 'Referer' => 'http://localhost/'])
            ->putJson("{$shop}/me/password", ['current_password' => 'long-password-1', 'password' => 'brand-new-pass', 'password_confirmation' => 'brand-new-pass'])
            ->assertOk();
        $this->assertTrue(Hash::check('brand-new-pass', $this->customer->fresh()->password));
    }

    public function test_sales_by_channel_report_separates_counter_and_online_sales(): void
    {
        $product = $this->createProduct($this->tenant, ['price' => '40.00']);
        $branch = $this->tenant->branches()->findOrFail($this->branchId);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $this->actingAsUser($this->owner);
        $this->openShift($this->tenant, $this->owner, $register);
        $this->checkout($this->tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '40']])->assertCreated();

        $rows = collect($this->getJson($this->tenantUrl($this->tenant, 'reports/sales-by-channel'))->assertOk()->json('data'))->keyBy('channel');
        $this->assertSame(1, $rows['in_store']['sales']);
        $this->assertSame('40.00', $rows['in_store']['total']);
        $this->assertSame(0, $rows['delivery']['sales']);
    }

    /** The only register is busy with the cashier's shift: the owner still records the online order's payment on it. */
    public function test_owner_records_online_payment_on_the_cashiers_open_register(): void
    {
        $branch = $this->tenant->branches()->findOrFail($this->branchId);
        $register = $this->mainRegister($branch);
        $this->openShift($this->tenant, $this->cashier, $register);
        $product = $this->createProduct($this->tenant, ['price' => '50.00']);
        $this->setStock($product, $branch, '10');
        $id = $this->actingAs($this->customer, 'customer')->postJson("/api/v1/shop/{$this->tenant->slug}/orders", [
            'branch_id' => $this->branchId, 'contact_name' => 'Ana Reyes', 'contact_phone' => '0917', 'fulfilment' => 'pickup',
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->json('data.id');

        $this->actingAsUser($this->owner);
        $this->getJson($this->tenantUrl($this->tenant, "registers?branch_id={$this->branchId}"))->assertOk()
            ->assertJsonPath('data.0.open_session.opened_by_name', $this->cashier->name);
        $this->moveOrder($id, ['status' => 'confirmed'])->assertOk();
        $this->moveOrder($id, ['status' => 'ready'])->assertOk();
        $this->checkout($this->tenant, $register, [['product_id' => $product->id, 'quantity' => 2]], [['method' => 'cash', 'amount' => '100']], ['online_order_id' => $id])
            ->assertCreated();
        $this->getJson($this->tenantUrl($this->tenant, "online-orders/{$id}"))->assertJsonPath('data.status', 'completed');
    }

    /** Owners and branch managers run online orders exactly like cashiers: confirm, prepare, dispatch and cancel. */
    public function test_owner_manager_and_cashier_can_all_work_online_orders(): void
    {
        $branch = $this->tenant->branches()->findOrFail($this->branchId);
        $manager = $this->addMember($this->tenant, 'branch_manager', [$branch]);

        foreach (['owner' => $this->owner, 'branch manager' => $manager, 'cashier' => $this->cashier] as $who => $user) {
            $id = $this->placeDelivery();
            $this->actingAsUser($user);
            $this->moveOrder($id, ['status' => 'confirmed'])->assertOk();
            $this->moveOrder($id, ['status' => 'ready'])->assertOk();
            $this->moveOrder($id, ['status' => 'out_for_delivery', 'rider_user_id' => $this->rider->id])->assertOk()->assertJsonPath('data.status', 'out_for_delivery');

            $other = $this->placeDelivery();
            $this->actingAsUser($user);
            $this->moveOrder($other, ['status' => 'cancelled', 'cancel_reason' => 'Out of stock'])->assertOk();
            $this->assertTrue(true, "{$who} can work online orders");
        }
    }
}
