<?php

namespace App\Http\Controllers\Api\V1\Reports;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Tenant;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Audit trail (read-only; entries are never edited or deleted through the API).
 *
 * @tags Audit logs
 */
class AuditLogController extends Controller
{
    /**
     * Filters: `action` (exact or prefix with `*`, e.g. `sale.*`), `user_id`, `auditable_type`, `auditable_id`,
     * `date_from`, `date_to`. Members without all-branch access only see entries for their branches.
     * Requires `audit_logs.view`.
     */
    public function index(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::AUDIT_VIEW);
        $request->validate([
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d'],
        ]);
        $context = $this->tenantContext();
        $tz = $tenant->timezone;

        $logs = $tenant->auditLogs()
            ->with('user:id,name')
            ->when(! $context->hasAllBranches(), fn ($q) => $q->whereIn('branch_id', $context->branchIds()))
            ->when($request->filled('action'), function ($q) use ($request) {
                $action = $request->string('action')->toString();
                str_ends_with($action, '*')
                    ? $q->where('action', 'like', str_replace(['%', '_'], ['\%', '\_'], rtrim($action, '*')).'%')
                    : $q->where('action', $action);
            })
            ->when($request->filled('user_id'), fn ($q) => $q->where('user_id', $request->integer('user_id')))
            ->when($request->filled('auditable_type'), fn ($q) => $q->where('auditable_type', $request->string('auditable_type')))
            ->when($request->filled('auditable_id'), fn ($q) => $q->where('auditable_id', $request->integer('auditable_id')))
            ->when($request->filled('date_from'), fn ($q) => $q->where('created_at', '>=', Carbon::parse($request->string('date_from'), $tz)->startOfDay()->utc()))
            ->when($request->filled('date_to'), fn ($q) => $q->where('created_at', '<=', Carbon::parse($request->string('date_to'), $tz)->endOfDay()->utc()))
            ->latest('id')
            ->paginate($this->perPage($request, 50));

        return response()->json($logs->through(fn (AuditLog $log) => [
            'id' => $log->id,
            'action' => $log->action,
            'user' => $log->user?->only(['id', 'name']),
            'branch_id' => $log->branch_id,
            'auditable_type' => $log->auditable_type,
            'auditable_id' => $log->auditable_id,
            'old_values' => $log->old_values,
            'new_values' => $log->new_values,
            'metadata' => $log->metadata,
            'ip_address' => $log->ip_address,
            'created_at' => $log->created_at,
        ]));
    }
}
