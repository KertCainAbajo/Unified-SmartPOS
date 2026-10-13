<?php

namespace Tests\Feature\Operations;

use App\Models\AppNotification;
use App\Models\AuditLog;
use Tests\Feature\Pos\PosTestHelpers;
use Tests\TestCase;

class OperationsTest extends TestCase
{
    use PosTestHelpers;

    public function test_customers_crud_and_cashier_permissions(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $staff = $this->addMember($tenant, 'inventory_staff', [$branch]);

        $id = $this->actingAsUser($cashier)->postJson($this->tenantUrl($tenant, 'customers'), ['name' => 'Ana Santos', 'phone' => '09171234567'])
            ->assertCreated()->json('data.id');
        $this->getJson($this->tenantUrl($tenant, 'customers?q=0917'))->assertJsonCount(1, 'data');
        $this->patchJson($this->tenantUrl($tenant, "customers/{$id}"), ['email' => 'ana@example.com'])->assertOk();

        $this->actingAsUser($staff)->getJson($this->tenantUrl($tenant, 'customers'))->assertForbidden();
    }

    public function test_expenses_record_soft_delete_and_branch_rules(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $b2 = $this->createBranch($tenant, 'B2');
        $manager = $this->addMember($tenant, 'branch_manager', [$main]);
        $category = $tenant->expenseCategories()->first();

        $this->actingAsUser($manager);
        $id = $this->postJson($this->tenantUrl($tenant, 'expenses'), [
            'branch_id' => $main->id, 'expense_category_id' => $category->id, 'amount' => '1500.50', 'expense_date' => '2026-10-01', 'description' => 'Electric bill',
        ])->assertCreated()->assertJsonPath('data.amount', '1500.50')->json('data.id');

        $this->postJson($this->tenantUrl($tenant, 'expenses'), [
            'branch_id' => $b2->id, 'expense_category_id' => $category->id, 'amount' => '1', 'expense_date' => '2026-10-01', 'description' => 'x',
        ])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, 'expenses'), [
            'expense_category_id' => $category->id, 'amount' => '1', 'expense_date' => '2026-10-01', 'description' => 'business-wide',
        ])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, 'expenses'), [
            'branch_id' => $main->id, 'expense_category_id' => $category->id, 'amount' => '0', 'expense_date' => '2026-10-01', 'description' => 'x',
        ])->assertUnprocessable();

        $this->deleteJson($this->tenantUrl($tenant, "expenses/{$id}"))->assertNoContent();
        $this->assertSoftDeleted('expenses', ['id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'expense.deleted', 'auditable_id' => $id]);
    }

    public function test_audit_log_endpoint_requires_permission_and_filters(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['price' => '10.00']);
        $this->setStock($product, $branch, '10');
        $this->openShift($tenant, $owner, $this->registerFor($branch));
        $this->checkout($tenant, $this->registerFor($branch), [['product_id' => $product->id, 'quantity' => 1]], [['method' => 'cash', 'amount' => '10']])->assertCreated();

        $logs = $this->getJson($this->tenantUrl($tenant, 'audit-logs?action=sale.*'))->assertOk()->json('data');
        $this->assertSame(['sale.completed'], array_column($logs, 'action'));

        $this->actingAsUser($this->addMember($tenant, 'cashier'))->getJson($this->tenantUrl($tenant, 'audit-logs'))->assertForbidden();

        // Audit entries never contain credentials.
        $this->assertSame(0, AuditLog::query()->where('new_values', 'like', '%password%')->count());
    }

    public function test_audit_logs_of_other_tenants_are_invisible(): void
    {
        [$tenantA, $ownerA] = $this->createTenant();
        [$tenantB, $ownerB] = $this->createTenant();
        $this->actingAsUser($ownerB)->postJson($this->tenantUrl($tenantB, 'categories'), ['name' => 'Secret'])->assertCreated();

        $actions = array_column($this->actingAsUser($ownerA)->getJson($this->tenantUrl($tenantA, 'audit-logs'))->json('data'), 'action');
        $this->assertNotContains('category.created', $actions);
    }

    public function test_notifications_are_private_to_their_user(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $manager = $this->addMember($tenant, 'branch_manager');
        $product = $this->createProduct($tenant, ['reorder_level' => '5']);
        $this->setStock($product, $branch, '6');
        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), [
            'branch_id' => $branch->id, 'reason' => 'damaged', 'items' => [['product_id' => $product->id, 'quantity_change' => -2]],
        ])->assertCreated();

        $ownerNotification = AppNotification::query()->where('user_id', $owner->id)->firstOrFail();

        $this->actingAsUser($manager)->postJson($this->tenantUrl($tenant, "notifications/{$ownerNotification->id}/read"))->assertNotFound();
        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, "notifications/{$ownerNotification->id}/read"))->assertOk();
        $this->postJson($this->tenantUrl($tenant, 'notifications/read-all'))->assertOk();
    }
}
