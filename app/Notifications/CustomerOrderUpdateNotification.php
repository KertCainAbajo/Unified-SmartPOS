<?php

namespace App\Notifications;

use App\Models\OnlineOrder;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Emails a shop customer when their online order moves along (confirmed, ready, on the way, cancelled). */
class CustomerOrderUpdateNotification extends Notification
{
    use Queueable;

    public function __construct(private readonly OnlineOrder $order, private readonly string $storeName) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $o = $this->order;
        $delivery = $o->isDelivery();
        [$subject, $line] = match ($o->status->value) {
            'confirmed' => ["Order {$o->order_number} confirmed", 'The store confirmed your order and is preparing it now.'],
            'ready' => $delivery
                ? ["Order {$o->order_number} is packed", 'Your order is packed and will go out with a rider shortly.']
                : ["Order {$o->order_number} is ready for pickup", "Your order is ready. Collect it at {$o->branch?->name} and pay at the counter."],
            'out_for_delivery' => ["Order {$o->order_number} is on the way", ($o->rider_name ? "{$o->rider_name} is" : 'A rider is').' bringing your order. Please prepare ₱'.number_format((float) ($o->cash_amount ?? $o->estimated_total), 2).' in cash.'],
            'cancelled' => ["Order {$o->order_number} was cancelled", 'The store cancelled your order'.($o->cancel_reason ? ": {$o->cancel_reason}." : '.')],
            default => ["Update on order {$o->order_number}", 'There is an update on your order.'],
        };

        return (new MailMessage)
            ->subject("{$subject} · {$this->storeName}")
            ->greeting("Hi {$notifiable->name},")
            ->line($line)
            ->line('Order total: ₱'.number_format((float) $o->estimated_total, 2).($delivery && $o->change_due !== null && (float) $o->change_due > 0 ? ' · Change to receive: ₱'.number_format((float) $o->change_due, 2) : ''))
            ->line('You can follow your order any time from "My orders" in the online shop.');
    }

    public function toArray(object $notifiable): array
    {
        return ['online_order_id' => $this->order->id, 'status' => $this->order->status->value];
    }
}
