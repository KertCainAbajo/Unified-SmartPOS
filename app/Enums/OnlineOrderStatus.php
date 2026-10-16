<?php

namespace App\Enums;

/**
 * Online order lifecycle: PENDING → CONFIRMED → READY → COMPLETED, with CANCELLED available until pickup.
 * Stock and money only move at COMPLETED, when staff ring the order up through the normal checkout.
 */
enum OnlineOrderStatus: string
{
    case Pending = 'pending';
    case Confirmed = 'confirmed';
    case Ready = 'ready';
    case Completed = 'completed';
    case Cancelled = 'cancelled';

    /** What staff see. */
    public function label(): string
    {
        return match ($this) {
            self::Pending => 'New order',
            self::Confirmed => 'Preparing',
            self::Ready => 'Ready for pickup',
            self::Completed => 'Picked up',
            self::Cancelled => 'Cancelled',
        };
    }

    /** What the customer sees. */
    public function customerLabel(): string
    {
        return match ($this) {
            self::Pending => 'Waiting for the store to confirm',
            self::Confirmed => 'Being prepared',
            self::Ready => 'Ready for pickup',
            self::Completed => 'Picked up',
            self::Cancelled => 'Cancelled',
        };
    }

    public function isOpen(): bool
    {
        return in_array($this, [self::Pending, self::Confirmed, self::Ready], true);
    }

    /** The customer may still call it off while the store has not prepared it. */
    public function customerMayCancel(): bool
    {
        return in_array($this, [self::Pending, self::Confirmed], true);
    }

    /** @return list<self> */
    public function nextStaffStatuses(): array
    {
        return match ($this) {
            self::Pending => [self::Confirmed, self::Cancelled],
            self::Confirmed => [self::Ready, self::Cancelled],
            self::Ready => [self::Completed, self::Cancelled],
            default => [],
        };
    }
}
