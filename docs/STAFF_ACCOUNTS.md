# Company-Managed Staff Accounts

Design for employee accounts that a business creates and controls, without requiring personal email,
with secure onboarding, scoped administration, immediate offboarding and full auditability.

## 1. What existed before this change

| Capability | Existing | Gap closed by this change |
|---|---|---|
| Global login identity | `users` (email required, unique) | Email optional; login by **business code + username** |
| Business membership | `tenant_memberships` (`active`/`suspended`) | `invited` and `offboarded` states, employee code, status reason/timestamps |
| Branch scope | `membership_branches` + `all_branches` | Staff administrators limited to their own branches |
| Roles & permissions | `roles`, `permissions`, `role_permissions`, `membership_roles` | Granular `staff.*` permissions, 5 new system roles |
| Per-request authorization | `ResolveTenant` requires an active membership | Also requires an active **user** on every authenticated request |
| Escalation guards | Cannot edit self/owner, cannot grant missing permissions | Privileged roles assignable by the owner only; branch-scope guard |
| Onboarding | Password-reset email for new users | Single-use, expiring, hashed activation codes (email link or hand-over code) |
| Offboarding | — | Status change + token/session/reset-token revocation + pending-work report |
| Recovery without email | — | Administrator-assisted recovery code with detection safeguards |

No redundant tables: `tenants` = businesses, `tenant_memberships` = business memberships,
`membership_branches` = branch memberships, `membership_roles` = scoped role assignment, `audit_logs`
and `sessions`/`personal_access_tokens` are reused. One table is added: `staff_invitations`.

## 2. Schema changes (migration `2026_10_14_000100_add_company_managed_staff_accounts`)

| Table | Change |
|---|---|
| `users` | `email` becomes nullable; add `username` (nullable), `managed_by_tenant_id` (FK tenants, restrict); unique `(managed_by_tenant_id, username)`; `status` gains `pending` |
| `tenant_memberships` | add `employee_code`, `status_reason`, `suspended_at`, `offboarded_at`, `offboarded_by`, `created_by`; unique `(tenant_id, employee_code)`; `status` gains `invited`, `offboarded` |
| `staff_invitations` *(new)* | `tenant_id`, `membership_id`, `user_id`, `purpose` (`activation`/`recovery`), `channel` (`email`/`manual`), `code_hash` (SHA-256), `expires_at`, `used_at`, `revoked_at`, `failed_attempts`, `created_by` |

Usernames are unique **per business** (`cashier.main01` can exist in two businesses), which is why
staff log in with `business_code` (the business slug) + `username`. Personal accounts keep logging in
by email.

## 3. Account lifecycle

```
                 create (admin)                activate (employee sets password)
   ┌──────────┐ ───────────────► ┌─────────┐ ───────────────────────────────► ┌────────┐
   │  (none)  │                  │ invited │                                   │ active │
   └──────────┘                  └─────────┘ ◄── resend invitation             └────────┘
                                                                         suspend │   ▲ reactivate
                                                                                 ▼   │
                                                                            ┌───────────┐
                                     offboard (from invited/active/suspended)│ suspended │
                                                   ┌──────────────┐          └───────────┘
                                                   │  offboarded  │ ── rehire ──► invited (new activation)
                                                   └──────────────┘
```

* **User status** (global): `pending` until first activation, `active`, `disabled`. A company-managed user
  is `disabled` when offboarded from the business that manages it.
* **Membership status** (per business): `invited`, `active`, `suspended`, `offboarded`.
* Every authenticated request checks the user status; every business request checks the membership status.
  Changes therefore take effect on the very next request.
* Users are never deleted; historical sales, refunds, stock movements and audit logs keep pointing at them.

## 4. Roles

| Role (key) | Purpose | Staff administration |
|---|---|---|
| Business Owner (`business_owner`) | Everything in the business | Full |
| User & Access Manager (`user_access_manager`) | Staff accounts and access only | `staff.*` (no sales/stock/finance) |
| Branch Manager (`branch_manager`) | Branch operations | Adds and manages staff of **own branches** with non-administrative roles (same process as the owner); cannot change other managers. Owner-only to grant |
| Cashier (`cashier`) | Selling | None |
| Inventory Staff (`inventory_staff`) | Stock operations | None |
| Accountant / Finance (`accountant`) | Reports, expenses, financial review | None |
| Purchasing Staff (`purchasing_staff`) | Suppliers, POs, receiving | None |
| Auditor / Read-only (`auditor`) | Read-only review incl. audit log | View staff only |
| Customer Service (`customer_service`) | Customers, sale look-up, refund requests | None |
| Platform Super Admin (`users.is_platform_admin`) | SaaS platform only | No business access |

