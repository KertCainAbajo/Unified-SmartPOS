<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** When a shop customer agreed to the terms and privacy notice at sign-up (proof of consent). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_accounts', function (Blueprint $table) {
            $table->timestamp('terms_accepted_at')->nullable()->after('email_verified_at');
        });
    }

    public function down(): void
    {
        Schema::table('customer_accounts', fn (Blueprint $table) => $table->dropColumn('terms_accepted_at'));
    }
};
