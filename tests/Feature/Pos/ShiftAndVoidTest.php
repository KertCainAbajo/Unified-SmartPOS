<?php

namespace Tests\Feature\Pos;

use App\Models\Inventory;
use Tests\TestCase;

class ShiftAndVoidTest extends TestCase
{
    use PosTestHelpers;

    public function test_shift_close_computes_expected_cash_and_difference(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $product = $this->createProduct($tenant, ['price' => '150.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $session = $this->openShift($tenant, $cashier, $register, '500.00');

        $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '200']])->assertCreated();
        $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'card', 'amount' => '150']])->assertCreated();

        // Cannot open a second shift on the same register.
        $this->postJson($this->tenantUrl($tenant, 'register-sessions'), ['register_id' => $register->id, 'opening_float' => 0])
            ->assertUnprocessable()->assertJsonPath('code', 'REGISTER_ALREADY_OPEN');

        $response = $this->postJson($this->tenantUrl($tenant, "register-sessions/{$session->id}/close"), ['counted_cash' => '640.00'])
            ->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.expected_cash', '650.00')
            ->assertJsonPath('data.cash_difference', '-10.00')
            ->assertJsonPath('data.summary.sales_count', 2)
            ->assertJsonPath('data.summary.gross_sales', '300.00');

        $methods = collect($response->json('data.summary.payments_by_method'))->keyBy('method');
        $this->assertSame('150.00', $methods['cash']['amount']);
        $this->assertSame('150.00', $methods['card']['amount']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'shift.closed', 'auditable_id' => $session->id]);

        // Closed shift blocks further sales.
        $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '150']])
            ->assertUnprocessable()->assertJsonPath('code', 'REGISTER_NOT_OPEN');
    }

    public function test_void_restores_stock_and_cash_and_requires_permission(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $manager = $this->addMember($tenant, 'branch_manager', [$branch]);
        $product = $this->createProduct($tenant, ['price' => '100.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $session = $this->openShift($tenant, $cashier, $register);

        $saleId = $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 3]], [['method' => 'cash', 'amount' => '300']])
            ->assertCreated()->json('data.id');

        $this->postJson($this->tenantUrl($tenant, "sales/{$saleId}/void"), ['reason' => 'Wrong item'])->assertForbidden();

        $this->actingAsUser($manager)->postJson($this->tenantUrl($tenant, "sales/{$saleId}/void"), ['reason' => 'Wrong item'])
            ->assertOk()
            ->assertJsonPath('data.status', 'voided')
            ->assertJsonPath('data.payment_status', 'voided')
            ->assertJsonPath('data.payments.0.status', 'voided');

        $this->assertSame('10.000', Inventory::query()->value('quantity'));
        $this->assertSame('0.00', $session->fresh()->cash_sales);
        $this->assertDatabaseHas('stock_movements', ['type' => 'sale_void', 'quantity_change' => '3.000']);
        $this->assertDatabaseHas('sales', ['id' => $saleId]); // never deleted
        $this->assertDatabaseHas('audit_logs', ['action' => 'sale.voided', 'auditable_id' => $saleId, 'user_id' => $manager->id]);

        $this->postJson($this->tenantUrl($tenant, "sales/{$saleId}/void"), ['reason' => 'Again'])
            ->assertUnprocessable()->assertJsonPath('code', 'SALE_NOT_VOIDABLE');
    }

    public function test_void_not_allowed_after_shift_closed(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['price' => '100.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $session = $this->openShift($tenant, $owner, $register);
        $saleId = $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '100']])->json('data.id');
        $this->postJson($this->tenantUrl($tenant, "register-sessions/{$session->id}/close"), ['counted_cash' => '1100'])->assertOk();

        $this->postJson($this->tenantUrl($tenant, "sales/{$saleId}/void"), ['reason' => 'Late'])
            ->assertUnprocessable()->assertJsonPath('code', 'SHIFT_CLOSED');
    }

    public function test_receipt_endpoint_returns_printable_data(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $tenant->forceFill(['tin' => '123-456-789-000'])->save();
        $product = $this->createProduct($tenant, ['price' => '56.00']);
        $this->setStock($product, $branch, '10');
        $register = $this->mainRegister($branch);
        $this->openShift($tenant, $owner, $register);
        $saleId = $this->checkout($tenant, $register, [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '100']])->json('data.id');

        $this->getJson($this->tenantUrl($tenant, "sales/{$saleId}/receipt"))
            ->assertOk()
            ->assertJsonPath('data.header.tin', '123-456-789-000')
            ->assertJsonPath('data.header.vat_status', 'VAT Reg.')
            ->assertJsonPath('data.reprint', true)
            ->assertJsonPath('data.totals.vat_amount', '6.00')
            ->assertJsonPath('data.change', '44.00');
    }
}
