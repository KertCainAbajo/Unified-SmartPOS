<?php

namespace App\Http\Controllers\Api\V1\Reports;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Customer;
use App\Models\GoodsReceipt;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\Refund;
use App\Models\Register;
use App\Models\Sale;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

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
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->integer('branch_id')))
            ->when($request->filled('user_id'), fn ($q) => $q->where('user_id', $request->integer('user_id')))
            ->when($request->filled('auditable_type'), fn ($q) => $q->where('auditable_type', $request->string('auditable_type')))
            ->when($request->filled('auditable_id'), fn ($q) => $q->where('auditable_id', $request->integer('auditable_id')))
            ->when($request->filled('date_from'), fn ($q) => $q->where('created_at', '>=', Carbon::parse($request->string('date_from'), $tz)->startOfDay()->utc()))
            ->when($request->filled('date_to'), fn ($q) => $q->where('created_at', '<=', Carbon::parse($request->string('date_to'), $tz)->endOfDay()->utc()))
            ->latest('id')
            ->paginate($this->perPage($request, 50));

        $subjects = $this->subjectNames($tenant, $logs->getCollection());
        $people = $this->peopleNames($tenant, $logs->getCollection());

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
            // Readable names so the log can say "Ana Cruz" or "Coca-Cola 1L" instead of record numbers.
            'subject_name' => $subjects[$log->auditable_type][$log->auditable_id] ?? null,
            'people' => array_intersect_key($people, array_flip($this->referencedUserIds($log))),
        ]));
    }

    /** Record types whose own name or number describes them, and the column that holds it. */
    private const SUBJECT_COLUMNS = [
        Branch::class => 'name', Product::class => 'name', Customer::class => 'name', Supplier::class => 'name',
        Category::class => 'name', Register::class => 'name', Sale::class => 'receipt_number', Refund::class => 'reference',
        GoodsReceipt::class => 'reference', PurchaseOrder::class => 'reference',
    ];

    /**
     * Names of the records on this page, looked up in one query per type and only inside this business.
     *
     * @param  Collection<int, AuditLog>  $logs
     * @return array<string, array<int, string>>
     */
    private function subjectNames(Tenant $tenant, Collection $logs): array
    {
        $names = [];
        foreach ($logs->whereNotNull('auditable_type')->groupBy('auditable_type') as $type => $group) {
            $ids = $group->pluck('auditable_id')->filter()->unique()->values();
            if (isset(self::SUBJECT_COLUMNS[$type])) {
                $column = self::SUBJECT_COLUMNS[$type];
                $names[$type] = $type::query()->where('tenant_id', $tenant->id)->whereIn('id', $ids)->pluck($column, 'id')->all();
            } elseif ($type === TenantMembership::class) {
                $names[$type] = TenantMembership::query()->where('tenant_id', $tenant->id)->whereIn('tenant_memberships.id', $ids)
                    ->join('users', 'users.id', '=', 'tenant_memberships.user_id')->pluck('users.name', 'tenant_memberships.id')->all();
            } elseif ($type === User::class) {
                $names[$type] = $this->memberNames($tenant, $ids->all());
            }
        }

        return $names;
    }

    /**
     * Names of staff referred to by id inside the entries (user_id, rider_user_id, approved_by, ...), members only.
     *
     * @param  Collection<int, AuditLog>  $logs
     * @return array<int, string>
     */
    private function peopleNames(Tenant $tenant, Collection $logs): array
    {
        return $this->memberNames($tenant, $logs->flatMap(fn (AuditLog $log) => $this->referencedUserIds($log))->unique()->values()->all());
    }

    /** @return list<int> */
    private function referencedUserIds(AuditLog $log): array
    {
        $ids = [];
        foreach ([$log->old_values, $log->new_values, $log->metadata] as $values) {
            foreach ((array) $values as $key => $value) {
                if (is_numeric($value) && (str_ends_with((string) $key, 'user_id') || str_ends_with((string) $key, '_by'))) {
                    $ids[] = (int) $value;
                }
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * @param  list<int>  $userIds
     * @return array<int, string>
     */
    private function memberNames(Tenant $tenant, array $userIds): array
    {
        if ($userIds === []) {
            return [];
        }

        return User::query()->whereIn('users.id', $userIds)
            ->whereExists(fn ($q) => $q->from('tenant_memberships')->whereColumn('tenant_memberships.user_id', 'users.id')->where('tenant_memberships.tenant_id', $tenant->id))
            ->pluck('name', 'id')->all();
    }
}
