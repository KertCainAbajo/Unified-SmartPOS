<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Emails a shop customer the 6-digit code that lets them choose a new password. */
class CustomerPasswordCodeNotification extends Notification
{
    use Queueable;

    public function __construct(
        private readonly string $storeName,
        #[\SensitiveParameter] private readonly string $code,
        private readonly int $minutes,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("{$this->code} is your {$this->storeName} password reset code")
            ->greeting('Reset your password')
            ->line("Someone asked to reset the password for your {$this->storeName} online shop account.")
            ->line("Your code is: **{$this->code}**")
            ->line("Enter it in the shop within {$this->minutes} minutes, then choose a new password.")
            ->line('If you did not ask for this, you can ignore this email. Your password stays the same.');
    }

    /** Keep the one-time code out of any serialized/queued representation. */
    public function toArray(object $notifiable): array
    {
        return ['store' => $this->storeName];
    }
}
