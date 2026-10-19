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
use App\Support\Money;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The rider's side of a delivery: the orders assigned to them, their live position while on the way (shown to that
 * order's customer only), and handing the order over or bringing it back. Payment is still recorded at the POS when
 * the rider returns the cash, so stock and money keep moving through the normal sale.
 */
class RiderDeliveryController extends Controller
{
    private const RELATIONS = ['branch:id,name,address,phone,latitude,longitude', 'items'];

    public function __construct(private readonly TenantContext $context, private readonly AuditLogger $audit, private readonly OnlineOrderNotifier $notify) {}

    /**
     * The rider's day: deliveries on the way, packed orders at their branches waiting for a rider, everything they
     * delivered today, and the figures that matter on the road (cash to hand in, change to bring).
     */
    public function index(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizeRider();
        $userId = $request->user()->id;
        $startOfToday = now($tenant->timezone)->startOfDay()->utc();

        $mine = $tenant->onlineOrders()->where('rider_user_id', $userId)
            ->where(fn ($q) => $q->where('status', OnlineOrderStatus::OutForDelivery->value)
                ->orWhere(fn ($w) => $w->where('status', OnlineOrderStatus::Completed->value)->where('delivered_at', '>=', $startOfToday)))
            ->with(self::RELATIONS)->latest('dispatched_at')->limit(100)->get();
        $available = $tenant->onlineOrders()->where('fulfilment', 'delivery')->where('status', OnlineOrderStatus::Ready->value)
            ->whereNull('rider_user_id')->where('placed_at', '>=', now()->subDays(3))
            ->when(! $this->context->hasAllBranches(), fn ($q) => $q->whereIn('branch_id', $this->context->branchIds() ?? []))
            ->with(self::RELATIONS)->oldest('ready_at')->limit(30)->get();

        $active = $mine->filter(fn (OnlineOrder $o) => $o->isBeingDelivered());
        $toHandIn = $mine->filter(fn (OnlineOrder $o) => $o->status === OnlineOrderStatus::OutForDelivery && $o->delivered_at);
        $deliveredToday = $mine->filter(fn (OnlineOrder $o) => $o->delivered_at && $o->delivered_at->gte($startOfToday));
        $sum = fn ($orders, string $field) => Money::round(Money::add('0', ...$orders->map(fn (OnlineOrder $o) => (string) ($o->{$field} ?? '0'))->all()));

        return response()->json([
            'data' => $mine->values(),
            'available' => $available->values(),
            'on_duty' => (bool) $this->context->membership()->on_duty,
            'summary' => [
                'on_the_way' => $active->count(),
                'delivered_today' => $deliveredToday->count(),
                'delivered_value_today' => $sum($deliveredToday, 'estimated_total'),
                'to_hand_in' => $sum($toHandIn, 'estimated_total'),
                'change_to_bring' => $sum($active, 'change_due'),
            ],
        ]);
    }

