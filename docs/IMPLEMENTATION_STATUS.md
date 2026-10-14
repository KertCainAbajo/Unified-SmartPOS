# Implementation Status

Last updated: 2026-10-14. Test runs: backend **162/162 passed on SQLite and on MySQL 8.0.46**; web app **15/15 unit tests**, typecheck and production build passing. End-to-end HTTP flow check (whole business day across all modules and roles, against a separate test database): **106/106**.

Legend: ✅ implemented and covered by automated tests · 🟡 implemented, partially verified · ⛔ not implemented

## Stages

| # | Stage | Status | Evidence |
|---|---|---|---|
| 1 | Environment & database | ✅ | Laravel 13.36, PHP 8.5.1, Sanctum 4, MySQL 8.0.46. Migrations, seeders and `smartpos:verify-integrity` run on MySQL. |
| 2 | Migrations & relationships | ✅ | All domain tables plus Laravel framework tables (sessions, cache, jobs, tokens); `migrate:fresh --seed` succeeds; `smartpos:verify-integrity` passes on seeded data |
| 3 | Authentication & tenancy | ✅ | `tests/Feature/Auth`, `tests/Feature/Tenancy` |
| 4 | Products & inventory | ✅ | `tests/Feature/Catalog`, `tests/Feature/Inventory` |
| 5 | POS checkout & payments | ✅ | `tests/Feature/Pos/CheckoutTest`, `ShiftAndVoidTest`, `tests/Unit/SaleCalculatorTest` |
| 6 | Purchasing & refunds | ✅ | `tests/Feature/Purchasing`, `tests/Feature/Pos/RefundTest` |
| 7 | Reporting & audit logs | ✅ | `tests/Feature/Reports`, `tests/Feature/Operations` |
| 8 | Tests, API docs, hardening | ✅ | OpenAPI exported to `docs/openapi.json` (87 paths); Pint clean; seeders; README |

## Flow review fixes (2026-10-14) — `tests/Feature/RegressionTest.php`

Each bug was reproduced by a failing test before it was fixed.

| # | Area | Bug | Fix |
|---|---|---|---|
| 1 | Receiving | A partially received PO could never be closed (cancel only allowed draft/ordered) | `POST …/purchase-orders/{po}/close` → status `closed`, undelivered quantities audited |
| 2 | Purchasing | Default PO order date used UTC (wrong day after 4 PM Manila) | Uses the business timezone |
| 3 | Stock counts | Expected quantity taken at completion, so sales between counting and completion were erased | Snapshot at count time; variance = counted − snapshot |
| 4 | Input | `.5` / `+5` passed validation but crashed with HTTP 500 | `Money::normalize` accepts every form the `decimal` rule accepts |
| 5 | Adjustments | A `0.000` change caused HTTP 500 | 422 `ZERO_QUANTITY` |
| 6 | Checkout | Another cashier reusing an idempotency key received the original cashier's sale | Replay only for the same cashier; otherwise 409 |
| 7 | Refunds | Cash refund approved after the requester's shift closed was not recorded on any drawer | Charged to the completing user's open shift at that branch |
| 8 | Transfers | A dispatched transfer could not be cancelled (stock stuck in transit) | Cancel in-transit → `transfer_return` back to source |
| 9 | Categories | Parent loops (A→B→A) were accepted | Ancestor walk rejects loops (`INVALID_PARENT`) |

## Company-managed staff accounts (2026-10-14) — see [STAFF_ACCOUNTS.md](STAFF_ACCOUNTS.md)

