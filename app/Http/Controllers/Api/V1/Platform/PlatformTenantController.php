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
    /** List businesses with non-sensitive metadata. */
    public function index(Request $request): JsonResponse
    {
        $tenants = Tenant::query()
            ->withCount(['branches', 'memberships'])
            ->when($request->filled('q'), fn ($q) => $q->where('name', 'like', '%'.$request->string('q').'%'))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->orderBy('id')
            ->paginate($this->perPage($request));

        return response()->json($tenants->through(fn (Tenant $t) => [
            'id' => $t->id,
            'name' => $t->name,
            'slug' => $t->slug,
            'status' => $t->status,
            'branches_count' => $t->branches_count,
            'members_count' => $t->memberships_count,
            'created_at' => $t->created_at,
        ]));
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
