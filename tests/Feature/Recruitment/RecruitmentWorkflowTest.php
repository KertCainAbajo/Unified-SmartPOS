<?php

namespace Tests\Feature\Recruitment;

use App\Models\ApplicationEvent;
use App\Models\AuditLog;
use App\Models\Interview;
use App\Models\TenantMembership;
use App\Models\User;
use App\Notifications\ApplicantUpdate;
use Illuminate\Http\UploadedFile;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Notification;
use LogicException;
use Tests\TestCase;

class RecruitmentWorkflowTest extends TestCase
{
    use RecruitmentHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpRecruitment();
    }

    public function test_full_hiring_path_from_application_to_smartpos_account(): void
    {
        $usersBefore = User::query()->count();
        [$application, $token] = $this->apply();
        $this->assertSame('submitted', $application->status->value);
        Notification::assertSentTo(new AnonymousNotifiable, ApplicantUpdate::class, fn ($n) => $n->event === 'submitted');

        $this->toApproved($application);

        // Offer → applicant accepts with their token.
        $this->actingAsUser($this->hr)->postJson($this->appUrl($application, 'offer'), [
            'position' => 'Cashier', 'salary' => '15000', 'start_date' => now()->addWeek()->toDateString(), 'terms' => '6-month probation.',
        ])->assertOk()->assertJsonPath('data.status', 'offer_sent');
        $this->publicPost('offer-response', ['reference' => $application->reference, 'token' => $token, 'accept' => true])
            ->assertOk()->assertJsonPath('data.status', 'offer_accepted');

        // Onboarding: account cannot be created until the checklist and documents are done.
        $this->actingAsUser($this->hr)->postJson($this->appUrl($application, 'onboarding'))->assertOk()->assertJsonPath('data.status', 'onboarding');
        $this->postJson($this->appUrl($application, 'provision'))->assertUnprocessable()->assertJsonPath('code', 'ONBOARDING_INCOMPLETE');
        $this->assertSame($usersBefore, User::query()->count(), 'No SmartPOS account before onboarding is complete');

        foreach ($application->onboardingTasks()->where('required', true)->get() as $task) {
            $this->patchJson($this->appUrl($application, "onboarding-tasks/{$task->id}"), ['done' => true])->assertOk();
        }
        foreach ($application->documents as $document) {
            $this->postJson($this->appUrl($application, "documents/{$document->id}/verify"), ['verified' => true])->assertOk();
        }

        $provisioned = $this->postJson($this->appUrl($application, 'provision'))->assertCreated()
            ->assertJsonPath('data.name', 'Ana Reyes')
            ->assertJsonPath('data.roles.0.key', 'cashier')
            ->assertJsonPath('data.branches.0.id', $this->main->id);
        $this->assertNotNull($provisioned->json('temporary_password'));
        $this->assertSame('hired', $application->fresh()->status->value);
        $membership = TenantMembership::query()->findOrFail($provisioned->json('data.id'));
        $this->assertSame($membership->id, $application->fresh()->hired_membership_id);

        // The new employee can sign in.
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/login', [
            'business_code' => $this->tenant->slug, 'username' => $provisioned->json('data.username'),
            'password' => $provisioned->json('temporary_password'), 'device_name' => 'test',
        ])->assertOk();

        // Every stage left an event and an audit entry with actor and timestamp.
        $statuses = ApplicationEvent::query()->where('application_id', $application->id)->whereNotNull('to_status')->orderBy('id')->pluck('to_status')->all();
        $this->assertSame(['submitted', 'hr_screening', 'hr_interview', 'manager_interview', 'owner_final_interview', 'approved',
            'offer_sent', 'offer_accepted', 'onboarding', 'hired'], $statuses);
        $this->assertTrue(AuditLog::query()->where('action', 'recruitment.hiring_approved')->where('user_id', $this->owner->id)->exists());
        $this->assertSame(3, Interview::query()->where('application_id', $application->id)->where('status', 'completed')->count());

        // The only opening is filled: the vacancy closes and stops taking applications.
        $this->assertSame('closed', $application->vacancy->fresh()->status);
        $this->app['auth']->forgetGuards();
        $this->postJson("/api/v1/careers/{$this->tenant->slug}/vacancies/{$this->vacancyId}/apply", [])->assertUnprocessable();
    }

    public function test_the_same_person_cannot_apply_twice_while_an_application_is_open(): void
    {
        [$first, $token] = $this->apply();
        $this->app['auth']->forgetGuards();
        $this->post("/api/v1/careers/{$this->tenant->slug}/vacancies/{$this->vacancyId}/apply", [
            'first_name' => 'Ana', 'last_name' => 'Reyes', 'email' => 'ANA@example.com', 'phone' => '0917', 'privacy_consent' => '1',
            'documents' => [
                ['type' => 'resume', 'file' => UploadedFile::fake()->create('resume.pdf', 10, 'application/pdf')],
                ['type' => 'valid_id', 'file' => UploadedFile::fake()->image('id.jpg')],
            ],
        ], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonPath('code', 'DUPLICATE_APPLICATION');

        // After withdrawing, applying again is allowed.
        $this->publicPost('withdraw', ['reference' => $first->reference, 'token' => $token])->assertOk();
        $this->apply();
    }

    public function test_applicant_sees_stage_but_never_internal_notes(): void
    {
        [$application, $token] = $this->apply();
        $this->toManagerStage($application);

        $status = $this->publicPost('status', ['reference' => $application->reference, 'token' => $token])->assertOk()
            ->assertJsonPath('data.status_label', 'Manager Interview')
            ->assertJsonPath('data.step', 3);
        $this->assertStringNotContainsString('Confidential', $status->getContent());
        $this->assertStringNotContainsString('score', $status->getContent());

        $this->actingAsUser($this->owner)->postJson($this->appUrl($application, 'reject'), ['reason' => 'Internal: failed reference check'])->assertOk();
        $closed = $this->publicPost('status', ['reference' => $application->reference, 'token' => $token])->assertOk()
            ->assertJsonPath('data.status_label', 'Not selected');
        $this->assertStringNotContainsString('reference check', $closed->getContent());
        Notification::assertSentTo(new AnonymousNotifiable, ApplicantUpdate::class,
            fn ($n) => $n->event === 'rejected' && ! str_contains(implode(' ', $n->lines), 'reference check'));
    }

    public function test_hr_requests_information_and_resumes_without_losing_the_earlier_interview(): void
    {
        [$application, $token] = $this->apply();
        $this->actingAsUser($this->hr)->postJson($this->appUrl($application, 'start-screening'))->assertOk();
        $this->postJson($this->appUrl($application, 'screen'), ['decision' => 'pass'])->assertOk();
        $this->schedule($application, $this->hr, $this->hr)->assertOk();
        $this->recordResult($application, $this->hr, 'request_info', ['reason' => 'Unclear availability', 'applicant_message' => 'Please upload your NBI clearance.'])
            ->assertOk()->assertJsonPath('data.status', 'incomplete')->assertJsonPath('data.return_status', 'hr_interview');

        $this->publicPost('status', ['reference' => $application->reference, 'token' => $token])
            ->assertJsonPath('data.message', 'Please upload your NBI clearance.')->assertJsonPath('data.can_upload', true);
        $this->app['auth']->forgetGuards();
        $this->post('/api/v1/careers/applications/documents', [
            'reference' => $application->reference, 'token' => $token,
            'documents' => [['type' => 'nbi_clearance', 'file' => UploadedFile::fake()->create('nbi.pdf', 50, 'application/pdf')]],
        ], ['Accept' => 'application/json'])->assertOk();

        $this->actingAsUser($this->hr)->postJson($this->appUrl($application, 'resume'))->assertOk()->assertJsonPath('data.status', 'hr_interview');
        $this->schedule($application, $this->hr, $this->hr)->assertOk();
        $this->assertSame([1, 2], $application->interviews()->orderBy('id')->pluck('round')->all());
        $this->assertSame('request_info', $application->interviews()->orderBy('id')->first()->decision, 'First decision kept');
    }

    public function test_manager_reassessment_adds_a_new_round(): void
    {
        [$application] = $this->apply();
        $this->toManagerStage($application);
        $this->schedule($application, $this->hr, $this->manager)->assertOk();
        $this->recordResult($application, $this->manager, 'reassess', ['reason' => 'Needs a practical cash-handling test'])
            ->assertOk()->assertJsonPath('data.status', 'manager_interview');

        $this->schedule($application, $this->manager, $this->manager)->assertOk(); // managers schedule their own stage
        $this->recordResult($application, $this->manager, 'recommend')->assertOk()->assertJsonPath('data.status', 'owner_final_interview');
        $this->assertSame(['reassess', 'recommend'], $application->interviews()->where('stage', 'manager_interview')->orderBy('id')->pluck('decision')->all());
    }

    public function test_owner_can_send_back_for_another_interview(): void
    {
        [$application] = $this->apply();
        $this->toFinalStage($application);
        $this->schedule($application, $this->hr, $this->owner)->assertOk();
        $this->recordResult($application, $this->owner, 'another_interview', ['reason' => 'Check weekend availability', 'next_stage' => 'manager_interview'])
            ->assertOk()->assertJsonPath('data.status', 'manager_interview');
        $this->assertSame('recommend', $application->interviews()->where('stage', 'manager_interview')->first()->decision);

        // HR can also ask for another interview at an earlier stage; open interviews are cancelled with history.
        $this->schedule($application, $this->hr, $this->manager)->assertOk();
        $this->actingAsUser($this->hr)->postJson($this->appUrl($application, 'another-interview'), ['stage' => 'hr_interview', 'reason' => 'Verify experience'])
            ->assertOk()->assertJsonPath('data.status', 'hr_interview');
        $this->assertSame('cancelled', $application->interviews()->latest('id')->first()->status);
    }

    public function test_rescheduling_cancellation_and_applicant_reschedule_request_are_recorded(): void
    {
        [$application, $token] = $this->apply();
        $this->actingAsUser($this->hr)->postJson($this->appUrl($application, 'start-screening'))->assertOk();
        $this->postJson($this->appUrl($application, 'screen'), ['decision' => 'pass'])->assertOk();
        $this->schedule($application, $this->hr, $this->hr)->assertOk();
        $interview = $this->openInterview($application);

        $this->publicPost('reschedule-request', ['reference' => $application->reference, 'token' => $token, 'interview_id' => $interview->id, 'reason' => 'Exam that day'])
            ->assertOk()->assertJsonPath('data.interviews.0.reschedule_requested', true);
        $this->actingAsUser($this->hr)->postJson($this->appUrl($application, "interviews/{$interview->id}/reschedule"), [
            'scheduled_at' => now()->addDays(3)->toIso8601String(), 'reason' => 'Applicant request',
        ])->assertOk()->assertJsonPath('data.interviews.0.reschedule_count', 1)->assertJsonPath('data.interviews.0.status', 'scheduled');
        $this->postJson($this->appUrl($application, "interviews/{$interview->id}/cancel"), ['reason' => 'Interviewer sick'])
            ->assertOk()->assertJsonPath('data.interviews.0.status', 'cancelled');

        $actions = ApplicationEvent::query()->where('interview_id', $interview->id)->pluck('action')->all();
        $this->assertSame(['interview_scheduled', 'reschedule_requested', 'interview_rescheduled', 'interview_cancelled'], $actions);
        Notification::assertSentTo(new AnonymousNotifiable, ApplicantUpdate::class, fn ($n) => $n->event === 'interview_rescheduled');
    }

    public function test_withdrawal_and_offer_decline_close_the_application(): void
    {
        [$first, $token] = $this->apply();
        $this->publicPost('withdraw', ['reference' => $first->reference, 'token' => $token, 'reason' => 'Accepted another job'])
            ->assertOk()->assertJsonPath('data.status', 'withdrawn')->assertJsonPath('data.can_withdraw', false);

        [$second, $token2] = $this->apply();
        $this->toApproved($second);
        $this->actingAsUser($this->hr)->postJson($this->appUrl($second, 'offer'), ['position' => 'Cashier', 'start_date' => now()->addWeek()->toDateString()])->assertOk();
        $this->publicPost('offer-response', ['reference' => $second->reference, 'token' => $token2, 'accept' => false])
            ->assertOk()->assertJsonPath('data.status', 'offer_declined');
        $this->actingAsUser($this->hr)->postJson($this->appUrl($second, 'onboarding'))->assertUnprocessable();
    }

    public function test_history_is_append_only(): void
    {
        [$application] = $this->apply();
        $event = ApplicationEvent::query()->where('application_id', $application->id)->firstOrFail();

        $this->expectException(LogicException::class);
        $event->update(['note' => 'rewritten']);
    }
}
