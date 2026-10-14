# API Specification (v1)

The machine-readable contract is **[docs/openapi.json](openapi.json)** (OpenAPI 3.1, generated from the
routes, Form Requests and API Resources by [Scramble](https://scramble.dedoc.co)). Regenerate it with
`php artisan scramble:export`. In local development the interactive UI is served at `/docs/api`.

This document is the human-readable overview: conventions, permissions per endpoint and business workflows.

## Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1` |
| Format | JSON. Send `Accept: application/json`. |
| Auth (mobile/API) | `POST /auth/login` with `device_name` → `Authorization: Bearer <token>` |
| Auth (browser SPA) | `GET /sanctum/csrf-cookie`, then `POST /auth/login` without `device_name` from a `SANCTUM_STATEFUL_DOMAINS` origin; cookies + `X-XSRF-TOKEN` thereafter |
| Tenant scope | `/tenants/{tenant}/…` requires an **active membership**; otherwise `404` |
| Money | Decimal strings with 2 places (`"112.00"`). Costs 4 places, quantities 3 places. Never floats. |
| Pagination | `?page=&per_page=` (max 100). Response: `data`, `links`, `meta` (Laravel paginator). |
| Dates | Filters use `YYYY-MM-DD` in the business timezone (`Asia/Manila` by default). Timestamps are ISO-8601 UTC. |
| Rate limits | API 120/min per user; `auth/*` 10/min per IP; login 5/min per email+IP; checkout 60/min per user |

### Error responses

```json
{ "message": "Insufficient stock for SKU-001 (Coke 1L). Available: 1.000.", "code": "INSUFFICIENT_STOCK",
  "errors": { "product_id": ["12"] } }
```

| Status | When |
|---|---|
| 401 | Missing/invalid token or session |
| 403 | Permission missing, branch not authorized, suspended business (`TENANT_SUSPENDED`), unverified email (`EMAIL_NOT_VERIFIED`), role escalation (`ROLE_ESCALATION`) |
| 404 | Not found **or** belongs to another business |
| 409 | `IDEMPOTENCY_KEY_REUSED` |
| 422 | Validation (`errors`) or business rule (`code`) |
| 429 | Rate limited |

Business-rule codes: `INSUFFICIENT_STOCK`, `WHOLE_UNITS_ONLY`, `STOCK_NOT_TRACKED`, `PRODUCT_INACTIVE`,
`REGISTER_NOT_OPEN`, `REGISTER_ALREADY_OPEN`, `USER_HAS_OPEN_SHIFT`, `SHIFT_CLOSED`, `INSUFFICIENT_PAYMENT`,
`PAYMENT_EXCEEDS_TOTAL`, `INVALID_PAYMENT`, `INVALID_DISCOUNT`, `DISCOUNT_NOT_COMBINABLE`, `SALE_NOT_VOIDABLE`,
`SALE_HAS_REFUNDS`, `SALE_NOT_REFUNDABLE`, `REFUND_EXCEEDS_SOLD`, `INVALID_REFUND_STATE`, `INVALID_TRANSFER_STATE`,
`INVALID_COUNT_STATE`, `INVALID_PO_STATE`, `OVER_RECEIPT`, `INVALID_PO_ITEM`, `WRONG_BRANCH`, `ALREADY_MEMBER`,
`ROLE_IN_USE`, `CATEGORY_IN_USE`, `SAME_BRANCH`.

## Endpoints and permissions

"Branch" means the caller must also be authorized for the branch involved.

### Authentication and profile (no tenant)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | Owner + business + main branch + register, in one transaction |
| POST | `/auth/login` | public | `email` **or** `business_code` + `username` (company-managed staff); token (with `device_name`) or session |
| POST | `/auth/logout` | user | Revokes current token / ends session |
| POST | `/auth/logout-all` | user | Revokes all tokens |
| POST | `/auth/forgot-password` | public | Always the same response |
| POST | `/auth/reset-password` | public | Revokes all tokens |
| GET | `/auth/email/verify/{id}/{hash}` | signed URL | |
| POST | `/auth/email/verification-notification` | user | |
| GET/PATCH | `/me` | user | |
| PUT | `/me/password` | user | Requires `current_password`; revokes other tokens |
| GET | `/me/memberships` | user | Businesses, roles, branches |
| POST | `/tenants` | user | Create an additional business owned by the caller |
| POST | `/me/memberships/{id}/accept` / `decline` | user | Respond to an invitation to an existing personal account |
| POST | `/staff/activate` | public (rate-limited) | Redeem an activation or recovery code (`business_code`, `username`, `code`, `password`) |
| POST | `/staff/forgot-password` | public (rate-limited) | Staff sign-in help: emailed link or administrators notified; same response always |

### Platform administration

| Method | Path | Auth |
|---|---|---|
| GET | `/platform/tenants` | `is_platform_admin` — name/status/counts only, no transactions |
| PATCH | `/platform/tenants/{tenant}/status` | `is_platform_admin` — suspend/reactivate with reason (audited) |

### Business, branches, members, roles

| Method | Path | Permission |
|---|---|---|
| GET | `/tenants/{t}` | member |
| PATCH | `/tenants/{t}` | `tenant.manage` |
| GET | `/tenants/{t}/context` | member — own permissions and branches |
| GET | `/tenants/{t}/branches` | member (authorized branches only) |
| POST/PATCH | `/tenants/{t}/branches[/{b}]` | `branches.manage` |
| GET | `/tenants/{t}/roles`, `/permissions` | `staff.view` |
| POST/PATCH/DELETE | `/tenants/{t}/roles[/{r}]` | `roles.manage`; custom roles only |

### Staff accounts (see [STAFF_ACCOUNTS.md](STAFF_ACCOUNTS.md))

Every write also enforces: same business, not self, not the owner, branch scope (administrators without all-branch
access only manage staff wholly inside their branches), and owner-only administrative roles/targets. Denials are
audited as `staff.unauthorized_attempt`.

| Method | Path | Permission |
|---|---|---|
| GET | `/tenants/{t}/staff` | `staff.view` — filters `status`, `q`, `branch_id`; restricted admins see shared-branch staff only |
| GET | `/tenants/{t}/staff/{id}` | `staff.view` (or own record) |
| POST | `/tenants/{t}/staff` | `staff.create` — company-managed account; `delivery` = `temporary_password` (returns a generated company-based password once; permanent unless `require_password_change=true`), `manual` (returns `activation_code` once) or `email`; optional `profile` |
| GET | `/tenants/{t}/staff/username-suggestion?role_id=&branch_id=` | `staff.create` — `{username, employee_code, email}` (`email` null without a `staff_email_domain`) |
| POST | `/tenants/{t}/staff/invite-existing` | `staff.create` — always 202; person must accept |
| PATCH | `/tenants/{t}/staff/{id}` | `staff.update` — name/username/email/employee code (personal accounts: employee code only) and `profile` |
| POST | `/tenants/{t}/staff/{id}/change-role` | `staff.assign_roles` |
| POST | `/tenants/{t}/staff/{id}/transfer-branches` | `staff.assign_branches` |
| POST | `/tenants/{t}/staff/{id}/suspend` | `staff.status` — revokes tokens and sessions |
| POST | `/tenants/{t}/staff/{id}/reactivate` | `staff.status` (+ `staff.credentials` to rehire an offboarded member) |
| POST | `/tenants/{t}/staff/{id}/offboard` | `staff.offboard` — returns `pending_work` |
| POST | `/tenants/{t}/staff/{id}/resend-invitation` | `staff.credentials` — `delivery` as on create |
| POST | `/tenants/{t}/staff/{id}/recovery` | `staff.credentials` — company-managed, active members only; `delivery=temporary_password` resets the password |
| GET | `/tenants/{t}/staff/{id}/pending-work` | `staff.offboard` |
| GET | `/tenants/{t}/staff/audit-log` | `staff.audit` — `staff.*` and `auth.*` events only |

Responses that issue credentials have the shape `{data, activation_code, temporary_password, code_expires_at}`
(only one secret is non-null) and `Cache-Control: no-store`. Staff records include `profile` only for `staff.update`
holders and the employee. `POST /auth/login` returns `must_change_password`; while it is true, tenant and platform
endpoints answer 403 `PASSWORD_CHANGE_REQUIRED` until `PUT /me/password` succeeds.

Sign-in method: company-managed staff log in with `business_code` + `username` (username or employee ID); owners,
managers and HR (roles with `requires_email_sign_in`) must use `email`. See STAFF_ACCOUNTS.md §5a.

Staff error codes: `DUPLICATE_IDENTIFIER`, `EMAIL_REQUIRED`, `INVALID_ROLE`, `INVALID_BRANCH`, `BRANCH_REQUIRED`,
`INVALID_STAFF_STATE`, `PERSONAL_ACCOUNT`, `PERSONAL_ACCOUNT_PROFILE`; `ACCOUNT_INACTIVE` (401) on any request by a
disabled user.

### Catalog

| Method | Path | Permission |
|---|---|---|
| GET | `/tenants/{t}/categories[/{c}]` | `products.view` |
| POST/PATCH/DELETE | `/tenants/{t}/categories[/{c}]` | `categories.manage` (delete only when empty) |
| GET | `/tenants/{t}/products` | `products.view` — `q`, `barcode`, `sku`, `category_id`, `status`, `with_stock` |
| POST/PATCH | `/tenants/{t}/products[/{p}]` | `products.manage` (price not editable here) |
| PATCH | `/tenants/{t}/products/{p}/price` | `products.price` — writes `price_history` |
| GET | `/tenants/{t}/products/{p}/price-history` | `products.view` (costs need `products.price`/`reports.financial`) |
| POST | `/tenants/{t}/products/{p}/archive` / `restore` | `products.manage` |

### Inventory

| Method | Path | Permission |
|---|---|---|
| GET | `/tenants/{t}/inventory` | `inventory.view` |
| GET | `/tenants/{t}/inventory/low-stock` (also `/reports/low-stock`) | `inventory.view` |
| POST | `/tenants/{t}/inventory/adjustments` | `inventory.adjust` + branch |
| GET | `/tenants/{t}/stock-movements` | `inventory.view` |
| GET/POST | `/tenants/{t}/stock-transfers` | view: `inventory.view`; create: `inventory.transfer` + source branch |
| POST | `/tenants/{t}/stock-transfers/{id}/dispatch` / `cancel` | `inventory.transfer` + source branch — cancelling an in-transit transfer returns the stock to the source (`transfer_return`) |
| POST | `/tenants/{t}/stock-transfers/{id}/receive` | `inventory.transfer` + destination branch |
| GET/POST | `/tenants/{t}/stock-counts` | view: `inventory.view`; create: `inventory.count` + branch |
| POST | `/tenants/{t}/stock-counts/{id}/complete` / `cancel` | `inventory.count` + branch |

### Purchasing

| Method | Path | Permission |
|---|---|---|
| GET | `/tenants/{t}/suppliers[/{s}]` | `suppliers.view` |
| POST/PATCH | `/tenants/{t}/suppliers[/{s}]` | `suppliers.manage` |
| GET | `/tenants/{t}/purchase-orders[/{po}]` | `purchasing.view` + branch |
| POST/PATCH | `/tenants/{t}/purchase-orders[/{po}]` | `purchasing.manage` + branch (edit while draft) |
| POST | `/tenants/{t}/purchase-orders/{po}/order` / `cancel` | `purchasing.manage` + branch |
| POST | `/tenants/{t}/purchase-orders/{po}/close` | `purchasing.manage` + branch — close a partially received PO short (`reason` required) |
| GET | `/tenants/{t}/goods-receipts[/{gr}]` | `purchasing.view` + branch |
| POST | `/tenants/{t}/goods-receipts` | `purchasing.receive` + branch |

### POS

| Method | Path | Permission |
|---|---|---|
| GET | `/tenants/{t}/registers` | `shifts.operate` or `registers.manage` |
| POST/PATCH | `/tenants/{t}/registers[/{r}]` | `registers.manage` + branch |
| GET | `/tenants/{t}/register-sessions` | own shifts (`shifts.operate`) or all (`shifts.view_all`) |
| GET | `/tenants/{t}/register-sessions/current` | member |
| POST | `/tenants/{t}/register-sessions` | `shifts.operate` + branch — open shift with float |
| GET | `/tenants/{t}/register-sessions/{id}` | owner of shift or `shifts.view_all` — includes X-reading summary |
| POST | `/tenants/{t}/register-sessions/{id}/close` | same — counted cash → expected/difference, Z-reading summary |
| POST | `/tenants/{t}/sales/quote` | `sales.create` + register branch — prices a cart (totals, VAT, per-line stock) without saving |
| POST | `/tenants/{t}/sales` | `sales.create` + register branch + open shift; `Idempotency-Key` header required |
| GET | `/tenants/{t}/sales[/{id}]` | own (`sales.view`) or all in branches (`sales.view_all`) |
| GET | `/tenants/{t}/sales/{id}/receipt` | same as view |
| POST | `/tenants/{t}/sales/{id}/void` | `sales.void` + branch; same open shift; no refunds |
| GET | `/tenants/{t}/payments` | `sales.view_all` |
| GET/POST | `/tenants/{t}/refunds` | `refunds.create` + sale branch |
| POST | `/tenants/{t}/refunds/{id}/approve` / `reject` | `refunds.approve` + branch; not the requester |

### Customers, expenses, notifications, audit

| Method | Path | Permission |
|---|---|---|
| GET | `/tenants/{t}/customers[/{c}]` | `customers.view` |
| POST/PATCH | `/tenants/{t}/customers[/{c}]` | `customers.manage` |
| GET | `/tenants/{t}/expense-categories` | `expenses.view` |
| POST/PATCH | `/tenants/{t}/expense-categories[/{c}]` | `expenses.manage` |
| GET | `/tenants/{t}/expenses[/{e}]` | `expenses.view` + branch (business-wide needs all branches) |
| POST/PATCH/DELETE | `/tenants/{t}/expenses[/{e}]` | `expenses.manage` + branch (delete = soft delete) |
| GET | `/tenants/{t}/notifications` | own notifications |
| POST | `/tenants/{t}/notifications/{id}/read`, `/read-all` | own notifications |
| GET | `/tenants/{t}/audit-logs` | `audit_logs.view` (branch-scoped) |

### Reports

All accept `date_from`, `date_to` (default: month to date, max 366 days) and `branch_id`.

| Path | Permission | Content |
|---|---|---|
| `/reports/sales-summary?group_by=day\|month` | `reports.view` | transactions, gross, discounts, VAT exemptions, net, VAT, refunds, net after refunds |
| `/reports/sales-by-branch` | `reports.view` | |
| `/reports/sales-by-cashier` | `reports.view` | |
| `/reports/sales-by-payment-method` | `reports.view` | collected, refunded, net per method |
| `/reports/best-sellers?limit=` | `reports.view` | net quantity, revenue |
| `/reports/low-stock` | `inventory.view` | |
| `/reports/inventory-movements` | `reports.view` | quantity and value at cost by movement type |
| `/reports/discounts-refunds` | `reports.view` | manual vs SC/PWD discounts, refunds, pending refunds, voids |
| `/reports/expenses` | `reports.financial` | by category |
| `/reports/profit` | `reports.financial` | see calculations below |

#### Report calculations and accounting assumptions

* **Sales date**: each sale stores `business_date` (local date in the business timezone at checkout). Refunds are
  dated when completed; expenses by `expense_date`.
* **Voided sales** are excluded from every figure (they are listed as a count in `discounts-refunds`).
* **Net revenue** = Σ(sale total − VAT) − Σ(completed refund total − refund VAT). VAT is a liability, not revenue.
* **COGS** = Σ(sale line `unit_cost` × quantity) − Σ(restocked refund line `unit_cost` × quantity).
  `unit_cost` is the branch weighted-average cost captured at the moment of sale. Refunded items that are not
  restocked stay in COGS (treated as a loss). Lines with zero cost are reported in `data_quality`.
* **Gross profit** = net revenue − COGS. **Estimated operating profit** = gross profit − recorded expenses.
* **Not net profit**: income tax, percentage tax, depreciation, financing costs and expenses not recorded in
  SmartPOS are unknown, so the API does not report net profit.
* Business-wide expenses (no branch) are only included when the caller reports across all branches.

## Key workflows

### Checkout (`POST /tenants/{t}/sales`)

```json
{
  "register_id": 1,
  "customer_id": null,
  "items": [
    { "product_id": 12, "quantity": 2 },
    { "product_id": 15, "quantity": 1, "discount": { "type": "percent", "value": 10 } }
  ],
  "discount": { "type": "none" },
  "payments": [ { "method": "gcash", "amount": "100.00", "reference_number": "GC123" },
                { "method": "cash", "amount": "500" } ]
}
```

Header: `Idempotency-Key: 4f8c…` (8–100 chars `[A-Za-z0-9_-:.]`). Prices, totals, VAT, change and stock are
computed by the server; sending `total`, `subtotal`, `items.*.price` or `items.*.unit_price` is rejected.

* Statuses: `status` = `completed` | `voided`; `payment_status` = `paid` | `partially_refunded` | `refunded` | `voided`.
* Payment rules: non-cash tenders ≤ total; at most one cash line; change comes from cash only.
* Senior Citizen / PWD (`discount.type` = `senior_citizen` | `pwd`, with `id_number` and `holder_name`): VAT removed
  from VAT-inclusive vatable prices, then 20% discount; cannot combine with manual discounts.
* Response `201` (`Idempotent-Replayed: false`) or `200` on replay, with `data` (sale) and `receipt`.

### Refund workflow

`POST /refunds` with `sale_id`, `reason`, `items[{sale_item_id, quantity, restock}]`, optional `refund_method`
and `register_session_id`. A refund is **restricted** when its total exceeds the business's
`refund_approval_threshold` or the sale is older than `refund_window_days`.

| Caller | Unrestricted | Restricted |
|---|---|---|
| has `refunds.approve` | `completed` | `completed` |
| lacks `refunds.approve` | `completed` | `pending_approval` → approver notified → `approve` / `reject` |

Pending refunds reserve their quantities. Completion restocks items (`restock=true`), updates
`sale_items.quantity_refunded`, `sales.refunded_total`, `payment_status` and the shift's cash refunds.

### Stock transfers

`draft` → `dispatch` (stock leaves source at its average cost) → `in_transit` → `receive` (stock enters
destination, updating its weighted-average cost) → `received`. Drafts can be cancelled; cancelling an in-transit
transfer returns the stock to the source branch.

### Stock counts

The system balance is snapshotted when the counted quantities are submitted. Completing the count posts
`counted − snapshot` as a `stock_count` movement, so sales or receipts that happen between counting and completion
are kept.

### Purchase order statuses

`draft` → `ordered` → `partially_received` → `received`; `draft`/`ordered` → `cancelled`;
`partially_received` → `closed` (remaining quantity will not be delivered; recorded in the audit log).
