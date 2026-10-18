<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Maps and riders for delivery orders: where each branch is, the exact spot the customer pinned, which staff
 * rider has the order, where that rider last reported being, and when they handed it over.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->decimal('latitude', 10, 7)->nullable()->after('address');
            $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
        });

        Schema::table('online_orders', function (Blueprint $table) {
            $table->decimal('delivery_lat', 10, 7)->nullable()->after('delivery_address');
            $table->decimal('delivery_lng', 10, 7)->nullable()->after('delivery_lat');
            $table->foreignId('rider_user_id')->nullable()->after('ready_at')->constrained('users')->nullOnDelete();
            $table->decimal('rider_lat', 10, 7)->nullable()->after('rider_phone');
            $table->decimal('rider_lng', 10, 7)->nullable()->after('rider_lat');
            $table->timestamp('rider_location_at')->nullable()->after('rider_lng');
            $table->timestamp('delivered_at')->nullable()->after('dispatched_at');
            // Why the last delivery attempt came back to the store, shown to staff until it is sent out again.
            $table->string('delivery_issue')->nullable()->after('delivered_at');

            $table->index(['rider_user_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('online_orders', function (Blueprint $table) {
            $table->dropIndex(['rider_user_id', 'status']);
            $table->dropConstrainedForeignId('rider_user_id');
            $table->dropColumn(['delivery_lat', 'delivery_lng', 'rider_lat', 'rider_lng', 'rider_location_at', 'delivered_at', 'delivery_issue']);
        });
        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn(['latitude', 'longitude']);
        });
    }
};
