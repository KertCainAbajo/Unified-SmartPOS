<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Cash-on-delivery for online orders. A delivery order records where it goes and how much cash the customer will
 * hand the rider, so the store can send the right change. The money itself is still recorded by the normal POS
 * checkout when the order is completed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('online_orders', function (Blueprint $table) {
            $table->string('fulfilment', 20)->default('pickup')->after('status'); // pickup | delivery
            $table->text('delivery_address')->nullable()->after('contact_phone');
            // What the customer will pay the rider with; change due = cash_amount - estimated_total.
            $table->decimal('cash_amount', 15, 2)->nullable()->after('estimated_total');
            $table->string('rider_name')->nullable()->after('ready_at');
            $table->string('rider_phone', 30)->nullable()->after('rider_name');
            $table->timestamp('dispatched_at')->nullable()->after('rider_phone');
        });
    }

    public function down(): void
    {
        Schema::table('online_orders', function (Blueprint $table) {
            $table->dropColumn(['fulfilment', 'delivery_address', 'cash_amount', 'rider_name', 'rider_phone', 'dispatched_at']);
        });
    }
};
