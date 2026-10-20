<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** The 6-digit code that confirms a sign-in from a browser or device this account has not used before. */
class SignInCodeNotification extends Notification
{
    use Queueable;

    public function __construct(
        public readonly string $appName,
        #[\SensitiveParameter] public readonly string $code,
        public readonly int $minutes,
        public readonly ?string $ipAddress,
        public readonly ?string $device,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("{$this->code} is your {$this->appName} sign-in code")
            ->greeting('Confirm it is you')
            ->line('Someone signed in to your account with the correct password from a new browser or device:')
            ->line(($this->device ? "**Device:** {$this->device}  \n" : '').($this->ipAddress ? "**IP address:** {$this->ipAddress}" : ''))
            ->line("Your sign-in code is: **{$this->code}**")
            ->line("It works for {$this->minutes} minutes. Never share it — our staff will never ask you for it.")
            ->line('**Not you?** Do not enter the code. Change your password right away: someone knows it.');
    }

    public function toArray(object $notifiable): array
    {
        return ['ip' => $this->ipAddress];
    }
}