Staff permissions: `staff.view`, `staff.create`, `staff.update`, `staff.status` (suspend/reactivate),
`staff.offboard`, `staff.assign_roles`, `staff.assign_branches`, `staff.credentials` (invitations and
recovery), `staff.audit` (account-related audit entries only). They replace the earlier
`members.view` / `members.manage`.

## 5. Authorization rules for staff administration

An administrator may act on a target membership only if **all** of these hold:

1. Same business (scoped route binding → 404 otherwise; IDs from clients are never trusted).
2. The administrator holds the specific `staff.*` permission for the action.
3. The target is not the administrator (no self-service escalation) and not the business owner.
4. **Branch scope**: administrators without all-branch access may only act on members whose branches are
   all within their own branches (and never on all-branch members). Lists show only members who share a branch.
5. **Privileged targets/roles**: roles containing administrative permissions (`staff.create`,
   `staff.assign_roles`, `staff.assign_branches`, `staff.status`, `staff.offboard`, `staff.credentials`,
   `roles.manage`, `tenant.manage`, `branches.manage`) can only be assigned by the business owner, and
   members holding them can only be modified by the owner. A User & Access Manager therefore cannot
   create another User & Access Manager, cannot grant Business Owner, and cannot change other administrators.
6. **Who defines roles**: non-owner administrators assign only the business's non-administrative roles. Those
   roles are system roles or custom roles, and custom roles can only contain permissions their creator holds
   (`roles.manage` is itself owner-only), so administrators can never grant permissions beyond what the owner
   defined. A User & Access Manager or Branch Manager can therefore make someone a Cashier, Accountant, etc., but cannot
   grant any administrative permission — including the Branch Manager role itself, which carries staff
   administration. `RoleResource.assignable` tells the client which roles the caller may give.
7. Branch assignments must be within the administrator's own branches; `all_branches` only by all-branch administrators.

Denied attempts are written to the audit log as `staff.unauthorized_attempt`.

## 5a. Who signs in how

| Who | Signs in with |
|---|---|
| Cashier, Inventory, Accountant, Purchasing, Auditor, Customer Service (and custom roles without administrative permissions) | **username or employee ID** + password |
| Business Owner, Branch Manager, User & Access Manager (HR), any role with an administrative permission | **email** + password |
| Platform super admin | **email** + password |

* The API call is `POST /auth/login` with `business_code` + `username` (the username *or* the employee ID,
  case-insensitive) + `password`. The web app stores the business on the device the first time anyone opens it
  there (or after one staff sign-in with the code), so staff on that device type only username/ID and password.
* Email-only roles need an email: creating such an account, promoting someone into such a role, or removing a
  manager's email answers 422 `EMAIL_REQUIRED`.
* A correct password entered through the username form for an email-only account is refused with "Managers and
  administrators sign in with their email address" and audited (`email_sign_in_required`). The check runs only
  after the password is verified, so it does not reveal anyone's role to someone guessing usernames.
* Responses: `StaffResource.sign_in_with` (`username`/`email`), `RoleResource.requires_email_sign_in`.

## 6. Onboarding

1. Admin calls `POST /tenants/{t}/staff` with name, optional username (auto-generated otherwise, e.g.
   `cashier.main01`), optional employee code, optional company email, roles, branches and a `delivery`:
   * `temporary_password` *(default in the web app)* – a random temporary password (`Xxxx-xxxx-xxxx`, mixed case
     and digits, generated per employee) is returned **once** for a printable credential slip. The account is
     active immediately but `must_change_password` is set: every tenant API call answers 403
     `PASSWORD_CHANGE_REQUIRED` until the employee replaces it via `PUT /me/password`. It expires after
     `SMARTPOS_STAFF_CODE_TTL_HOURS` (sign-in is refused afterwards). Only the bcrypt hash is stored;
   * `email` – an activation link is emailed (requires an email on the account);
   * `manual` – a one-time **activation code** (`XXXX-XXXX-XXXX`, ~60 bits) is returned **once** in the response
     for the admin to hand to the employee in person. It is never stored in plain text and cannot be retrieved later.
2. The user is created with `status=pending` and a random unusable password; the membership is `invited`.
3. The employee calls `POST /api/v1/staff/activate` with `business_code`, `username`, `code` and a new password.
4. Codes are SHA-256 hashed, expire after `SMARTPOS_STAFF_CODE_TTL_HOURS` (default 72), are single-use, and are
   revoked after 5 failed attempts. Issuing a new code revokes earlier ones.
