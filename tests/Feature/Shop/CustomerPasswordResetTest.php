<?php

namespace Tests\Feature\Shop;

use App\Models\CustomerAccount;
use App\Models\Tenant;
use App\Notifications\CustomerPasswordCodeNotification;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class CustomerPasswordResetTest extends TestCase
{
    private Tenant $tenant;

    private CustomerAccount $account;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        [$this->tenant] = $this->createTenant();
        $this->account = CustomerAccount::query()->forceCreate([
            'tenant_id' => $this->tenant->id, 'name' => 'Ana Reyes', 'email' => 'ana@example.com', 'phone' => '0917', 'password' => 'old-password-1',
        ]);
    }

    private function url(string $path): string
    {
        return "/api/v1/shop/{$this->tenant->slug}/password/{$path}";
    }

    /** Ask for a code and capture it from the (faked) email. */
    private function requestCode(): string
    {
        $this->postJson($this->url('forgot'), ['email' => 'ANA@example.com'])->assertOk();
        $code = null;
        Notification::assertSentTo($this->account, CustomerPasswordCodeNotification::class, function ($n) use (&$code) {
            preg_match('/\*\*(\d{6})\*\*/', implode(' ', array_map('strval', $n->toMail($this->account)->introLines)), $m);
            $code = $m[1] ?? null;

            return true;
        });

        return (string) $code;
    }

    public function test_customer_resets_password_with_the_emailed_code(): void
    {
        $code = $this->requestCode();
        $this->assertMatchesRegularExpression('/^\d{6}$/', $code);

        $this->postJson($this->url('verify'), ['email' => 'ana@example.com', 'code' => $code])->assertOk();
        $this->postJson($this->url('reset'), ['email' => 'ana@example.com', 'code' => $code, 'password' => 'brand-new-pass', 'password_confirmation' => 'brand-new-pass'])->assertOk();

        $this->assertTrue(Hash::check('brand-new-pass', $this->account->fresh()->password));
        // The code works only once.
        $this->postJson($this->url('verify'), ['email' => 'ana@example.com', 'code' => $code])->assertUnprocessable()->assertJsonValidationErrors('code');
    }

    public function test_unknown_email_gets_the_same_answer_and_no_email(): void
    {
        $known = $this->postJson($this->url('forgot'), ['email' => 'ana@example.com'])->assertOk()->json('message');
        $unknown = $this->postJson($this->url('forgot'), ['email' => 'nobody@example.com'])->assertOk()->json('message');

        $this->assertSame($known, $unknown);
        Notification::assertSentTimes(CustomerPasswordCodeNotification::class, 1);
    }

    public function test_a_code_stops_working_after_five_wrong_guesses(): void
    {
        $code = $this->requestCode();
        $wrong = $code === '000000' ? '111111' : '000000';
        for ($i = 0; $i < 5; $i++) {
            $this->postJson($this->url('reset'), ['email' => 'ana@example.com', 'code' => $wrong, 'password' => 'brand-new-pass', 'password_confirmation' => 'brand-new-pass'])
                ->assertUnprocessable()->assertJsonValidationErrors('code');
        }

        $this->postJson($this->url('verify'), ['email' => 'ana@example.com', 'code' => $code])
            ->assertUnprocessable()->assertJsonPath('errors.code.0', 'Too many wrong codes. Request a new one.');
        $this->assertTrue(Hash::check('old-password-1', $this->account->fresh()->password));
    }

    public function test_a_mail_server_failure_shows_a_plain_message_and_keeps_details_private(): void
    {
        Notification::shouldReceive('send')->andThrow(new \RuntimeException('535-5.7.8 Username and Password not accepted for kertabajo4@gmail.com'));

        $response = $this->postJson($this->url('forgot'), ['email' => 'ana@example.com'])
            ->assertStatus(503)
            ->assertJsonPath('message', 'We could not send the email right now. Please try again in a few minutes, or contact the store.');

        $this->assertStringNotContainsString('535', $response->getContent());
        $this->assertStringNotContainsString('gmail', $response->getContent());
        $this->assertSame(0, $this->account->passwordCodes()->count()); // unsent code removed, so a retry is not blocked
    }

    public function test_expired_codes_are_rejected_and_resends_are_spaced_out(): void
    {
        $code = $this->requestCode();
        $this->postJson($this->url('forgot'), ['email' => 'ana@example.com'])->assertOk();
        Notification::assertSentTimes(CustomerPasswordCodeNotification::class, 1); // second request within a minute sends nothing

        $this->travel(16)->minutes();
        $this->postJson($this->url('verify'), ['email' => 'ana@example.com', 'code' => $code])
            ->assertUnprocessable()->assertJsonPath('errors.code.0', 'This code is invalid or has expired. Request a new one.');
    }
}
