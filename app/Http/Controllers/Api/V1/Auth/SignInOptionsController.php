<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Tenant;
use Illuminate\Http\JsonResponse;

/**
 * @tags Authentication
 */
class SignInOptionsController extends Controller
{
    /**
     * Every active store with its active branches, for the staff sign-in dropdown on a device that has no store
     * yet. Names only. 404 when the directory is turned off (`SMARTPOS_PUBLIC_STORE_LIST=false`).
     *
     * @unauthenticated
     */
    public function index(): JsonResponse
    {
        abort_unless(config('smartpos.public_store_list'), 404);

        $stores = Tenant::query()
            ->where('status', 'active')
            ->with(['branches' => fn ($q) => $q->where('is_active', true)->orderBy('name')])
            ->orderBy('name')
            ->limit(200)
            ->get()
            ->filter(fn (Tenant $t) => $t->branches->isNotEmpty())
            ->map(fn (Tenant $t) => [
                'code' => $t->slug,
                'name' => $t->name,
                'branches' => $t->branches->map(fn (Branch $b) => ['id' => $b->id, 'name' => $b->name])->values(),
            ])
            ->values();

        return response()->json(['data' => $stores]);
    }

    /**
     * Store name and active branch names for the staff sign-in page (branch dropdown). Public: shows only names,
     * which also appear on the careers page; an unknown or suspended business gives 404.
     *
     * @unauthenticated
     */
    public function show(string $business): JsonResponse
    {
        $tenant = Tenant::query()->where('slug', mb_strtolower(trim($business)))->where('status', 'active')->firstOrFail();

        return response()->json([
            'business' => ['code' => $tenant->slug, 'name' => $tenant->name],
            'branches' => $tenant->branches()->where('is_active', true)->orderBy('name')->get()
                ->map(fn (Branch $b) => ['id' => $b->id, 'name' => $b->name])->values(),
        ]);
    }
}
