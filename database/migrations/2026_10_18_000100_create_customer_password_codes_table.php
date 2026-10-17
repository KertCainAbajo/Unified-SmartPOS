<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One-time codes a shop customer receives by email to choose a new password. Only a hash of the code is stored,
 * each code expires quickly and allows a handful of wrong guesses before it stops working.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_password_codes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_account_id')->constrained()->cascadeOnDelete();
            $table->string('code_hash');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamps();

            $table->index(['customer_account_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_password_codes');
    }
};
