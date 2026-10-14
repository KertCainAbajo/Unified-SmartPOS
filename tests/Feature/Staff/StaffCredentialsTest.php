<?php

namespace Tests\Feature\Staff;

use App\Models\AuditLog;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class StaffCredentialsTest extends TestCase
{
    use StaffTestHelpers;

    private function createWithTemporaryPassword($tenant, $actor, $branch, array $extra = [])
    {
        return $this->createStaff($tenant, $actor, 'cashier', [$branch], ['delivery' => 'temporary_password', ...$extra]);
    }

    public function test_suggestions_follow_role_branch_and_company_email_domain(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $cashierRole = Role::system('cashier')->id;
        $url = $this->tenantUrl($tenant, "staff/username-suggestion?role_id={$cashierRole}&branch_id={$branch->id}");

        $this->actingAsUser($owner)->getJson($url)->assertOk()
            ->assertJson(['username' => 'cashier.main01', 'employee_code' => 'EMP-0001', 'email' => null]);

        $this->patchJson($this->tenantUrl($tenant), ['staff_email_domain' => 'alingnena.com'])->assertOk()
            ->assertJsonPath('data.staff_email_domain', 'alingnena.com');
        $this->createWithTemporaryPassword($tenant, $owner, $branch)->assertCreated()->assertJsonPath('data.employee_code', 'EMP-0001');

        $this->getJson($url)->assertOk()
            ->assertJson(['username' => 'cashier.main02', 'employee_code' => 'EMP-0002', 'email' => 'cashier.main02@alingnena.com']);
    }

    public function test_temporary_password_is_shown_once_never_stored_and_must_be_changed(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();

        $response = $this->createWithTemporaryPassword($tenant, $owner, $branch, ['name' => 'Ana Reyes'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.must_change_password', true)
            ->assertJsonPath('data.employee_code', 'EMP-0001')
            ->assertJsonPath('activation_code', null);
        $temporary = $response->json('temporary_password');
        $this->assertMatchesRegularExpression('/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/', $temporary);

        // Only a bcrypt hash exists; the plain value appears nowhere in the database.
        $user = User::query()->findOrFail($response->json('data.user_id'));
        $this->assertStringStartsWith('$2y$', $user->password);
        foreach (['users', 'audit_logs', 'staff_invitations', 'tenant_memberships'] as $table) {
            $this->assertStringNotContainsString($temporary, json_encode(DB::table($table)->get()), "Found in {$table}");
        }

        // Viewing the staff member later never reveals a password.
        $shown = $this->getJson($this->tenantUrl($tenant, "staff/{$response->json('data.id')}"))->assertOk();
        $this->assertStringNotContainsString($temporary, $shown->getContent());
        $this->assertArrayNotHasKey('password', $shown->json('data'));

        // Employee signs in, is blocked until they choose a password.
        $token = $this->staffLogin($tenant, $response->json('data.username'), $temporary)->assertOk()
            ->assertJsonPath('must_change_password', true)->json('token');
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson($this->tenantUrl($tenant, 'context'))->assertForbidden()->assertJsonPath('code', 'PASSWORD_CHANGE_REQUIRED');
        $this->withToken($token)->getJson('/api/v1/me')->assertOk();

        $this->withToken($token)->putJson('/api/v1/me/password', [
            'current_password' => $temporary, 'password' => 'MyOwnPass123', 'password_confirmation' => 'MyOwnPass123',
        ])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson($this->tenantUrl($tenant, 'context'))->assertOk();
        $this->assertFalse($user->fresh()->must_change_password);
        $this->staffLogin($tenant, $response->json('data.username'), $temporary)->assertUnprocessable();
    }

    public function test_spaces_copied_around_a_temporary_password_are_ignored_but_not_for_own_passwords(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $created = $this->createWithTemporaryPassword($tenant, $owner, $branch)->assertCreated();
        $username = $created->json('data.username');
        $temporary = $created->json('temporary_password');

        $token = $this->staffLogin($tenant, $username, " {$temporary} \n")->assertOk()->json('token');
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->putJson('/api/v1/me/password', [
            'current_password' => "{$temporary} ", 'password' => 'MyOwnPass123', 'password_confirmation' => 'MyOwnPass123',
        ])->assertOk();

        // Once the employee has their own password, it must match exactly.
        $this->staffLogin($tenant, $username, 'MyOwnPass123 ')->assertUnprocessable();
        $this->staffLogin($tenant, $username, 'MyOwnPass123')->assertOk();
    }

    public function test_temporary_password_expires(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $response = $this->createWithTemporaryPassword($tenant, $owner, $branch)->assertCreated();

        $this->travel(73)->hours();
        $this->staffLogin($tenant, $response->json('data.username'), $response->json('temporary_password'))
            ->assertUnprocessable()->assertJsonValidationErrors('username');
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.login_failed']);
    }

    public function test_reset_password_issues_new_temporary_password_and_signs_employee_out(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $uam = $this->addMember($tenant, 'user_access_manager');
        [$membership, $username, $password] = $this->activeStaff($tenant, $owner, 'cashier', [$branch]);
        $oldToken = $this->staffLogin($tenant, $username, $password)->json('token');

        $this->app['auth']->forgetGuards();
        $new = $this->actingAsUser($uam)->postJson($this->tenantUrl($tenant, "staff/{$membership->id}/recovery"), ['delivery' => 'temporary_password'])
            ->assertOk()->assertJsonPath('data.must_change_password', true)->json('temporary_password');

        $this->staffLogin($tenant, $username, $password)->assertUnprocessable();
        $this->app['auth']->forgetGuards();
        $this->withToken($oldToken)->getJson('/api/v1/me')->assertUnauthorized();
        $this->staffLogin($tenant, $username, $new)->assertOk();

        $this->assertDatabaseHas('notifications', ['user_id' => $membership->user_id, 'type' => 'password_recovered']);
        $this->assertDatabaseHas('notifications', ['user_id' => $owner->id, 'type' => 'staff_recovery_issued']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.temporary_password_issued', 'user_id' => $uam->id]);
    }

    public function test_personal_information_is_visible_only_to_staff_admins_and_the_employee(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $manager = $this->addMember($tenant, 'branch_manager', [$branch]);
        $profile = [
            'job_title' => 'Senior Cashier', 'hire_date' => '2026-01-15', 'phone' => '09171234567',
            'address' => '12 Mabini St., Quezon City', 'birth_date' => '1995-04-02',
            'emergency_contact_name' => 'Pedro Reyes', 'emergency_contact_phone' => '09181112222',
        ];
        $response = $this->createWithTemporaryPassword($tenant, $owner, $branch, ['profile' => $profile])->assertCreated();
        $id = $response->json('data.id');

        $this->getJson($this->tenantUrl($tenant, "staff/{$id}"))->assertOk()
            ->assertJsonPath('data.profile.job_title', 'Senior Cashier')
            ->assertJsonPath('data.profile.birth_date', '1995-04-02');

        // Branch manager can see the staff list but not personal data.
        $this->actingAsUser($manager)->getJson($this->tenantUrl($tenant, "staff/{$id}"))->assertOk()->assertJsonMissingPath('data.profile');

        // Updates are audited by field name only, never by value.
        $this->actingAsUser($owner)->patchJson($this->tenantUrl($tenant, "staff/{$id}"), ['profile' => ['phone' => '09990000000']])
            ->assertOk()->assertJsonPath('data.profile.phone', '09990000000');
        $log = AuditLog::query()->where('action', 'staff.profile_updated')->latest('id')->firstOrFail();
        $this->assertSame(['phone'], $log->metadata['profile_fields_changed']);
        $this->assertStringNotContainsString('0999', json_encode($log->toArray()));
        $this->assertStringNotContainsString('Mabini', json_encode(AuditLog::query()->get()->toArray()));

        // Personal accounts: profile is editable, name is not.
        $personal = $this->addMember($tenant, 'cashier', [$branch]);
        $pid = $this->membershipOf($tenant, $personal)->id;
        $this->patchJson($this->tenantUrl($tenant, "staff/{$pid}"), ['profile' => ['job_title' => 'Part-time']])->assertOk();

        // Invalid profile data is rejected.
        $this->patchJson($this->tenantUrl($tenant, "staff/{$id}"), ['profile' => ['birth_date' => '2999-01-01', 'salary' => 1]])
            ->assertUnprocessable()->assertJsonValidationErrors(['profile', 'profile.birth_date']);
    }
}
