# Implementation Status

Last updated: 2026-10-14. Test runs: **99/99 passed on SQLite in-memory** and **99/99 passed on MySQL 8.0.46** (`phpunit.mysql.xml`).

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
