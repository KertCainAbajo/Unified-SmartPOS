<?php

namespace App\Http\Controllers\Api\V1\Shop;

use App\Enums\OnlineOrderStatus;
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

/** Staff-facing order queue for branches the signed-in employee can access. */
class StaffOnlineOrderController extends Controller
{
    public function __construct(private readonly TenantContext $context, private readonly AuditLogger $audit) {}

    public function index(Request $request, Tenant $tenant)
    {
        $this->authorizePermission(Permissions::SALES_VIEW_ALL);
        $request->validate([
            'branch_id' => ['sometimes', 'integer'],
            'status' => ['sometimes', Rule::enum(OnlineOrderStatus::class)],
        ]);
        $query = $tenant->onlineOrders()
            ->when(! $this->context->hasAllBranches(), fn ($q) => $q->whereIn('branch_id', $this->context->branchIds() ?? []))
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->integer('branch_id')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->with(['branch:id,name', 'account:id,name,email,phone', 'items'])
            ->latest('id');

        return response()->json($query->paginate(min(max($request->integer('per_page', 20), 1), 100)));
    }

    /** Advance preparation state. Completion is reserved for POS checkout so it always has a recorded sale. */
    public function updateStatus(Request $request, Tenant $tenant, OnlineOrder $order)
    {
        $this->authorizePermission(Permissions::SALES_CREATE);
        if ((int) $order->tenant_id !== (int) $tenant->id || ! $this->context->canAccessBranch($order->branch_id)) {
            abort(404);
        }
        $data = $request->validate([
            'status' => ['required', Rule::in([
                OnlineOrderStatus::Confirmed->value,
                OnlineOrderStatus::Ready->value,
                OnlineOrderStatus::Cancelled->value,
            ])],
            'cancel_reason' => ['required_if:status,cancelled', 'nullable', 'string', 'max:255'],
        ]);

        DB::transaction(function () use ($order, $data, $request) {
            $locked = OnlineOrder::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            $target = OnlineOrderStatus::from($data['status']);
            if (! in_array($target, $locked->status->nextStaffStatuses(), true)) {
                throw new AuthorizationException('This order cannot move to the requested status.');
            }
            $attributes = ['status' => $target, 'handled_by' => $request->user()->id];
            if ($target === OnlineOrderStatus::Confirmed) $attributes['confirmed_at'] = now();
            if ($target === OnlineOrderStatus::Ready) $attributes['ready_at'] = now();
            if ($target === OnlineOrderStatus::Cancelled) {
                $attributes += ['cancelled_at' => now(), 'cancelled_by' => 'staff', 'cancel_reason' => $data['cancel_reason'] ?? null];
            }
            $old = $locked->status->value;
            $locked->forceFill($attributes)->save();
            $this->audit->log('online_order.status_changed', $locked, ['status' => $old], ['status' => $target->value, 'order_number' => $locked->order_number]);
        });

        return response()->json(['data' => $order->fresh(['branch:id,name', 'account:id,name,email,phone', 'items'])]);
    }

    private function authorizePermission(string $permission): void
    {
        if (! $this->context->can($permission)) {
            throw new AuthorizationException('You do not have permission to manage online orders.');
        }
    }
}
