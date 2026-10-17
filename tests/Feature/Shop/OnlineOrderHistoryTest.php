<?php

namespace Tests\Feature\Shop;

use App\Models\CustomerAccount;
use App\Models\OnlineOrder;
use App\Models\Tenant;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class OnlineOrderHistoryTest extends TestCase
{
    private function order(Tenant $tenant, int $branchId, CustomerAccount $account, array $attributes): OnlineOrder
    {
        static $n = 0;
        $n++;

        return OnlineOrder::query()->forceCreate([
            'tenant_id' => $tenant->id, 'branch_id' => $branchId, 'customer_account_id' => $account->id,
            'order_number' => "ONL-{$n}", 'contact_name' => 'Ana Reyes', 'contact_phone' => '0917', 'placed_at' => now(),
            ...$attributes,
        ]);
    }

    public function test_history_filters_by_period_and_summarises_the_whole_period(): void
    {
        Carbon::setTestNow('2026-10-17 10:00:00');
        [$tenant, $owner, $branch] = $this->createTenant();
        $account = CustomerAccount::query()->forceCreate(['tenant_id' => $tenant->id, 'name' => 'Ana Reyes', 'email' => 'ana@example.com', 'phone' => '0917', 'password' => 'long-password-1']);

        $this->order($tenant, $branch->id, $account, ['status' => 'completed', 'fulfilment' => 'delivery', 'estimated_total' => '100.00', 'placed_at' => now()->subMinutes(90), 'completed_at' => now()->subMinutes(30)]);
        $this->order($tenant, $branch->id, $account, ['status' => 'completed', 'fulfilment' => 'pickup', 'estimated_total' => '50.00', 'placed_at' => now()->subMinutes(40), 'completed_at' => now()->subMinutes(20)]);
        $this->order($tenant, $branch->id, $account, ['status' => 'completed', 'fulfilment' => 'pickup', 'estimated_total' => '999.00', 'placed_at' => now()->subDays(40), 'completed_at' => now()->subDays(40)]);
        $this->order($tenant, $branch->id, $account, ['status' => 'cancelled', 'fulfilment' => 'delivery', 'estimated_total' => '75.00', 'cancelled_by' => 'customer', 'cancel_reason' => 'Changed my mind', 'cancelled_at' => now()]);

        $this->actingAsUser($owner)->getJson($this->tenantUrl($tenant, 'online-orders?status=completed&date_from=2026-10-01&date_to=2026-10-17&per_page=1'))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('total', 2)
            ->assertJsonPath('summary.orders', 2)
            ->assertJsonPath('summary.value', '150.00')
            ->assertJsonPath('summary.delivery', 1)
            ->assertJsonPath('summary.pickup', 1)
            ->assertJsonPath('summary.average_minutes', 40);

        $this->getJson($this->tenantUrl($tenant, 'online-orders?status=cancelled&fulfilment=delivery'))
            ->assertOk()
            ->assertJsonPath('summary.cancelled_by_customer', 1)
            ->assertJsonPath('summary.top_cancel_reason', 'Changed my mind');

        $this->getJson($this->tenantUrl($tenant, 'online-orders?status=completed&q=ONL-2'))->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_cashiers_can_see_the_online_order_queue(): void
    {
        [$tenant] = $this->createTenant();
        $cashier = $this->addMember($tenant, 'cashier');

        $this->actingAsUser($cashier)->getJson($this->tenantUrl($tenant, 'online-orders?open=1'))->assertOk()->assertJsonPath('summary.orders', 0);
    }
}
