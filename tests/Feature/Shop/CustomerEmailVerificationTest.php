<?php

namespace Tests\Feature\Shop;

use App\Models\CustomerAccount;
use App\Notifications\CustomerVerifyEmailNotification;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/** Shop sign-up confirms the email with a 6-digit code before the account can be used. */
class CustomerEmailVerificationTest extends TestCase
{
    private function signUp(string $slug, string $email = 'ana@example.com'): \Illuminate\Testing\TestResponse
    {
        return $this->withHeaders(['Origin' => 'http://localhost', 'Referer' => 'http://localhost/'])->postJson("/api/v1/shop/{$slug}/register", [
            'name' => 'Ana Reyes', 'email' => $email, 'phone' => '09171234567',
            'password' => 'long-password-1', 'password_confirmation' => 'long-password-1',
        ]);
    }

    private function sentCode(CustomerAccount $account): string
    {
        $code = null;
        Notification::assertSentTo($account, CustomerVerifyEmailNotification::class, function (CustomerVerifyEmailNotification $n) use (&$code) {
            $code = $n->code;

            return true;
        });

        return $code;
    }

    public function test_sign_up_waits_for_the_emailed_code_then_signs_in(): void
    {
        Notification::fake();
        [$tenant] = $this->createTenant();

        $this->signUp($tenant->slug)->assertStatus(202)->assertJsonPath('verification_required', true);
        $account = CustomerAccount::query()->where('email', 'ana@example.com')->firstOrFail();
        $this->assertSame('unverified', $account->status);
        $this->getJson("/api/v1/shop/{$tenant->slug}/me")->assertUnauthorized(); // not signed in yet

        // Signing in before confirming sends the customer back to the code step.
        $this->postJson("/api/v1/shop/{$tenant->slug}/login", ['email' => 'ana@example.com', 'password' => 'long-password-1'])
            ->assertUnprocessable()->assertJsonPath('code', 'EMAIL_NOT_VERIFIED');

        $code = $this->sentCode($account);
        $wrong = $code === '000000' ? '111111' : '000000';
        $this->postJson("/api/v1/shop/{$tenant->slug}/verify-email", ['email' => 'ana@example.com', 'code' => $wrong])
            ->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->postJson("/api/v1/shop/{$tenant->slug}/verify-email", ['email' => 'ana@example.com', 'code' => $code])
            ->assertOk()->assertJsonPath('data.email', 'ana@example.com');

        $account->refresh();
        $this->assertSame('active', $account->status);
        $this->assertNotNull($account->email_verified_at);
        $this->getJson("/api/v1/shop/{$tenant->slug}/me")->assertOk();
    }

    public function test_an_unconfirmed_email_can_sign_up_again_but_a_confirmed_one_cannot(): void
    {
        Notification::fake();
        [$tenant] = $this->createTenant();

        $this->signUp($tenant->slug)->assertStatus(202);
        $this->signUp($tenant->slug)->assertStatus(202); // typo in the first attempt: just sends a new code
        $this->assertSame(1, CustomerAccount::query()->where('email', 'ana@example.com')->count());

        CustomerAccount::query()->where('email', 'ana@example.com')->update(['status' => 'active']);
        $this->signUp($tenant->slug)->assertUnprocessable()->assertJsonValidationErrors('email');
    }
}
