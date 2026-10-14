<?php

namespace App\Enums;

/**
 * Recruitment workflow. Default path:
 * SUBMITTED → HR_SCREENING → HR_INTERVIEW → MANAGER_INTERVIEW → OWNER_FINAL_INTERVIEW → APPROVED → OFFER_SENT
 * → OFFER_ACCEPTED → ONBOARDING → HIRED.
 * Exceptions: INCOMPLETE (missing requirements / clarification, returns to where it was), REJECTED, WITHDRAWN,
 * OFFER_DECLINED. Interview rescheduling is tracked on the interview (status `reschedule_requested`, reschedule
 * count and history). Transitions are validated in RecruitmentService.
 */
enum ApplicationStatus: string
{
    case Submitted = 'submitted';
    case HrScreening = 'hr_screening';
    case Incomplete = 'incomplete';
    case HrInterview = 'hr_interview';
    case ManagerInterview = 'manager_interview';
    case OwnerFinalInterview = 'owner_final_interview';
    case Approved = 'approved';
    case OfferSent = 'offer_sent';
    case OfferAccepted = 'offer_accepted';
    case OfferDeclined = 'offer_declined';
    case Onboarding = 'onboarding';
    case Hired = 'hired';
    case Rejected = 'rejected';
    case Withdrawn = 'withdrawn';

    /** Interview stages, in order. */
    public const INTERVIEW_STAGES = [self::HrInterview, self::ManagerInterview, self::OwnerFinalInterview];

    public function label(): string
    {
        return match ($this) {
            self::Submitted => 'Submitted',
            self::HrScreening => 'HR screening',
            self::Incomplete => 'Incomplete — waiting for applicant',
            self::HrInterview => 'HR interview',
            self::ManagerInterview => 'Branch manager interview',
            self::OwnerFinalInterview => 'Owner final interview',
            self::Approved => 'Hiring approved',
            self::OfferSent => 'Offer sent',
            self::OfferAccepted => 'Offer accepted',
            self::OfferDeclined => 'Offer declined',
            self::Onboarding => 'Onboarding',
            self::Hired => 'Hired',
            self::Rejected => 'Rejected',
            self::Withdrawn => 'Withdrawn',
        };
    }

    /** What the applicant sees. Never reveals internal notes, scores or reasons. */
    public function publicLabel(): string
    {
        return match ($this) {
            self::Submitted, self::HrScreening => 'Application under review',
            self::Incomplete => 'Action needed: please provide the requested information',
            self::HrInterview => 'HR Interview',
            self::ManagerInterview => 'Manager Interview',
            self::OwnerFinalInterview => 'Final Interview',
            self::Approved => 'Selected — your job offer is being prepared',
            self::OfferSent => 'Job offer sent',
            self::OfferAccepted => 'Offer accepted',
            self::OfferDeclined => 'Offer declined',
            self::Onboarding => 'Onboarding',
            self::Hired => 'Hired — welcome to the team',
            self::Rejected => 'Not selected',
            self::Withdrawn => 'Application withdrawn',
        };
    }

    public function isClosed(): bool
    {
        return in_array($this, [self::Hired, self::Rejected, self::Withdrawn, self::OfferDeclined], true);
    }

    public function isInterviewStage(): bool
    {
        return in_array($this, self::INTERVIEW_STAGES, true);
    }

    /** Position of an interview stage (0 = HR) for "earlier stage" checks. */
    public function interviewIndex(): ?int
    {
        $index = array_search($this, self::INTERVIEW_STAGES, true);

        return $index === false ? null : $index;
    }
}
