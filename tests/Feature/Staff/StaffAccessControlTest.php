<?php

namespace Tests\Feature\Staff;

use App\Models\Permission;
use App\Models\Role;
use Tests\TestCase;

class StaffAccessControlTest extends TestCase
{
    use StaffTestHelpers;

    public function test_owner_cannot_see_or_manage_another_companys_staff(): void
    {
        [$tenantA, $ownerA] = $this->createTenant();
        [$tenantB, $ownerB, $branchB] = $this->createTenant();
        $foreign = $this->createStaff($tenantB, $ownerB, 'cashier', [$branchB])->assertCreated()->json('data.id');

        $this->actingAsUser($ownerA);
        // Through own tenant URL: scoped binding hides the foreign membership.
        $this->getJson($this->tenantUrl($tenantA, "staff/{$foreign}"))->assertNotFound();
        $this->postJson($this->tenantUrl($tenantA, "staff/{$foreign}/suspend"), ['reason' => 'x'])->assertNotFound();
        $this->postJson($this->tenantUrl($tenantA, "staff/{$foreign}/offboard"), ['reason' => 'x'])->assertNotFound();
        // Through the other tenant's URL: not a member.
        $this->getJson($this->tenantUrl($tenantB, 'staff'))->assertNotFound();
        $this->postJson($this->tenantUrl($tenantB, 'staff'), ['name' => 'X', 'role_ids' => [1], 'branch_ids' => [$branchB->id], 'delivery' => 'manual'])->assertNotFound();
        // Listing own staff never includes theirs.
        $ids = array_column($this->getJson($this->tenantUrl($tenantA, 'staff'))->assertOk()->json('data'), 'id');
        $this->assertNotContains($foreign, $ids);
        // Cannot assign a branch of another company.
        $this->createStaff($tenantA, $ownerA, 'cashier', [$branchB])->assertUnprocessable()->assertJsonPath('code', 'INVALID_BRANCH');
    }

