<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Tells the account holder that sign-in was paused after repeated wrong passwords. */
class SignInLockedNotification extends Notification
{
    use Queueable;

    public function __construct(
        public readonly string $appName,
        public readonly ?string $ipAddress,
        public readonly int $minutes,
        public readonly ?string $resetUrl = null,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $mail = (new MailMessage)
            ->subject("Security alert: sign-in to your {$this->appName} account was paused")
            ->greeting('Someone tried to sign in to your account')
            ->line('There were several wrong passwords for your account'.($this->ipAddress ? " (from IP address {$this->ipAddress})" : '').'.')
            ->line("To protect you, sign-in was paused for {$this->minutes} minutes.")
            ->line('If this was you, wait and try again, or reset your password. If it was not you, reset your password now and use one you do not use anywhere else.');

        return $this->resetUrl ? $mail->action('Reset my password', $this->resetUrl) : $mail;
    }

    public function toArray(object $notifiable): array
    {
        return ['ip' => $this->ipAddress];
    }
}
