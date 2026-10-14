<?php

namespace Tests\Feature\Recruitment;

use App\Models\Branch;
use App\Models\Interview;
use App\Models\JobApplication;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;

trait RecruitmentHelpers
{
    protected Tenant $tenant;

    protected User $owner;

    protected Branch $main;

    protected User $hr;

    protected User $manager;

    protected int $vacancyId;

    protected function setUpRecruitment(): void
    {
        Notification::fake();
        Storage::fake('local');
        [$this->tenant, $this->owner, $this->main] = $this->createTenant(['name' => 'Aling Nena Mini Mart']);
        $this->hr = $this->addMember($this->tenant, 'user_access_manager');
        $this->manager = $this->addMember($this->tenant, 'branch_manager', [$this->main]);
        $this->vacancyId = $this->createVacancy($this->main)->json('data.id');
    }

    protected function createVacancy(Branch $branch, string $role = 'cashier'): TestResponse
    {
        return $this->actingAsUser($this->hr)->postJson($this->tenantUrl($this->tenant, 'vacancies'), [
            'title' => 'Cashier',
            'branch_id' => $branch->id,
            'role_id' => Role::system($role)->id,
            'required_documents' => ['resume', 'valid_id'],
            'status' => 'open',
        ])->assertCreated();
    }

    /** Apply through the public endpoint. @return array{0: JobApplication, 1: string} application and secret token */
    protected function apply(?int $vacancyId = null, array $extra = []): array
    {
        $this->app['auth']->forgetGuards();
        $response = $this->post("/api/v1/careers/{$this->tenant->slug}/vacancies/".($vacancyId ?? $this->vacancyId).'/apply', [
            'first_name' => 'Ana',
            'last_name' => 'Reyes',
            'email' => 'ana@example.com',
            'phone' => '09171234567',
            'privacy_consent' => '1',
            'documents' => [
                ['type' => 'resume', 'file' => UploadedFile::fake()->create('resume.pdf', 100, 'application/pdf')],
                ['type' => 'valid_id', 'file' => UploadedFile::fake()->image('id.jpg')],
            ],
            ...$extra,
        ], ['Accept' => 'application/json'])->assertCreated();

        return [JobApplication::query()->where('reference', $response->json('reference'))->firstOrFail(), $response->json('status_token')];
    }

    protected function appUrl(JobApplication $application, string $path = ''): string
    {
        return $this->tenantUrl($this->tenant, "applications/{$application->id}".($path === '' ? '' : "/{$path}"));
    }

    protected function membershipId(User $user): int
    {
        return TenantMembership::query()->where('tenant_id', $this->tenant->id)->where('user_id', $user->id)->value('id');
    }

    protected function schedule(JobApplication $application, User $by, User $interviewer): TestResponse
    {
        return $this->actingAsUser($by)->postJson($this->appUrl($application, 'interviews'), [
            'interviewer_membership_id' => $this->membershipId($interviewer),
            'scheduled_at' => now()->addDay()->toIso8601String(),
            'mode' => 'in_person',
            'location' => 'Main branch office',
        ]);
    }

    protected function openInterview(JobApplication $application): Interview
    {
        return $application->interviews()->whereIn('status', Interview::OPEN_STATUSES)->latest('id')->firstOrFail();
    }

    protected function recordResult(JobApplication $application, User $by, string $decision, array $extra = []): TestResponse
    {
        $interview = $this->openInterview($application);

        return $this->actingAsUser($by)->postJson($this->appUrl($application, "interviews/{$interview->id}/result"), [
            'decision' => $decision,
            'score' => 80,
            'feedback' => 'Confidential: good communication, needs POS training.',
            'criteria' => [['name' => 'Communication', 'score' => 4], ['name' => 'Experience', 'score' => 3]],
            ...$extra,
        ]);
    }

    /** Submitted → HR interview passed → at MANAGER_INTERVIEW. */
    protected function toManagerStage(JobApplication $application): void
    {
        $this->actingAsUser($this->hr)->postJson($this->appUrl($application, 'start-screening'))->assertOk();
        $this->postJson($this->appUrl($application, 'screen'), ['decision' => 'pass'])->assertOk();
        $this->schedule($application, $this->hr, $this->hr)->assertOk();
        $this->recordResult($application, $this->hr, 'pass')->assertOk()->assertJsonPath('data.status', 'manager_interview');
    }

    /** … → manager recommended → at OWNER_FINAL_INTERVIEW. */
    protected function toFinalStage(JobApplication $application): void
    {
        $this->toManagerStage($application);
        $this->schedule($application, $this->hr, $this->manager)->assertOk();
        $this->recordResult($application, $this->manager, 'recommend')->assertOk()->assertJsonPath('data.status', 'owner_final_interview');
    }

    /** … → owner approved → APPROVED. */
    protected function toApproved(JobApplication $application): void
    {
        $this->toFinalStage($application);
        $this->schedule($application, $this->hr, $this->owner)->assertOk();
        $this->recordResult($application, $this->owner, 'approve')->assertOk()->assertJsonPath('data.status', 'approved');
    }

    protected function publicPost(string $path, array $body): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->postJson("/api/v1/careers/applications/{$path}", $body);
    }
}