    public function test_user_access_manager_manages_operational_staff_only(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $uam = $this->addMember($tenant, 'user_access_manager');

        // Can create and manage a cashier.
        $cashierId = $this->createStaff($tenant, $uam, 'cashier', [$branch], ['email' => 'cashier1@example.com'])->assertCreated()->json('data.id');
        $this->postJson($this->tenantUrl($tenant, "staff/{$cashierId}/change-role"), ['role_ids' => [Role::system('branch_manager')->id]])->assertOk();
        $this->postJson($this->tenantUrl($tenant, "staff/{$cashierId}/suspend"), ['reason' => 'Investigation'])->assertOk();

        // Cannot create another User & Access Manager or grant Business Owner.
        $this->createStaff($tenant, $uam, 'user_access_manager', [$branch])->assertForbidden();
        $this->createStaff($tenant, $uam, 'business_owner', [$branch])->assertForbidden();
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.unauthorized_attempt', 'user_id' => $uam->id]);

        // Cannot change own role or the owner's.
        $own = $this->membershipOf($tenant, $uam)->id;
        $this->postJson($this->tenantUrl($tenant, "staff/{$own}/change-role"), ['role_ids' => [Role::system('business_owner')->id]])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, "staff/{$own}/transfer-branches"), ['all_branches' => true])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, 'staff/'.$this->membershipOf($tenant, $owner)->id.'/suspend'), ['reason' => 'x'])->assertForbidden();

        // Cannot modify another administrator (owner-only).
        $otherUam = $this->addMember($tenant, 'user_access_manager');
        $this->postJson($this->tenantUrl($tenant, 'staff/'.$this->membershipOf($tenant, $otherUam)->id.'/offboard'), ['reason' => 'x'])->assertForbidden();

        // No business data access.
        foreach (['sales', 'reports/sales-summary', 'reports/profit', 'payments', 'inventory', 'audit-logs', 'expenses'] as $path) {
            $this->getJson($this->tenantUrl($tenant, $path))->assertForbidden();
        }
        $this->postJson($this->tenantUrl($tenant, 'inventory/adjustments'), ['branch_id' => $branch->id, 'reason' => 'found', 'items' => []])->assertForbidden();
        $this->patchJson($this->tenantUrl($tenant), ['name' => 'Hacked'])->assertForbidden();

        // Account-related audit trail only.
        $this->getJson($this->tenantUrl($tenant, 'staff/audit-log'))->assertOk();
    }

    public function test_branch_manager_needs_explicit_grant_and_is_limited_to_own_branches(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $makati = $this->createBranch($tenant, 'MKT');
        $manager = $this->addMember($tenant, 'branch_manager', [$main]);
        $mainCashier = $this->createStaff($tenant, $owner, 'cashier', [$main])->assertCreated()->json('data.id');
        $makatiCashier = $this->createStaff($tenant, $owner, 'cashier', [$makati])->assertCreated()->json('data.id');

        // Default branch manager: can view staff of own branch only, cannot manage.
        $list = array_column($this->actingAsUser($manager)->getJson($this->tenantUrl($tenant, 'staff'))->assertOk()->json('data'), 'id');
        $this->assertContains($mainCashier, $list);
        $this->assertNotContains($makatiCashier, $list);
        $this->getJson($this->tenantUrl($tenant, "staff/{$makatiCashier}"))->assertForbidden();
        $this->createStaff($tenant, $manager, 'cashier', [$main])->assertForbidden();

        // Owner grants branch staff administration via a custom role.
        $custom = Role::query()->create(['tenant_id' => $tenant->id, 'key' => 'branch_staff_admin', 'name' => 'Branch staff admin']);
        $custom->permissions()->attach(Permission::query()->whereIn('key', ['staff.view', 'staff.create', 'staff.status', 'staff.assign_branches'])->pluck('id'));
        $this->membershipOf($tenant, $manager)->roles()->attach($custom->id);

        $this->createStaff($tenant, $manager, 'cashier', [$main])->assertCreated();
        $this->createStaff($tenant, $manager, 'cashier', [$makati])->assertForbidden();
        $this->createStaff($tenant, $manager, 'cashier', [], ['all_branches' => true])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, "staff/{$mainCashier}/suspend"), ['reason' => 'Late'])->assertOk();
        $this->postJson($this->tenantUrl($tenant, "staff/{$makatiCashier}/suspend"), ['reason' => 'x'])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, "staff/{$mainCashier}/transfer-branches"), ['branch_ids' => [$makati->id]])->assertForbidden();
    }

    public function test_cashier_and_auditor_cannot_administer_staff_even_by_direct_api_calls(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $cashier = $this->addMember($tenant, 'cashier', [$branch]);
        $auditor = $this->addMember($tenant, 'auditor');
        $target = $this->addMember($tenant, 'inventory_staff', [$branch]);
        $targetId = $this->membershipOf($tenant, $target)->id;

        foreach ([$cashier, $auditor] as $actor) {
            $this->createStaff($tenant, $actor, 'business_owner', [$branch])->assertForbidden();
            $this->createStaff($tenant, $actor, 'cashier', [$branch])->assertForbidden();
            $this->postJson($this->tenantUrl($tenant, "staff/{$targetId}/change-role"), ['role_ids' => [Role::system('branch_manager')->id]])->assertForbidden();
            $this->postJson($this->tenantUrl($tenant, "staff/{$targetId}/offboard"), ['reason' => 'x'])->assertForbidden();
            $this->postJson($this->tenantUrl($tenant, "staff/{$targetId}/recovery"), ['delivery' => 'manual'])->assertForbidden();
        }
        $this->actingAsUser($cashier)->getJson($this->tenantUrl($tenant, 'staff'))->assertForbidden();

        // Auditor can read staff and the full audit log but change nothing.
        $this->actingAsUser($auditor)->getJson($this->tenantUrl($tenant, 'staff'))->assertOk();
        $this->getJson($this->tenantUrl($tenant, 'audit-logs'))->assertOk();
        $this->postJson($this->tenantUrl($tenant, 'customers'), ['name' => 'X'])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, 'expenses'), [])->assertForbidden();
    }

    public function test_profile_update_cannot_smuggle_role_or_status_changes(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $id = $this->createStaff($tenant, $owner, 'cashier', [$branch])->assertCreated()->json('data.id');

        $this->patchJson($this->tenantUrl($tenant, "staff/{$id}"), ['role_ids' => [Role::system('business_owner')->id], 'status' => 'active'])
            ->assertUnprocessable()->assertJsonValidationErrors(['role_ids', 'status']);
        $this->patchJson($this->tenantUrl($tenant, "staff/{$id}"), ['name' => 'Juana Staff', 'employee_code' => 'E-7'])
            ->assertOk()->assertJsonPath('data.name', 'Juana Staff')->assertJsonPath('data.employee_code', 'E-7');

        // Personal accounts: only the employee code.
        $personal = $this->addMember($tenant, 'cashier');
        $this->patchJson($this->tenantUrl($tenant, 'staff/'.$this->membershipOf($tenant, $personal)->id), ['name' => 'Renamed'])
            ->assertUnprocessable()->assertJsonPath('code', 'PERSONAL_ACCOUNT_PROFILE');
    }
}
