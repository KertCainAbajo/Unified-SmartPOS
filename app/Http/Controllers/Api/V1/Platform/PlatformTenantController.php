<?php

namespace App\Http\Controllers\Api\V1\Platform;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Tenant;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Platform Super Admin: tenant directory and account status only.
 *
 * Deliberately exposes no sales, payments, customers or other business transactions.
 *
 * @tags Platform administration
 */
class PlatformTenantController extends Controller
{
    /**
     * List businesses with non-sensitive metadata (who owns it, size, status). `summary` counts every business by
     * status. Filters: `q` (name or business code), `status`.
     */
    public function index(Request $request): JsonResponse
    {
        $tenants = Tenant::query()
            ->with('owner:id,name,email')
            ->withCount(['branches', 'memberships'])
            ->when($request->filled('q'), fn ($q) => $q->where(fn ($w) => $w
                ->whereLike('name', '%'.$request->string('q').'%')
                ->orWhereLike('slug', '%'.$request->string('q').'%')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->orderBy('id')
            ->paginate($this->perPage($request));

        $ids = $tenants->getCollection()->pluck('id');
        $lastActivity = DB::table('tenant_memberships')->join('users', 'users.id', '=', 'tenant_memberships.user_id')
            ->whereIn('tenant_memberships.tenant_id', $ids)->whereNotNull('users.last_login_at')
            ->selectRaw('tenant_memberships.tenant_id, max(users.last_login_at) as last')->groupBy('tenant_memberships.tenant_id')->pluck('last', 'tenant_id');
        // Why each suspended business was suspended (the latest reason recorded).
        $reasons = AuditLog::query()->whereIn('tenant_id', $ids)->where('action', 'platform.tenant_status_changed')->latest('id')->get(['tenant_id', 'metadata'])
            ->unique('tenant_id')->mapWithKeys(fn (AuditLog $l) => [$l->tenant_id => $l->metadata['reason'] ?? null]);

        $page = $tenants->through(fn (Tenant $t) => [
            'id' => $t->id,
            'name' => $t->name,
            'slug' => $t->slug,
            'status' => $t->status,
            'owner' => $t->owner ? ['name' => $t->owner->name, 'email' => $t->owner->email] : null,
            'branches_count' => $t->branches_count,
            'members_count' => $t->memberships_count,
            'created_at' => $t->created_at,
            'shop_enabled' => (bool) $t->shop_enabled,
            'last_activity_at' => isset($lastActivity[$t->id]) ? Carbon::parse($lastActivity[$t->id]) : null,
            'status_reason' => $t->status === 'suspended' ? ($reasons[$t->id] ?? null) : null,
        ])->toArray();

        $byStatus = Tenant::query()->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');

        return response()->json([...$page, 'summary' => [
            'total' => (int) $byStatus->sum(),
            'active' => (int) ($byStatus['active'] ?? 0),
            'suspended' => (int) ($byStatus['suspended'] ?? 0),
        ]]);
    }

    /** Suspend or reactivate a business. */
    public function updateStatus(Request $request, Tenant $tenant, AuditLogger $audit): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'in:active,suspended'],
            'reason' => ['required', 'string', 'max:255'],
        ]);

        $old = $tenant->status;
        $tenant->forceFill(['status' => $data['status']])->save();
        $audit->log('platform.tenant_status_changed', $tenant, ['status' => $old], ['status' => $tenant->status],
            ['reason' => $data['reason']], tenantId: $tenant->id);

        return response()->json(['id' => $tenant->id, 'status' => $tenant->status]);
    }
}
