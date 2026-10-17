<?php

namespace App\Http\Controllers\Api\V1\Shop;

use App\Enums\OnlineOrderStatus;
use App\Exceptions\BusinessRuleException;
use App\Http\Controllers\Controller;
use App\Models\OnlineOrder;
use App\Models\Tenant;
use App\Services\AuditLogger;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Staff-facing order queue for branches the signed-in employee can access. Anyone who can ring up sales
 * (cashiers included) works the queue: confirm, prepare, send out with a rider, then ring it up at the POS.
 */
class StaffOnlineOrderController extends Controller
{
    private const RELATIONS = ['branch:id,name', 'account:id,name,email,phone', 'items'];

    public function __construct(private readonly TenantContext $context, private readonly AuditLogger $audit) {}

    public function index(Request $request, Tenant $tenant)
    {
        $this->authorizeQueue();
        $request->validate([
            'branch_id' => ['sometimes', 'integer'],
            'status' => ['sometimes', Rule::enum(OnlineOrderStatus::class)],
            'fulfilment' => ['sometimes', Rule::in(['pickup', 'delivery'])],
            'open' => ['sometimes', 'boolean'],
        ]);
        $query = $tenant->onlineOrders()
            ->when(! $this->context->hasAllBranches(), fn ($q) => $q->whereIn('branch_id', $this->context->branchIds() ?? []))
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->integer('branch_id')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('fulfilment'), fn ($q) => $q->where('fulfilment', $request->string('fulfilment')))
            ->when($request->boolean('open'), fn ($q) => $q->whereIn('status', array_map(fn (OnlineOrderStatus $s) => $s->value, array_filter(OnlineOrderStatus::cases(), fn (OnlineOrderStatus $s) => $s->isOpen()))))
            ->with(self::RELATIONS)
            ->latest('id');

        return response()->json($query->paginate(min(max($request->integer('per_page', 20), 1), 100)));
    }

    /** One order, e.g. to load it into the POS for checkout. */
    public function show(Tenant $tenant, OnlineOrder $onlineOrder)
    {
        $this->authorizeQueue();
        $this->ensureAccessible($tenant, $onlineOrder);

        return response()->json(['data' => $onlineOrder->load(self::RELATIONS)]);
    }

    /** Advance preparation state. Completion is reserved for POS checkout so it always has a recorded sale. */
    public function updateStatus(Request $request, Tenant $tenant, OnlineOrder $onlineOrder)
    {
        $this->authorizePermission(Permissions::SALES_CREATE);
        $this->ensureAccessible($tenant, $onlineOrder);
        $data = $request->validate([
            'status' => ['required', Rule::in([
                OnlineOrderStatus::Confirmed->value,
                OnlineOrderStatus::Ready->value,
                OnlineOrderStatus::OutForDelivery->value,
                OnlineOrderStatus::Cancelled->value,
            ])],
            'cancel_reason' => ['required_if:status,cancelled', 'nullable', 'string', 'max:255'],
            'rider_name' => ['required_if:status,out_for_delivery', 'nullable', 'string', 'max:255'],
            'rider_phone' => ['nullable', 'string', 'max:30'],
        ], ['rider_name.required_if' => 'Enter who is delivering this order.']);

        DB::transaction(function () use ($onlineOrder, $data, $request) {
            $locked = OnlineOrder::query()->whereKey($onlineOrder->id)->lockForUpdate()->firstOrFail();
            $target = OnlineOrderStatus::from($data['status']);
            if (! in_array($target, $locked->status->nextStaffStatuses($locked->isDelivery()), true)) {
                throw new BusinessRuleException("This order cannot move from {$locked->status->label()} to {$target->label()}.", 'ONLINE_ORDER_INVALID_STATUS', status: 409);
            }
            $attributes = ['status' => $target, 'handled_by' => $request->user()->id];
            if ($target === OnlineOrderStatus::Confirmed) {
                $attributes['confirmed_at'] = now();
            }
            if ($target === OnlineOrderStatus::Ready) {
                $attributes['ready_at'] = $locked->ready_at ?? now();
            }
            if ($target === OnlineOrderStatus::OutForDelivery) {
                $attributes += ['rider_name' => trim($data['rider_name']), 'rider_phone' => filled($data['rider_phone'] ?? null) ? trim($data['rider_phone']) : null, 'dispatched_at' => now()];
            }
            if ($target === OnlineOrderStatus::Cancelled) {
                $attributes += ['cancelled_at' => now(), 'cancelled_by' => 'staff', 'cancel_reason' => $data['cancel_reason'] ?? null];
            }
            $old = $locked->status->value;
            $locked->forceFill($attributes)->save();
            $this->audit->log('online_order.status_changed', $locked, ['status' => $old], array_filter([
                'status' => $target->value, 'order_number' => $locked->order_number, 'rider_name' => $attributes['rider_name'] ?? null,
            ]));
        });

        return response()->json(['data' => $onlineOrder->fresh(self::RELATIONS)]);
    }

    private function authorizeQueue(): void
    {
        if (! $this->context->can(Permissions::SALES_VIEW_ALL) && ! $this->context->can(Permissions::SALES_CREATE)) {
            throw new AuthorizationException('You do not have permission to view online orders.');
        }
    }

    private function ensureAccessible(Tenant $tenant, OnlineOrder $onlineOrder): void
    {
        if ((int) $onlineOrder->tenant_id !== (int) $tenant->id || ! $this->context->canAccessBranch($onlineOrder->branch_id)) {
            abort(404);
        }
    }

    protected function authorizePermission(string $permission): void
    {
        if (! $this->context->can($permission)) {
            throw new AuthorizationException('You do not have permission to manage online orders.');
        }
    }
}
