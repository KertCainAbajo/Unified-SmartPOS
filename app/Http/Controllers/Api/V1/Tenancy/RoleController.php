<?php

namespace App\Http\Controllers\Api\V1\Tenancy;

use App\Exceptions\BusinessRuleException;
use App\Http\Controllers\Controller;
use App\Http\Resources\RoleResource;
use App\Models\Permission;
use App\Models\Role;
use App\Models\Tenant;
use App\Services\AuditLogger;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * @tags Roles and permissions
 */
class RoleController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** System roles and this business's custom roles, with their permissions. Requires `staff.view`. */
    public function index(Tenant $tenant): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Role::class);

        return RoleResource::collection(
            Role::query()->availableTo($tenant->id)->with('permissions')->orderBy('is_system', 'desc')->orderBy('name')->get()
        );
    }

    /** The permission catalogue. Requires `staff.view`. */
    public function permissions(): JsonResponse
    {
        $this->authorize('viewAny', Role::class);

        return response()->json([
            'data' => Permission::query()->orderBy('group')->orderBy('key')->get(['key', 'name', 'group', 'description']),
        ]);
    }

    /** Create a custom role. Requires `roles.manage`; only permissions the caller holds may be included. */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorize('create', Role::class);

        $data = $this->validated($request, $tenant);

        $role = DB::transaction(function () use ($tenant, $data) {
            $role = Role::query()->create([
                'tenant_id' => $tenant->id,
                'key' => $data['key'],
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'is_system' => false,
            ]);
            $role->permissions()->sync($this->permissionIds($data['permissions']));
            $this->audit->log('role.created', $role, null, ['key' => $role->key, 'permissions' => $data['permissions']]);

            return $role;
        });

        return (new RoleResource($role->load('permissions')))->response()->setStatusCode(201);
    }

    /** Update a custom role. System roles cannot be changed. */
    public function update(Request $request, Tenant $tenant, Role $role): RoleResource
    {
        $this->authorize('update', $role);

        $data = $this->validated($request, $tenant, $role);
        $old = ['name' => $role->name, 'permissions' => $role->permissions()->pluck('key')->all()];

        DB::transaction(function () use ($role, $data, $old) {
            $role->fill(array_intersect_key($data, array_flip(['name', 'description'])))->save();
            if (isset($data['permissions'])) {
                $role->permissions()->sync($this->permissionIds($data['permissions']));
            }
            $this->audit->log('role.updated', $role, $old, ['name' => $role->name, 'permissions' => $data['permissions'] ?? $old['permissions']]);
        });

        return new RoleResource($role->load('permissions'));
    }

    /** Delete an unassigned custom role. */
    public function destroy(Tenant $tenant, Role $role): JsonResponse
    {
        $this->authorize('delete', $role);

        if (DB::table('membership_roles')->where('role_id', $role->id)->exists()) {
            throw new BusinessRuleException('This role is still assigned to members.', 'ROLE_IN_USE');
        }

        $this->audit->log('role.deleted', $role, ['key' => $role->key, 'name' => $role->name]);
        $role->delete();

        return response()->json(null, 204);
    }

    private function validated(Request $request, Tenant $tenant, ?Role $role = null): array
    {
        $required = $role ? 'sometimes' : 'required';

        $data = $request->validate([
            'key' => [$role ? 'prohibited' : 'required', 'string', 'max:100', 'alpha_dash',
                Rule::unique('roles')->where('tenant_id', $tenant->id),
                Rule::notIn(array_keys(Permissions::systemRoles()))],
            'name' => [$required, 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:255'],
            'permissions' => [$required, 'array', 'min:1'],
            'permissions.*' => ['string', 'distinct', Rule::exists('permissions', 'key')],
        ]);

        foreach ($data['permissions'] ?? [] as $key) {
            if (! $this->tenantContext()->can($key)) {
                throw new BusinessRuleException('You cannot grant permissions you do not hold.', 'ROLE_ESCALATION', status: 403);
            }
        }

        return $data;
    }

    /** @param list<string> $keys */
    private function permissionIds(array $keys): array
    {
        return Permission::query()->whereIn('key', $keys)->pluck('id')->all();
    }
}
