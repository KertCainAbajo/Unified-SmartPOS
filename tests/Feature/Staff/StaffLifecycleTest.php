<?php

namespace Tests\Feature\Staff;

use App\Models\AuditLog;
use App\Models\Role;
use App\Models\Sale;
use App\Models\User;
use Tests\Feature\Pos\PosTestHelpers;
use Tests\TestCase;

class StaffLifecycleTest extends TestCase
{
    use PosTestHelpers;
    use StaffTestHelpers;

    public function test_offboarded_employee_loses_all_access_but_history_is_preserved(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        [$membership, $username, $password] = $this->activeStaff($tenant, $owner, 'cashier', [$branch]);
        $employee = $membership->user;

        // The employee works a shift and makes a sale with a bearer token.
        $token = $this->staffLogin($tenant, $username, $password)->assertOk()->json('token');
        $this->app['auth']->forgetGuards();
        $product = $this->createProduct($tenant, ['price' => '50.00']);
        $this->setStock($product, $branch, '10');
        $this->withToken($token)->postJson($this->tenantUrl($tenant, 'register-sessions'), ['register_id' => $this->registerFor($branch)->id, 'opening_float' => '500'])->assertCreated();
        $this->withToken($token)->withHeader('Idempotency-Key', 'offboard-test-1')->postJson($this->tenantUrl($tenant, 'sales'), [
            'register_id' => $this->registerFor($branch)->id,
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payments' => [['method' => 'cash', 'amount' => '50']],
        ])->assertCreated();

        // Owner offboards; pending work lists the open shift.
        $this->app['auth']->forgetGuards();
        $response = $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, "staff/{$membership->id}/offboard"), ['reason' => 'Resigned'])
            ->assertOk()
            ->assertJsonPath('data.status', 'offboarded')
            ->assertJsonPath('data.user_status', 'disabled')
            ->assertJsonCount(1, 'pending_work.open_shifts');

        // Token revoked, login refused.
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson($this->tenantUrl($tenant, 'context'))->assertUnauthorized();
        $this->staffLogin($tenant, $username, $password)->assertUnprocessable();
        $this->assertSame(0, $employee->tokens()->count());

        // History intact and still attributed.
        $this->assertDatabaseHas('users', ['id' => $employee->id]);
        $sale = Sale::query()->firstOrFail();
        $this->assertSame($employee->id, $sale->cashier_id);
        $this->actingAsUser($owner)->getJson($this->tenantUrl($tenant, "sales/{$sale->id}"))->assertOk()->assertJsonPath('data.cashier.name', $employee->name);

        $log = AuditLog::query()->where('action', 'staff.offboarded')->firstOrFail();
        $this->assertSame($owner->id, $log->user_id);
        $this->assertSame('Resigned', $log->metadata['reason']);
        $this->assertSame([$branch->id], $log->metadata['branch_ids']);
        $this->assertGreaterThanOrEqual(1, $log->metadata['revoked']['tokens']);
    }

    public function test_existing_session_is_blocked_immediately_after_offboarding_or_suspension(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        [$managed] = $this->activeStaff($tenant, $owner, 'cashier', [$branch]);
        $personal = $this->addMember($tenant, 'cashier', [$branch]);

        // Simulate already-authenticated sessions (no token to revoke): status is rechecked per request.
        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, "staff/{$managed->id}/offboard"), ['reason' => 'Terminated'])->assertOk();
        $this->actingAsUser($managed->user->fresh())->getJson($this->tenantUrl($tenant, 'context'))->assertUnauthorized()->assertJsonPath('code', 'ACCOUNT_INACTIVE');

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'staff/'.$this->membershipOf($tenant, $personal)->id.'/suspend'), ['reason' => 'Audit'])->assertOk();
        $this->actingAsUser($personal)->getJson($this->tenantUrl($tenant, 'context'))->assertNotFound();
        $this->getJson($this->tenantUrl($tenant, 'products'))->assertNotFound();

        // Reactivation restores access.
        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'staff/'.$this->membershipOf($tenant, $personal)->id.'/reactivate'))->assertOk()->assertJsonPath('data.status', 'active');
        $this->actingAsUser($personal)->getJson($this->tenantUrl($tenant, 'context'))->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.suspended']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.reactivated']);
    }

    public function test_offboarding_one_business_keeps_other_memberships(): void
    {
        [$tenantA, $ownerA, $branchA] = $this->createTenant();
        [$tenantB, , $branchB] = $this->createTenant();
        $person = User::factory()->create();
        $this->addMember($tenantA, 'cashier', [$branchA], $person);
        $this->addMember($tenantB, 'branch_manager', [$branchB], $person);

        $this->actingAsUser($ownerA)->postJson($this->tenantUrl($tenantA, 'staff/'.$this->membershipOf($tenantA, $person)->id.'/offboard'), ['reason' => 'Left A'])->assertOk()
            ->assertJsonPath('data.user_status', null); // personal account: login stays enabled

        $this->assertSame('active', $person->fresh()->status);
        $this->assertSame('active', $this->membershipOf($tenantB, $person)->status);
        $this->actingAsUser($person->fresh());
        $this->getJson($this->tenantUrl($tenantA, 'context'))->assertNotFound();
        $this->getJson($this->tenantUrl($tenantB, 'context'))->assertOk()->assertJsonPath('roles', ['branch_manager']);
    }

    public function test_branch_transfer_removes_access_to_previous_branch_on_next_request(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $makati = $this->createBranch($tenant, 'MKT');
        [$membership, $username, $password] = $this->activeStaff($tenant, $owner, 'cashier', [$main]);
        $token = $this->staffLogin($tenant, $username, $password)->json('token');
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->getJson($this->tenantUrl($tenant, 'context'))->assertJsonPath('branches.0.id', $main->id);

        $this->app['auth']->forgetGuards();
        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, "staff/{$membership->id}/transfer-branches"), ['branch_ids' => [$makati->id]])
            ->assertOk()->assertJsonPath('data.branches.0.id', $makati->id);

        // Same token, next request: only Makati.
        $this->app['auth']->forgetGuards();
        $branches = array_column($this->withToken($token)->getJson($this->tenantUrl($tenant, 'context'))->json('branches'), 'id');
        $this->assertSame([$makati->id], $branches);
        $this->withToken($token)->postJson($this->tenantUrl($tenant, 'register-sessions'), ['register_id' => $this->registerFor($main)->id, 'opening_float' => '0'])
            ->assertForbidden();

        $log = AuditLog::query()->where('action', 'staff.branches_changed')->firstOrFail();
        $this->assertSame([$main->id], $log->old_values['branch_ids']);
        $this->assertSame([$makati->id], $log->new_values['branch_ids']);
    }

    public function test_role_change_takes_effect_and_is_logged(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        // An email is needed for the promotion to manager below.
        [$membership, $username, $password] = $this->activeStaff($tenant, $owner, 'cashier', [$branch], ['email' => 'promoted@example.com']);
        // The session started here outlives the switch to email-only sign-in; permissions still update immediately.
        $token = $this->staffLogin($tenant, $username, $password)->json('token');
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson($this->tenantUrl($tenant, 'reports/sales-summary'))->assertForbidden();

        $this->app['auth']->forgetGuards();
        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, "staff/{$membership->id}/change-role"), ['role_ids' => [Role::system('branch_manager')->id]])->assertOk();

        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson($this->tenantUrl($tenant, 'reports/sales-summary'))->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.roles_changed', 'user_id' => $owner->id]);
    }

    public function test_rehire_requires_new_activation_and_old_password_no_longer_works(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        [$membership, $username, $password] = $this->activeStaff($tenant, $owner, 'cashier', [$branch]);

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, "staff/{$membership->id}/offboard"), ['reason' => 'Seasonal'])->assertOk();
        $code = $this->postJson($this->tenantUrl($tenant, "staff/{$membership->id}/reactivate"), ['delivery' => 'manual'])
            ->assertOk()->assertJsonPath('data.status', 'invited')->json('activation_code');
        $this->assertNotNull($code);
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.rehired']);

        $this->staffLogin($tenant, $username, $password)->assertUnprocessable();
        $this->postJson('/api/v1/staff/activate', [
            'business_code' => $tenant->slug, 'username' => $username, 'code' => $code,
            'password' => 'Returning123', 'password_confirmation' => 'Returning123',
        ])->assertOk();
        $this->staffLogin($tenant, $username, 'Returning123')->assertOk();
    }

    public function test_offboarding_revokes_outstanding_codes_and_failed_logins_are_audited(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $created = $this->createStaff($tenant, $owner, 'cashier', [$branch])->assertCreated();

        $this->postJson($this->tenantUrl($tenant, "staff/{$created->json('data.id')}/offboard"), ['reason' => 'Never started'])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/staff/activate', [
            'business_code' => $tenant->slug, 'username' => $created->json('data.username'), 'code' => $created->json('activation_code'),
            'password' => 'Employee123', 'password_confirmation' => 'Employee123',
        ])->assertUnprocessable();

        $this->staffLogin($tenant, $created->json('data.username'), 'Wrong123')->assertUnprocessable();
        $failed = AuditLog::query()->where('action', 'auth.login_failed')->latest('id')->firstOrFail();
        $this->assertSame($tenant->id, $failed->tenant_id);
        $this->assertStringNotContainsString('Wrong123', json_encode($failed->metadata));
    }

    public function test_staff_audit_log_shows_account_events_only(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $this->createStaff($tenant, $owner, 'cashier', [$branch])->assertCreated();
        $this->postJson($this->tenantUrl($tenant, 'categories'), ['name' => 'Snacks'])->assertCreated();

        $actions = array_column($this->getJson($this->tenantUrl($tenant, 'staff/audit-log'))->assertOk()->json('data'), 'action');
        $this->assertContains('staff.created', $actions);
        $this->assertNotContains('category.created', $actions);
    }
}
