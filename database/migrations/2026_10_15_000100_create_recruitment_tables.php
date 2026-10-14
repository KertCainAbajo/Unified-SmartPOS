<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Recruitment: vacancies, applications, interviews, documents, onboarding checklist and an append-only
 * application history. The workflow (SUBMITTED → … → HIRED) is enforced by App\Services\Recruitment\RecruitmentService;
 * an applicant becomes a SmartPOS user only at the final HIRED step, through the existing staff provisioning.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            // Business policy: may the person who recommended an applicant (manager stage) also give final approval?
            $table->boolean('recruitment_allow_self_approval')->default(false)->after('refund_window_days');
        });

        Schema::create('vacancies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            // Role the hired employee receives in SmartPOS.
            $table->foreignId('role_id')->constrained()->restrictOnDelete();
            $table->string('title');
            $table->text('description')->nullable();
            $table->text('requirements')->nullable();
            $table->string('employment_type', 30)->default('full_time');
            $table->unsignedSmallInteger('slots')->default(1);
            // Document types the applicant must provide (and HR must verify before account provisioning).
            $table->json('required_documents');
            $table->string('status', 20)->default('draft'); // draft | open | closed
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('job_applications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('vacancy_id')->constrained()->restrictOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->string('reference', 20)->unique();
            // SHA-256 of the applicant's secret status token (shown once, emailed as a link).
            $table->string('status_token_hash', 64);
            $table->string('first_name', 100);
            $table->string('last_name', 100);
            $table->string('email');
            $table->string('phone', 30);
            $table->string('address')->nullable();
            $table->date('birth_date')->nullable();
            $table->text('work_experience')->nullable();
            $table->text('availability')->nullable();
            $table->text('cover_letter')->nullable();
            $table->string('status', 30);
            // Where an INCOMPLETE application returns when HR resumes it.
            $table->string('return_status', 30)->nullable();
            // Message the applicant sees while INCOMPLETE (never internal notes).
            $table->text('applicant_message')->nullable();
            $table->text('rejection_reason')->nullable(); // internal
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->string('offer_position')->nullable();
            $table->decimal('offer_salary', 12, 2)->nullable();
            $table->date('offer_start_date')->nullable();
            $table->text('offer_terms')->nullable();
            $table->timestamp('offer_sent_at')->nullable();
            $table->timestamp('offer_responded_at')->nullable();
            $table->string('offer_response_source', 20)->nullable(); // applicant | staff
            $table->timestamp('onboarding_started_at')->nullable();
            $table->foreignId('hired_membership_id')->nullable()->constrained('tenant_memberships')->nullOnDelete();
            $table->timestamp('hired_at')->nullable();
            $table->timestamp('closed_at')->nullable(); // rejected / withdrawn / offer declined
            $table->timestamps();
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'branch_id']);
        });

        Schema::create('interviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('application_id')->constrained('job_applications')->cascadeOnDelete();
            $table->string('stage', 30); // hr_interview | manager_interview | owner_final_interview
            $table->unsignedSmallInteger('round')->default(1);
            $table->foreignId('interviewer_membership_id')->constrained('tenant_memberships')->restrictOnDelete();
            $table->timestamp('scheduled_at');
            $table->string('mode', 20)->default('in_person'); // in_person | phone | video
            $table->string('location')->nullable();
            // scheduled | reschedule_requested | completed | cancelled | no_show
            $table->string('status', 30)->default('scheduled');
            $table->unsignedSmallInteger('reschedule_count')->default(0);
            $table->text('cancel_reason')->nullable();
            $table->json('criteria')->nullable(); // [{name, score 1-5}]
            $table->unsignedTinyInteger('score')->nullable(); // 0-100
            $table->text('feedback')->nullable(); // confidential
            $table->string('decision', 30)->nullable();
            $table->text('decision_reason')->nullable();
            $table->timestamp('decided_at')->nullable();
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('scheduled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['application_id', 'stage']);
            $table->index(['interviewer_membership_id', 'status']);
        });

        Schema::create('application_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('application_id')->constrained('job_applications')->cascadeOnDelete();
            $table->string('type', 40);
            $table->string('original_name');
            $table->string('path');
            $table->string('mime_type', 100);
            $table->unsignedInteger('size');
            $table->string('uploaded_by_type', 20); // applicant | staff
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('verified_at')->nullable();
            $table->foreignId('verified_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('onboarding_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('application_id')->constrained('job_applications')->cascadeOnDelete();
            $table->string('key', 50);
            $table->string('label');
            $table->boolean('required')->default(true);
            $table->timestamp('completed_at')->nullable();
            $table->foreignId('completed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('note')->nullable();
            $table->timestamps();
            $table->unique(['application_id', 'key']);
        });

        // Append-only: every status change, decision, schedule change and applicant action.
        Schema::create('application_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('application_id')->constrained('job_applications')->cascadeOnDelete();
            $table->string('action', 50);
            $table->string('from_status', 30)->nullable();
            $table->string('to_status', 30)->nullable();
            $table->string('actor_type', 20); // staff | applicant | system
            $table->foreignId('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('interview_id')->nullable()->constrained()->nullOnDelete();
            $table->text('note')->nullable(); // internal
            $table->json('metadata')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index(['application_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('application_events');
        Schema::dropIfExists('onboarding_tasks');
        Schema::dropIfExists('application_documents');
        Schema::dropIfExists('interviews');
        Schema::dropIfExists('job_applications');
        Schema::dropIfExists('vacancies');
        Schema::table('tenants', fn (Blueprint $table) => $table->dropColumn('recruitment_allow_self_approval'));
    }
};
