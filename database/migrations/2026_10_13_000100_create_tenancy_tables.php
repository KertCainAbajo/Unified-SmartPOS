<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenants', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->string('legal_name')->nullable();
            $table->string('tin', 30)->nullable();
            $table->string('address')->nullable();
            $table->string('phone', 30)->nullable();
            $table->string('email')->nullable();
            $table->char('currency', 3)->default('PHP');
            $table->string('timezone', 64)->default('Asia/Manila');
            $table->boolean('vat_registered')->default(true);
            $table->decimal('vat_rate', 5, 2)->default('12.00');
            $table->boolean('prices_include_vat')->default(true);
            $table->boolean('allow_negative_stock')->default(false);
            $table->decimal('refund_approval_threshold', 15, 2)->default('0.00');
            $table->unsignedSmallInteger('refund_window_days')->default(30);
            $table->string('status', 20)->default('active');
            $table->foreignId('owner_user_id')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->index('status');
        });

        Schema::create('branches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('code', 20);
            $table->string('name');
            $table->string('address')->nullable();
            $table->string('phone', 30)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'code']);
        });

        Schema::create('permissions', function (Blueprint $table) {
            $table->id();
            $table->string('key', 100)->unique();
            $table->string('name');
            $table->string('group', 50);
            $table->string('description')->nullable();
            $table->timestamps();
        });

        Schema::create('roles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('key', 100);
            $table->string('name');
            $table->string('description')->nullable();
            $table->boolean('is_system')->default(false);
            $table->timestamps();

            // System roles have tenant_id NULL; uniqueness among them is enforced by the seeder
            // because NULLs are distinct in unique indexes.
            $table->unique(['tenant_id', 'key']);
        });

        Schema::create('role_permissions', function (Blueprint $table) {
            $table->foreignId('role_id')->constrained()->cascadeOnDelete();
            $table->foreignId('permission_id')->constrained()->cascadeOnDelete();
            $table->primary(['role_id', 'permission_id']);
        });

        Schema::create('tenant_memberships', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('status', 20)->default('active');
            $table->boolean('all_branches')->default(false);
            $table->timestamp('joined_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'user_id']);
            $table->index(['user_id', 'status']);
        });

        Schema::create('membership_roles', function (Blueprint $table) {
            $table->foreignId('membership_id')->constrained('tenant_memberships')->cascadeOnDelete();
            $table->foreignId('role_id')->constrained()->restrictOnDelete();
            $table->primary(['membership_id', 'role_id']);
        });

        Schema::create('membership_branches', function (Blueprint $table) {
            $table->foreignId('membership_id')->constrained('tenant_memberships')->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $table->primary(['membership_id', 'branch_id']);
        });

        Schema::create('document_sequences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('type', 30);
            // "tenant" for tenant-wide numbering or "branch:{id}" for per-branch numbering.
            // Non-null so the unique index also covers tenant-wide sequences.
            $table->string('scope', 40);
            $table->unsignedBigInteger('next_number')->default(1);
            $table->timestamps();

            $table->unique(['tenant_id', 'type', 'scope']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_sequences');
        Schema::dropIfExists('membership_branches');
        Schema::dropIfExists('membership_roles');
        Schema::dropIfExists('tenant_memberships');
        Schema::dropIfExists('role_permissions');
        Schema::dropIfExists('roles');
        Schema::dropIfExists('permissions');
        Schema::dropIfExists('branches');
        Schema::dropIfExists('tenants');
    }
};