- ✅ Business-code + username login; personal email optional; usernames unique per business with generator (`cashier.main01`)
- ✅ Pending-activation accounts; hashed, single-use, expiring (72 h) codes; lockout after 5 failures; manual hand-over or email link
- ✅ New roles: User & Access Manager, Accountant, Purchasing, Auditor (read-only), Customer Service; granular `staff.*` permissions
- ✅ Scope rules: no self-edits, owner untouchable, owner-only administrative roles/targets, branch-scoped administration; denials audited
- ✅ Suspend / reactivate / offboard / rehire; offboarding disables company-managed logins and revokes tokens, DB sessions, reset tokens and codes, and reports pending work
- ✅ Per-request user status check (`ACCOUNT_INACTIVE`) in addition to the membership check
- ✅ Role changes and branch transfers effective on the next request; old/new values audited
- ✅ Administrator-assisted recovery for accounts without email, with impersonation detection (old password valid until redemption, sessions revoked, employee and owner notified, audited)
- ✅ Existing personal accounts invited without enumeration; active only after acceptance
- ✅ Staff audit trail endpoint limited to account events; failed sign-ins audited without secrets
- ✅ 22 new tests + rewritten role tests (`tests/Feature/Staff`, `RoleManagementTest`); mutation-checked (removing the branch-scope or owner-only rule makes tests fail)
- ✅ Generated company-based passwords (`AlingNena-4827`, shown once, permanent by default; optional forced change at first sign-in with 72 h expiry), password reset by administrators, auto-filled username / employee ID / company email, staff personal-information profiles (`StaffCredentialsTest`)
- 🟡 Web app: Team page with auto-fill, printable credential slip, staff detail (account, personal information, roles & access, reset password); staff username sign-in and forced password change. **Activation-code and "forgot password" screens are not built yet**
- ✅ Staff sign in with username **or employee ID** + password (business remembered per device); owners, managers and HR sign in with email only (`StaffSignInMethodTest`)
- ⛔ Not implemented: MFA, bulk employee import, per-business password policy

## Recruitment and hiring (2026-10-15) — see [RECRUITMENT.md](RECRUITMENT.md)

- ✅ Vacancies; public careers page and online application with documents; applicant status page (reference + token)
- ✅ Enforced stages SUBMITTED → HR_SCREENING → HR_INTERVIEW → MANAGER_INTERVIEW → OWNER_FINAL_INTERVIEW → APPROVED → OFFER_SENT → OFFER_ACCEPTED → ONBOARDING → HIRED, plus INCOMPLETE / REJECTED / WITHDRAWN / OFFER_DECLINED
- ✅ Interview scheduling, rescheduling (incl. applicant requests), cancellation, no-show, assigned-interviewer-only results with criteria, score, feedback and reasons; append-only history + audit
- ✅ Final approval by owner or delegate; self-approval blocked unless the business policy allows it
- ✅ Offer, onboarding checklist, document verification; SmartPOS account only after all of them (via staff-account rules)
- ✅ 17 tests (`tests/Feature/Recruitment`) covering every transition, permission and bypass attempt
- 🟡 Web pages verified by typecheck/build, not by browser tests; applicant emails go to the log mailer in development
- ⛔ Not implemented: calendar invites, interview reminders, configurable stages per business

## Web app (React, `web/`)

- ✅ Session (cookie) login, registration, business picker, logout; CSRF handled; verified end-to-end through the Vite proxy
- ✅ Permission-aware navigation and branch selector
- ✅ POS: shift open/close with Z reading, barcode/SKU search, cart, server quote (`POST /sales/quote`), SC/PWD, line discounts, split payments, idempotent checkout, printable receipt
- ✅ Sales list/detail, receipt reprint, void, refund request; refund approval queue
- ✅ Products (create/edit/price history/archive), categories, inventory (balances, low stock, history, adjustments, stock counts), transfers
- ✅ Purchasing (suppliers, purchase orders, receiving), customers, expenses
- ✅ Reports (sales, breakdowns, best sellers, movements, profit), audit log, team & roles, business/branch/register settings, notifications
- 🟡 Verified by typecheck, unit tests (cart, money, API client) and HTTP smoke test; no automated browser (E2E) tests yet

## Feature checklist

