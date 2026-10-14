# Recruitment and Hiring Workflow

Mandatory three-interview hiring process, enforced by the backend (`App\Services\Recruitment\RecruitmentService`).
An applicant becomes a SmartPOS user only at the very last step, through the normal staff-account rules.

## Stages

```
SUBMITTED → HR_SCREENING → HR_INTERVIEW → MANAGER_INTERVIEW → OWNER_FINAL_INTERVIEW → APPROVED
          → OFFER_SENT → OFFER_ACCEPTED → ONBOARDING → HIRED
```

Exceptions: `INCOMPLETE` (missing requirements / clarification; remembers where to return), `REJECTED`,
`WITHDRAWN`, `OFFER_DECLINED`. Interview rescheduling is tracked per interview (`reschedule_requested`,
reschedule count, full history). `APPROVED` is the state between the owner's decision and HR sending the offer.

Every status change goes through one method that only allows the edges in `RecruitmentService::TRANSITIONS`;
anything else is 422 `INVALID_TRANSITION` / `INVALID_APPLICATION_STATE`.

| Step | Who | Outcomes |
|---|---|---|
| Application | Applicant (public page) | Submitted with required documents and privacy consent |
| HR screening | HR (`recruitment.hr`) | pass → HR interview · incomplete → applicant · reject |
| HR interview | Assigned HR interviewer | pass → manager · request_info → applicant (returns to HR interview) · reject |
| Manager interview | Assigned branch manager (`recruitment.manager_interview`, own branch) | recommend → owner · reassess (new manager round) · reject |
| Final interview | Owner, or owner-granted delegate (`recruitment.final_approval`) | approve · another_interview (back to a chosen stage) · reject |
| Offer | HR | Offer sent; applicant accepts/declines online or HR records the answer |
| Onboarding | HR | Checklist (`config/smartpos.php` → `onboarding_tasks`) and document verification |
| Account | Account administrator (`staff.create`) | Account with the vacancy's role and branch; one-time sign-in slip |

## Rules enforced on the server

- **No skipping.** Interviews can be scheduled only for the current stage, one open interview per stage; results
  only for the current stage; offer only after approval; onboarding only after acceptance; account only when
  onboarding is complete (`ONBOARDING_INCOMPLETE` lists what is missing).
- **Only the assigned interviewer records a result**, and only while still eligible (role + branch). Even the
  owner cannot record a result for an interview assigned to someone else.
- **Eligible interviewers**: HR stage → HR (or owner); manager stage → branch managers with access to the
  application's branch (or owner); final stage → owner or a final-approval delegate.
- **Final approval** only by the owner or a delegate. A delegate who made the manager-stage recommendation cannot
  approve the same applicant unless the business enables *Settings → Hiring: a delegate who recommended an
  applicant may also give the final approval* (`tenants.recruitment_allow_self_approval`, default off).
  `recruitment.final_approval` is an administrative permission: only the owner can grant it.
- **Visibility**: branch-scoped. Members who only interview at the manager stage see applications once they have
  reached the manager interview, or ones they are assigned to — never applicants rejected earlier by HR.
- **Rejection** by HR during screening; by the owner / final approver at any stage before the offer; and through
  interview decisions. A reason is always required (internal; the applicant sees only "Not selected").
- **No overwriting.** Each interview round is its own record; reassessments, returns and clarifications add rounds
  and events. `application_events` is append-only (updates and deletes throw). Every action is also written to
  `audit_logs` as `recruitment.*`; refusals as `recruitment.unauthorized_attempt`.
- **One open application per person per vacancy** (same email): 422 `DUPLICATE_APPLICATION` until it is closed.
- **Openings**: when the number of hires reaches the vacancy's openings (`slots`), the vacancy closes automatically
  (`recruitment.vacancy_filled` audit entry) and disappears from the careers page.
- **No SmartPOS access before**: approval, offer acceptance, all required onboarding tasks and verification of
  every document type the vacancy requires.

## Applicants

Applicants have no SmartPOS account. On submitting they get a reference (`APP-XXXXXXXX`) and a secret token
(shown once, emailed as a link; only its SHA-256 is stored). With it they can view their status (public stage
label, interview schedule, offer — never scores, feedback or reasons), upload documents while under review or
incomplete, ask to reschedule an interview, accept/decline the offer and withdraw. A wrong reference or token
gives the same 404. Public endpoints are rate-limited (`public-applications`, 10/min per IP).

Applicant emails (`App\Notifications\ApplicantUpdate`): received, interview scheduled / moved / cancelled,
information requested, selected, offer, rejected (generic), hired. Staff get in-app notifications for assignments,
uploads, reschedule requests, offer answers and withdrawals.

Documents (PDF/JPG/PNG, ≤ 5 MB) are stored on the private `local` disk under `recruitment/{tenant}/{application}`
and are downloadable only by staff who can see the application.

## API

Public (no sign-in, under `/api/v1/careers`): `GET {business}/vacancies`, `POST {business}/vacancies/{id}/apply`
(multipart), `POST applications/status`, `applications/documents`, `applications/withdraw`,
`applications/offer-response`, `applications/reschedule-request` (all with `reference` + `token`).

Staff (under `/api/v1/tenants/{t}`): `vacancies` (GET/POST/PATCH), `applications` (list, show),
`applications/{a}/interviewers?stage=`, `start-screening`, `screen`, `clarification`, `resume`, `interviews`,
`interviews/{i}/reschedule|cancel|no-show|result`, `another-interview`, `reject`, `withdraw`, `offer`,
`offer-response`, `onboarding`, `onboarding-tasks/{task}`, `documents` (upload), `documents/{d}` (download),
`documents/{d}/verify`, `provision`.

## Web

- Public: `/careers/{business code}` (vacancies + application form) and `/applications/status` (applicant view).
- Staff: **Recruitment** in the sidebar (`recruitment.view`): applications with the 6-step tracker, a "Next step"
  panel showing only the actions allowed for the current stage and member, interviews, documents, history; and
  vacancies. "Copy careers page link" gives the public URL to share.

## Tests

`tests/Feature/Recruitment/RecruitmentWorkflowTest.php` (every transition, full path to a working sign-in) and
`RecruitmentAccessTest.php` (skipping stages, unassigned/ineligible interviewers, final approval and self-approval
policy, branch and stage visibility, roles without access, other businesses, applicant token isolation, no account
before onboarding, private documents).
