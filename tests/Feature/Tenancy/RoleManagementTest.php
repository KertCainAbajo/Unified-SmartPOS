<?php

namespace Tests\Feature\Tenancy;

use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class RoleManagementTest extends TestCase
{
    public function test_owner_can_add_member_and_new_user_receives_password_setup_link(): void
    {
        Notification::fake();
        [$tenant, $owner, $branch] = $this->createTenant();

        $response = $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'members'), [
            'email' => 'New.Cashier@example.com',
            'name' => 'New Cashier',
            'role_ids' => [Role::system('cashier')->id],
            'branch_ids' => [$branch->id],
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.user.email', 'new.cashier@example.com')
            ->assertJsonPath('data.roles.0.key', 'cashier')
            ->assertJsonPath('data.branches.0.id', $branch->id);

        Notification::assertSentTo(User::query()->where('email', 'new.cashier@example.com')->first(), ResetPassword::class);
        $this->assertDatabaseHas('audit_logs', ['action' => 'member.added', 'tenant_id' => $tenant->id]);
    }

    public function test_user_cannot_change_another_users_roles_without_permission(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $manager = $this->addMember($tenant, 'branch_manager', [$branch]);
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $cashierMembership = $tenant->memberships()->where('user_id', $cashier->id)->first();

        // Branch managers lack members.manage.
        $this->actingAsUser($manager)
            ->patchJson($this->tenantUrl($tenant, 'members/'.$cashierMembership->id), ['role_ids' => [Role::system('branch_manager')->id]])
            ->assertForbidden();

        // Cashiers obviously too.
        $this->actingAsUser($cashier)
            ->patchJson($this->tenantUrl($tenant, 'members/'.$cashierMembership->id), ['role_ids' => [Role::system('business_owner')->id]])
            ->assertForbidden();

        $this->assertSame(['cashier'], $cashierMembership->roles()->pluck('key')->all());
    }

    public function test_nobody_can_modify_their_own_or_the_owners_membership(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $ownerMembership = $tenant->memberships()->where('user_id', $owner->id)->first();

        $this->actingAsUser($owner)
            ->patchJson($this->tenantUrl($tenant, 'members/'.$ownerMembership->id), ['status' => 'suspended'])
            ->assertForbidden();
    }

    public function test_custom_role_cannot_grant_permissions_the_creator_lacks(): void
    {
        [$tenant, $owner] = $this->createTenant();
        // A manager given roles.manage via a custom role still cannot grant tenant.manage.
        $manager = $this->addMember($tenant, 'branch_manager');
        $custom = Role::query()->create(['tenant_id' => $tenant->id, 'key' => 'role_admin', 'name' => 'Role admin']);
        $custom->permissions()->attach(Permission::query()->whereIn('key', ['roles.manage', 'members.manage'])->pluck('id'));
        $tenant->memberships()->where('user_id', $manager->id)->first()->roles()->attach($custom->id);

        $this->actingAsUser($manager)->postJson($this->tenantUrl($tenant, 'roles'), [
            'key' => 'super', 'name' => 'Super', 'permissions' => ['tenant.manage'],
        ])->assertForbidden()->assertJsonPath('code', 'ROLE_ESCALATION');

        // And cannot assign the Business Owner role.
        $cashier = $this->addMember($tenant, 'cashier');
        $this->actingAsUser($manager)->patchJson(
            $this->tenantUrl($tenant, 'members/'.$tenant->memberships()->where('user_id', $cashier->id)->value('id')),
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
}
