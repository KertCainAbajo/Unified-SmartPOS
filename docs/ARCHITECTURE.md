# Architecture

## Overview

```
 React web (SPA cookie auth) ─┐
                              ├──► Laravel API  /api/v1  ──► MySQL 8
 Expo mobile (bearer tokens) ─┘        │
                                       └── Mail (password reset, verification)
```

A single Laravel application (modular monolith) serves both clients. No microservices.

## Code layout

| Path | Responsibility |
|---|---|
| `routes/api.php` | All `/api/v1` routes. Tenant routes live under `/api/v1/tenants/{tenant}/…` |
| `app/Http/Controllers/Api/V1` | Thin controllers: authorize → validate (Form Request) → call service → return Resource |
| `app/Http/Requests` | Form Requests (validation only; tenant-aware `exists`/`unique` rules) |
| `app/Http/Resources` | API Resources (response shapes) |
| `app/Http/Middleware/ResolveTenant.php` | Resolves `{tenant}`, requires an active membership, loads permissions into `TenantContext` |
| `app/Support/TenantContext.php` | Request-scoped holder for current tenant, membership, permissions and branch access |
| `app/Support/Money.php` | Decimal-string arithmetic (bcmath) with half-up rounding |
| `app/Policies` | Model policies; each checks tenant ownership + permission + branch access |
| `app/Services/*` | Business operations (checkout, stock ledger, transfers, purchasing, refunds, reports, audit) |
| `app/Exceptions/BusinessRuleException.php` | Domain errors rendered as `422` with a machine-readable `code` |
| `app/Enums` | String-backed enums for statuses, movement types, tax types, payment methods |

## Request lifecycle for a tenant endpoint

1. `auth:sanctum` authenticates by bearer token **or** by stateful session cookie (SPA).
2. `throttle:api` applies rate limits; auth endpoints use stricter named limiters.
3. `tenant` middleware (`ResolveTenant`): loads `{tenant}`, rejects suspended tenants, requires an
   **active membership** for the authenticated user (platform admins get no bypass), and stores
   the membership's permission keys and authorized branch IDs in `TenantContext`.
4. Scoped route-model binding (`scopeBindings`) resolves child models through the tenant's
   relationships, so `/tenants/1/products/99` returns 404 if product 99 belongs to another tenant.
5. Controller calls `$this->authorize()` → Policy checks permission key + branch access.
6. Form Request validates input. `exists` rules are scoped by `tenant_id`.
7. Service performs the operation inside `DB::transaction()` with row locks where needed and
   writes audit log entries.
8. API Resource renders the response.

## Tenancy model

- **Shared database, shared schema.** Every tenant-owned row has `tenant_id` (FK, indexed).
- Isolation is enforced in four layers: tenant middleware (membership), scoped route bindings,
  policies (re-check `tenant_id`), and tenant-scoped queries/validation in services and
  Form Requests. Tenant IDs are never taken from the request body.
- A user can belong to several tenants. Each membership has its own roles and its own set of
  authorized branches (`all_branches` flag or explicit `membership_branches`).

## Authorization (RBAC)

- `permissions` is a fixed catalogue (e.g. `sales.create`, `refunds.approve`).
- `roles` are either **system roles** (`tenant_id` NULL, shared templates) or tenant-defined
  custom roles. Roles map to permissions via `role_permissions`.
- Memberships receive roles via `membership_roles`. Effective permissions = union of role permissions.
- **Platform Super Admin** is a flag on `users` (`is_platform_admin`). It grants access only to
  `/api/v1/platform/*` (tenant directory, suspend/reactivate). It grants **no** access to tenant
  data such as sales, payments or customers. To work inside a tenant, the admin needs a membership like anyone else.
- Privilege-escalation guards: members cannot edit their own roles, cannot modify the business
  owner's membership, and cannot grant a role containing permissions they do not hold.

## Financial and stock consistency

- Money is stored as `DECIMAL(15,2)`, costs as `DECIMAL(15,4)`, quantities as `DECIMAL(15,3)`.
  PHP code never uses floats for money; `App\Support\Money` performs bcmath string arithmetic.
- Stock balances (`inventory.quantity`) are only changed by `StockLedger`, which locks the
  inventory row (`SELECT … FOR UPDATE`), validates the result and writes an immutable
  `stock_movements` row with before/after quantities. Clients never send balances. A stock
  count sends a *counted* quantity and the server books the variance as a movement.
- Checkout locks all affected inventory rows in a deterministic order (by product id) to avoid
  deadlocks, then validates availability. This prevents concurrent oversell.
- Completed sales are never deleted. Reversals are voids (same-day, whole sale) or refunds
  (partial or full), each with stock movements and audit logs.

## Concurrency and idempotency

| Operation | Protection |
|---|---|
| Checkout | Open shift row locked; inventory rows locked in ascending product order; whole sale in one transaction |
| Duplicate checkout | Unique `(tenant_id, idempotency_key)`; request SHA-256 hash stored; replay returns the original sale (200), a different body returns 409; a concurrent duplicate that loses the unique-index race is answered as a replay |
| Receipt / document numbers | `document_sequences` row locked and incremented inside the document's transaction (gap-free; rolled back with failures) |
| Refunds / voids | Sale row locked; pending refunds reserve quantities |
| Shifts | Register row locked when opening; session row locked when closing and during checkout |
| Transfers, counts, POs | Header row locked with a state check (`draft` → …) before any stock change |

Locks are effective on MySQL/InnoDB. SQLite (used by the default test suite) serialises writers and ignores
`FOR UPDATE`, so concurrency must also be verified against MySQL (see IMPLEMENTATION_STATUS.md).

## Testing strategy

- `tests/Unit`: pure calculations (`Money`, `SaleCalculator`).
- `tests/Feature`: HTTP-level tests through real routes, middleware, policies and services, asserting both the
  response and the resulting database state (ledger, audit log, counters).
- `tests/TestCase::setStock()` creates stock through `StockLedger`, so `smartpos:verify-integrity` holds in tests.
- `RefreshDatabase` is guarded: tests refuse to run unless the database is `:memory:` or named `*_testing`.

## Error format

```json
{ "message": "Insufficient stock for SKU-001.", "code": "INSUFFICIENT_STOCK", "errors": { "items.0.quantity": ["…"] } }
```

| Status | Meaning |
|---|---|
| 401 | Unauthenticated |
| 403 | Authenticated but lacking permission / branch access |
| 404 | Resource not found **or belongs to a tenant you are not a member of** |
| 409 | Idempotency key reused with a different payload |
| 422 | Validation error or business-rule violation (`code` present for rule violations) |
| 429 | Rate limited |

## Logging

Laravel's default log channel. Credentials, tokens and passwords are never logged. The audit trail
is stored in `audit_logs` (database), separate from the application logs. Password fields are
always excluded from audit diffs.
