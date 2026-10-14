<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Email to a job applicant (they have no SmartPOS account). Contains only applicant-facing information:
 * never interview scores, feedback or internal reasons.
 */
class ApplicantUpdate extends Notification
{
    use Queueable;

    /** @param  list<string>  $lines */
    public function __construct(
        public readonly string $event,
        public readonly string $businessName,
        public readonly string $reference,
        public readonly string $subjectLine,
        public readonly array $lines,
        #[\SensitiveParameter] private readonly ?string $statusUrl = null,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $mail = (new MailMessage)->subject("{$this->businessName}: {$this->subjectLine}");
        foreach ($this->lines as $line) {
            $mail->line($line);
        }
        if ($this->statusUrl !== null) {
            $mail->action('View my application', $this->statusUrl)
                ->line('Keep this email: the link above is the only way to view your application status.');
        }

        return $mail->line("Application reference: {$this->reference}");
    }

    public function toArray(object $notifiable): array
    {
        return ['event' => $this->event, 'reference' => $this->reference];
    }
}
