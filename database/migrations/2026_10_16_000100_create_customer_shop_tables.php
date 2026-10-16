<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Customer-facing online shop: customer accounts, online orders and their items.
 *
 * Deliberately separate from staff accounts (`users`): a customer can never sign in to the POS. Orders hold a
 * price snapshot taken when they were placed; stock only moves when staff complete the order through the normal
 * checkout, so the stock ledger, VAT and receipts stay the single source of truth.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->boolean('shop_enabled')->default(true)->after('recruitment_allow_self_approval');
        });

        Schema::table('products', function (Blueprint $table) {
            // Hide a product from the online shop without archiving it in the POS.
            $table->boolean('show_online')->default(true)->after('status');
        });

        Schema::create('customer_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            // The POS customer record this account shops as (created on registration).
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name');
            $table->string('email');
            $table->string('phone', 30);
            $table->string('password');
            $table->string('status', 20)->default('active'); // active | disabled
            $table->timestamp('last_login_at')->nullable();
            $table->rememberToken();
            $table->timestamps();

            $table->unique(['tenant_id', 'email']);
        });

        Schema::create('online_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('customer_account_id')->constrained()->restrictOnDelete();
            $table->string('order_number', 32);
            // pending | confirmed | ready | completed | cancelled
            $table->string('status', 20)->default('pending');
            $table->string('contact_name');
            $table->string('contact_phone', 30);
            $table->text('note')->nullable();
            // Price snapshot at order time; the real money is recorded on the sale at pickup.
            $table->decimal('estimated_total', 15, 2);
            $table->timestamp('placed_at');
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('ready_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('cancelled_by', 20)->nullable(); // customer | staff
            $table->string('cancel_reason')->nullable();
            $table->foreignId('sale_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('handled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'order_number']);
            $table->index(['tenant_id', 'status']);
            $table->index(['customer_account_id', 'id']);
        });

        Schema::create('online_order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('online_order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            // Snapshot so the order still reads correctly if the product is renamed or repriced later.
            $table->string('name');
            $table->string('sku', 64);
            $table->string('unit', 20);
            $table->decimal('unit_price', 15, 2);
            $table->decimal('quantity', 15, 3);
            $table->decimal('line_total', 15, 2);
            $table->timestamps();

            $table->unique(['online_order_id', 'product_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('online_order_items');
        Schema::dropIfExists('online_orders');
        Schema::dropIfExists('customer_accounts');
        Schema::table('products', fn (Blueprint $table) => $table->dropColumn('show_online'));
        Schema::table('tenants', fn (Blueprint $table) => $table->dropColumn('shop_enabled'));
    }
};
