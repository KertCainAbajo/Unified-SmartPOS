<?php

namespace App\Http\Controllers\Api\V1\Tenancy;

use App\Http\Controllers\Controller;
use App\Http\Resources\BranchResource;
use App\Models\Branch;
use App\Models\Tenant;
use App\Services\AuditLogger;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * @tags Branches
 */
class BranchController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** Branches the caller is authorized for. */
    public function index(Tenant $tenant): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Branch::class);

        return BranchResource::collection(
            $this->scopeToAccessibleBranches($tenant->branches(), 'id')->orderBy('name')->get()
        );
    }

    /**
     * Create a branch. Requires `branches.manage` (owner and branch managers). A creator who is limited to certain
     * branches is given access to the new branch so they can run it.
     */
    public function store(Request $request, Tenant $tenant, TenantContext $context): JsonResponse
    {
        $this->authorize('create', Branch::class);

        $data = $request->validate([
            'code' => ['required', 'string', 'max:20', 'alpha_dash', Rule::unique('branches')->where('tenant_id', $tenant->id)],
            'name' => ['required', 'string', 'max:255'],
            'address' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:30'],
        ]);
        $data['code'] = strtoupper($data['code']);

        $branch = DB::transaction(function () use ($tenant, $data, $context) {
            $branch = $tenant->branches()->create($data);
            $this->audit->log('branch.created', $branch, null, $data, branchId: $branch->id);

            $membership = $context->membership();
            if (! $membership->all_branches) {
                $membership->branches()->syncWithoutDetaching([$branch->id]);
                $this->audit->log('staff.branches_changed', $membership, null, ['added_branch_id' => $branch->id],
                    ['reason' => 'creator_of_new_branch', 'user_id' => $membership->user_id], branchId: $branch->id);
            }

            return $branch;
        });

        return (new BranchResource($branch))->response()->setStatusCode(201);
    }

    public function show(Tenant $tenant, Branch $branch): BranchResource
    {
        $this->authorize('view', $branch);

        return new BranchResource($branch);
    }

    /** Update or deactivate a branch. Requires `branches.manage`. */
    public function update(Request $request, Tenant $tenant, Branch $branch): BranchResource
    {
        $this->authorize('update', $branch);

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $original = $branch->getOriginal();
        $branch->fill($data)->save();
        $this->audit->logChanges('branch.updated', $branch, $original);

        return new BranchResource($branch);
    }
}
