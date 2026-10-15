<?php

namespace Tests\Feature\Tenancy;

use Tests\TestCase;

/** Owners and branch managers add branches; managers stay limited to their own branches. */
class BranchManagementTest extends TestCase
{
    public function test_manager_adds_a_branch_and_gets_access_to_it(): void
    {
        [$tenant, , $main] = $this->createTenant();
        $makati = $this->createBranch($tenant, 'MKT');
        $manager = $this->addMember($tenant, 'branch_manager', [$main]);

        $id = $this->actingAsUser($manager)->postJson($this->tenantUrl($tenant, 'branches'), ['code' => 'pasig', 'name' => 'Pasig Branch'])
            ->assertCreated()->assertJsonPath('data.code', 'PASIG')->json('data.id');

        // The new branch is now one of the manager's branches; other branches stay out of reach.
        $this->app['auth']->forgetGuards();
        $branches = $this->actingAsUser($manager)->getJson($this->tenantUrl($tenant, 'context'))->assertOk()->json('branches');
        $this->assertEqualsCanonicalizing([$main->id, $id], array_column($branches, 'id'));
        $this->patchJson($this->tenantUrl($tenant, "branches/{$id}"), ['phone' => '02-8123-4567'])->assertOk();
        $this->patchJson($this->tenantUrl($tenant, "branches/{$makati->id}"), ['name' => 'Renamed'])->assertForbidden();
        $this->assertDatabaseHas('audit_logs', ['action' => 'branch.created', 'user_id' => $manager->id]);
    }

    public function test_owner_adds_branches_and_sees_them_all(): void
    {
        [$tenant, $owner] = $this->createTenant();

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'branches'), ['code' => 'MKT', 'name' => 'Makati'])->assertCreated();
        $this->assertCount(2, $this->getJson($this->tenantUrl($tenant, 'branches'))->json('data'));
    }

    public function test_owner_only_features_are_refused_to_managers(): void
    {
        [$tenant, , $main] = $this->createTenant();
        $manager = $this->addMember($tenant, 'branch_manager', [$main]);
        $this->actingAsUser($manager);

        $this->patchJson($this->tenantUrl($tenant), ['name' => 'Taken over'])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, 'roles'), ['name' => 'Custom', 'permissions' => ['sales.view']])->assertForbidden();
        $this->getJson($this->tenantUrl($tenant, 'reports/profit'))->assertForbidden();
        $this->getJson($this->tenantUrl($tenant, 'audit-logs'))->assertForbidden();
        // Still runs the branch: sales reports and staff.
        $this->getJson($this->tenantUrl($tenant, 'reports/sales-summary'))->assertOk();
        $this->getJson($this->tenantUrl($tenant, 'staff'))->assertOk();
    }

    public function test_cashiers_cannot_add_branches(): void
    {
        [$tenant, , $main] = $this->createTenant();
        $this->actingAsUser($this->addMember($tenant, 'cashier', [$main]))
            ->postJson($this->tenantUrl($tenant, 'branches'), ['code' => 'X1', 'name' => 'X'])->assertForbidden();
    }
}
