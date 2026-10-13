<?php

namespace Tests\Feature\Pos;

use App\Models\Inventory;
use App\Models\Product;
use App\Models\Refund;
use App\Models\RegisterSession;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use Tests\TestCase;

class RefundTest extends TestCase
{
    use PosTestHelpers;

    /** @return array{0: Tenant, 1: User, 2: User, 3: Sale, 4: Product, 5: RegisterSession} */
    private function saleSetup(string $threshold = '500.00'): array
    {
        [$tenant, , $branch] = $this->createTenant(['refund_approval_threshold' => $threshold]);
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $manager = $this->addMember($tenant, 'branch_manager', [$branch]);
        $product = $this->createProduct($tenant, ['price' => '100.00']);
        $this->setStock($product, $branch, '20', '60.0000');
        $register = $this->mainRegister($branch);
        $session = $this->openShift($tenant, $cashier, $register);

        $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 10]], [['method' => 'cash', 'amount' => '1000']])->assertCreated();

        return [$tenant, $cashier, $manager, Sale::query()->firstOrFail(), $product, $session];
    }

    public function test_cashier_completes_small_refund_and_stock_is_restored(): void
    {
        [$tenant, $cashier, , $sale, $product, $session] = $this->saleSetup();
        $item = $sale->items()->first();

        $this->actingAsUser($cashier)->postJson($this->tenantUrl($tenant, 'refunds'), [
            'sale_id' => $sale->id,
            'reason' => 'Damaged packaging',
            'register_session_id' => $session->id,
            'items' => [['sale_item_id' => $item->id, 'quantity' => 2]],
        ])->assertCreated()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.total', '200.00')
            ->assertJsonPath('data.vat_amount', '21.43');

        $sale->refresh();
        $this->assertSame('200.00', $sale->refunded_total);
        $this->assertSame('partially_refunded', $sale->payment_status->value);
        $this->assertSame('2.000', $item->fresh()->quantity_refunded);
        $this->assertSame('12.000', Inventory::query()->where('product_id', $product->id)->value('quantity'));
        $this->assertSame('200.00', $session->fresh()->cash_refunds);
        $this->assertDatabaseHas('stock_movements', ['type' => 'refund', 'quantity_change' => '2.000']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'refund.completed']);
    }

    public function test_cashier_cannot_approve_restricted_refund_but_manager_can(): void
    {
        [$tenant, $cashier, $manager, $sale] = $this->saleSetup('500.00');
        $item = $sale->items()->first();

        $refundId = $this->actingAsUser($cashier)->postJson($this->tenantUrl($tenant, 'refunds'), [
            'sale_id' => $sale->id, 'reason' => 'Customer changed mind',
            'items' => [['sale_item_id' => $item->id, 'quantity' => 6]],
        ])->assertCreated()
            ->assertJsonPath('data.status', 'pending_approval')
            ->assertJsonPath('data.total', '600.00')
            ->json('data.id');

        // Nothing applied while pending.
        $this->assertSame('0.00', $sale->fresh()->refunded_total);
        $this->assertSame('10.000', Inventory::query()->value('quantity'));

        // The approver is notified.
        $this->assertDatabaseHas('notifications', ['user_id' => $manager->id, 'type' => 'refund_pending_approval']);

        // Cashier lacks refunds.approve.
        $this->postJson($this->tenantUrl($tenant, "refunds/{$refundId}/approve"))->assertForbidden();
        $this->assertSame('pending_approval', Refund::query()->find($refundId)->status->value);

        $this->actingAsUser($manager)->postJson($this->tenantUrl($tenant, "refunds/{$refundId}/approve"))
            ->assertOk()->assertJsonPath('data.status', 'completed')->assertJsonPath('data.approved_by', $manager->id);

        $this->assertSame('600.00', $sale->fresh()->refunded_total);
        $this->assertSame('16.000', Inventory::query()->value('quantity'));
        $this->postJson($this->tenantUrl($tenant, "refunds/{$refundId}/approve"))->assertUnprocessable();
    }

    public function test_pending_refunds_reserve_quantity_and_rejection_releases_it(): void
    {
        [$tenant, $cashier, $manager, $sale] = $this->saleSetup('0.00');
        $item = $sale->items()->first();
        $this->actingAsUser($cashier);

        $first = $this->postJson($this->tenantUrl($tenant, 'refunds'), [
            'sale_id' => $sale->id, 'reason' => 'x', 'items' => [['sale_item_id' => $item->id, 'quantity' => 8]],
        ])->assertCreated()->assertJsonPath('data.status', 'pending_approval')->json('data.id');

        $this->postJson($this->tenantUrl($tenant, 'refunds'), [
            'sale_id' => $sale->id, 'reason' => 'x', 'items' => [['sale_item_id' => $item->id, 'quantity' => 3]],
        ])->assertUnprocessable()->assertJsonPath('code', 'REFUND_EXCEEDS_SOLD');

        $this->actingAsUser($manager)->postJson($this->tenantUrl($tenant, "refunds/{$first}/reject"), ['reason' => 'No receipt'])
            ->assertOk()->assertJsonPath('data.status', 'rejected');

        $this->actingAsUser($cashier)->postJson($this->tenantUrl($tenant, 'refunds'), [
            'sale_id' => $sale->id, 'reason' => 'x', 'items' => [['sale_item_id' => $item->id, 'quantity' => 3]],
        ])->assertCreated();
    }

    public function test_full_refund_amounts_sum_exactly_to_sale_total(): void
    {
        [$tenant, , $manager, $sale] = $this->saleSetup();
        $item = $sale->items()->first();
        $this->actingAsUser($manager);

        foreach ([3, 3, 4] as $qty) {
            $this->postJson($this->tenantUrl($tenant, 'refunds'), [
                'sale_id' => $sale->id, 'reason' => 'Recall', 'items' => [['sale_item_id' => $item->id, 'quantity' => $qty, 'restock' => false]],
            ])->assertCreated()->assertJsonPath('data.status', 'completed');
        }

        $sale->refresh();
        $this->assertSame('1000.00', $sale->refunded_total);
        $this->assertSame('refunded', $sale->payment_status->value);
        $this->assertSame('107.14', number_format((float) Refund::query()->sum('vat_amount'), 2, '.', ''));
        $this->assertSame('10.000', Inventory::query()->value('quantity')); // not restocked

        $this->postJson($this->tenantUrl($tenant, 'refunds'), [
            'sale_id' => $sale->id, 'reason' => 'Again', 'items' => [['sale_item_id' => $item->id, 'quantity' => 1]],
        ])->assertUnprocessable()->assertJsonPath('code', 'REFUND_EXCEEDS_SOLD');
    }

    public function test_refund_of_voided_sale_or_other_tenant_sale_is_rejected(): void
    {
        [$tenant, , $manager, $sale] = $this->saleSetup();
        [$otherTenant, $otherOwner] = $this->createTenant();
        $item = $sale->items()->first();

        $this->actingAsUser($otherOwner)->postJson($this->tenantUrl($otherTenant, 'refunds'), [
            'sale_id' => $sale->id, 'reason' => 'x', 'items' => [['sale_item_id' => $item->id, 'quantity' => 1]],
        ])->assertUnprocessable()->assertJsonValidationErrors('sale_id');

        $this->actingAsUser($manager)->postJson($this->tenantUrl($tenant, "sales/{$sale->id}/void"), ['reason' => 'Error'])->assertOk();
        $this->postJson($this->tenantUrl($tenant, 'refunds'), [
            'sale_id' => $sale->id, 'reason' => 'x', 'items' => [['sale_item_id' => $item->id, 'quantity' => 1]],
        ])->assertUnprocessable()->assertJsonPath('code', 'SALE_NOT_REFUNDABLE');
    }

    public function test_inventory_staff_cannot_create_refunds(): void
    {
        [$tenant, , , $sale] = $this->saleSetup();
        $staff = $this->addMember($tenant, 'inventory_staff');

        $this->actingAsUser($staff)->postJson($this->tenantUrl($tenant, 'refunds'), [
            'sale_id' => $sale->id, 'reason' => 'x', 'items' => [['sale_item_id' => $sale->items()->value('id'), 'quantity' => 1]],
        ])->assertForbidden();
    }
}
