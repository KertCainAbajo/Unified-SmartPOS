<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Emails a new shop customer the 6-digit code that confirms their email address. */
class CustomerVerifyEmailNotification extends Notification
{
    use Queueable;

    public function __construct(
        public readonly string $storeName,
        #[\SensitiveParameter] public readonly string $code,
        public readonly int $minutes,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("{$this->code} is your {$this->storeName} verification code")
            ->greeting('Confirm your email')
            ->line("Thanks for creating a {$this->storeName} online shop account.")
            ->line("Your code is: **{$this->code}**")
            ->line("Enter it in the shop within {$this->minutes} minutes to finish creating your account.")
            ->line('If you did not sign up, you can ignore this email. No account will be activated.');
    }

    /** Keep the one-time code out of any serialized/queued representation. */
    public function toArray(object $notifiable): array
    {
        return ['store' => $this->storeName];
    }
}
