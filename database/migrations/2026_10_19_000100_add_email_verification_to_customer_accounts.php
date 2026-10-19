<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Shop sign-up confirms the email with a 6-digit code. Codes share the one-time code table, told apart by `purpose`
 * (`reset` for forgot-password, `verify` for sign-up). Accounts created before this keep working as they are.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_accounts', function (Blueprint $table) {
            $table->timestamp('email_verified_at')->nullable()->after('status');
        });
        Schema::table('customer_password_codes', function (Blueprint $table) {
            $table->string('purpose', 20)->default('reset')->after('customer_account_id');
        });
    }

    public function down(): void
    {
        Schema::table('customer_password_codes', fn (Blueprint $table) => $table->dropColumn('purpose'));
        Schema::table('customer_accounts', fn (Blueprint $table) => $table->dropColumn('email_verified_at'));
    }
};
