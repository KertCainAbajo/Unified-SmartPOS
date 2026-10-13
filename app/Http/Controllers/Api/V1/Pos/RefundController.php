<?php

namespace App\Http\Controllers\Api\V1\Pos;

use App\Enums\PaymentMethod;
use App\Http\Controllers\Controller;
use App\Models\Refund;
use App\Models\Sale;
use App\Models\Tenant;
use App\Services\Pos\RefundService;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * @tags Refunds
 */
class RefundController extends Controller
{
    public function __construct(private readonly RefundService $refunds) {}

    /** Filters: `status`, `sale_id`. Requesters without approval rights see only their own refunds. */
    public function index(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorize('viewAny', Refund::class);
        $context = $this->tenantContext();
        $seesAll = $context->can(Permissions::REFUNDS_APPROVE) || $context->can(Permissions::SALES_VIEW_ALL);

        $refunds = $this->scopeToAccessibleBranches($tenant->refunds())
            ->with('items')
            ->when(! $seesAll, fn ($q) => $q->where('requested_by', $request->user()->id))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('sale_id'), fn ($q) => $q->where('sale_id', $request->integer('sale_id')))
            ->latest('id')
            ->paginate($this->perPage($request));

        return response()->json($refunds->through(fn (Refund $r) => $this->present($r)));
    }

    /**
     * Request a refund for items of a completed sale.
     *
     * Amounts are derived from the original sale lines (proportional, rounding absorbed by the last units).
     * Returns `completed` when the caller may complete it, otherwise `pending_approval`.
     * Requires `refunds.create` at the sale's branch.
     */
    public function store(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizePermission(Permissions::REFUNDS_CREATE);

        $data = $request->validate([
            'sale_id' => ['required', 'integer', Rule::exists('sales', 'id')->where('tenant_id', $tenant->id)],
            'reason' => ['required', 'string', 'max:255'],
            'refund_method' => ['sometimes', Rule::enum(PaymentMethod::class)],
            'register_session_id' => ['nullable', 'integer'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.sale_item_id' => ['required', 'integer', 'distinct'],
            'items.*.quantity' => ['required', 'numeric', 'decimal:0,3', 'gt:0'],
            'items.*.restock' => ['sometimes', 'boolean'],
        ]);

        $sale = Sale::query()->findOrFail($data['sale_id']);
        $this->authorize('refund', $sale);

        $refund = $this->refunds->request($sale, $data, $request->user()->id);

        return response()->json(['data' => $this->present($refund)], 201);
    }

    public function show(Tenant $tenant, Refund $refund): JsonResponse
    {
        $this->authorize('view', $refund);

        return response()->json(['data' => $this->present($refund->load('items'))]);
    }

    /** Approve a pending refund. Requires `refunds.approve`; requesters cannot approve their own refunds. */
    public function approve(Request $request, Tenant $tenant, Refund $refund): JsonResponse
    {
        $this->authorize('approve', $refund);

        return response()->json(['data' => $this->present($this->refunds->approve($refund, $request->user()->id))]);
    }

    public function reject(Request $request, Tenant $tenant, Refund $refund): JsonResponse
    {
        $this->authorize('approve', $refund);
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);

        return response()->json(['data' => $this->present($this->refunds->reject($refund, $data['reason'], $request->user()->id))]);
    }

    private function present(Refund $refund): array
    {
        return [
            'id' => $refund->id,
            'reference' => $refund->reference,
            'sale_id' => $refund->sale_id,
            'branch_id' => $refund->branch_id,
            'status' => $refund->status,
            'reason' => $refund->reason,
            'refund_method' => $refund->refund_method,
            'subtotal' => $refund->subtotal,
            'vat_amount' => $refund->vat_amount,
            'total' => $refund->total,
            'requested_by' => $refund->requested_by,
            'approved_by' => $refund->approved_by,
            'approved_at' => $refund->approved_at,
            'rejected_by' => $refund->rejected_by,
            'rejection_reason' => $refund->rejection_reason,
            'completed_at' => $refund->completed_at,
            'created_at' => $refund->created_at,
            'items' => $refund->relationLoaded('items')
                ? $refund->items->map(fn ($i) => $i->only(['id', 'sale_item_id', 'product_id', 'quantity', 'amount', 'vat_amount', 'restock']))
                : null,
        ];
    }
}
