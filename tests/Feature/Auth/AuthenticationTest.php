<?php

namespace Tests\Feature\Auth;

use App\Models\AuditLog;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    private function registrationPayload(array $overrides = []): array
    {
        return array_replace_recursive([
            'name' => 'Juan Dela Cruz',
            'email' => 'Juan@Example.com',
            'password' => 'Secret123',
            'password_confirmation' => 'Secret123',
            'device_name' => 'pixel-8',
            'business' => ['name' => 'Sari-Sari Store', 'tin' => '123-456-789-000'],
        ], $overrides);
    }

    public function test_registration_creates_owner_business_branch_and_membership_atomically(): void
    {
        Notification::fake();

        $response = $this->postJson('/api/v1/auth/register', $this->registrationPayload());

        $response->assertCreated()
            ->assertJsonPath('user.email', 'juan@example.com')
            ->assertJsonPath('tenant.name', 'Sari-Sari Store')
            ->assertJsonPath('token_type', 'Bearer')
            ->assertJsonStructure(['token']);

        $user = User::query()->where('email', 'juan@example.com')->firstOrFail();
        $tenant = Tenant::query()->firstOrFail();

        $this->assertNotSame('Secret123', $user->password);
        $this->assertTrue(password_verify('Secret123', $user->password));
        $this->assertSame($user->id, $tenant->owner_user_id);
        $this->assertSame(1, $tenant->branches()->count());
        $this->assertSame(1, $tenant->registers()->count());

        $membership = $user->memberships()->firstOrFail();
        $this->assertTrue($membership->all_branches);
        $this->assertSame(['business_owner'], $membership->roles()->pluck('key')->all());

        Notification::assertSentTo($user, VerifyEmail::class);
        $this->assertDatabaseHas('audit_logs', ['action' => 'tenant.created', 'tenant_id' => $tenant->id]);
    }

    public function test_registration_validates_input_and_rejects_duplicate_email(): void
    {
        User::factory()->create(['email' => 'taken@example.com']);

        $this->postJson('/api/v1/auth/register', $this->registrationPayload([
            'email' => 'taken@example.com',
            'password' => 'short',
            'password_confirmation' => 'short',
            'business' => ['name' => ''],
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email', 'password', 'business.name']);

        $this->assertSame(0, Tenant::query()->count());
    }

    public function test_failed_registration_rolls_back_user_creation(): void
    {
        // Force the onboarding transaction to fail after the user is inserted.
        Role::query()->where('key', 'business_owner')->delete();

        $this->postJson('/api/v1/auth/register', $this->registrationPayload())->assertStatus(500);

        $this->assertSame(0, User::query()->count());
        $this->assertSame(0, Tenant::query()->count());
    }

    public function test_token_login_and_logout_revokes_only_current_token(): void
    {
        $user = User::factory()->create(['email' => 'cashier@example.com', 'password' => 'Secret123']);
        $other = $user->createToken('tablet')->plainTextToken;

        $token = $this->postJson('/api/v1/auth/login', [
            'email' => 'CASHIER@example.com', 'password' => 'Secret123', 'device_name' => 'phone',
        ])->assertOk()->json('token');

        $this->withToken($token)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.email', 'cashier@example.com');
        $this->withToken($token)->postJson('/api/v1/auth/logout')->assertOk();

        $this->assertSame(1, $user->tokens()->count(), 'Only the current token should be revoked.');
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->withToken($other)->getJson('/api/v1/me')->assertOk();
    }

    public function test_spa_cookie_session_login_and_logout(): void
    {
        User::factory()->create(['email' => 'spa@example.com', 'password' => 'Secret123']);
        $spa = ['Origin' => 'http://localhost', 'Referer' => 'http://localhost/'];

        $this->withHeaders($spa)->postJson('/api/v1/auth/login', ['email' => 'spa@example.com', 'password' => 'Secret123'])
            ->assertOk()->assertJsonPath('session', true)->assertJsonMissingPath('token');

        $this->withHeaders($spa)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.email', 'spa@example.com');
        $this->withHeaders($spa)->postJson('/api/v1/auth/logout')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withHeaders($spa)->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_logout_all_revokes_every_token(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('a')->plainTextToken;
        $user->createToken('b');

        $this->withToken($token)->postJson('/api/v1/auth/logout-all')->assertOk()->assertJsonPath('tokens_revoked', 2);
        $this->assertSame(0, $user->tokens()->count());
    }

    public function test_browser_on_an_untrusted_address_gets_a_clear_message(): void
    {
        User::factory()->create(['email' => 'a@example.com', 'password' => 'Secret123']);

        $this->withHeader('Origin', 'http://localhost:9999')
            ->postJson('/api/v1/auth/login', ['email' => 'a@example.com', 'password' => 'Secret123'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('origin')
            ->assertJsonMissingValidationErrors('device_name');

        // Token clients without an Origin still get the device_name hint.
        $this->flushHeaders()->postJson('/api/v1/auth/login', ['email' => 'a@example.com', 'password' => 'Secret123'])
            ->assertUnprocessable()->assertJsonValidationErrors('device_name');
    }

    public function test_login_rejects_bad_credentials_and_disabled_accounts(): void
    {
        User::factory()->create(['email' => 'a@example.com', 'password' => 'Secret123']);
        User::factory()->create(['email' => 'b@example.com', 'password' => 'Secret123', 'status' => 'disabled']);

        $this->postJson('/api/v1/auth/login', ['email' => 'a@example.com', 'password' => 'wrong', 'device_name' => 'x'])
            ->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->postJson('/api/v1/auth/login', ['email' => 'nobody@example.com', 'password' => 'Secret123', 'device_name' => 'x'])
            ->assertUnprocessable();
        $this->postJson('/api/v1/auth/login', ['email' => 'b@example.com', 'password' => 'Secret123', 'device_name' => 'x'])
            ->assertUnprocessable();
    }

    public function test_login_is_rate_limited(): void
    {
        User::factory()->create(['email' => 'a@example.com']);

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/auth/login', ['email' => 'a@example.com', 'password' => 'wrong', 'device_name' => 'x']);
        }

        $this->postJson('/api/v1/auth/login', ['email' => 'a@example.com', 'password' => 'wrong', 'device_name' => 'x'])
            ->assertTooManyRequests();
    }

    public function test_unauthenticated_requests_get_json_401(): void
    {
        $this->getJson('/api/v1/me')->assertUnauthorized()->assertJsonPath('message', 'Unauthenticated.');
    }

    public function test_password_reset_flow_revokes_tokens(): void
    {
        Notification::fake();
        $user = User::factory()->create(['email' => 'reset@example.com']);
        $user->createToken('old');

        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'reset@example.com'])->assertOk();
        // Same response for unknown addresses (no account enumeration).
        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'unknown@example.com'])->assertOk();

        $token = null;
        Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $n) use (&$token) {
            $token = $n->token;

            return true;
        });

        $this->postJson('/api/v1/auth/reset-password', [
            'token' => $token, 'email' => 'reset@example.com', 'password' => 'NewSecret123', 'password_confirmation' => 'NewSecret123',
        ])->assertOk();

        $this->assertTrue(password_verify('NewSecret123', $user->fresh()->password));
        $this->assertSame(0, $user->tokens()->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.password_reset', 'user_id' => $user->id]);
    }

    public function test_invalid_reset_token_is_rejected(): void
    {
        User::factory()->create(['email' => 'reset@example.com']);

        $this->postJson('/api/v1/auth/reset-password', [
            'token' => 'bogus', 'email' => 'reset@example.com', 'password' => 'NewSecret123', 'password_confirmation' => 'NewSecret123',
        ])->assertUnprocessable();
    }

    public function test_email_verification_with_signed_link(): void
    {
        $user = User::factory()->unverified()->create();
        $url = URL::temporarySignedRoute('api.v1.auth.verify-email', now()->addHour(), [
            'id' => $user->id, 'hash' => sha1($user->email),
        ]);

        $this->getJson($url)->assertOk();
        $this->assertTrue($user->fresh()->hasVerifiedEmail());

        $tampered = str_replace('/'.$user->id.'/', '/999/', $url);
        $this->getJson($tampered)->assertForbidden();
    }

    public function test_verification_can_be_required_by_configuration(): void
    {
        config(['smartpos.require_email_verification' => true]);
        [$tenant] = $this->createTenant(owner: User::factory()->unverified()->create());

        $this->actingAsUser($tenant->owner)->getJson($this->tenantUrl($tenant))
            ->assertForbidden()->assertJsonPath('code', 'EMAIL_NOT_VERIFIED');
    }

    public function test_profile_update_and_password_change(): void
    {
        $user = User::factory()->create(['password' => 'Secret123']);
        $current = $user->createToken('current');
        $user->createToken('other');

        $this->withToken($current->plainTextToken)->patchJson('/api/v1/me', ['name' => 'New Name', 'phone' => '09171234567'])
            ->assertOk()->assertJsonPath('data.name', 'New Name');

        $this->withToken($current->plainTextToken)->putJson('/api/v1/me/password', [
            'current_password' => 'wrong', 'password' => 'Another123', 'password_confirmation' => 'Another123',
        ])->assertUnprocessable()->assertJsonValidationErrors('current_password');

        $this->withToken($current->plainTextToken)->putJson('/api/v1/me/password', [
            'current_password' => 'Secret123', 'password' => 'Another123', 'password_confirmation' => 'Another123',
        ])->assertOk();

        $this->assertSame([$current->accessToken->id], $user->tokens()->pluck('id')->all());
        $this->assertSame(0, AuditLog::query()->where('new_values', 'like', '%Another123%')->count());
    }

    public function test_changing_email_requires_the_current_password(): void
    {
        Notification::fake();
        $user = User::factory()->create(['email' => 'owner@example.com', 'password' => 'Secret123'])->fresh();
        $this->actingAsUser($user);

        $this->patchJson('/api/v1/me', ['email' => 'new@example.com'])->assertUnprocessable()->assertJsonValidationErrors('current_password');
        $this->patchJson('/api/v1/me', ['email' => 'new@example.com', 'current_password' => 'wrong'])->assertUnprocessable()->assertJsonValidationErrors('current_password');
        // Re-sending the same address (any case) does not ask for the password.
        $this->patchJson('/api/v1/me', ['email' => 'OWNER@example.com', 'name' => 'Owner'])->assertOk();

        $this->patchJson('/api/v1/me', ['email' => 'New@Example.com', 'current_password' => 'Secret123'])
            ->assertOk()->assertJsonPath('data.email', 'new@example.com')->assertJsonPath('data.email_verified', false);
        Notification::assertSentTo($user->fresh(), VerifyEmail::class);
    }

    public function test_memberships_lists_each_business_with_its_roles(): void
    {
        [$tenantA, $owner] = $this->createTenant();
        [$tenantB] = $this->createTenant();
        $this->addMember($tenantB, 'cashier', [$tenantB->branches()->first()], $owner);

        $response = $this->actingAsUser($owner)->getJson('/api/v1/me/memberships')->assertOk();

        $this->assertEqualsCanonicalizing([$tenantA->id, $tenantB->id], array_column($response->json('data'), 'tenant_id'));
        $byTenant = collect($response->json('data'))->keyBy('tenant_id');
        $this->assertSame('business_owner', $byTenant[$tenantA->id]['roles'][0]['key']);
        $this->assertSame('cashier', $byTenant[$tenantB->id]['roles'][0]['key']);
    }
}
