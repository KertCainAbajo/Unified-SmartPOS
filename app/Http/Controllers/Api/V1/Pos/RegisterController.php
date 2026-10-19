<?php

namespace App\Http\Controllers\Api\V1\Pos;

use App\Exceptions\BusinessRuleException;
use App\Http\Controllers\Controller;
use App\Models\Register;
use App\Models\Tenant;
use App\Services\AuditLogger;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * @tags Registers and shifts
 */
class RegisterController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** Registers in authorized branches, with the currently open shift if any. */
    public function index(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorize('viewAny', Register::class);

        $registers = $this->scopeToAccessibleBranches($tenant->registers())
            ->with('openSession.openedBy:id,name')
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->integer('branch_id')))
            ->orderBy('branch_id')->orderBy('code')
            ->get();

        return response()->json(['data' => $registers->map(fn (Register $r) => $this->present($r))]);
    }

    /** Requires `registers.manage` at the branch. */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::REGISTERS_MANAGE);

        $data = $request->validate([
            'branch_id' => ['required', 'integer', Rule::exists('branches', 'id')->where('tenant_id', $tenant->id)],
            'code' => ['required', 'string', 'max:20', 'alpha_dash', Rule::unique('registers')->where('tenant_id', $tenant->id)],
            'name' => ['required', 'string', 'max:255'],
        ]);
        $this->authorizeAtBranch(Permissions::REGISTERS_MANAGE, $data['branch_id']);

        $register = $tenant->registers()->create([...$data, 'code' => strtoupper($data['code'])]);
        $this->audit->log('register.created', $register, null, $data);

        return response()->json(['data' => $this->present($register)], 201);
    }

    public function update(Request $request, Tenant $tenant, Register $register): JsonResponse
    {
        $this->authorize('update', $register);

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        // A cashier selling on this register would be locked out mid-shift.
        if (($data['is_active'] ?? true) === false && $register->openSession()->exists()) {
            throw new BusinessRuleException('Close the open shift on this register before deactivating it.', 'REGISTER_IN_USE');
        }

        $original = $register->getOriginal();
        $register->fill($data)->save();
        $this->audit->logChanges('register.updated', $register, $original);

        return response()->json(['data' => $this->present($register)]);
    }

    private function present(Register $register): array
    {
        return [
            'id' => $register->id,
            'branch_id' => $register->branch_id,
            'code' => $register->code,
            'name' => $register->name,
            'is_active' => $register->is_active,
            'open_session' => $register->relationLoaded('openSession') && $register->openSession
                ? [
                    'id' => $register->openSession->id, 'opened_by' => $register->openSession->opened_by,
                    'opened_by_name' => $register->openSession->openedBy?->name, 'opened_at' => $register->openSession->opened_at,
                ]
                : null,
        ];
    }
}
