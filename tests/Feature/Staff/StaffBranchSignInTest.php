<?php

namespace Tests\Feature\Staff;

use Tests\TestCase;

/** Staff pick their branch on the sign-in page; only branches they are assigned to are accepted. */
class StaffBranchSignInTest extends TestCase
{
    use StaffTestHelpers;

    public function test_sign_in_page_lists_active_branch_names_only(): void
    {
        [$tenant, , $main] = $this->createTenant(['name' => 'Aling Nena Mini Mart']);
        $makati = $this->createBranch($tenant, 'MKT');
        $closed = $this->createBranch($tenant, 'OLD');
        $closed->forceFill(['is_active' => false])->save();

        $response = $this->getJson("/api/v1/auth/businesses/{$tenant->slug}")->assertOk()
            ->assertJsonPath('business.name', 'Aling Nena Mini Mart');
        $this->assertEqualsCanonicalizing([$main->id, $makati->id], array_column($response->json('branches'), 'id'));
        $this->assertSame(['id', 'name'], array_keys($response->json('branches.0')));

        $this->getJson('/api/v1/auth/businesses/no-such-store')->assertNotFound();
        $tenant->forceFill(['status' => 'suspended'])->save();
        $this->getJson("/api/v1/auth/businesses/{$tenant->slug}")->assertNotFound();
    }

    public function test_store_directory_lists_active_stores_and_branches_and_can_be_turned_off(): void
    {
        [$tenant, , $main] = $this->createTenant(['name' => 'Aling Nena Mini Mart']);
        [$suspended] = $this->createTenant(['name' => 'Closed Store']);
        $suspended->forceFill(['status' => 'suspended'])->save();

        $stores = collect($this->getJson('/api/v1/auth/businesses')->assertOk()->json('data'))->keyBy('code');
        $this->assertTrue($stores->has($tenant->slug));
        $this->assertFalse($stores->has($suspended->slug));
        $this->assertSame(['code', 'name', 'branches'], array_keys($stores[$tenant->slug]));
        $this->assertSame([['id' => $main->id, 'name' => $main->name]], $stores[$tenant->slug]['branches']);

        config(['smartpos.public_store_list' => false]);
        $this->getJson('/api/v1/auth/businesses')->assertNotFound();
    }

    public function test_staff_can_only_sign_in_at_an_assigned_branch(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $makati = $this->createBranch($tenant, 'MKT');
        [, , $foreignBranch] = $this->createTenant();
        [, $username, $password] = $this->activeStaff($tenant, $owner, 'cashier', [$main]);
        $login = function (int $branchId) use ($tenant, $username, $password) {
            $this->app['auth']->forgetGuards();

            return $this->postJson('/api/v1/auth/login', ['business_code' => $tenant->slug, 'username' => $username, 'password' => $password, 'branch_id' => $branchId, 'device_name' => 'test']);
        };

        $login($main->id)->assertOk();
        $login($makati->id)->assertUnprocessable()->assertJsonValidationErrors('branch_id');
        $login($foreignBranch->id)->assertUnprocessable()->assertJsonValidationErrors('branch_id');
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.login_failed']);

        // A wrong password never reveals branch assignments.
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/login', ['business_code' => $tenant->slug, 'username' => $username, 'password' => 'Wrong1234', 'branch_id' => $makati->id, 'device_name' => 'test'])
            ->assertUnprocessable()->assertJsonValidationErrors('username')->assertJsonMissingValidationErrors('branch_id');
    }

    public function test_all_branch_staff_can_sign_in_anywhere(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $makati = $this->createBranch($tenant, 'MKT');
        [, $username, $password] = $this->activeStaff($tenant, $owner, 'accountant', [], ['all_branches' => true]);

        foreach ([$main, $makati] as $branch) {
            $this->app['auth']->forgetGuards();
            $this->postJson('/api/v1/auth/login', ['business_code' => $tenant->slug, 'username' => $username, 'password' => $password, 'branch_id' => $branch->id, 'device_name' => 'test'])->assertOk();
        }
    }
}
