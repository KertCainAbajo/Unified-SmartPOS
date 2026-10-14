<?php

namespace App\Notifications;

use App\Models\StaffInvitation;
use App\Models\Tenant;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Carbon;

/** Emails an activation or recovery link to a company-managed account that has a company email. */
class StaffCodeNotification extends Notification
{
    use Queueable;

    public function __construct(
        private readonly Tenant $tenant,
        private readonly string $username,
        #[\SensitiveParameter] private readonly string $code,
        private readonly string $purpose,
        private readonly Carbon $expiresAt,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $url = rtrim((string) config('smartpos.frontend_url'), '/').'/activate?'.http_build_query([
            'business' => $this->tenant->slug,
            'username' => $this->username,
            'code' => $this->code,
        ]);
        $recovery = $this->purpose === StaffInvitation::PURPOSE_RECOVERY;

        return (new MailMessage)
            ->subject($recovery ? "Reset your {$this->tenant->name} password" : "Activate your {$this->tenant->name} account")
            ->line($recovery
                ? 'An administrator issued a password recovery link for your staff account.'
                : "An account was created for you at {$this->tenant->name}.")
            ->line("Business code: {$this->tenant->slug} · Username: {$this->username}")
            ->action($recovery ? 'Choose a new password' : 'Activate account', $url)
            ->line('This link works once and expires '.$this->expiresAt->diffForHumans().'.')
            ->line('If you did not expect this email, contact your manager.');
    }

    /** Keep the one-time code out of any serialized/queued representation. */
    public function toArray(object $notifiable): array
    {
        return ['tenant_id' => $this->tenant->id, 'purpose' => $this->purpose];
    }
}
