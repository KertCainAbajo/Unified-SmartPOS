<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Tells an existing account holder that a business invited them; they must accept in the app. */
class StaffInvitedToBusiness extends Notification
{
    use Queueable;

    public function __construct(private readonly string $businessName) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("You were invited to join {$this->businessName}")
            ->line("{$this->businessName} invited you to join their team on Unified SmartPOS.")
            ->line('Sign in and accept the invitation to get access. If you do not recognise this business, decline it.')
            ->action('Open SmartPOS', rtrim((string) config('smartpos.frontend_url'), '/'));
    }
}
