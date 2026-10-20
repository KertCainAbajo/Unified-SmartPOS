<?php

namespace App\Http\Controllers\Api\V1\Shop;

use App\Enums\OnlineOrderStatus;
use App\Exceptions\BusinessRuleException;
use App\Http\Controllers\Controller;
use App\Models\OnlineOrder;
use App\Models\Tenant;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Shop\OnlineOrderNotifier;
use App\Services\Shop\RiderDirectory;
use App\Support\Money;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Staff-facing order queue for branches the signed-in employee can access. Anyone who can ring up sales
 * (cashiers included) works the queue: confirm, prepare, send out with a rider, then ring it up at the POS.
 */
class StaffOnlineOrderController extends Controller
{
    private const RELATIONS = ['branch:id,name,address,latitude,longitude', 'account:id,name,email,phone', 'items'];

    public function __construct(private readonly TenantContext $context, private readonly AuditLogger $audit, private readonly RiderDirectory $riders, private readonly OnlineOrderNotifier $notify) {}

    /** Riders who can take deliveries from a branch, least busy first. */
    public function riders(Request $request, Tenant $tenant)
    {
        $this->authorizePermission(Permissions::SALES_CREATE);
        $data = $request->validate(['branch_id' => ['required', 'integer']]);
        abort_unless($this->context->canAccessBranch($data['branch_id']), 404);

        return response()->json(['data' => $this->riders->forBranch($tenant, (int) $data['branch_id'])]);
    }

