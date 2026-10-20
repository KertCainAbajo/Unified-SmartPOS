<?php

namespace Tests\Feature\Recruitment;

use App\Models\AppNotification;
use App\Models\User;
use App\Notifications\ApplicantUpdate;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class ApplicationLinkTest extends TestCase
{
    use RecruitmentHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpRecruitment();
    }

    public function test_owner_hr_and_branch_manager_are_alerted_of_a_new_application(): void
    {
        $outsider = $this->addMember($this->tenant, 'cashier', [$this->main]);
        [$application] = $this->apply();

        foreach ([$this->owner, $this->hr, $this->manager] as $user) {
            $this->assertTrue(AppNotification::query()->where('user_id', $user->id)->where('type', 'application_received')->exists(),
                "user {$user->email} was not alerted");
        }
        $this->assertFalse(AppNotification::query()->where('user_id', $outsider->id)->where('type', 'application_received')->exists());
        $this->assertSame($application->id, AppNotification::query()->where('user_id', $this->owner->id)->where('type', 'application_received')->first()->data['application_id'] ?? null);
    }

    public function test_applicant_can_get_a_fresh_link_by_email(): void
    {
        [$application, $oldToken] = $this->apply();

        $reply = $this->publicPost('resend-link', ['email' => 'ANA@example.com'])->assertOk()->json('message');
        $newToken = null;
        Notification::assertSentTo(new AnonymousNotifiable, ApplicantUpdate::class, function ($n) use (&$newToken) {
            if ($n->event !== 'link') {
                return false;
            }
            parse_str((string) parse_url((string) $n->toMail(new AnonymousNotifiable)->actionUrl, PHP_URL_QUERY), $query);
            $newToken = $query['token'] ?? null;

            return true;
        });

        $this->assertNotNull($newToken);
        $this->publicPost('status', ['reference' => $application->reference, 'token' => $newToken])->assertOk();
        $this->publicPost('status', ['reference' => $application->reference, 'token' => $oldToken])->assertClientError();

        // Unknown emails get the same reply, so the form never reveals who applied.
        $this->assertSame($reply, $this->publicPost('resend-link', ['email' => 'nobody@example.com'])->assertOk()->json('message'));
    }
}
