<?php

use App\Http\Controllers\Api\V1\Auth\AuthController;
use App\Http\Controllers\Api\V1\Auth\EmailVerificationController;
use App\Http\Controllers\Api\V1\Auth\PasswordResetController;
use App\Http\Controllers\Api\V1\Auth\ProfileController;
use App\Http\Controllers\Api\V1\Catalog\CategoryController;
use App\Http\Controllers\Api\V1\Catalog\ProductController;
use App\Http\Controllers\Api\V1\Inventory\InventoryController;
use App\Http\Controllers\Api\V1\Inventory\StockCountController;
use App\Http\Controllers\Api\V1\Inventory\StockTransferController;
use App\Http\Controllers\Api\V1\Operations\CustomerController;
use App\Http\Controllers\Api\V1\Operations\ExpenseController;
use App\Http\Controllers\Api\V1\Operations\NotificationController;
use App\Http\Controllers\Api\V1\Platform\PlatformTenantController;
use App\Http\Controllers\Api\V1\Pos\RefundController;
use App\Http\Controllers\Api\V1\Pos\RegisterController;
use App\Http\Controllers\Api\V1\Pos\RegisterSessionController;
use App\Http\Controllers\Api\V1\Pos\SaleController;
use App\Http\Controllers\Api\V1\Purchasing\PurchaseOrderController;
use App\Http\Controllers\Api\V1\Purchasing\SupplierController;
use App\Http\Controllers\Api\V1\Reports\AuditLogController;
use App\Http\Controllers\Api\V1\Reports\ReportController;
use App\Http\Controllers\Api\V1\Tenancy\BranchController;
use App\Http\Controllers\Api\V1\Tenancy\MemberController;
use App\Http\Controllers\Api\V1\Tenancy\RoleController;
use App\Http\Controllers\Api\V1\Tenancy\TenantController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->name('api.v1.')->group(function () {
    // ---- Public authentication -------------------------------------------------------------
    Route::prefix('auth')->group(function () {
        Route::post('register', [AuthController::class, 'register'])->middleware('throttle:auth')->name('auth.register');
        Route::post('login', [AuthController::class, 'login'])->middleware('throttle:login')->name('auth.login');
        Route::post('forgot-password', [PasswordResetController::class, 'sendLink'])->middleware('throttle:auth')->name('auth.forgot-password');
        Route::post('reset-password', [PasswordResetController::class, 'reset'])->middleware('throttle:auth')->name('auth.reset-password');
        Route::get('email/verify/{id}/{hash}', [EmailVerificationController::class, 'verify'])
            ->middleware(['signed', 'throttle:auth'])
            ->name('auth.verify-email');
    });

    // ---- Authenticated ---------------------------------------------------------------------
    Route::middleware(['auth:sanctum', 'throttle:api'])->group(function () {
        Route::post('auth/logout', [AuthController::class, 'logout'])->name('auth.logout');
        Route::post('auth/logout-all', [AuthController::class, 'logoutAll'])->name('auth.logout-all');
        Route::post('auth/email/verification-notification', [EmailVerificationController::class, 'resend'])
            ->middleware('throttle:auth')->name('auth.verification-notification');

        Route::get('me', [ProfileController::class, 'show'])->name('me.show');
        Route::patch('me', [ProfileController::class, 'update'])->name('me.update');
        Route::put('me/password', [ProfileController::class, 'updatePassword'])->name('me.password');
        Route::get('me/memberships', [ProfileController::class, 'memberships'])->name('me.memberships');

        Route::post('tenants', [TenantController::class, 'store'])->middleware('verified.when_required')->name('tenants.store');

        // ---- Platform administration (no access to tenant transactions) ------------------------
        Route::prefix('platform')->middleware('platform.admin')->name('platform.')->group(function () {
            Route::get('tenants', [PlatformTenantController::class, 'index'])->name('tenants.index');
            Route::patch('tenants/{tenant}/status', [PlatformTenantController::class, 'updateStatus'])->name('tenants.status');
        });

        // ---- Tenant-scoped ---------------------------------------------------------------------
        Route::prefix('tenants/{tenant}')
            ->middleware(['tenant', 'verified.when_required'])
            ->scopeBindings()
            ->name('tenants.')
            ->group(function () {
                Route::get('/', [TenantController::class, 'show'])->name('show');
                Route::patch('/', [TenantController::class, 'update'])->name('update');
                Route::get('context', [TenantController::class, 'context'])->name('context');

                Route::apiResource('branches', BranchController::class)->except('destroy');

                Route::get('members', [MemberController::class, 'index'])->name('members.index');
                Route::post('members', [MemberController::class, 'store'])->name('members.store');
                Route::get('members/{membership}', [MemberController::class, 'show'])->name('members.show');
                Route::patch('members/{membership}', [MemberController::class, 'update'])->name('members.update');

                Route::get('permissions', [RoleController::class, 'permissions'])->name('permissions.index');
                Route::apiResource('roles', RoleController::class)->except('show');

                // Catalog
                Route::apiResource('categories', CategoryController::class);
                Route::apiResource('products', ProductController::class)->except('destroy');
                Route::patch('products/{product}/price', [ProductController::class, 'updatePrice'])->name('products.price');
                Route::get('products/{product}/price-history', [ProductController::class, 'priceHistory'])->name('products.price-history');
                Route::post('products/{product}/archive', [ProductController::class, 'archive'])->name('products.archive');
                Route::post('products/{product}/restore', [ProductController::class, 'restore'])->name('products.restore');

                // Inventory
                Route::get('inventory', [InventoryController::class, 'index'])->name('inventory.index');
                Route::get('inventory/low-stock', [InventoryController::class, 'lowStock'])->name('inventory.low-stock');
                Route::post('inventory/adjustments', [InventoryController::class, 'adjust'])->name('inventory.adjust');
                Route::get('stock-movements', [InventoryController::class, 'movements'])->name('stock-movements.index');

                Route::get('stock-transfers', [StockTransferController::class, 'index'])->name('stock-transfers.index');
                Route::post('stock-transfers', [StockTransferController::class, 'store'])->name('stock-transfers.store');
                Route::get('stock-transfers/{stockTransfer}', [StockTransferController::class, 'show'])->name('stock-transfers.show');
                Route::post('stock-transfers/{stockTransfer}/dispatch', [StockTransferController::class, 'dispatch'])->name('stock-transfers.dispatch');
                Route::post('stock-transfers/{stockTransfer}/receive', [StockTransferController::class, 'receive'])->name('stock-transfers.receive');
                Route::post('stock-transfers/{stockTransfer}/cancel', [StockTransferController::class, 'cancel'])->name('stock-transfers.cancel');

                Route::get('stock-counts', [StockCountController::class, 'index'])->name('stock-counts.index');
                Route::post('stock-counts', [StockCountController::class, 'store'])->name('stock-counts.store');
                Route::get('stock-counts/{stockCount}', [StockCountController::class, 'show'])->name('stock-counts.show');
                Route::post('stock-counts/{stockCount}/complete', [StockCountController::class, 'complete'])->name('stock-counts.complete');
                Route::post('stock-counts/{stockCount}/cancel', [StockCountController::class, 'cancel'])->name('stock-counts.cancel');

                // POS: registers, shifts, sales, payments
                Route::get('registers', [RegisterController::class, 'index'])->name('registers.index');
                Route::post('registers', [RegisterController::class, 'store'])->name('registers.store');
                Route::patch('registers/{register}', [RegisterController::class, 'update'])->name('registers.update');

                Route::get('register-sessions', [RegisterSessionController::class, 'index'])->name('register-sessions.index');
                Route::get('register-sessions/current', [RegisterSessionController::class, 'current'])->name('register-sessions.current');
                Route::post('register-sessions', [RegisterSessionController::class, 'store'])->name('register-sessions.open');
                Route::get('register-sessions/{registerSession}', [RegisterSessionController::class, 'show'])->name('register-sessions.show');
                Route::post('register-sessions/{registerSession}/close', [RegisterSessionController::class, 'close'])->name('register-sessions.close');

                Route::get('sales', [SaleController::class, 'index'])->name('sales.index');
                Route::post('sales', [SaleController::class, 'store'])->middleware('throttle:checkout')->name('sales.checkout');
                Route::get('sales/{sale}', [SaleController::class, 'show'])->name('sales.show');
                Route::get('sales/{sale}/receipt', [SaleController::class, 'receipt'])->name('sales.receipt');
                Route::post('sales/{sale}/void', [SaleController::class, 'void'])->name('sales.void');
                Route::get('payments', [SaleController::class, 'payments'])->name('payments.index');

                Route::get('refunds', [RefundController::class, 'index'])->name('refunds.index');
                Route::post('refunds', [RefundController::class, 'store'])->name('refunds.store');
                Route::get('refunds/{refund}', [RefundController::class, 'show'])->name('refunds.show');
                Route::post('refunds/{refund}/approve', [RefundController::class, 'approve'])->name('refunds.approve');
                Route::post('refunds/{refund}/reject', [RefundController::class, 'reject'])->name('refunds.reject');

                // Purchasing
                Route::apiResource('suppliers', SupplierController::class)->except('destroy');
                Route::get('purchase-orders', [PurchaseOrderController::class, 'index'])->name('purchase-orders.index');
                Route::post('purchase-orders', [PurchaseOrderController::class, 'store'])->name('purchase-orders.store');
                Route::get('purchase-orders/{purchaseOrder}', [PurchaseOrderController::class, 'show'])->name('purchase-orders.show');
                Route::patch('purchase-orders/{purchaseOrder}', [PurchaseOrderController::class, 'update'])->name('purchase-orders.update');
                Route::post('purchase-orders/{purchaseOrder}/order', [PurchaseOrderController::class, 'order'])->name('purchase-orders.order');
                Route::post('purchase-orders/{purchaseOrder}/cancel', [PurchaseOrderController::class, 'cancel'])->name('purchase-orders.cancel');
                Route::get('goods-receipts', [PurchaseOrderController::class, 'receipts'])->name('goods-receipts.index');
                Route::post('goods-receipts', [PurchaseOrderController::class, 'receive'])->name('goods-receipts.store');
                Route::get('goods-receipts/{goodsReceipt}', [PurchaseOrderController::class, 'showReceipt'])->name('goods-receipts.show');

                // Customers and expenses
                Route::apiResource('customers', CustomerController::class)->except('destroy');
                Route::get('expense-categories', [ExpenseController::class, 'categories'])->name('expense-categories.index');
                Route::post('expense-categories', [ExpenseController::class, 'storeCategory'])->name('expense-categories.store');
                Route::patch('expense-categories/{expenseCategory}', [ExpenseController::class, 'updateCategory'])->name('expense-categories.update');
                Route::apiResource('expenses', ExpenseController::class);

                // Reports and audit
                Route::prefix('reports')->name('reports.')->group(function () {
                    Route::get('sales-summary', [ReportController::class, 'salesSummary'])->name('sales-summary');
                    Route::get('sales-by-branch', [ReportController::class, 'salesByBranch'])->name('sales-by-branch');
                    Route::get('sales-by-cashier', [ReportController::class, 'salesByCashier'])->name('sales-by-cashier');
                    Route::get('sales-by-payment-method', [ReportController::class, 'salesByPaymentMethod'])->name('sales-by-payment-method');
                    Route::get('best-sellers', [ReportController::class, 'bestSellers'])->name('best-sellers');
                    Route::get('low-stock', [InventoryController::class, 'lowStock'])->name('low-stock');
                    Route::get('inventory-movements', [ReportController::class, 'inventoryMovements'])->name('inventory-movements');
                    Route::get('discounts-refunds', [ReportController::class, 'discountsAndRefunds'])->name('discounts-refunds');
                    Route::get('expenses', [ReportController::class, 'expenses'])->name('expenses');
                    Route::get('profit', [ReportController::class, 'profit'])->name('profit');
                });
                Route::get('audit-logs', [AuditLogController::class, 'index'])->name('audit-logs.index');

                // Notifications (own only)
                Route::get('notifications', [NotificationController::class, 'index'])->name('notifications.index');
                Route::post('notifications/read-all', [NotificationController::class, 'markAllRead'])->name('notifications.read-all');
                Route::post('notifications/{notification}/read', [NotificationController::class, 'markRead'])->name('notifications.read');
            });
    });
});
