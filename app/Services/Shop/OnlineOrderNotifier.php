<?php

namespace App\Services\Shop;

use App\Models\OnlineOrder;
use App\Notifications\CustomerOrderUpdateNotification;
use App\Services\NotificationService;
use App\Support\Permissions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Tells the right people when an online order moves: the branch staff who prepare it, the rider who takes it, and
 * the customer who placed it. Everything runs after the change is saved, and a mail problem never blocks the change.
 */
class OnlineOrderNotifier
{
    public function __construct(private readonly NotificationService $notifications) {}

    /** A customer placed an order: staff who prepare orders at that branch see it in their bell. */
    public function placed(OnlineOrder $order): void
    {
        $kind = $order->isDelivery() ? 'delivery' : 'pickup';
        $this->toBranchStaff($order, 'online_order_new', "New {$kind} order {$order->order_number}",
            "{$order->contact_name} · ₱".number_format((float) $order->estimated_total, 2));
    }

    public function cancelledByCustomer(OnlineOrder $order): void
    {
        $this->toBranchStaff($order, 'online_order_cancelled', "Order {$order->order_number} cancelled by the customer",
            "{$order->contact_name} cancelled. Put the items back on the shelf if they were already packed.");
    }

    /** Staff changed the status: email the customer, and tell a staff rider they have a new delivery. */
    public function statusChanged(OnlineOrder $order, bool $tellRider = true): void
    {
        $order->loadMissing(['account', 'branch:id,name', 'tenant:id,name']);
        if ($tellRider && $order->status->value === 'out_for_delivery' && $order->rider_user_id) {
            DB::afterCommit(fn () => $this->notifications->notifyUser($order->tenant_id, $order->rider_user_id, 'delivery_assigned',
                "New delivery: {$order->order_number}", "{$order->contact_name} · {$order->delivery_address}", ['online_order_id' => $order->id]));
        }
        if (in_array($order->status->value, ['confirmed', 'ready', 'out_for_delivery', 'cancelled'], true)) {
            DB::afterCommit(fn () => $this->emailCustomer($order));
        }
    }

    public function delivered(OnlineOrder $order): void
    {
        $this->toBranchStaff($order, 'delivery_delivered', "{$order->order_number} delivered",
            ($order->rider_name ?? 'The rider').' will hand in ₱'.number_format((float) $order->estimated_total, 2).'. Record the payment at the POS.');
    }

    public function returned(OnlineOrder $order, string $reason): void
    {
        $this->toBranchStaff($order, 'delivery_returned', "{$order->order_number} came back to the store",
            "{$reason}. Send it out again or cancel it.");
    }

    private function toBranchStaff(OnlineOrder $order, string $type, string $title, string $body): void
    {
        DB::afterCommit(fn () => $this->notifications->notifyPermissionHolders(
            $order->tenant_id, $order->branch_id, Permissions::SALES_CREATE, $type, $title, $body, ['online_order_id' => $order->id],
        ));
    }

    private function emailCustomer(OnlineOrder $order): void
    {
        try {
            $order->account?->notify(new CustomerOrderUpdateNotification($order, $order->tenant?->name ?? 'the store'));
        } catch (Throwable $e) {
            Log::warning('Online order update email could not be sent.', ['online_order_id' => $order->id, 'error' => $e->getMessage()]);
        }
    }
}