    public function index(Request $request, Tenant $tenant)
    {
        $this->authorizeQueue();
        $request->validate([
            'branch_id' => ['sometimes', 'integer'],
            'status' => ['sometimes', Rule::enum(OnlineOrderStatus::class)],
            'fulfilment' => ['sometimes', Rule::in(['pickup', 'delivery'])],
            'open' => ['sometimes', 'boolean'],
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d'],
            'q' => ['sometimes', 'string', 'max:100'],
        ]);
        $tz = $tenant->timezone;
        $query = $tenant->onlineOrders()
            ->when(! $this->context->hasAllBranches(), fn ($q) => $q->whereIn('branch_id', $this->context->branchIds() ?? []))
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->integer('branch_id')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('fulfilment'), fn ($q) => $q->where('fulfilment', $request->string('fulfilment')))
            ->when($request->boolean('open'), fn ($q) => $q->whereIn('status', array_map(fn (OnlineOrderStatus $s) => $s->value, array_filter(OnlineOrderStatus::cases(), fn (OnlineOrderStatus $s) => $s->isOpen()))))
            ->when($request->filled('date_from'), fn ($q) => $q->where('placed_at', '>=', Carbon::parse($request->string('date_from'), $tz)->startOfDay()->utc()))
            ->when($request->filled('date_to'), fn ($q) => $q->where('placed_at', '<=', Carbon::parse($request->string('date_to'), $tz)->endOfDay()->utc()))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->string('q')).'%';
                $q->where(fn ($w) => $w->whereLike('order_number', $term)->orWhereLike('contact_name', $term)
                    ->orWhereLike('contact_phone', $term)->orWhereLike('delivery_address', $term));
            });

        $summary = $this->summarize((clone $query)->get(['id', 'fulfilment', 'status', 'estimated_total', 'placed_at', 'completed_at', 'cancelled_by', 'cancel_reason']));
        $page = $query->with(self::RELATIONS)->latest('id')->paginate(min(max($request->integer('per_page', 20), 1), 100));

        return response()->json([...$page->toArray(), 'summary' => $summary]);
    }

    /** Figures for every order matching the filters (not just this page), shown above the order history. */
    private function summarize(Collection $orders): array
    {
        $completed = $orders->filter(fn (OnlineOrder $o) => $o->status === OnlineOrderStatus::Completed && $o->completed_at);
        $minutes = $completed->map(fn (OnlineOrder $o) => $o->placed_at->diffInMinutes($o->completed_at));

        return [
            'orders' => $orders->count(),
            'value' => Money::round(Money::add('0', ...$orders->map(fn (OnlineOrder $o) => (string) $o->estimated_total)->all())),
            'delivery' => $orders->where('fulfilment', 'delivery')->count(),
            'pickup' => $orders->where('fulfilment', 'pickup')->count(),
            'average_minutes' => $minutes->isEmpty() ? null : (int) round($minutes->avg()),
            'cancelled_by_customer' => $orders->where('cancelled_by', 'customer')->count(),
            'cancelled_by_store' => $orders->where('cancelled_by', 'staff')->count(),
            'top_cancel_reason' => $orders->pluck('cancel_reason')->filter()->countBy()->sortDesc()->keys()->first(),
        ];
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
        // Customer service may cancel an order when a customer calls; everything else is for staff who ring up sales.
        if (! ($request->input('status') === OnlineOrderStatus::Cancelled->value && $this->context->can(Permissions::CUSTOMERS_MANAGE))) {
            $this->authorizePermission(Permissions::SALES_CREATE);
        }
        $this->ensureAccessible($tenant, $onlineOrder);
        $data = $request->validate([
            'status' => ['required', Rule::in([
                OnlineOrderStatus::Confirmed->value,
                OnlineOrderStatus::Ready->value,
                OnlineOrderStatus::OutForDelivery->value,
                OnlineOrderStatus::Cancelled->value,
            ])],
            'cancel_reason' => ['required_if:status,cancelled', 'nullable', 'string', 'max:255'],
            // Either a staff rider account (tracked on the map) or, for an outside courier, just a name.
            'rider_user_id' => ['nullable', 'integer'],
            'rider_name' => ['nullable', 'string', 'max:255'],
            'rider_phone' => ['nullable', 'string', 'max:30'],
        ]);
        $rider = null;
        if ($data['status'] === OnlineOrderStatus::OutForDelivery->value) {
            if (filled($data['rider_user_id'] ?? null)) {
                if (! $this->riders->isRider($tenant, (int) $onlineOrder->branch_id, (int) $data['rider_user_id'])) {
                    throw ValidationException::withMessages(['rider_user_id' => 'Choose a rider who works at this branch.']);
                }
                $rider = User::query()->findOrFail($data['rider_user_id']);
            } elseif (blank($data['rider_name'] ?? null)) {
                throw ValidationException::withMessages(['rider_name' => 'Choose a rider or enter who is delivering this order.']);
            }
        }

        DB::transaction(function () use ($onlineOrder, $data, $request, $rider) {
            $locked = OnlineOrder::query()->whereKey($onlineOrder->id)->lockForUpdate()->firstOrFail();
            $target = OnlineOrderStatus::from($data['status']);
            if (! in_array($target, $locked->status->nextStaffStatuses($locked->isDelivery()), true)) {
                throw new BusinessRuleException("This order cannot move from {$locked->status->label()} to {$target->label()}.", 'ONLINE_ORDER_INVALID_STATUS', status: 409);
            }
            $attributes = ['status' => $target, 'handled_by' => $request->user()->id];
            if ($target === OnlineOrderStatus::Confirmed) {
                $attributes['confirmed_at'] = now();
            }
            if ($locked->delivered_at && $target !== OnlineOrderStatus::Cancelled) {
                throw new BusinessRuleException('The rider already delivered this order. Record the payment at the POS.', 'ONLINE_ORDER_ALREADY_DELIVERED', status: 409);
            }
            $clearRider = ['rider_user_id' => null, 'rider_lat' => null, 'rider_lng' => null, 'rider_location_at' => null, 'delivered_at' => null];
            if ($target === OnlineOrderStatus::Ready) {
                $attributes['ready_at'] = $locked->ready_at ?? now();
                if ($locked->status === OnlineOrderStatus::OutForDelivery) {
                    $attributes += $clearRider; // brought back to the store
                }
            }
            if ($target === OnlineOrderStatus::OutForDelivery) {
                $phone = filled($data['rider_phone'] ?? null) ? trim($data['rider_phone']) : $rider?->phone;
                $attributes = [...$attributes, ...$clearRider, 'rider_user_id' => $rider?->id, 'rider_name' => $rider?->name ?? trim($data['rider_name']),
                    'rider_phone' => $phone, 'dispatched_at' => now(), 'delivery_issue' => null];
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

        $fresh = $onlineOrder->fresh(self::RELATIONS);
        $this->notify->statusChanged($fresh);

        return response()->json(['data' => $fresh]);
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
