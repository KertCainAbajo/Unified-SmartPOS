<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('email')->nullable();
            $table->string('phone', 30)->nullable();
            $table->string('tin', 30)->nullable();
            $table->string('address')->nullable();
            $table->text('notes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['tenant_id', 'name']);
            $table->index(['tenant_id', 'phone']);
        });

        Schema::create('registers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->string('code', 20);
            $table->string('name');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'code']);
        });

        Schema::create('register_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('register_id')->constrained()->restrictOnDelete();
            $table->foreignId('opened_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('closed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('status', 20)->default('open');
            $table->decimal('opening_float', 15, 2)->default('0.00');
            $table->decimal('cash_sales', 15, 2)->default('0.00');
            $table->decimal('cash_refunds', 15, 2)->default('0.00');
            $table->decimal('expected_cash', 15, 2)->nullable();
            $table->decimal('counted_cash', 15, 2)->nullable();
            $table->decimal('cash_difference', 15, 2)->nullable();
            $table->timestamp('opened_at');
            $table->timestamp('closed_at')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['register_id', 'status']);
            $table->index(['tenant_id', 'opened_at']);
        });

        Schema::create('sales', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('register_id')->constrained()->restrictOnDelete();
            $table->foreignId('register_session_id')->constrained()->restrictOnDelete();
            $table->foreignId('cashier_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('receipt_number', 40);
            $table->string('idempotency_key', 100);
            $table->char('request_hash', 64);
            $table->string('status', 20);
            $table->string('payment_status', 30);
            $table->decimal('subtotal', 15, 2);
            $table->decimal('discount_total', 15, 2)->default('0.00');
            // VAT removed from VAT-exempt Senior Citizen / PWD sales (not a discount, not revenue).
            $table->decimal('vat_exemption_amount', 15, 2)->default('0.00');
            $table->decimal('vatable_sales', 15, 2)->default('0.00');
            $table->decimal('vat_exempt_sales', 15, 2)->default('0.00');
            $table->decimal('zero_rated_sales', 15, 2)->default('0.00');
            $table->decimal('vat_amount', 15, 2)->default('0.00');
            $table->decimal('total', 15, 2);
            $table->decimal('amount_tendered', 15, 2);
            $table->decimal('change_due', 15, 2)->default('0.00');
            $table->decimal('refunded_total', 15, 2)->default('0.00');
            $table->string('discount_type', 30)->default('none');
            $table->string('discount_id_number', 50)->nullable();
            $table->string('discount_holder_name')->nullable();
            $table->text('notes')->nullable();
            $table->date('business_date');
            $table->timestamp('sold_at');
            $table->timestamp('voided_at')->nullable();
            $table->foreignId('voided_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('void_reason')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'receipt_number']);
            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'branch_id', 'business_date']);
            $table->index(['tenant_id', 'cashier_id', 'business_date']);
            $table->index(['tenant_id', 'status', 'business_date']);
        });

        Schema::create('sale_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sale_id')->constrained()->restrictOnDelete();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->string('sku', 64);
            $table->string('barcode', 64)->nullable();
            $table->string('name');
            $table->string('unit', 20);
            $table->string('tax_type', 20);
            $table->decimal('quantity', 15, 3);
            $table->decimal('unit_price', 15, 2);
            $table->decimal('unit_cost', 15, 4);
            $table->decimal('gross_amount', 15, 2);
            $table->string('discount_type', 20)->default('none');
            $table->decimal('discount_value', 15, 2)->default('0.00');
            $table->decimal('discount_amount', 15, 2)->default('0.00');
            $table->decimal('vat_exemption_amount', 15, 2)->default('0.00');
            $table->decimal('vat_amount', 15, 2)->default('0.00');
            $table->decimal('line_total', 15, 2);
            $table->decimal('quantity_refunded', 15, 3)->default('0.000');
            $table->timestamps();

            $table->index('product_id');
        });

        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sale_id')->constrained()->restrictOnDelete();
            $table->string('method', 30);
            $table->decimal('amount', 15, 2);
            $table->decimal('tendered', 15, 2);
            $table->string('reference_number', 100)->nullable();
            $table->string('status', 20)->default('completed');
            $table->timestamps();

            $table->index(['tenant_id', 'method', 'created_at']);
        });

        Schema::create('refunds', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('sale_id')->constrained()->restrictOnDelete();
            $table->foreignId('register_session_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('reference', 40);
            $table->string('status', 30);
            $table->string('reason');
            $table->string('refund_method', 30);
            $table->decimal('subtotal', 15, 2);
            $table->decimal('vat_amount', 15, 2)->default('0.00');
            $table->decimal('total', 15, 2);
            $table->foreignId('requested_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->foreignId('rejected_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('rejected_at')->nullable();
            $table->string('rejection_reason')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'reference']);
            $table->index(['tenant_id', 'status', 'created_at']);
        });

        Schema::create('refund_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('refund_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sale_item_id')->constrained()->restrictOnDelete();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->decimal('quantity', 15, 3);
            $table->decimal('amount', 15, 2);
            $table->decimal('vat_amount', 15, 2)->default('0.00');
            $table->decimal('unit_cost', 15, 4);
            $table->boolean('restock')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('refund_items');
        Schema::dropIfExists('refunds');
        Schema::dropIfExists('payments');
        Schema::dropIfExists('sale_items');
        Schema::dropIfExists('sales');
        Schema::dropIfExists('register_sessions');
        Schema::dropIfExists('registers');
        Schema::dropIfExists('customers');
    }
};
