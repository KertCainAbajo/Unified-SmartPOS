<?php

namespace App\Enums;

/**
 * Online order lifecycle: PENDING → CONFIRMED → READY → COMPLETED, with CANCELLED available until completion.
 * Delivery orders add OUT_FOR_DELIVERY between READY and COMPLETED while the rider is on the way.
 * Stock and money only move at COMPLETED, when staff ring the order up through the normal checkout.
 */
enum OnlineOrderStatus: string
{
    case Pending = 'pending';
    case Confirmed = 'confirmed';
    case Ready = 'ready';
    case OutForDelivery = 'out_for_delivery';
    case Completed = 'completed';
    case Cancelled = 'cancelled';

    /** What staff see. */
    public function label(): string
    {
        return match ($this) {
            self::Pending => 'New order',
            self::Confirmed => 'Preparing',
            self::Ready => 'Ready',
            self::OutForDelivery => 'Out for delivery',
            self::Completed => 'Completed',
            self::Cancelled => 'Cancelled',
        };
    }

    /** What the customer sees. */
    public function customerLabel(): string
    {
        return match ($this) {
            self::Pending => 'Waiting for the store to confirm',
            self::Confirmed => 'Being prepared',
            self::Ready => 'Ready',
            self::OutForDelivery => 'On the way',
            self::Completed => 'Completed',
            self::Cancelled => 'Cancelled',
        };
    }

    public function isOpen(): bool
    {
        return in_array($this, [self::Pending, self::Confirmed, self::Ready, self::OutForDelivery], true);
    }

    /** The customer may still call it off while the store has not prepared it. */
    public function customerMayCancel(): bool
    {
        return in_array($this, [self::Pending, self::Confirmed], true);
    }

    /** Statuses staff may move to by hand. COMPLETED is reached only through POS checkout. */
    public function nextStaffStatuses(bool $delivery = false): array
    {
        return match ($this) {
            self::Pending => [self::Confirmed, self::Cancelled],
            self::Confirmed => [self::Ready, self::Cancelled],
            self::Ready => $delivery ? [self::OutForDelivery, self::Cancelled] : [self::Cancelled],
            // A failed delivery comes back: either send it out again later or cancel it.
            self::OutForDelivery => [self::Ready, self::Cancelled],
            default => [],
        };
    }

    /** Statuses at which the POS may ring the order up. */
    public function payableAtCheckout(bool $delivery): bool
    {
        return $this === self::Ready || ($delivery && $this === self::OutForDelivery);
    }
}
