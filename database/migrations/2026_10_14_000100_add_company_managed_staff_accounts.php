<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Company-managed staff accounts (see docs/STAFF_ACCOUNTS.md).
 *
 * - users: email optional; business-scoped username for accounts managed by a business.
 * - tenant_memberships: invited/offboarded lifecycle, employee code, status metadata.
 * - staff_invitations: hashed, expiring, single-use activation and recovery codes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('email')->nullable()->change();
            $table->string('username', 50)->nullable()->after('email');
            $table->foreignId('managed_by_tenant_id')->nullable()->after('username')->constrained('tenants')->restrictOnDelete();

            $table->unique(['managed_by_tenant_id', 'username']);
        });

        Schema::table('tenant_memberships', function (Blueprint $table) {
            $table->string('employee_code', 40)->nullable()->after('user_id');
            $table->string('status_reason')->nullable()->after('status');
            $table->timestamp('suspended_at')->nullable()->after('joined_at');
            $table->timestamp('offboarded_at')->nullable()->after('suspended_at');
            $table->foreignId('offboarded_by')->nullable()->after('offboarded_at')->constrained('users')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->after('offboarded_by')->constrained('users')->nullOnDelete();

            $table->unique(['tenant_id', 'employee_code']);
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('staff_invitations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('membership_id')->constrained('tenant_memberships')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('purpose', 20);   // activation | recovery
            $table->string('channel', 20);   // email | manual
            $table->char('code_hash', 64);   // SHA-256 of the one-time code; the code itself is never stored
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->unsignedTinyInteger('failed_attempts')->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['user_id', 'used_at', 'revoked_at']);
            $table->index(['tenant_id', 'membership_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_invitations');

        Schema::table('tenant_memberships', function (Blueprint $table) {
            $table->dropUnique(['tenant_id', 'employee_code']);
            $table->dropIndex(['tenant_id', 'status']);
            $table->dropConstrainedForeignId('offboarded_by');
            $table->dropConstrainedForeignId('created_by');
            $table->dropColumn(['employee_code', 'status_reason', 'suspended_at', 'offboarded_at']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['managed_by_tenant_id', 'username']);
            $table->dropConstrainedForeignId('managed_by_tenant_id');
            $table->dropColumn('username');
            $table->string('email')->nullable(false)->change();
        });
    }
};
