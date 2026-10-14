/** Recruitment types and labels shared by the public careers pages and the staff Recruitment page. */

export type ApplicationStatus =
  | 'submitted'
  | 'hr_screening'
  | 'incomplete'
  | 'hr_interview'
  | 'manager_interview'
  | 'owner_final_interview'
  | 'approved'
  | 'offer_sent'
  | 'offer_accepted'
  | 'offer_declined'
  | 'onboarding'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export type InterviewStage = 'hr_interview' | 'manager_interview' | 'owner_final_interview';

export interface DocumentType {
  type: string;
  label: string;
}

export interface Vacancy {
  id: number;
  title: string;
  description: string | null;
  requirements: string | null;
  employment_type: string;
  slots: number;
  status: 'draft' | 'open' | 'closed';
  branch_id: number;
  branch?: { id: number; name: string };
  role_id: number;
  role?: { id: number; name: string };
  required_documents: DocumentType[];
  applications_count?: number;
}

export interface Interview {
  id: number;
  stage: InterviewStage;
  stage_label: string;
  round: number;
  interviewer_membership_id: number;
  interviewer_name: string | null;
  scheduled_at: string;
  mode: 'in_person' | 'phone' | 'video';
  location: string | null;
  status: 'scheduled' | 'reschedule_requested' | 'completed' | 'cancelled' | 'no_show';
  reschedule_count: number;
  cancel_reason: string | null;
  criteria: { name: string; score: number }[] | null;
  score: number | null;
  feedback: string | null;
  decision: string | null;
  decision_reason: string | null;
  decided_at: string | null;
}

export interface ApplicationEvent {
  id: number;
  action: string;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus | null;
  to_label: string | null;
  actor_type: 'staff' | 'applicant' | 'system';
  actor_name: string | null;
  interview_id: number | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface JobApplication {
  id: number;
  reference: string;
  status: ApplicationStatus;
  status_label: string;
  return_status: ApplicationStatus | null;
  first_name: string;
  last_name: string;
  name: string;
  email: string;
  phone: string;
  address: string | null;
  birth_date: string | null;
  work_experience: string | null;
  availability: string | null;
  cover_letter: string | null;
  applicant_message: string | null;
  rejection_reason: string | null;
  branch_id: number;
  branch?: { id: number; name: string };
  vacancy?: { id: number; title: string; role: { id: number; name: string } | null; required_documents: string[] };
  approved_at: string | null;
  offer: { position: string; salary: string | null; start_date: string; terms: string | null; sent_at: string; responded_at: string | null; response_source: string | null } | null;
  onboarding_started_at: string | null;
  hired_membership_id: number | null;
  hired_at: string | null;
  closed_at: string | null;
  interviews?: Interview[];
  documents?: { id: number; type: string; type_label: string; original_name: string; mime_type: string; size: number; uploaded_by_type: string; verified_at: string | null; created_at: string }[];
  onboarding_tasks?: { id: number; key: string; label: string; required: boolean; completed_at: string | null; note: string | null }[];
  events?: ApplicationEvent[];
  provisioning_blockers?: string[];
  created_at: string;
}

/** What the applicant sees on the public status page (no internal notes). */
export interface PublicApplication {
  reference: string;
  business: string;
  position: string;
  name: string;
  status: ApplicationStatus;
  status_label: string;
  step: number | null;
  closed: boolean;
  message: string | null;
  interviews: { id: number; stage: string; scheduled_at: string; mode: string; location: string | null; reschedule_requested: boolean }[];
  offer: { position: string; salary: string | null; start_date: string; terms: string | null } | null;
  documents: { type: string; name: string; uploaded_at: string }[];
  can_upload: boolean;
  can_withdraw: boolean;
  can_respond_to_offer: boolean;
}

/** The six steps shown to applicants and staff (matches the hiring process). */
export const HIRING_STEPS = [
  { step: 1, label: 'Application', detail: 'Application and documents reviewed by HR' },
  { step: 2, label: 'HR Interview', detail: 'First interview' },
  { step: 3, label: 'Manager Interview', detail: 'Second interview' },
  { step: 4, label: 'Final Interview', detail: 'Business owner' },
  { step: 5, label: 'Offer & Onboarding', detail: 'Job offer, documents, checklist' },
  { step: 6, label: 'Account', detail: 'SmartPOS access' },
];

export function stepOf(status: ApplicationStatus): number | null {
  switch (status) {
    case 'submitted':
    case 'hr_screening':
    case 'incomplete':
      return 1;
    case 'hr_interview':
      return 2;
    case 'manager_interview':
      return 3;
    case 'owner_final_interview':
      return 4;
    case 'approved':
    case 'offer_sent':
    case 'offer_accepted':
    case 'offer_declined':
    case 'onboarding':
      return 5;
    case 'hired':
      return 6;
    default:
      return null;
  }
}

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: 'Submitted',
  hr_screening: 'HR screening',
  incomplete: 'Incomplete',
  hr_interview: 'HR interview',
  manager_interview: 'Manager interview',
  owner_final_interview: 'Final interview',
  approved: 'Hiring approved',
  offer_sent: 'Offer sent',
  offer_accepted: 'Offer accepted',
  offer_declined: 'Offer declined',
  onboarding: 'Onboarding',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const DECISIONS: Record<InterviewStage, { value: string; label: string; tone: 'good' | 'bad' | 'neutral' }[]> = {
  hr_interview: [
    { value: 'pass', label: 'Pass to manager interview', tone: 'good' },
    { value: 'request_info', label: 'Request more information', tone: 'neutral' },
    { value: 'reject', label: 'Reject', tone: 'bad' },
  ],
  manager_interview: [
    { value: 'recommend', label: 'Recommend to owner', tone: 'good' },
    { value: 'reassess', label: 'Request reassessment', tone: 'neutral' },
    { value: 'reject', label: 'Reject', tone: 'bad' },
  ],
  owner_final_interview: [
    { value: 'approve', label: 'Approve hiring', tone: 'good' },
    { value: 'another_interview', label: 'Request another interview', tone: 'neutral' },
    { value: 'reject', label: 'Reject', tone: 'bad' },
  ],
};

export const DECISION_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(DECISIONS).flatMap((list) => list.map((d) => [d.value, d.label])),
);

export const MODE_LABELS: Record<string, string> = { in_person: 'In person', phone: 'Phone call', video: 'Video call' };
