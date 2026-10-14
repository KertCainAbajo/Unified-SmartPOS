<?php

namespace Tests\Feature\Staff;

use App\Models\AuditLog;
use App\Models\Role;
use Tests\TestCase;

/** Rank-and-file staff sign in with username or employee ID; owners, managers and HR with email only. */
class StaffSignInMethodTest extends TestCase
{
    use StaffTestHelpers;

    public function test_staff_can_sign_in_with_username_or_employee_id(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        [$membership, $username, $password] = $this->activeStaff($tenant, $owner, 'cashier', [$branch], ['employee_code' => 'EMP-0042']);

        $this->staffLogin($tenant, $username, $password)->assertOk();
        $this->staffLogin($tenant, 'EMP-0042', $password)->assertOk();
        $this->staffLogin($tenant, 'emp-0042', $password)->assertOk();
        $this->staffLogin($tenant, 'EMP-0042', 'WrongPass123')->assertUnprocessable();

        $this->actingAsUser($owner)->getJson($this->tenantUrl($tenant, "staff/{$membership->id}"))
            ->assertJsonPath('data.sign_in_with', 'username');
    }

    public function test_employee_id_of_another_business_does_not_work(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        [$other] = $this->createTenant();
        [, , $password] = $this->activeStaff($tenant, $owner, 'cashier', [$branch], ['employee_code' => 'EMP-0042']);

        $this->staffLogin($other, 'EMP-0042', $password)->assertUnprocessable();
    }

    public function test_managers_and_hr_need_an_email_and_must_sign_in_with_it(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();

        foreach (['branch_manager', 'user_access_manager'] as $role) {
            $this->createStaff($tenant, $owner, $role, [$branch])->assertUnprocessable()->assertJsonPath('code', 'EMAIL_REQUIRED');
        }

        $created = $this->createStaff($tenant, $owner, 'branch_manager', [$branch], [
            'email' => 'jose@example.com', 'employee_code' => 'EMP-0007', 'delivery' => 'temporary_password',
        ])->assertCreated()->assertJsonPath('data.sign_in_with', 'email');
        $temporary = $created->json('temporary_password');

        // The right password through the username form is refused, and the attempt is audited.
        $this->staffLogin($tenant, $created->json('data.username'), $temporary)->assertUnprocessable()
            ->assertJsonPath('errors.username.0', 'Managers and administrators sign in with their email address.');
        $this->staffLogin($tenant, 'EMP-0007', $temporary)->assertUnprocessable();
        $this->assertTrue(AuditLog::query()->where('action', 'auth.login_failed')->where('metadata->reason', 'email_sign_in_required')->exists());

        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/login', ['email' => 'jose@example.com', 'password' => $temporary, 'device_name' => 'test'])->assertOk();
    }

    public function test_promotion_to_manager_requires_an_email_and_switches_sign_in(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        [$membership, $username, $password] = $this->activeStaff($tenant, $owner, 'cashier', [$branch]);
        $managerRole = Role::system('branch_manager')->id;

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, "staff/{$membership->id}/change-role"), ['role_ids' => [$managerRole]])
            ->assertUnprocessable()->assertJsonPath('code', 'EMAIL_REQUIRED');

        $this->patchJson($this->tenantUrl($tenant, "staff/{$membership->id}"), ['email' => 'promoted@example.com'])->assertOk();
        $this->postJson($this->tenantUrl($tenant, "staff/{$membership->id}/change-role"), ['role_ids' => [$managerRole]])->assertOk();

        // A manager's email cannot be removed.
        $this->patchJson($this->tenantUrl($tenant, "staff/{$membership->id}"), ['email' => null])
            ->assertUnprocessable()->assertJsonPath('code', 'EMAIL_REQUIRED');

        $this->staffLogin($tenant, $username, $password)->assertUnprocessable();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/login', ['email' => 'promoted@example.com', 'password' => $password, 'device_name' => 'test'])->assertOk();
    }

    public function test_roles_report_their_sign_in_method(): void
    {
        [$tenant, $owner] = $this->createTenant();

        $roles = collect($this->actingAsUser($owner)->getJson($this->tenantUrl($tenant, 'roles'))->assertOk()->json('data'))
            ->pluck('requires_email_sign_in', 'key');

        $this->assertTrue($roles['business_owner']);
        $this->assertTrue($roles['branch_manager']);
        $this->assertTrue($roles['user_access_manager']);
        $this->assertFalse($roles['cashier']);
        $this->assertFalse($roles['accountant']);
    }
}
