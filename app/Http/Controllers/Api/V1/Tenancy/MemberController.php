<?php

namespace App\Http\Controllers\Api\V1\Tenancy;

use App\Http\Controllers\Controller;
use App\Http\Resources\MembershipResource;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Services\Tenancy\MembershipService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * @tags Members
 */
class MemberController extends Controller
{
    public function __construct(private readonly MembershipService $memberships) {}

    /** Team members. Requires `members.view`. */
    public function index(Request $request, Tenant $tenant): AnonymousResourceCollection
    {
        $this->authorize('viewAny', TenantMembership::class);

        $members = $tenant->memberships()
            ->with(['user', 'roles', 'branches'])
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->orderBy('id')
            ->paginate($this->perPage($request));

        return MembershipResource::collection($members);
    }

    /**
     * Add a member.
     *
     * Requires `members.manage`. Existing users are linked; new users receive a password-setup email.
     * The caller can only grant roles whose permissions they hold themselves, and only branches they can access.
     */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorize('create', TenantMembership::class);

        $data = $request->validate([
            'email' => ['required', 'email:rfc', 'max:255'],
            'name' => ['nullable', 'string', 'max:255'],
            'role_ids' => ['required', 'array', 'min:1'],
            'role_ids.*' => ['integer', 'distinct'],
            'all_branches' => ['sometimes', 'boolean'],
            'branch_ids' => ['sometimes', 'array'],
            'branch_ids.*' => ['integer', 'distinct'],
        ]);

        return (new MembershipResource($this->memberships->add($data)))->response()->setStatusCode(201);
    }

    public function show(Tenant $tenant, TenantMembership $membership): MembershipResource
    {
        $this->authorize('view', $membership);

        return new MembershipResource($membership->load(['user', 'roles', 'branches']));
    }

    /**
     * Change a member's roles, branches or status.
     *
     * Requires `members.manage`. Members cannot change their own membership, and nobody can change the owner's.
     */
    public function update(Request $request, Tenant $tenant, TenantMembership $membership): MembershipResource
    {
        $this->authorize('update', $membership);

        $data = $request->validate([
            'role_ids' => ['sometimes', 'array', 'min:1'],
            'role_ids.*' => ['integer', 'distinct'],
            'all_branches' => ['sometimes', 'boolean'],
            'branch_ids' => ['sometimes', 'array'],
            'branch_ids.*' => ['integer', 'distinct'],
            'status' => ['sometimes', 'in:active,suspended'],
        ]);

        return new MembershipResource($this->memberships->update($membership, $data));
    }
}
