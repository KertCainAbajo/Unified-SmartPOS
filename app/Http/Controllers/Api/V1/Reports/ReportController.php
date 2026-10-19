<?php

namespace App\Http\Controllers\Api\V1\Reports;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\Reports\ReportService;
use App\Support\Permissions;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Reports. Common query parameters: `date_from`, `date_to` (YYYY-MM-DD, tenant timezone; default:
 * current month, maximum 366 days) and `branch_id` (must be an authorized branch). Results are always
 * limited to the caller's authorized branches.
 *
 * @tags Reports
 */
class ReportController extends Controller
{
    /** Daily (`group_by=day`) or monthly (`group_by=month`) sales with refunds. Requires `reports.view`. */
    public function salesSummary(Request $request, Tenant $tenant): JsonResponse
    {
        $request->validate(['group_by' => ['sometimes', Rule::in(['day', 'month'])]]);

        return $this->respond($request, $tenant, Permissions::REPORTS_VIEW,
            fn (ReportService $r) => $r->salesSummary($request->string('group_by', 'day')->toString()));
    }

    public function salesByBranch(Request $request, Tenant $tenant): JsonResponse
    {
        return $this->respond($request, $tenant, Permissions::REPORTS_VIEW, fn (ReportService $r) => $r->salesByBranch());
    }

    public function salesByCashier(Request $request, Tenant $tenant): JsonResponse
    {
        return $this->respond($request, $tenant, Permissions::REPORTS_VIEW, fn (ReportService $r) => $r->salesByCashier());
    }

    public function salesByPaymentMethod(Request $request, Tenant $tenant): JsonResponse
    {
        return $this->respond($request, $tenant, Permissions::REPORTS_VIEW, fn (ReportService $r) => $r->salesByPaymentMethod());
    }

    /** Completed sales by channel: in store, online pickup and online delivery. */
    public function salesByChannel(Request $request, Tenant $tenant): JsonResponse
    {
        return $this->respond($request, $tenant, Permissions::REPORTS_VIEW, fn (ReportService $r) => $r->salesByChannel());
    }

    /** Top products by net quantity sold. `limit` 1-100 (default 20). */
    public function bestSellers(Request $request, Tenant $tenant): JsonResponse
    {
        $request->validate(['limit' => ['sometimes', 'integer', 'between:1,100']]);

        return $this->respond($request, $tenant, Permissions::REPORTS_VIEW,
            fn (ReportService $r) => $r->bestSellers($request->integer('limit', 20)));
    }

    /** Stock movements aggregated by type, with value at cost. */
    public function inventoryMovements(Request $request, Tenant $tenant): JsonResponse
    {
        return $this->respond($request, $tenant, Permissions::REPORTS_VIEW, fn (ReportService $r) => $r->inventoryMovements());
    }

    public function discountsAndRefunds(Request $request, Tenant $tenant): JsonResponse
    {
        return $this->respond($request, $tenant, Permissions::REPORTS_VIEW, fn (ReportService $r) => $r->discountsAndRefunds());
    }

    /** Recorded operating expenses by category. Requires `reports.financial`. */
    public function expenses(Request $request, Tenant $tenant): JsonResponse
    {
        return $this->respond($request, $tenant, Permissions::REPORTS_FINANCIAL, fn (ReportService $r) => $r->expensesByCategory());
    }

    /**
     * Estimated gross profit (net revenue − COGS) and operating profit (− recorded expenses).
     * Not net profit. Requires `reports.financial`.
     */
    public function profit(Request $request, Tenant $tenant): JsonResponse
    {
        return $this->respond($request, $tenant, Permissions::REPORTS_FINANCIAL, fn (ReportService $r) => $r->profit());
    }

    private function respond(Request $request, Tenant $tenant, string $permission, callable $build): JsonResponse
    {
        $this->authorizePermission($permission);

        $data = $request->validate([
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'branch_id' => ['sometimes', 'integer', Rule::exists('branches', 'id')->where('tenant_id', $tenant->id)],
        ]);

        $today = Carbon::now($tenant->timezone);
        $from = $data['date_from'] ?? $today->copy()->startOfMonth()->toDateString();
        $to = $data['date_to'] ?? $today->toDateString();

        if (Carbon::parse($from)->diffInDays(Carbon::parse($to)) > 366) {
            return response()->json(['message' => 'The date range cannot exceed 366 days.', 'errors' => ['date_to' => ['The date range cannot exceed 366 days.']]], 422);
        }

        $context = $this->tenantContext();
        if (isset($data['branch_id'])) {
            if (! $context->canAccessBranch($data['branch_id'])) {
                throw new AuthorizationException('You cannot view reports for this branch.');
            }
            $branchIds = [(int) $data['branch_id']];
        } else {
            $branchIds = $context->branchIds();
        }

        $service = new ReportService($tenant, $from, $to, $branchIds);

        return response()->json([
            'filters' => [
                'date_from' => $from,
                'date_to' => $to,
                'branch_ids' => $branchIds,
                'timezone' => $tenant->timezone,
                'currency' => $tenant->currency,
            ],
            'data' => $build($service),
        ]);
    }
}