5. On success the user becomes `active`, the membership `active`, and all other outstanding codes are revoked.

No shared or default passwords exist. Administrators never see or choose an employee's password: a temporary
password is generated by the server, shown once, and must be replaced at first sign-in; afterwards only the
employee knows the password. To give an employee new sign-in details, an administrator **resets** it (below).

### Auto-filled identifiers

`GET /tenants/{t}/staff/username-suggestion?role_id=&branch_id=` returns `username` (from role and branch, e.g.
`cashier.main01`), the next `employee_code` (`EMP-0001`, …) and, when the business has a `staff_email_domain`
(Settings → Business), a company `email` such as `cashier.main01@alingnena.com` (null if no domain is set or the
address is taken). The web form fills these when a role is ticked; typed values are kept. Leaving the employee code
empty on create also assigns the next number.

### Personal information

An optional `profile` object on create/update (`job_title`, `hire_date`, `phone`, `address`, `birth_date`,
`emergency_contact_name`, `emergency_contact_phone`, `notes`) is stored in `staff_profiles`, one row per
membership (so it is per business). It is returned only to holders of `staff.update` and to the employee
themselves. Audit entries record which fields changed, never their values.

## 7. Recovery

* **Accounts with email** (personal or company email): the standard `POST /auth/forgot-password` →
  emailed link → `POST /auth/reset-password` (Laravel broker: hashed, single-use, 60-minute expiry).
* **Accounts without email**: the employee calls `POST /api/v1/staff/forgot-password` (business code + username).
  The response is always the same (no account enumeration); staff administrators of that business get an
  in-app notification. An administrator with `staff.credentials` then verifies the employee's identity in
  person and calls `POST /tenants/{t}/staff/{membership}/recovery`, which returns a one-time **recovery code**.
  The employee redeems it at `POST /api/v1/staff/activate` to choose a new password.
* **Reset password (temporary password)**: `POST /tenants/{t}/staff/{membership}/recovery` with
  `delivery=temporary_password` sets a new generated temporary password, shown once on a credential slip. The old
  password stops working immediately, all sessions and tokens are revoked, and the employee must choose a new
  password at next sign-in. For a still-`invited` account, `resend-invitation` with the same delivery does the same.

**Impersonation safeguards.** An administrator who issues a recovery code could in principle redeem it themselves.
This cannot be made impossible without a channel the administrator does not control, so it is made **detectable
and visible**:
with a recovery code the employee's old password keeps working until the code is redeemed, and with a temporary
password the old one stops working at once (either way an impostor locks the real employee out, who notices
immediately); an impostor using a temporary password must also change it, so the employee cannot sign in with it; redemption revokes every token and session; initiation and completion are audited with
actor, IP and user agent; the employee receives an in-app notification on next sign-in; and the business owner is
notified whenever a recovery code is issued by someone else. Recovery codes for members holding administrative
permissions can only be issued by the business owner.

## 8. Offboarding

`POST /tenants/{t}/staff/{membership}/offboard` (`staff.offboard`) with a reason, in one transaction:

1. Membership → `offboarded` (`offboarded_at`, `offboarded_by`, `status_reason`).
2. For company-managed users (whose only purpose is this business): user → `disabled`.
3. All personal access tokens and database sessions of the user are deleted; outstanding activation/recovery
   codes and password-reset tokens are revoked.
4. Historical records are untouched.
5. The response lists **pending work** the administrator should hand over: open register shifts (a manager with
   `shifts.view_all` can close them), pending refund requests, draft transfers, counts and purchase orders.
6. Audit entry `staff.offboarded` with actor, target, reason, affected branches and roles.

For personal (multi-business) accounts only this business's membership is offboarded; other memberships remain.
Rehiring (`POST …/reactivate` on an offboarded membership) returns it to `invited` with a fresh activation code,
so the returning employee must set a new password.

## 9. Role changes and branch transfers

`POST …/change-role` and `POST …/transfer-branches` replace role / branch assignments under the rules in §5.
Permissions and branches are resolved from the database on every request, so a transferred cashier loses the
old branch on their next request without needing a new token. Historical records keep the branch and user
they were created with; the audit log records old and new roles/branches.

## 10. Linking an existing personal account

`POST /tenants/{t}/staff/invite-existing` with an email always answers `202` with the same message, whether or
not the email is registered (no enumeration). If it is, an `invited` membership is created and the person sees it
in `GET /me/memberships`; they must `POST /me/memberships/{id}/accept` before they gain any access.
