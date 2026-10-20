<?php

namespace Tests\Feature\Auth;

use App\Models\CustomerAccount;
use App\Models\TrustedDevice;
use App\Models\User;
use App\Notifications\SignInCodeNotification;
use App\Notifications\SignInLockedNotification;
use App\Services\Security\NewDeviceVerification;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/** Account pause after wrong passwords, emailed code on a new browser, trusted browsers, and security headers. */
class SignInSecurityTest extends TestCase
{
    private const SPA = ['Origin' => 'http://localhost', 'Referer' => 'http://localhost/'];

    private User $user;

    /** The emailed code, read from the faked notification. */
    private ?string $sentCode = null;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->user = User::factory()->create(['email' => 'owner@example.com', 'password' => 'Secret123']);
    }

    private function login(string $password = 'Secret123'): TestResponse
    {
        return $this->withHeaders(self::SPA)->postJson('/api/v1/auth/login', ['email' => 'owner@example.com', 'password' => $password]);
    }

    private function lastCode(): string
    {
        Notification::assertSentTo($this->user, SignInCodeNotification::class, function (SignInCodeNotification $n) {
            $this->sentCode = $n->code;

            return true;
        });

        return $this->sentCode;
    }

    public function test_five_wrong_passwords_pause_the_account_even_with_the_right_password(): void
    {
        foreach (range(1, 5) as $_) {
            $this->login('Wrong-pass1')->assertUnprocessable();
        }
        Notification::assertSentTo($this->user, SignInLockedNotification::class);

        // A new IP address does not help, and nor does the correct password, until the pause ends.
        $this->travel(2)->minutes();
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])->login()->assertUnprocessable()
            ->assertJsonPath('errors.email.0', fn (string $m) => str_contains($m, 'paused'));
        $this->assertGuest('web');

        $this->travel(16)->minutes();
        $this->login()->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.account_locked']);
    }

    public function test_unknown_emails_are_paused_too_so_the_pause_reveals_nothing(): void
    {
        foreach (range(1, 5) as $_) {
            $this->withHeaders(self::SPA)->postJson('/api/v1/auth/login', ['email' => 'nobody@example.com', 'password' => 'Wrong-pass1'])->assertUnprocessable();
        }
        $this->travel(2)->minutes();
        $this->withHeaders(self::SPA)->postJson('/api/v1/auth/login', ['email' => 'nobody@example.com', 'password' => 'Wrong-pass1'])
            ->assertJsonPath('errors.email.0', fn (string $m) => str_contains($m, 'paused'));
    }

    public function test_new_browser_needs_the_emailed_code_and_can_be_trusted(): void
    {
        config(['smartpos.new_device_codes' => true]);

        $challenge = $this->login()->assertOk()->assertJsonPath('two_factor_required', true)
            ->assertJsonPath('email_hint', fn (string $h) => str_ends_with($h, '@example.com') && ! str_contains($h, 'owner'))
            ->assertJsonMissingPath('session')->json('challenge');
        $this->assertGuest('web');

        $this->withHeaders(self::SPA)->postJson('/api/v1/auth/login/verify', ['challenge' => $challenge, 'code' => '000000'])
            ->assertJsonValidationErrors('code');
        $response = $this->withHeaders(self::SPA)->postJson('/api/v1/auth/login/verify', ['challenge' => $challenge, 'code' => $this->lastCode(), 'trust_device' => true])
            ->assertOk()->assertJsonPath('session', true);
        $this->assertAuthenticatedAs($this->user, 'web');

        // The code works once.
        $this->withHeaders(self::SPA)->postJson('/api/v1/auth/login/verify', ['challenge' => $challenge, 'code' => $this->sentCode])->assertJsonValidationErrors('code');

        // The trusted browser signs in with the password alone; the cookie value is stored only as a hash.
        $cookie = $response->getCookie(NewDeviceVerification::COOKIE, false);
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertDatabaseHas('trusted_devices', ['user_id' => $this->user->id, 'token_hash' => hash('sha256', $cookie->getValue())]);
        $this->app['auth']->forgetGuards();
        $this->withCredentials()->withUnencryptedCookie(NewDeviceVerification::COOKIE, $cookie->getValue())->login()->assertOk()->assertJsonPath('session', true);

        // Forgetting devices asks for a code again.
        $this->actingAs($this->user)->deleteJson('/api/v1/me/devices')->assertOk();
        $this->assertSame(0, TrustedDevice::query()->count());
        $this->app['auth']->forgetGuards();
        $this->withCredentials()->withUnencryptedCookie(NewDeviceVerification::COOKIE, $cookie->getValue())->login()->assertJsonPath('two_factor_required', true);
    }

    public function test_five_wrong_codes_end_the_sign_in(): void
    {
        config(['smartpos.new_device_codes' => true]);
        $challenge = $this->login()->json('challenge');
        $code = $this->lastCode();

        foreach (range(1, 5) as $_) {
            $this->withHeaders(self::SPA)->postJson('/api/v1/auth/login/verify', ['challenge' => $challenge, 'code' => $code === '111111' ? '222222' : '111111'])->assertJsonValidationErrors('code');
        }
        $this->withHeaders(self::SPA)->postJson('/api/v1/auth/login/verify', ['challenge' => $challenge, 'code' => $code])
            ->assertJsonValidationErrors('code');
        $this->assertGuest('web');
    }

    public function test_another_code_can_be_sent_after_a_minute(): void
    {
        config(['smartpos.new_device_codes' => true]);
        $challenge = $this->login()->json('challenge');

        $this->postJson('/api/v1/auth/login/resend', ['challenge' => $challenge])->assertOk()
            ->assertJsonPath('resend_after_seconds', fn (int $s) => $s > 0 && $s <= 60);
        Notification::assertSentToTimes($this->user, SignInCodeNotification::class, 1);

        $this->travel(61)->seconds();
        $this->postJson('/api/v1/auth/login/resend', ['challenge' => $challenge])->assertOk();
        Notification::assertSentToTimes($this->user, SignInCodeNotification::class, 2);
    }

    public function test_staff_username_sign_in_never_asks_for_a_code(): void
    {
        config(['smartpos.new_device_codes' => true]);
        [$tenant] = $this->createTenant();
        $cashier = User::factory()->create(['email' => null, 'username' => 'cashier.one', 'managed_by_tenant_id' => $tenant->id, 'password' => 'Secret123']);
        $this->addMember($tenant, 'cashier', null, $cashier);

        $this->withHeaders(self::SPA)->postJson('/api/v1/auth/login', ['business_code' => $tenant->slug, 'username' => 'cashier.one', 'password' => 'Secret123'])
            ->assertOk()->assertJsonPath('session', true);
    }

    public function test_shop_sign_in_is_paused_after_wrong_passwords(): void
    {
        [$tenant] = $this->createTenant();
        $account = CustomerAccount::query()->forceCreate(['tenant_id' => $tenant->id, 'name' => 'Ana', 'email' => 'ana@example.com', 'phone' => '0917', 'password' => 'long-password-1']);
        $url = "/api/v1/shop/{$tenant->slug}/login";

        foreach (range(1, 5) as $_) {
            $this->withHeaders(self::SPA)->postJson($url, ['email' => 'ana@example.com', 'password' => 'wrong-one'])->assertUnprocessable();
        }
        Notification::assertSentTo($account, SignInLockedNotification::class);
        $this->travel(2)->minutes();
        $this->withHeaders(self::SPA)->postJson($url, ['email' => 'ana@example.com', 'password' => 'long-password-1'])
            ->assertJsonPath('errors.email.0', fn (string $m) => str_contains($m, 'paused'));
    }

    public function test_responses_carry_security_headers(): void
    {
        $this->getJson('/api/v1/me')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('X-Frame-Options', 'DENY')
            ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
            ->assertHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }
}
