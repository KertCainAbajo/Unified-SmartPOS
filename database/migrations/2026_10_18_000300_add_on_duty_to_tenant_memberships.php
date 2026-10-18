<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Riders mark themselves on or off duty; the store's dispatch list shows who is available. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenant_memberships', function (Blueprint $table) {
            $table->boolean('on_duty')->default(true)->after('status');
            $table->timestamp('duty_changed_at')->nullable()->after('on_duty');
        });
    }

    public function down(): void
    {
        Schema::table('tenant_memberships', function (Blueprint $table) {
            $table->dropColumn(['on_duty', 'duty_changed_at']);
        });
    }
};
