<?php

namespace Tests\Feature\Staff;

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
        $this->postJson($this->tenantUrl($tenant, "staff/{$cashierId}/change-role"), ['role_ids' => [Role::system('inventory_staff')->id]])->assertOk();
        // Branch Manager can add staff, so it is an administrative role: owner-only.
        $this->postJson($this->tenantUrl($tenant, "staff/{$cashierId}/change-role"), ['role_ids' => [Role::system('branch_manager')->id]])->assertForbidden();
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

    public function test_branch_manager_adds_and_manages_staff_of_own_branches_only(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $makati = $this->createBranch($tenant, 'MKT');
        $manager = $this->addMember($tenant, 'branch_manager', [$main]);
        $makatiCashier = $this->createStaff($tenant, $owner, 'cashier', [$makati])->assertCreated()->json('data.id');
        $otherManager = $this->membershipOf($tenant, $this->addMember($tenant, 'branch_manager', [$main]))->id;

        // Same process as the owner: temporary password, slip, own-branch staff.
        $created = $this->createStaff($tenant, $manager, 'cashier', [$main], ['delivery' => 'temporary_password'])->assertCreated();
        $this->assertNotNull($created->json('temporary_password'));
        $cashierId = $created->json('data.id');
        $this->postJson($this->tenantUrl($tenant, "staff/{$cashierId}/change-role"), ['role_ids' => [Role::system('inventory_staff')->id]])->assertOk();
        $this->postJson($this->tenantUrl($tenant, "staff/{$cashierId}/recovery"), ['delivery' => 'temporary_password'])->assertOk();
        $this->postJson($this->tenantUrl($tenant, "staff/{$cashierId}/suspend"), ['reason' => 'Late'])->assertOk();

        // Only own branches.
        $list = array_column($this->getJson($this->tenantUrl($tenant, 'staff'))->assertOk()->json('data'), 'id');
        $this->assertContains($cashierId, $list);
        $this->assertNotContains($makatiCashier, $list);
        $this->createStaff($tenant, $manager, 'cashier', [$makati])->assertForbidden();
        $this->createStaff($tenant, $manager, 'cashier', [], ['all_branches' => true])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, "staff/{$makatiCashier}/suspend"), ['reason' => 'x'])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, "staff/{$cashierId}/transfer-branches"), ['branch_ids' => [$makati->id]])->assertForbidden();

        // No administrative roles, and other managers are owner-only.
        foreach (['branch_manager', 'user_access_manager', 'business_owner'] as $role) {
            $this->createStaff($tenant, $manager, $role, [$main], ['email' => "{$role}@example.com"])->assertForbidden();
        }
        $this->postJson($this->tenantUrl($tenant, "staff/{$otherManager}/suspend"), ['reason' => 'x'])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, 'staff/'.$this->membershipOf($tenant, $owner)->id.'/suspend'), ['reason' => 'x'])->assertForbidden();

        // The role list tells the web app which roles the manager may give.
        $assignable = collect($this->getJson($this->tenantUrl($tenant, 'roles'))->assertOk()->json('data'))->pluck('assignable', 'key');
        $this->assertTrue($assignable['cashier']);
        $this->assertFalse($assignable['branch_manager']);
        $this->assertFalse($assignable['business_owner']);
        $this->assertTrue(collect($this->actingAsUser($owner)->getJson($this->tenantUrl($tenant, 'roles'))->json('data'))->every('assignable'));
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
