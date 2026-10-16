<?php

namespace Tests\Feature\Recruitment;

use App\Models\Permission;
use App\Models\Role;
use App\Models\TenantMembership;
use App\Models\User;
use Tests\TestCase;

/** Role permissions, branch isolation and every attempted workflow bypass. */
class RecruitmentAccessTest extends TestCase
{
    use RecruitmentHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpRecruitment();
    }

    public function test_stages_cannot_be_skipped(): void
    {
        [$application] = $this->apply();
        $this->actingAsUser($this->hr);

        // No interview before screening is passed.
        $this->schedule($application, $this->hr, $this->hr)->assertUnprocessable()->assertJsonPath('code', 'INVALID_APPLICATION_STATE');
        $this->postJson($this->appUrl($application, 'screen'), ['decision' => 'pass'])->assertUnprocessable();
        // No offer, onboarding or account before their stage.
        $this->postJson($this->appUrl($application, 'offer'), ['position' => 'Cashier', 'start_date' => now()->addWeek()->toDateString()])
            ->assertUnprocessable()->assertJsonPath('code', 'INVALID_APPLICATION_STATE');
        $this->postJson($this->appUrl($application, 'onboarding'))->assertUnprocessable();
        $this->postJson($this->appUrl($application, 'provision'))->assertUnprocessable()->assertJsonPath('code', 'ONBOARDING_INCOMPLETE');

        // A result cannot be recorded without an interview at the current stage.
        $this->postJson($this->appUrl($application, 'start-screening'))->assertOk();
        $this->postJson($this->appUrl($application, 'start-screening'))->assertUnprocessable();
        $this->postJson($this->appUrl($application, 'screen'), ['decision' => 'pass'])->assertOk();
        $this->schedule($application, $this->hr, $this->hr)->assertOk();
        $this->schedule($application, $this->hr, $this->hr)->assertUnprocessable()->assertJsonPath('code', 'INTERVIEW_ALREADY_SCHEDULED');

        // Decisions of another stage are refused.
        $this->recordResult($application, $this->hr, 'approve')->assertUnprocessable()->assertJsonPath('code', 'INVALID_DECISION');
        $this->recordResult($application, $this->hr, 'reject')->assertUnprocessable()->assertJsonPath('code', 'REASON_REQUIRED');
        $this->assertSame('hr_interview', $application->fresh()->status->value);
    }

    public function test_only_the_assigned_and_eligible_interviewer_records_results(): void
    {
        [$application] = $this->apply();
        $this->toManagerStage($application);

        // Interviewers must be allowed for the stage: HR and cashiers cannot be the manager-stage interviewer.
        $cashier = $this->addMember($this->tenant, 'cashier', [$this->main]);
        $this->schedule($application, $this->hr, $cashier)->assertUnprocessable()->assertJsonPath('code', 'INVALID_INTERVIEWER');
        $this->schedule($application, $this->hr, $this->hr)->assertUnprocessable()->assertJsonPath('code', 'INVALID_INTERVIEWER');

        $this->schedule($application, $this->hr, $this->manager)->assertOk();
        $otherManager = $this->addMember($this->tenant, 'branch_manager', [$this->main]);
        $this->recordResult($application, $this->hr, 'recommend')->assertForbidden();
        $this->recordResult($application, $otherManager, 'recommend')->assertForbidden();
        $this->recordResult($application, $this->owner, 'recommend')->assertForbidden(); // not assigned, even the owner
        $this->assertDatabaseHas('audit_logs', ['action' => 'recruitment.unauthorized_attempt', 'user_id' => $otherManager->id]);

        $this->recordResult($application, $this->manager, 'recommend')->assertOk();
    }

    public function test_hr_and_managers_cannot_give_final_approval(): void
    {
        [$application] = $this->apply();
        $this->toFinalStage($application);

        $this->schedule($application, $this->hr, $this->hr)->assertUnprocessable()->assertJsonPath('code', 'INVALID_INTERVIEWER');
        $this->schedule($application, $this->hr, $this->manager)->assertUnprocessable()->assertJsonPath('code', 'INVALID_INTERVIEWER');
        // A manager cannot schedule the final stage at all.
        $this->schedule($application, $this->manager, $this->owner)->assertForbidden();
        // Nor reject it outright.
        $this->actingAsUser($this->manager)->postJson($this->appUrl($application, 'reject'), ['reason' => 'x'])->assertForbidden();
        $this->assertSame('owner_final_interview', $application->fresh()->status->value);
    }

    public function test_delegate_cannot_approve_an_applicant_they_recommended_unless_policy_allows(): void
    {
        $delegateRole = Role::query()->create(['tenant_id' => $this->tenant->id, 'key' => 'hiring_delegate', 'name' => 'Hiring delegate']);
        $delegateRole->permissions()->attach(Permission::query()->where('key', 'recruitment.final_approval')->pluck('id'));
        TenantMembership::query()->findOrFail($this->membershipId($this->manager))->roles()->attach($delegateRole->id);

        [$application] = $this->apply();
        $this->toFinalStage($application); // $this->manager recommended
        $this->schedule($application, $this->hr, $this->manager)->assertOk();
        $this->recordResult($application, $this->manager, 'approve')->assertForbidden();
        $this->assertDatabaseHas('audit_logs', ['action' => 'recruitment.unauthorized_attempt', 'user_id' => $this->manager->id]);
        $this->assertSame('owner_final_interview', $application->fresh()->status->value);

        $this->tenant->forceFill(['recruitment_allow_self_approval' => true])->save();
        $this->recordResult($application, $this->manager, 'approve')->assertOk()->assertJsonPath('data.status', 'approved');
    }

    public function test_branch_scope_and_stage_visibility(): void
    {
        $makati = $this->createBranch($this->tenant, 'MKT');
        $makatiVacancy = $this->createVacancy($makati)->json('data.id');
        [$mainApp] = $this->apply();
        [$makatiApp] = $this->apply($makatiVacancy, ['email' => 'ben@example.com']);

        // Managers see nothing before the manager stage, and never other branches.
        $this->actingAsUser($this->manager)->getJson($this->tenantUrl($this->tenant, 'applications'))->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->appUrl($mainApp))->assertForbidden();

        $this->toManagerStage($mainApp);
        $this->toManagerStage($makatiApp);
        $ids = array_column($this->actingAsUser($this->manager)->getJson($this->tenantUrl($this->tenant, 'applications'))->json('data'), 'id');
        $this->assertSame([$mainApp->id], $ids);
        $this->getJson($this->appUrl($makatiApp))->assertForbidden();
        $this->schedule($makatiApp, $this->hr, $this->manager)->assertUnprocessable()->assertJsonPath('code', 'INVALID_INTERVIEWER');

        // HR limited to one branch cannot touch the other branch.
        $mainHr = $this->addMember($this->tenant, 'user_access_manager', [$this->main]);
        $this->actingAsUser($mainHr)->postJson($this->appUrl($makatiApp, 'reject'), ['reason' => 'x'])->assertForbidden();
        $this->getJson($this->tenantUrl($this->tenant, 'applications'))->assertOk();
    }

    public function test_roles_without_recruitment_access_and_other_businesses_are_refused(): void
    {
        [$application] = $this->apply();
        foreach (['cashier', 'auditor', 'inventory_staff'] as $role) {
            $user = $this->addMember($this->tenant, $role, [$this->main]);
            $this->actingAsUser($user)->getJson($this->tenantUrl($this->tenant, 'applications'))->assertForbidden();
            $this->postJson($this->appUrl($application, 'start-screening'))->assertForbidden();
            $this->postJson($this->tenantUrl($this->tenant, 'vacancies'), ['title' => 'X'])->assertForbidden();
        }
        // Managers interview but do not screen, post vacancies or send offers.
        $this->actingAsUser($this->manager)->postJson($this->appUrl($application, 'start-screening'))->assertForbidden();
        $this->createVacancyAs($this->manager)->assertForbidden();

        [$otherTenant, $otherOwner] = $this->createTenant();
        $this->actingAsUser($otherOwner)->getJson($this->tenantUrl($otherTenant, "applications/{$application->id}"))->assertNotFound();
        $this->getJson($this->appUrl($application))->assertNotFound(); // not a member of this business
    }

    public function test_applicants_only_reach_their_own_application_and_cannot_change_results(): void
    {
        [$application, $token] = $this->apply();
        [$other, $otherToken] = $this->apply(null, ['email' => 'ben@example.com']);

        $this->publicPost('status', ['reference' => $application->reference, 'token' => $otherToken])->assertNotFound();
        $this->publicPost('status', ['reference' => $application->reference, 'token' => 'guess'])->assertNotFound();
        // Offer answers only while an offer is out.
        $this->publicPost('offer-response', ['reference' => $application->reference, 'token' => $token, 'accept' => true])
            ->assertUnprocessable()->assertJsonPath('code', 'INVALID_APPLICATION_STATE');
        // The public API has no way to record results or move stages.
        $this->app['auth']->forgetGuards();
        $this->postJson($this->appUrl($application, 'start-screening'))->assertUnauthorized();
        $this->assertSame('submitted', $application->fresh()->status->value);
        $this->assertSame('submitted', $other->fresh()->status->value);
    }

    public function test_no_smartpos_account_without_approval_offer_acceptance_and_onboarding(): void
    {
        [$application, $token] = $this->apply();
        $before = User::query()->count();
        $this->toApproved($application);
        $this->actingAsUser($this->hr)->postJson($this->appUrl($application, 'provision'))->assertUnprocessable();
        $this->postJson($this->appUrl($application, 'offer'), ['position' => 'Cashier', 'start_date' => now()->addWeek()->toDateString()])->assertOk();
        $this->postJson($this->appUrl($application, 'provision'))->assertUnprocessable();
        $this->publicPost('offer-response', ['reference' => $application->reference, 'token' => $token, 'accept' => true])->assertOk();
        $this->actingAsUser($this->hr)->postJson($this->appUrl($application, 'provision'))->assertUnprocessable();
        $this->postJson($this->appUrl($application, 'onboarding'))->assertOk();
        $blockers = $this->postJson($this->appUrl($application, 'provision'))->assertUnprocessable()->json('errors.application');
        $this->assertNotEmpty($blockers);
        $this->assertSame($before, User::query()->count());

        // Account administrators without staff.create (e.g. the auditor) cannot provision even when ready.
        foreach ($application->onboardingTasks()->where('required', true)->get() as $task) {
            $this->patchJson($this->appUrl($application, "onboarding-tasks/{$task->id}"), ['done' => true])->assertOk();
        }
        foreach ($application->documents as $document) {
            $this->postJson($this->appUrl($application, "documents/{$document->id}/verify"), ['verified' => true])->assertOk();
        }
        $auditor = $this->addMember($this->tenant, 'auditor');
        $before = User::query()->count();
        $this->actingAsUser($auditor)->postJson($this->appUrl($application, 'provision'))->assertForbidden();
        $this->assertSame($before, User::query()->count());
        $this->actingAsUser($this->hr)->postJson($this->appUrl($application, 'provision'))->assertCreated();
    }

    public function test_documents_are_private_and_downloadable_only_by_staff_with_access(): void
    {
        [$application] = $this->apply();
        $document = $application->documents()->firstOrFail();

        $this->actingAsUser($this->hr)->get($this->appUrl($application, "documents/{$document->id}"))->assertOk()
            ->assertHeader('Content-Disposition');
        $this->actingAsUser($this->manager)->getJson($this->appUrl($application, "documents/{$document->id}"))->assertForbidden();
        $this->app['auth']->forgetGuards();
        $this->getJson($this->appUrl($application, "documents/{$document->id}"))->assertUnauthorized();
    }

    private function createVacancyAs(User $user)
    {
        return $this->actingAsUser($user)->postJson($this->tenantUrl($this->tenant, 'vacancies'), [
            'title' => 'Bagger', 'branch_id' => $this->main->id, 'role_id' => Role::system('cashier')->id, 'required_documents' => ['resume'],
        ]);
    }

    public function test_status_filter_accepts_several_statuses(): void
    {
        [$submitted] = $this->apply();
        [$screening] = $this->apply(null, ['email' => 'ben@example.com']);
        [$interviewing] = $this->apply(null, ['email' => 'cora@example.com']);
        $this->actingAsUser($this->hr)->postJson($this->appUrl($screening, 'start-screening'))->assertOk();
        $this->toManagerStage($interviewing);

        $ids = fn (string $status) => array_column($this->actingAsUser($this->hr)->getJson($this->tenantUrl($this->tenant, 'applications?status='.$status))->assertOk()->json('data'), 'id');

        $this->assertEqualsCanonicalizing([$submitted->id, $screening->id], $ids('submitted,hr_screening,incomplete'));
        $this->assertSame([$interviewing->id], $ids('manager_interview'));
    }
}
