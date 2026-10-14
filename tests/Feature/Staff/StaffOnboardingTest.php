<?php

namespace Tests\Feature\Staff;

use App\Models\AuditLog;
use App\Models\Role;
use App\Models\StaffInvitation;
use App\Models\User;
use App\Notifications\StaffCodeNotification;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class StaffOnboardingTest extends TestCase
{
    use StaffTestHelpers;

    public function test_owner_creates_company_managed_account_with_one_time_code(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();

        $response = $this->createStaff($tenant, $owner, 'cashier', [$branch], ['employee_code' => 'EMP-001'])
            ->assertCreated()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.username', 'cashier.main01')
            ->assertJsonPath('data.account_type', 'company_managed')
            ->assertJsonPath('data.status', 'invited')
            ->assertJsonPath('data.user_status', 'pending')
            ->assertJsonPath('data.email', null)
            ->assertJsonPath('data.pending_code.purpose', 'activation');

        $code = $response->json('activation_code');
        $this->assertMatchesRegularExpression('/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/', $code);

        // Stored only as a hash; never in audit logs.
        $invitation = StaffInvitation::query()->firstOrFail();
        $this->assertSame(hash('sha256', str_replace('-', '', $code)), $invitation->code_hash);
        $this->assertSame(0, AuditLog::query()->where('new_values', 'like', '%'.$code.'%')->orWhere('metadata', 'like', '%'.$code.'%')->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.created', 'tenant_id' => $tenant->id, 'user_id' => $owner->id]);

        // Next username is generated without conflict.
        $this->createStaff($tenant, $owner, 'cashier', [$branch])->assertCreated()->assertJsonPath('data.username', 'cashier.main02');
    }

    public function test_pending_account_cannot_log_in_until_activated_and_codes_are_single_use(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $response = $this->createStaff($tenant, $owner, 'cashier', [$branch])->assertCreated();
        $username = $response->json('data.username');
        $code = $response->json('activation_code');

        $this->staffLogin($tenant, $username, 'anything123A')->assertUnprocessable();

        $activate = fn (string $c, string $password = 'Employee123') => $this->postJson('/api/v1/staff/activate', [
            'business_code' => $tenant->slug, 'username' => $username, 'code' => $c,
            'password' => $password, 'password_confirmation' => $password,
        ]);

        $activate(strtolower($code))->assertOk(); // case-insensitive hand-typed code
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.activated']);

        $token = $this->staffLogin($tenant, $username, 'Employee123')->assertOk()->json('token');
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson($this->tenantUrl($tenant, 'context'))->assertOk()->assertJsonPath('roles', ['cashier']);

        // Reuse fails with a generic message.
        $activate($code, 'Another123')->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.activation_failed']);
    }

    public function test_activation_codes_expire_and_lock_after_repeated_failures(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $first = $this->createStaff($tenant, $owner, 'cashier', [$branch])->assertCreated();
        $second = $this->createStaff($tenant, $owner, 'cashier', [$branch])->assertCreated();

        $try = fn ($response, string $code) => $this->postJson('/api/v1/staff/activate', [
            'business_code' => $tenant->slug, 'username' => $response->json('data.username'), 'code' => $code,
            'password' => 'Employee123', 'password_confirmation' => 'Employee123',
        ]);

        // Expiry.
        $this->travel(73)->hours();
        $try($first, $first->json('activation_code'))->assertUnprocessable();
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.invitation_expired']);
        $this->travelBack();

        // Lockout after 5 wrong codes, even if the right code is then supplied.
        for ($i = 0; $i < 5; $i++) {
            $this->app['cache']->flush(); // isolate from the per-minute rate limiter
            $try($second, 'WRNG-WRNG-WRNG')->assertUnprocessable();
        }
        $this->app['cache']->flush();
        $try($second, $second->json('activation_code'))->assertUnprocessable();
        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.code_locked']);

        // A newly issued code works and revokes nothing else.
        $reissue = $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, "staff/{$second->json('data.id')}/resend-invitation"), ['delivery' => 'manual'])->assertOk();
        $this->app['auth']->forgetGuards();
        $try($second, $reissue->json('activation_code'))->assertOk();
    }

    public function test_email_delivery_sends_link_and_never_returns_the_code(): void
    {
        Notification::fake();
        [$tenant, $owner, $branch] = $this->createTenant();

        $response = $this->createStaff($tenant, $owner, 'inventory_staff', [$branch], [
            'delivery' => 'email', 'email' => 'Stock.Clerk@company.example', 'username' => 'inventory.main01',
        ])->assertCreated()->assertJsonPath('activation_code', null)->assertJsonPath('data.email', 'stock.clerk@company.example');

        Notification::assertSentTo(User::query()->findOrFail($response->json('data.user_id')), StaffCodeNotification::class);

        $this->createStaff($tenant, $owner, 'cashier', [$branch], ['delivery' => 'email'])
            ->assertUnprocessable()->assertJsonPath('code', 'EMAIL_REQUIRED');
    }

    public function test_usernames_are_unique_per_business_but_reusable_across_businesses(): void
    {
        [$tenantA, $ownerA, $branchA] = $this->createTenant();
        [$tenantB, $ownerB, $branchB] = $this->createTenant();

        $this->createStaff($tenantA, $ownerA, 'cashier', [$branchA], ['username' => 'juan.dc'])->assertCreated();
        $this->createStaff($tenantA, $ownerA, 'cashier', [$branchA], ['username' => 'JUAN.DC'])
            ->assertUnprocessable()->assertJsonValidationErrors('username');
        $this->createStaff($tenantB, $ownerB, 'cashier', [$branchB], ['username' => 'juan.dc'])->assertCreated();
        $this->createStaff($tenantA, $ownerA, 'cashier', [$branchA], ['username' => 'bad name!'])
            ->assertUnprocessable()->assertJsonValidationErrors('username');
    }

    public function test_username_suggestion_endpoint(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $this->createStaff($tenant, $owner, 'inventory_staff', [$branch])->assertCreated();

        $this->actingAsUser($owner)->getJson($this->tenantUrl($tenant, 'staff/username-suggestion?role_id='.Role::system('inventory_staff')->id.'&branch_id='.$branch->id))
            ->assertOk()->assertJsonPath('username', 'inventory.main02');
    }

    public function test_admin_assisted_recovery_is_single_use_revokes_sessions_and_notifies(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $uam = $this->addMember($tenant, 'user_access_manager');
        [$membership, $username, $password] = $this->activeStaff($tenant, $owner, 'cashier', [$branch]);
        $oldToken = $this->staffLogin($tenant, $username, $password)->assertOk()->json('token');

        // Forgot password (no email): admins are notified; response does not reveal anything.
        $this->postJson('/api/v1/staff/forgot-password', ['business_code' => $tenant->slug, 'username' => $username])->assertOk();
        $this->postJson('/api/v1/staff/forgot-password', ['business_code' => $tenant->slug, 'username' => 'nobody'])->assertOk();
        $this->assertDatabaseHas('notifications', ['user_id' => $uam->id, 'type' => 'staff_recovery_requested']);

        $code = $this->actingAsUser($uam)->postJson($this->tenantUrl($tenant, "staff/{$membership->id}/recovery"), ['delivery' => 'manual'])
            ->assertOk()->assertJsonPath('data.pending_code.purpose', 'recovery')->json('activation_code');
        // Owner is told someone else issued a recovery code.
        $this->assertDatabaseHas('notifications', ['user_id' => $owner->id, 'type' => 'staff_recovery_issued']);

        // The old password still works until the code is redeemed.
        $this->staffLogin($tenant, $username, $password)->assertOk();

        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/staff/activate', [
            'business_code' => $tenant->slug, 'username' => $username, 'code' => $code,
            'password' => 'NewSecret456', 'password_confirmation' => 'NewSecret456',
        ])->assertOk();

        $this->assertDatabaseHas('audit_logs', ['action' => 'staff.recovery_completed']);
        $this->assertDatabaseHas('notifications', ['user_id' => $membership->user_id, 'type' => 'password_recovered']);
        $this->staffLogin($tenant, $username, $password)->assertUnprocessable();
        $this->staffLogin($tenant, $username, 'NewSecret456')->assertOk();

        // Every earlier session/token was revoked.
        $this->app['auth']->forgetGuards();
        $this->withToken($oldToken)->getJson('/api/v1/me')->assertUnauthorized();

        // Single use.
        $this->postJson('/api/v1/staff/activate', [
            'business_code' => $tenant->slug, 'username' => $username, 'code' => $code,
            'password' => 'Third789xyz', 'password_confirmation' => 'Third789xyz',
        ])->assertUnprocessable();
    }

    public function test_personal_accounts_cannot_be_recovered_by_business_admins(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $personal = $this->addMember($tenant, 'cashier');

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'staff/'.$this->membershipOf($tenant, $personal)->id.'/recovery'), ['delivery' => 'manual'])
            ->assertUnprocessable()->assertJsonPath('code', 'PERSONAL_ACCOUNT');
    }

    public function test_inviting_existing_account_requires_acceptance_and_does_not_reveal_accounts(): void
    {
        Notification::fake();
        [$tenant, $owner, $branch] = $this->createTenant();
        $person = User::factory()->create(['email' => 'pat@example.com']);
        $payload = ['role_ids' => [Role::system('cashier')->id], 'branch_ids' => [$branch->id]];

        $existing = $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'staff/invite-existing'), ['email' => 'pat@example.com', ...$payload])->assertStatus(202);
        $missing = $this->postJson($this->tenantUrl($tenant, 'staff/invite-existing'), ['email' => 'ghost@example.com', ...$payload])->assertStatus(202);
        $this->assertSame($existing->json(), $missing->json());

        // No access until accepted.
        $membership = $this->membershipOf($tenant, $person);
        $this->assertSame('invited', $membership->status);
        $this->actingAsUser($person)->getJson($this->tenantUrl($tenant, 'context'))->assertNotFound();
        $this->getJson('/api/v1/me/memberships')->assertJsonPath('data.0.status', 'invited');

        $this->postJson("/api/v1/me/memberships/{$membership->id}/accept")->assertOk()->assertJsonPath('data.status', 'active');
        $this->getJson($this->tenantUrl($tenant, 'context'))->assertOk();

        // Someone else's invitation is indistinguishable from a missing one.
        $other = $this->addMember($tenant, 'cashier');
        $this->actingAsUser($other)->postJson("/api/v1/me/memberships/{$membership->id}/accept")->assertNotFound();
    }
}
