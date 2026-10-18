<?php

namespace Tests\Feature\Shop;

use App\Models\CustomerAccount;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Str;
use Tests\TestCase;

/** How long a shopper stays signed in, and that the staff app sharing the browser cannot sign them out. */
class CustomerSessionTest extends TestCase
{
    private const SPA = ['Origin' => 'http://localhost', 'Referer' => 'http://localhost/'];

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        [$this->tenant] = $this->createTenant();
        CustomerAccount::query()->forceCreate([
            'tenant_id' => $this->tenant->id, 'name' => 'Ana Reyes', 'email' => 'ana@example.com', 'phone' => '0917', 'password' => 'long-password-1',
        ]);
    }

    private function shop(string $path): string
    {
        return "/api/v1/shop/{$this->tenant->slug}/{$path}";
    }

    public function test_keep_me_signed_in_sets_a_long_lived_remember_cookie(): void
    {
        $response = $this->withHeaders(self::SPA)->postJson($this->shop('login'), ['email' => 'ana@example.com', 'password' => 'long-password-1', 'remember' => '1'])->assertOk();

        $cookie = collect($response->headers->getCookies())->first(fn ($c) => Str::startsWith($c->getName(), 'remember_customer_'));
        $this->assertNotNull($cookie, 'A remember-me cookie for the customer guard is set.');
        $this->assertGreaterThan(now()->addYear()->timestamp, $cookie->getExpiresTime());
    }

    public function test_unticking_keep_me_signed_in_sets_no_remember_cookie(): void
    {
        $response = $this->withHeaders(self::SPA)->postJson($this->shop('login'), ['email' => 'ana@example.com', 'password' => 'long-password-1', 'remember' => '0'])->assertOk();

        $this->assertFalse(collect($response->headers->getCookies())->contains(fn ($c) => Str::startsWith($c->getName(), 'remember_customer_')));
    }

    public function test_staff_signing_out_in_the_same_browser_keeps_the_shopper_signed_in(): void
    {
        User::factory()->create(['email' => 'cashier@example.com', 'password' => 'Secret123']);

        $this->withHeaders(self::SPA)->postJson($this->shop('login'), ['email' => 'ana@example.com', 'password' => 'long-password-1', 'remember' => '0'])->assertOk();
        $this->withHeaders(self::SPA)->postJson('/api/v1/auth/login', ['email' => 'cashier@example.com', 'password' => 'Secret123'])->assertOk();
        $this->withHeaders(self::SPA)->postJson('/api/v1/auth/logout')->assertOk();
        $this->app['auth']->forgetGuards();

        $this->withHeaders(self::SPA)->getJson('/api/v1/me')->assertUnauthorized();
        $this->withHeaders(self::SPA)->getJson($this->shop('me'))->assertOk()->assertJsonPath('data.email', 'ana@example.com');
    }
}
