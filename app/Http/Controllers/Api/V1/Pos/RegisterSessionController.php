<?php

namespace App\Http\Controllers\Api\V1\Pos;

use App\Http\Controllers\Controller;
use App\Http\Resources\RegisterSessionResource;
use App\Models\Register;
use App\Models\RegisterSession;
use App\Models\Tenant;
use App\Services\Pos\RegisterSessionService;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * Cashier shifts.
 *
 * @tags Registers and shifts
 */
class RegisterSessionController extends Controller
{
    public function __construct(private readonly RegisterSessionService $sessions) {}

    /** Own shifts, or all shifts in authorized branches with `shifts.view_all`. Filter by `status`, `register_id`. */
    public function index(Request $request, Tenant $tenant): AnonymousResourceCollection
    {
        $context = $this->tenantContext();
        abort_unless($context->can(Permissions::SHIFTS_OPERATE) || $context->can(Permissions::SHIFTS_VIEW_ALL), 403);

        $sessions = $this->scopeToAccessibleBranches($tenant->registerSessions())
            ->when(! $context->can(Permissions::SHIFTS_VIEW_ALL), fn ($q) => $q->where('opened_by', $request->user()->id))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('register_id'), fn ($q) => $q->where('register_id', $request->integer('register_id')))
            ->latest('id')
            ->paginate($this->perPage($request));

        return RegisterSessionResource::collection($sessions);
    }

    /** The caller's currently open shift in this business, or `data: null`. */
    public function current(Request $request, Tenant $tenant): JsonResponse
    {
        $session = $tenant->registerSessions()->where('opened_by', $request->user()->id)->where('status', 'open')->first();

        return response()->json(['data' => $session ? new RegisterSessionResource($session) : null]);
    }

    /** Open a shift. Requires `shifts.operate` at the register's branch. */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::SHIFTS_OPERATE);

        $data = $request->validate([
            'register_id' => ['required', 'integer', Rule::exists('registers', 'id')->where('tenant_id', $tenant->id)],
            'opening_float' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:9999999'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

        $register = Register::query()->findOrFail($data['register_id']);
        $this->authorize('openShift', $register);

        $session = $this->sessions->open($register, (string) $data['opening_float'], $request->user()->id, $data['notes'] ?? null);

        return (new RegisterSessionResource($session))->response()->setStatusCode(201);
    }

    /** Shift details with an X-reading style summary. */
    public function show(Tenant $tenant, RegisterSession $registerSession): RegisterSessionResource
    {
        $this->authorize('view', $registerSession);

        return (new RegisterSessionResource($registerSession))->withSummary($this->sessions->summary($registerSession));
    }

    /** Close a shift with the counted cash; returns the Z-reading style summary. */
    public function close(Request $request, Tenant $tenant, RegisterSession $registerSession): RegisterSessionResource
    {
        $this->authorize('close', $registerSession);

        $data = $request->validate([
            'counted_cash' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:999999999'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

        $session = $this->sessions->close($registerSession, (string) $data['counted_cash'], $request->user()->id, $data['notes'] ?? null);

        return (new RegisterSessionResource($session))->withSummary($this->sessions->summary($session));
    }
}
