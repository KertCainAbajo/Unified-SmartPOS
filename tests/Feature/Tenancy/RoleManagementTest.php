<?php

namespace Tests\Feature\Tenancy;

use App\Models\Permission;
use App\Models\Role;
use App\Support\Permissions;
use Tests\TestCase;

class RoleManagementTest extends TestCase
{
    public function test_branch_manager_cannot_change_another_users_roles_without_permission(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $manager = $this->addMember($tenant, 'branch_manager', [$branch]);
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $cashierMembership = $tenant->memberships()->where('user_id', $cashier->id)->first();

        // Branch managers do not hold staff.assign_roles unless the owner grants it.
        $this->actingAsUser($manager)
            ->postJson($this->tenantUrl($tenant, "staff/{$cashierMembership->id}/change-role"), ['role_ids' => [Role::system('branch_manager')->id]])
            ->assertForbidden();

        $this->actingAsUser($cashier)
            ->postJson($this->tenantUrl($tenant, "staff/{$cashierMembership->id}/change-role"), ['role_ids' => [Role::system('business_owner')->id]])
            ->assertForbidden();

        $this->assertSame(['cashier'], $cashierMembership->roles()->pluck('key')->all());
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.unauthorized_attempt', 'user_id' => $manager->id]);
    }

    public function test_nobody_can_modify_their_own_or_the_owners_membership(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $ownerMembership = $tenant->memberships()->where('user_id', $owner->id)->first();

        $this->actingAsUser($owner)
            ->postJson($this->tenantUrl($tenant, "staff/{$ownerMembership->id}/suspend"), ['reason' => 'x'])
            ->assertForbidden();
    }

    public function test_custom_role_cannot_grant_permissions_the_creator_lacks(): void
    {
        [$tenant] = $this->createTenant();
        // A manager given roles.manage via a custom role still cannot grant tenant.manage.
        $manager = $this->addMember($tenant, 'branch_manager');
        $custom = Role::query()->create(['tenant_id' => $tenant->id, 'key' => 'role_admin', 'name' => 'Role admin']);
        $custom->permissions()->attach(Permission::query()->whereIn('key', ['roles.manage', 'staff.assign_roles'])->pluck('id'));
        $tenant->memberships()->where('user_id', $manager->id)->first()->roles()->attach($custom->id);

        $this->actingAsUser($manager)->postJson($this->tenantUrl($tenant, 'roles'), [
            'key' => 'super', 'name' => 'Super', 'permissions' => ['tenant.manage'],
        ])->assertForbidden()->assertJsonPath('code', 'ROLE_ESCALATION');

        // And cannot assign the Business Owner role.
        $cashier = $this->addMember($tenant, 'cashier');
        $this->actingAsUser($manager)->postJson(
            $this->tenantUrl($tenant, 'staff/'.$tenant->memberships()->where('user_id', $cashier->id)->value('id').'/change-role'),
            ['role_ids' => [Role::system('business_owner')->id]],
        )->assertForbidden();

        // Allowed: a role made only of permissions the manager holds.
        $this->actingAsUser($manager)->postJson($this->tenantUrl($tenant, 'roles'), [
            'key' => 'shift_lead', 'name' => 'Shift lead', 'permissions' => ['sales.create', 'sales.view_all'],
        ])->assertCreated()->assertJsonPath('data.permissions', ['sales.create', 'sales.view_all']);
    }

    public function test_system_roles_are_read_only_and_foreign_roles_unreachable(): void
    {
        [$tenantA, $ownerA] = $this->createTenant();
        [$tenantB] = $this->createTenant();
        $foreign = Role::query()->create(['tenant_id' => $tenantB->id, 'key' => 'x', 'name' => 'X']);

        $this->actingAsUser($ownerA);
        $this->patchJson($this->tenantUrl($tenantA, 'roles/'.Role::system('cashier')->id), ['name' => 'Hacked'])->assertNotFound();
        $this->patchJson($this->tenantUrl($tenantA, 'roles/'.$foreign->id), ['name' => 'Hacked'])->assertNotFound();
    }

    public function test_context_endpoint_reports_permissions_and_branches(): void
    {
        [$tenant, , $main] = $this->createTenant();
        $this->createBranch($tenant, 'B2');
        $cashier = $this->addMember($tenant, 'cashier', [$main]);

        $response = $this->actingAsUser($cashier)->getJson($this->tenantUrl($tenant, 'context'))->assertOk();

        $this->assertContains('sales.create', $response->json('permissions'));
        $this->assertNotContains('refunds.approve', $response->json('permissions'));
        $this->assertSame([$main->id], array_column($response->json('branches'), 'id'));
    }

    public function test_seeded_roles_have_expected_boundaries(): void
    {
        $perms = fn (string $key) => Role::system($key)->permissions()->pluck('key')->all();

        $uam = $perms('user_access_manager');
        $this->assertContains('staff.create', $uam);
        foreach (['sales.create', 'sales.view_all', 'refunds.create', 'inventory.adjust', 'reports.financial', 'reports.view', 'tenant.manage', 'audit_logs.view'] as $forbidden) {
            $this->assertNotContains($forbidden, $uam, "UAM must not hold {$forbidden}");
        }

        $this->assertSame([], array_diff($perms('auditor'), Permissions::readOnly()), 'Auditor must be read-only');
        // Branch managers add and manage their branches' staff, but cannot change business settings or roles.
        $this->assertContains('staff.create', $perms('branch_manager'));
        $this->assertContains('staff.credentials', $perms('branch_manager'));
        foreach (['tenant.manage', 'branches.manage', 'roles.manage'] as $forbidden) {
            $this->assertNotContains($forbidden, $perms('branch_manager'));
        }
        $this->assertDatabaseMissing('permissions', ['key' => 'members.manage']);
    }
}
