<?php

namespace Tests\Feature\Tenancy;

use App\Models\User;
use Tests\TestCase;

class TenantIsolationTest extends TestCase
{
    public function test_user_cannot_access_an_unrelated_business(): void
    {
        [$tenantA, $ownerA] = $this->createTenant();
        [$tenantB] = $this->createTenant();

        $this->actingAsUser($ownerA);
        $this->getJson($this->tenantUrl($tenantA))->assertOk();
        $this->getJson($this->tenantUrl($tenantB))->assertNotFound();
        $this->getJson($this->tenantUrl($tenantB, 'branches'))->assertNotFound();
        $this->patchJson($this->tenantUrl($tenantB), ['name' => 'Hacked'])->assertNotFound();

        $this->assertNotSame('Hacked', $tenantB->fresh()->name);
    }

    public function test_child_resources_of_another_business_are_not_reachable_through_own_tenant(): void
    {
        [$tenantA, $ownerA] = $this->createTenant();
        [$tenantB] = $this->createTenant();
        $branchB = $tenantB->branches()->first();

        // Own tenant in the URL, foreign branch id: scoped binding must return 404.
        $this->actingAsUser($ownerA)
            ->getJson($this->tenantUrl($tenantA, 'branches/'.$branchB->id))
            ->assertNotFound()
            ->assertJsonPath('message', 'Resource not found.');
    }

    public function test_suspended_membership_loses_access(): void
    {
        [$tenant] = $this->createTenant();
        $cashier = $this->addMember($tenant, 'cashier');
        $tenant->memberships()->where('user_id', $cashier->id)->update(['status' => 'suspended']);

        $this->actingAsUser($cashier)->getJson($this->tenantUrl($tenant))->assertNotFound();
    }

    public function test_suspended_business_is_blocked(): void
    {
        [$tenant, $owner] = $this->createTenant(['status' => 'suspended']);

        $this->actingAsUser($owner)->getJson($this->tenantUrl($tenant))
            ->assertForbidden()->assertJsonPath('code', 'TENANT_SUSPENDED');
    }

    public function test_platform_admin_gets_no_implicit_access_to_business_data(): void
    {
        [$tenant] = $this->createTenant();
        $admin = User::factory()->create();
        $admin->forceFill(['is_platform_admin' => true])->save();

        $this->actingAsUser($admin);
        $this->getJson($this->tenantUrl($tenant))->assertNotFound();
        $this->getJson($this->tenantUrl($tenant, 'branches'))->assertNotFound();

        // Platform directory only exposes non-sensitive metadata.
        $list = $this->getJson('/api/v1/platform/tenants')->assertOk()
            ->assertJsonPath('summary.total', 1)->assertJsonPath('summary.active', 1)->assertJsonPath('summary.suspended', 0);
        $row = $list->json('data.0');
        $this->assertSame(['id', 'name', 'slug', 'status', 'owner', 'branches_count', 'members_count', 'created_at'], array_keys($row));
        $this->assertSame(['name', 'email'], array_keys($row['owner']));
    }

    public function test_platform_routes_require_platform_admin(): void
    {
        [$tenant, $owner] = $this->createTenant();

        $this->actingAsUser($owner)->getJson('/api/v1/platform/tenants')->assertForbidden();
        $this->patchJson('/api/v1/platform/tenants/'.$tenant->id.'/status', ['status' => 'suspended', 'reason' => 'x'])
            ->assertForbidden();
    }

    public function test_platform_admin_can_suspend_a_business_with_audit(): void
    {
        [$tenant] = $this->createTenant();
        $admin = User::factory()->create();
        $admin->forceFill(['is_platform_admin' => true])->save();

        $this->actingAsUser($admin)
            ->patchJson('/api/v1/platform/tenants/'.$tenant->id.'/status', ['status' => 'suspended', 'reason' => 'Unpaid'])
            ->assertOk();

        $this->assertSame('suspended', $tenant->fresh()->status);
        $this->assertDatabaseHas('audit_logs', ['action' => 'platform.tenant_status_changed', 'tenant_id' => $tenant->id, 'user_id' => $admin->id]);
    }
}
