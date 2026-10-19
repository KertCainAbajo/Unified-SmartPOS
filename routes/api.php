<?php

use App\Http\Controllers\Api\V1\Auth\AuthController;
use App\Http\Controllers\Api\V1\Auth\EmailVerificationController;
use App\Http\Controllers\Api\V1\Auth\PasswordResetController;
use App\Http\Controllers\Api\V1\Auth\ProfileController;
use App\Http\Controllers\Api\V1\Auth\SignInOptionsController;
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
use App\Http\Controllers\Api\V1\Recruitment\ApplicationController;
use App\Http\Controllers\Api\V1\Recruitment\PublicCareerController;
use App\Http\Controllers\Api\V1\Recruitment\VacancyController;
use App\Http\Controllers\Api\V1\Reports\AuditLogController;
use App\Http\Controllers\Api\V1\Reports\ReportController;
use App\Http\Controllers\Api\V1\Staff\StaffActivationController;
use App\Http\Controllers\Api\V1\Staff\StaffController;
use App\Http\Controllers\Api\V1\Tenancy\BranchController;
use App\Http\Controllers\Api\V1\Tenancy\RoleController;
use App\Http\Controllers\Api\V1\Tenancy\TenantController;
use App\Http\Controllers\Api\V1\Shop\AddressAreaController;
use App\Http\Controllers\Api\V1\Shop\CustomerShopController;
use App\Http\Controllers\Api\V1\Shop\RiderDeliveryController;
use App\Http\Controllers\Api\V1\Shop\StaffOnlineOrderController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->name('api.v1.')->group(function () {
    // ---- Public authentication -------------------------------------------------------------
    Route::prefix('auth')->group(function () {
        Route::post('register', [AuthController::class, 'register'])->middleware('throttle:auth')->name('auth.register');
        Route::post('login', [AuthController::class, 'login'])->middleware('throttle:login')->name('auth.login');
        // Branch dropdown on the staff sign-in page (names only).
        Route::get('businesses', [SignInOptionsController::class, 'index'])->middleware('throttle:60,1')->name('auth.businesses');
        Route::get('businesses/{business}', [SignInOptionsController::class, 'show'])->middleware('throttle:60,1')->name('auth.business');
        Route::post('forgot-password', [PasswordResetController::class, 'sendLink'])->middleware('throttle:auth')->name('auth.forgot-password');
        Route::post('reset-password', [PasswordResetController::class, 'reset'])->middleware('throttle:auth')->name('auth.reset-password');
        Route::get('email/verify/{id}/{hash}', [EmailVerificationController::class, 'verify'])
            ->middleware(['signed', 'throttle:auth'])
            ->name('auth.verify-email');
    });

    // ---- Public staff onboarding / recovery (company-managed accounts) ----------------------
    Route::prefix('staff')->name('staff.')->middleware('throttle:staff-codes')->group(function () {
        Route::post('activate', [StaffActivationController::class, 'activate'])->name('activate');
        Route::post('forgot-password', [StaffActivationController::class, 'forgotPassword'])->name('forgot-password');
    });

    // ---- Public careers (applicants have no account: reference + secret token) ---------------
    Route::prefix('careers')->name('careers.')->middleware('throttle:public-applications')->group(function () {
        Route::get('{business}/vacancies', [PublicCareerController::class, 'vacancies'])->middleware('throttle:60,1')->withoutMiddleware('throttle:public-applications')->name('vacancies');
        Route::post('{business}/vacancies/{vacancy}/apply', [PublicCareerController::class, 'apply'])->whereNumber('vacancy')->name('apply');
        Route::post('applications/status', [PublicCareerController::class, 'status'])->name('status');
        Route::post('applications/documents', [PublicCareerController::class, 'upload'])->name('documents');
        Route::post('applications/withdraw', [PublicCareerController::class, 'withdraw'])->name('withdraw');
        Route::post('applications/offer-response', [PublicCareerController::class, 'offerResponse'])->name('offer-response');
        Route::post('applications/reschedule-request', [PublicCareerController::class, 'rescheduleRequest'])->name('reschedule-request');
    });

    // Philippine address dropdowns (region → province → city → barangay), cached from the official PSGC list.
    Route::get('address/areas', AddressAreaController::class)->middleware('throttle:120,1')->name('address.areas');

    // ---- Customer online shop ---------------------------------------------------------------
    Route::prefix('shop/{business}')->name('shop.')->middleware('throttle:api')->group(function () {
        Route::get('/', [CustomerShopController::class, 'catalog'])->name('catalog');
        Route::get('products/{product}/image', [CustomerShopController::class, 'productImage'])->whereNumber('product')->name('products.image');
        Route::post('register', [CustomerShopController::class, 'register'])->middleware('throttle:auth')->name('register');
        Route::post('login', [CustomerShopController::class, 'login'])->middleware('throttle:login')->name('login');
        Route::post('password/forgot', [CustomerShopController::class, 'forgotPassword'])->middleware('throttle:auth')->name('password.forgot');
        Route::post('password/verify', [CustomerShopController::class, 'verifyResetCode'])->middleware('throttle:customer-codes')->name('password.verify');
        Route::post('password/reset', [CustomerShopController::class, 'resetPassword'])->middleware('throttle:customer-codes')->name('password.reset');
        Route::middleware('auth:customer')->group(function () {
            Route::post('logout', [CustomerShopController::class, 'logout'])->name('logout');
            Route::get('me', [CustomerShopController::class, 'me'])->name('me');
            Route::patch('me', [CustomerShopController::class, 'updateProfile'])->name('me.update');
            Route::put('me/password', [CustomerShopController::class, 'changePassword'])->middleware('throttle:login')->name('me.password');
            Route::get('orders', [CustomerShopController::class, 'orders'])->name('orders.index');
            Route::get('purchases', [CustomerShopController::class, 'purchases'])->name('purchases.index');
            Route::post('orders', [CustomerShopController::class, 'placeOrder'])->middleware('throttle:checkout')->name('orders.store');
            Route::post('orders/{order}/cancel', [CustomerShopController::class, 'cancelOrder'])->whereNumber('order')->name('orders.cancel');
        });
    });

    // ---- Authenticated ---------------------------------------------------------------------
    Route::middleware(['auth:sanctum', 'active', 'throttle:api'])->group(function () {
        Route::post('auth/logout', [AuthController::class, 'logout'])->name('auth.logout');
        Route::post('auth/logout-all', [AuthController::class, 'logoutAll'])->name('auth.logout-all');
        Route::post('auth/email/verification-notification', [EmailVerificationController::class, 'resend'])
            ->middleware('throttle:auth')->name('auth.verification-notification');

        Route::get('me', [ProfileController::class, 'show'])->name('me.show');
        Route::patch('me', [ProfileController::class, 'update'])->name('me.update');
        Route::put('me/password', [ProfileController::class, 'updatePassword'])->name('me.password');
        Route::get('me/memberships', [ProfileController::class, 'memberships'])->name('me.memberships');
        Route::post('me/memberships/{membership}/accept', [ProfileController::class, 'acceptMembership'])->name('me.memberships.accept');
        Route::post('me/memberships/{membership}/decline', [ProfileController::class, 'declineMembership'])->name('me.memberships.decline');

        Route::post('tenants', [TenantController::class, 'store'])->middleware(['password.changed', 'verified.when_required'])->name('tenants.store');

        // ---- Platform administration (no access to tenant transactions) ------------------------
        Route::prefix('platform')->middleware(['password.changed', 'platform.admin'])->name('platform.')->group(function () {
            Route::get('tenants', [PlatformTenantController::class, 'index'])->name('tenants.index');
            Route::patch('tenants/{tenant}/status', [PlatformTenantController::class, 'updateStatus'])->name('tenants.status');
        });

        // ---- Tenant-scoped ---------------------------------------------------------------------
        Route::prefix('tenants/{tenant}')
            ->middleware(['password.changed', 'tenant', 'verified.when_required'])
            ->scopeBindings()
            ->name('tenants.')
            ->group(function () {
                Route::get('/', [TenantController::class, 'show'])->name('show');
                Route::patch('/', [TenantController::class, 'update'])->name('update');
                Route::get('context', [TenantController::class, 'context'])->name('context');

                Route::apiResource('branches', BranchController::class)->except('destroy');

                // Staff accounts (company-managed employees). Static paths before {staff}.
                Route::get('staff', [StaffController::class, 'index'])->name('staff.index');
                Route::post('staff', [StaffController::class, 'store'])->name('staff.store');
                Route::get('staff/username-suggestion', [StaffController::class, 'suggestUsername'])->name('staff.username-suggestion');
                Route::post('staff/invite-existing', [StaffController::class, 'inviteExisting'])->name('staff.invite-existing');
                Route::get('staff/audit-log', [StaffController::class, 'auditLog'])->name('staff.audit-log');
                Route::get('staff/{staff}', [StaffController::class, 'show'])->name('staff.show');
                Route::patch('staff/{staff}', [StaffController::class, 'update'])->name('staff.update');
                Route::post('staff/{staff}/change-role', [StaffController::class, 'changeRoles'])->name('staff.change-role');
                Route::post('staff/{staff}/transfer-branches', [StaffController::class, 'transferBranches'])->name('staff.transfer-branches');
                Route::post('staff/{staff}/suspend', [StaffController::class, 'suspend'])->name('staff.suspend');
                Route::post('staff/{staff}/reactivate', [StaffController::class, 'reactivate'])->name('staff.reactivate');
                Route::post('staff/{staff}/offboard', [StaffController::class, 'offboard'])->name('staff.offboard');
                Route::post('staff/{staff}/resend-invitation', [StaffController::class, 'resendInvitation'])->name('staff.resend-invitation');
                Route::post('staff/{staff}/recovery', [StaffController::class, 'recovery'])->name('staff.recovery');
                Route::get('staff/{staff}/pending-work', [StaffController::class, 'pendingWork'])->name('staff.pending-work');

                // Recruitment (hiring workflow; see RecruitmentService for the stage rules)
                Route::get('vacancies', [VacancyController::class, 'index'])->name('vacancies.index');
                Route::post('vacancies', [VacancyController::class, 'store'])->name('vacancies.store');
                Route::patch('vacancies/{vacancy}', [VacancyController::class, 'update'])->name('vacancies.update');
                Route::prefix('applications')->name('applications.')->controller(ApplicationController::class)->group(function () {
                    Route::get('/', 'index')->name('index');
                    Route::get('{application}', 'show')->name('show');
                    Route::get('{application}/interviewers', 'interviewers')->name('interviewers');
                    Route::post('{application}/start-screening', 'startScreening')->name('start-screening');
                    Route::post('{application}/screen', 'screen')->name('screen');
                    Route::post('{application}/clarification', 'clarification')->name('clarification');
                    Route::post('{application}/resume', 'resume')->name('resume');
                    Route::post('{application}/interviews', 'schedule')->name('interviews.schedule');
                    Route::post('{application}/interviews/{interview}/reschedule', 'reschedule')->name('interviews.reschedule');
                    Route::post('{application}/interviews/{interview}/cancel', 'cancelInterview')->name('interviews.cancel');
                    Route::post('{application}/interviews/{interview}/no-show', 'noShow')->name('interviews.no-show');
                    Route::post('{application}/interviews/{interview}/result', 'result')->name('interviews.result');
                    Route::post('{application}/another-interview', 'anotherInterview')->name('another-interview');
                    Route::post('{application}/reject', 'reject')->name('reject');
                    Route::post('{application}/withdraw', 'withdraw')->name('withdraw');
                    Route::post('{application}/offer', 'offer')->name('offer');
                    Route::post('{application}/offer-response', 'offerResponse')->name('offer-response');
                    Route::post('{application}/onboarding', 'startOnboarding')->name('onboarding');
                    Route::patch('{application}/onboarding-tasks/{onboardingTask}', 'updateTask')->name('onboarding-tasks.update');
                    Route::post('{application}/documents', 'uploadDocument')->name('documents.store');
                    Route::get('{application}/documents/{document}', 'downloadDocument')->name('documents.download');
                    Route::post('{application}/documents/{document}/verify', 'verifyDocument')->name('documents.verify');
                    Route::post('{application}/provision', 'provision')->name('provision');
                });

                Route::get('permissions', [RoleController::class, 'permissions'])->name('permissions.index');
                Route::apiResource('roles', RoleController::class)->except('show');

                // Catalog
                Route::apiResource('categories', CategoryController::class);
                Route::apiResource('products', ProductController::class)->except('destroy');
                Route::patch('products/{product}/price', [ProductController::class, 'updatePrice'])->name('products.price');
                Route::get('products/{product}/price-history', [ProductController::class, 'priceHistory'])->name('products.price-history');
                Route::post('products/{product}/archive', [ProductController::class, 'archive'])->name('products.archive');
                Route::post('products/{product}/restore', [ProductController::class, 'restore'])->name('products.restore');
                Route::get('products/{product}/image', [ProductController::class, 'image'])->name('products.image');
                Route::post('products/{product}/image', [ProductController::class, 'uploadImage'])->name('products.image.store');
                Route::delete('products/{product}/image', [ProductController::class, 'removeImage'])->name('products.image.destroy');

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
                Route::post('sales/quote', [SaleController::class, 'quote'])->name('sales.quote');
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
                Route::post('purchase-orders/{purchaseOrder}/close', [PurchaseOrderController::class, 'close'])->name('purchase-orders.close');
                Route::get('goods-receipts', [PurchaseOrderController::class, 'receipts'])->name('goods-receipts.index');
                Route::post('goods-receipts', [PurchaseOrderController::class, 'receive'])->name('goods-receipts.store');
                Route::get('goods-receipts/{goodsReceipt}', [PurchaseOrderController::class, 'showReceipt'])->name('goods-receipts.show');

                // Customers and expenses
                Route::apiResource('customers', CustomerController::class)->except('destroy');
                Route::get('online-orders', [StaffOnlineOrderController::class, 'index'])->name('online-orders.index');
                Route::get('online-orders/riders', [StaffOnlineOrderController::class, 'riders'])->name('online-orders.riders');
                Route::get('online-orders/{onlineOrder}', [StaffOnlineOrderController::class, 'show'])->name('online-orders.show');

                // Riders
                Route::get('deliveries', [RiderDeliveryController::class, 'index'])->name('deliveries.index');
                Route::get('deliveries/history', [RiderDeliveryController::class, 'history'])->name('deliveries.history');
                Route::post('deliveries/duty', [RiderDeliveryController::class, 'duty'])->name('deliveries.duty');
                Route::post('deliveries/{onlineOrder}/claim', [RiderDeliveryController::class, 'claim'])->name('deliveries.claim');
                Route::post('deliveries/{onlineOrder}/location', [RiderDeliveryController::class, 'location'])->name('deliveries.location');
                Route::post('deliveries/{onlineOrder}/delivered', [RiderDeliveryController::class, 'delivered'])->name('deliveries.delivered');
                Route::post('deliveries/{onlineOrder}/return', [RiderDeliveryController::class, 'returnToStore'])->name('deliveries.return');
                Route::post('online-orders/{onlineOrder}/status', [StaffOnlineOrderController::class, 'updateStatus'])->name('online-orders.status');
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
                    Route::get('sales-by-channel', [ReportController::class, 'salesByChannel'])->name('sales-by-channel');
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