    /**
     * Everything the signed-in rider delivered in a period (newest first, paginated), with totals for the whole period:
     * deliveries, value, average trip time and how much is still to be handed in.
     */
    public function history(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizeRider();
        $data = $request->validate([
            'date_from' => ['required', 'date_format:Y-m-d'],
            'date_to' => ['required', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'q' => ['sometimes', 'nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $tz = $tenant->timezone;
        $query = $tenant->onlineOrders()->where('rider_user_id', $request->user()->id)->whereNotNull('delivered_at')
            ->where('delivered_at', '>=', Carbon::parse($data['date_from'], $tz)->startOfDay()->utc())
            ->where('delivered_at', '<=', Carbon::parse($data['date_to'], $tz)->endOfDay()->utc())
            ->when(filled($data['q'] ?? null), function ($q) use ($data) {
                $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $data['q']).'%';
                $q->where(fn ($w) => $w->where('order_number', 'like', $term)->orWhere('contact_name', 'like', $term)->orWhere('delivery_address', 'like', $term));
            });

        $all = (clone $query)->get(['id', 'status', 'estimated_total', 'dispatched_at', 'delivered_at']);
        $minutes = $all->filter(fn (OnlineOrder $o) => $o->dispatched_at)->map(fn (OnlineOrder $o) => $o->dispatched_at->diffInMinutes($o->delivered_at));
        $sum = fn ($orders) => Money::round(Money::add('0', ...$orders->map(fn (OnlineOrder $o) => (string) $o->estimated_total)->all()));
        $page = $query->with(self::RELATIONS)->latest('delivered_at')->paginate(25);

        return response()->json([...$page->toArray(), 'summary' => [
            'deliveries' => $all->count(),
            'value' => $sum($all),
            'average_minutes' => $minutes->isEmpty() ? null : (int) round($minutes->avg()),
            'days_worked' => $all->map(fn (OnlineOrder $o) => $o->delivered_at->setTimezone($tz)->toDateString())->unique()->count(),
            'not_handed_in' => $sum($all->filter(fn (OnlineOrder $o) => $o->status !== OnlineOrderStatus::Completed)),
        ]]);
    }

    /** Pick up a packed delivery order from the counter yourself instead of waiting to be assigned. */
    public function claim(Request $request, Tenant $tenant, OnlineOrder $onlineOrder): JsonResponse
    {
        $this->authorizeRider();
        if ((int) $onlineOrder->tenant_id !== (int) $tenant->id || ! $this->context->canAccessBranch($onlineOrder->branch_id)) {
            abort(404);
        }
        if (! $this->context->membership()->on_duty) {
            throw new BusinessRuleException('Go on duty before taking a delivery.', 'RIDER_OFF_DUTY', status: 409);
        }
        $user = User::query()->findOrFail($request->user()->id);

        $order = DB::transaction(function () use ($onlineOrder, $user) {
            $locked = OnlineOrder::query()->whereKey($onlineOrder->id)->lockForUpdate()->firstOrFail();
            if (! $locked->isDelivery() || $locked->status !== OnlineOrderStatus::Ready || $locked->rider_user_id !== null) {
                throw new BusinessRuleException('Another rider already took this order, or it is no longer ready.', 'DELIVERY_NOT_AVAILABLE', status: 409);
            }
            $locked->forceFill([
                'status' => OnlineOrderStatus::OutForDelivery, 'rider_user_id' => $user->id, 'rider_name' => $user->name,
                'rider_phone' => $user->phone, 'dispatched_at' => now(), 'delivery_issue' => null, 'handled_by' => $user->id,
                'rider_lat' => null, 'rider_lng' => null, 'rider_location_at' => null, 'delivered_at' => null,
            ])->save();
            $this->audit->log('online_order.claimed_by_rider', $locked, ['status' => OnlineOrderStatus::Ready->value], [
                'status' => OnlineOrderStatus::OutForDelivery->value, 'order_number' => $locked->order_number, 'rider_name' => $user->name,
            ]);

            return $locked;
        });

        $fresh = $order->fresh(self::RELATIONS);
        $this->notify->statusChanged($fresh, tellRider: false); // the customer hears their order is on the way

        return response()->json(['data' => $fresh]);
    }

    /** Go on or off duty. Off-duty riders are listed last when the store sends an order out. */
    public function duty(Request $request, Tenant $tenant): JsonResponse
    {
        $this->authorizeRider();
        $data = $request->validate(['on_duty' => ['required', 'boolean']]);
        $membership = $this->context->membership();
        $membership->forceFill(['on_duty' => $data['on_duty'], 'duty_changed_at' => now()])->save();
        $this->audit->log($data['on_duty'] ? 'rider.on_duty' : 'rider.off_duty', $membership, null, ['user_id' => $membership->user_id]);

        return response()->json(['on_duty' => (bool) $membership->on_duty]);
    }

    /** The rider's current position, sent every few seconds by their phone while delivering. */
    public function location(Request $request, Tenant $tenant, OnlineOrder $onlineOrder): JsonResponse
    {
        $order = $this->myActiveDelivery($request, $tenant, $onlineOrder);
        $data = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);
        $order->forceFill([
            'rider_lat' => round((float) $data['latitude'], 7),
            'rider_lng' => round((float) $data['longitude'], 7),
            'rider_location_at' => now(),
        ])->save();

        return response()->json(['ok' => true, 'at' => $order->rider_location_at]);
    }

    /** Handed over and cash collected. Location sharing stops; the cash is recorded at the POS when the rider is back. */
    public function delivered(Request $request, Tenant $tenant, OnlineOrder $onlineOrder): JsonResponse
    {
        $order = $this->myActiveDelivery($request, $tenant, $onlineOrder);
        DB::transaction(function () use ($order) {
            $order->forceFill(['delivered_at' => now(), 'rider_lat' => null, 'rider_lng' => null, 'rider_location_at' => null])->save();
            $this->audit->log('online_order.delivered', $order, null, ['order_number' => $order->order_number, 'rider_name' => $order->rider_name]);
        });
        $this->notify->delivered($order);

        return response()->json(['data' => $order->fresh(self::RELATIONS)]);
    }

    /** Could not deliver: the order goes back to Ready at the store with the reason, for staff to resend or cancel. */
    public function returnToStore(Request $request, Tenant $tenant, OnlineOrder $onlineOrder): JsonResponse
    {
        $order = $this->myActiveDelivery($request, $tenant, $onlineOrder);
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);
        DB::transaction(function () use ($order, $data) {
            $order->forceFill([
                'status' => OnlineOrderStatus::Ready, 'delivery_issue' => trim($data['reason']),
                'rider_user_id' => null, 'rider_lat' => null, 'rider_lng' => null, 'rider_location_at' => null,
            ])->save();
            $this->audit->log('online_order.returned_to_store', $order, ['status' => OnlineOrderStatus::OutForDelivery->value], [
                'status' => OnlineOrderStatus::Ready->value, 'order_number' => $order->order_number, 'reason' => trim($data['reason']),
            ]);
        });
        $this->notify->returned($order, trim($data['reason']));

        return response()->json(['data' => $order->fresh(self::RELATIONS)]);
    }

    private function authorizeRider(): void
    {
        if (! $this->context->can(Permissions::DELIVERIES_RIDE)) {
            throw new AuthorizationException('Only delivery riders can do this.');
        }
    }

    private function myActiveDelivery(Request $request, Tenant $tenant, OnlineOrder $order): OnlineOrder
    {
        $this->authorizeRider();
        if ((int) $order->tenant_id !== (int) $tenant->id || (int) $order->rider_user_id !== (int) $request->user()->id) {
            abort(404);
        }
        if (! $order->isBeingDelivered()) {
            throw new BusinessRuleException('This delivery is no longer on the way.', 'DELIVERY_NOT_ACTIVE', status: 409);
        }

        return $order;
    }
}
