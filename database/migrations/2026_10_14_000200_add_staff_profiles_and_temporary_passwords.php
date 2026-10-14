<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * - tenants.staff_email_domain: optional domain for auto-generated company emails (e.g. alingnena.com).
 * - users.must_change_password / temporary_password_expires_at: administrator-issued temporary passwords that
 *   must be replaced at first sign-in. The password itself is only ever stored as a bcrypt hash.
 * - staff_profiles: employment/personal details per business membership (visible to staff administrators and
 *   the employee only).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->string('staff_email_domain', 100)->nullable()->after('email');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->boolean('must_change_password')->default(false)->after('password');
            $table->timestamp('temporary_password_expires_at')->nullable()->after('must_change_password');
        });

        Schema::create('staff_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('membership_id')->unique()->constrained('tenant_memberships')->cascadeOnDelete();
            $table->string('job_title', 100)->nullable();
            $table->date('hire_date')->nullable();
            $table->string('phone', 30)->nullable();
            $table->string('address')->nullable();
            $table->date('birth_date')->nullable();
            $table->string('emergency_contact_name')->nullable();
            $table->string('emergency_contact_phone', 30)->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_profiles');
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['must_change_password', 'temporary_password_expires_at']);
        });
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropColumn('staff_email_domain');
        });
    }
};
