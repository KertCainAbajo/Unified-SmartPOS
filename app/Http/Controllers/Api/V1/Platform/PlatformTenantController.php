<?php

namespace App\Http\Controllers\Api\V1\Platform;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
                ->where('name', 'like', '%'.$request->string('q').'%')
                ->orWhere('slug', 'like', '%'.$request->string('q').'%')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->orderBy('id')
            ->paginate($this->perPage($request));

        $page = $tenants->through(fn (Tenant $t) => [
            'id' => $t->id,
            'name' => $t->name,
            'slug' => $t->slug,
            'status' => $t->status,
            'owner' => $t->owner ? ['name' => $t->owner->name, 'email' => $t->owner->email] : null,
            'branches_count' => $t->branches_count,
            'members_count' => $t->memberships_count,
            'created_at' => $t->created_at,
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