### Identity, tenancy, RBAC
- ✅ Business registration (user + tenant + main branch + register + owner membership, one transaction; rollback tested)
- ✅ Token login (mobile) and Sanctum SPA session login; logout revokes current token only; logout-all
- ✅ Password hashing (bcrypt), password reset (tokens revoked), change password (other tokens revoked)
- ✅ Email verification (signed link); enforcement switchable with `SMARTPOS_REQUIRE_EMAIL_VERIFICATION`
- ✅ Rate limiting (login, auth, API, checkout)
- ✅ Roles: Business Owner, Branch Manager, Cashier, Inventory Staff (system roles) + custom tenant roles
- ✅ Platform Super Admin: tenant directory + suspend/reactivate only; no access to tenant data (tested)
- ✅ Tenant isolation (middleware + scoped bindings + policies + scoped validation) — tested
- ✅ Branch isolation for inventory, sales, shifts, reports, expenses, audit logs — tested
- ✅ Escalation guards: no self-edit, no owner edit, cannot grant permissions/branches/owner role you lack — tested

### Catalog & inventory
- ✅ Category CRUD, product CRUD, search, pagination, archival/restore
- ✅ SKU format + per-tenant uniqueness; barcode format + GS1 check digit + per-tenant uniqueness
- ✅ Price changes only via dedicated endpoint with `price_history`; cost hidden from roles without cost permissions
- ✅ Branch stock balances; immutable stock ledger with before/after; adjustments with reasons; no negative adjustments
- ✅ Low-stock query (incl. never-stocked products) and low-stock notifications
- ✅ Stock transfers (draft → in transit → received; cancel draft); stock counts with server-computed variance
- ✅ Weighted-average cost per branch (receipts, transfers, refunds)

### POS
- ✅ Registers, shifts (open float, one open shift per register and per user, close with counted cash, X/Z summary)
- ✅ Checkout engine: server prices, line discounts (permission), SC/PWD statutory discount, VAT-inclusive/exclusive,
  VAT-exempt/zero-rated buckets, non-VAT businesses, split payments, change, receipts, sale-item snapshots
- ✅ Idempotency (unique `(tenant_id, idempotency_key)` + request hash; replay 200, conflict 409)
- ✅ Row-locking for inventory (`SELECT … FOR UPDATE`, ordered by product id) and shifts
- ✅ Gap-free receipt numbers per branch (rolled back with failed sales — tested)
- ✅ Voids (same open shift, permission, stock and cash restored) and refunds (partial/full, approval workflow, reservation)

### Purchasing, operations, reporting
- ✅ Suppliers; purchase orders (draft/ordered/partially received/received/cancelled); goods receipts with/without PO; over-receipt prevention
- ✅ Customers; expenses (+ categories, soft delete); in-app notifications; audit log API
- ✅ Reports: daily/monthly sales, by branch, by cashier, by payment method, best sellers, low stock,
  inventory movements, discounts & refunds, expenses, COGS / gross profit / estimated operating profit
- ✅ `smartpos:verify-integrity` command (ledger, sale, payment, refund invariants)

## Blockers

1. ~~MySQL credentials~~ — resolved 2026-10-14: database `Unified-SmartPOS`, test database `smartpos_testing` and user `Unified-SmartPOS` created; full suite passes on MySQL. (Fixed one MySQL-only bug found: reserved word `lines` used as an alias.)
2. **Real concurrency.** SQLite ignores `FOR UPDATE` and serialises writers, so the oversell protection is verified
   sequentially only. A concurrent load test against MySQL (e.g. 20 parallel checkouts on the last unit) is still to do.

## Known limitations / not implemented (by design for this phase)

- ⛔ Product variants table (each SKU is a product; see DATABASE_DESIGN.md for the extension path)
- ⛔ Cart-level discounts, promotions, price lists per branch, loyalty points
- ⛔ Credit sales / accounts receivable, layaway, partial payments
- ⛔ Payment gateway integration (GCash/Maya/card are recorded tenders only); non-cash refunds are records only
- ⛔ BIR accreditation features (accumulated grand total, Z-reading counters/eJournal export, OR series registration)
- ⛔ Partial transfer receipts and cancelling in-transit transfers (use adjustments)
- ⛔ Pending invitations: adding a member creates the account immediately and emails a password-setup link
- ⛔ Email/push notifications (in-app only); email verification link answers with JSON rather than redirecting to the SPA
- ⛔ Offline mobile sync (idempotency keys are designed to support it)
- ⛔ Report caching / materialized summaries for very large datasets
- Changing a business timezone affects only new sales' `business_date`
