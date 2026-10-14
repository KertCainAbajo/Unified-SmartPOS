# Database Design

Target: MySQL 8 (InnoDB, `utf8mb4_unicode_ci`). Automated tests also run the same migrations on SQLite.

## Conventions

| Concern | Rule |
|---|---|
| Keys | `BIGINT UNSIGNED` auto-increment `id`; FKs via `foreignId()->constrained()` |
| Tenant ownership | Every tenant-owned table has `tenant_id` FK + index (child line tables inherit through their parent) |
| Money | `DECIMAL(15,2)` (up to ₱9,999,999,999,999.99) |
| Unit cost | `DECIMAL(15,4)` (weighted-average cost needs extra precision) |
| Quantities | `DECIMAL(15,3)` (supports weighed goods, e.g. 1.250 kg) |
| Rates | `DECIMAL(5,2)` percent (e.g. VAT `12.00`) |
| Status columns | `VARCHAR` backed by PHP string enums (portable, easy to extend) |
| Timestamps | `created_at`/`updated_at` in UTC; `sales.business_date` holds the tenant-local date for reporting |
| Deletes | Financial and stock records are never deleted. Master data is archived (`status`/`is_active`). FKs to financial rows use `RESTRICT`. |

## Entity overview

```
users ─< tenant_memberships >─ tenants ─< branches
            │      │                │
            │      └─< membership_branches >─ branches
            └─< membership_roles >─ roles ─< role_permissions >─ permissions

tenants ─< categories ─< products ─< price_history
products ─< inventory (per branch) ;  products ─< stock_movements (ledger)
branches ─< stock_counts ─< stock_count_items
branches ─< stock_transfers (from/to) ─< stock_transfer_items
suppliers ─< purchase_orders ─< purchase_order_items
purchase_orders ─< goods_receipts ─< goods_receipt_items
branches ─< registers ─< register_sessions ─< sales ─< sale_items
sales ─< payments ; sales ─< refunds ─< refund_items >─ sale_items
customers ─< sales ; expense_categories ─< expenses
audit_logs, notifications, document_sequences
```

## 1. Identity and tenancy

### users
Global identity (one login across businesses).
`name`, `email` (unique, **nullable**), `username` + `managed_by_tenant_id` (company-managed staff; unique per business),
`phone`, `password` (bcrypt hash), `email_verified_at`, `is_platform_admin` (bool), `status` (`pending`/`active`/`disabled`),
`must_change_password` (bool) + `temporary_password_expires_at` (set when an administrator issues a temporary password),
`last_login_at`, `remember_token`. Users are never deleted (history keeps pointing at them).

### tenants
A business. `name`, `slug` (unique; the staff "business code"), `staff_email_domain` (optional, for suggested staff emails), `legal_name`, `tin`, `address`, `phone`, `email`,
`currency` (`PHP`), `timezone` (`Asia/Manila`), `vat_registered` (bool), `vat_rate` (12.00),
`prices_include_vat` (bool, default true), `allow_negative_stock` (bool, default false),
`refund_approval_threshold` (money; refunds above it need `refunds.approve`), `refund_window_days`,
`status` (`active`/`suspended`), `owner_user_id` → users.

### branches
`tenant_id`, `code` (unique per tenant), `name`, `address`, `phone`, `is_active`.

### roles
`tenant_id` (NULL = system role available to all tenants), `key` (unique per tenant scope), `name`,
`description`, `is_system`. System roles: `business_owner`, `user_access_manager`, `branch_manager`, `cashier`,
`inventory_staff`, `accountant`, `purchasing_staff`, `auditor`, `customer_service`.

### permissions
`key` (unique, e.g. `refunds.approve`), `name`, `group`, `description`. Seeded catalogue.

### role_permissions
Pivot `role_id` + `permission_id` (composite PK).

### tenant_memberships
`tenant_id`, `user_id` (unique pair), `employee_code` (unique per business), `status`
(`invited`/`active`/`suspended`/`offboarded`; only `active` grants access), `status_reason`, `all_branches` (bool),
`joined_at`, `suspended_at`, `offboarded_at`, `offboarded_by`, `created_by`.

### staff_profiles *(added: employee personal information)*
`tenant_id`, `membership_id` (unique), `job_title`, `hire_date`, `phone`, `address`, `birth_date`,
`emergency_contact_name`, `emergency_contact_phone`, `notes`. Per membership, so each business keeps its own record;
visible only to staff administrators and the employee.

### staff_invitations *(added: company-managed onboarding and recovery)*
`tenant_id`, `membership_id`, `user_id`, `purpose` (`activation`/`recovery`), `channel` (`email`/`manual`), `code_hash`
(SHA-256; codes are never stored), `expires_at`, `used_at`, `revoked_at`, `failed_attempts`, `created_by`.
Single-use, expiring, locked after 5 failures. See [STAFF_ACCOUNTS.md](STAFF_ACCOUNTS.md).

### membership_roles
Pivot `membership_id` + `role_id` (composite PK).

### membership_branches *(added: required for per-membership branch authorization)*
Pivot `membership_id` + `branch_id` (composite PK). Ignored when `all_branches = true`.

Platform Super Admin is `users.is_platform_admin`, not a tenant role, so that it can never be granted
implicitly through a tenant.

## 2. Products

### categories
`tenant_id`, `parent_id` (self FK, nullable), `name`, `slug` (unique per tenant), `description`, `is_active`, `sort_order`.

### products
`tenant_id`, `category_id`, `sku` (**unique per tenant**), `barcode` (**unique per tenant**, nullable),
`name`, `description`, `unit` (`pc`, `kg`, …), `price` (current selling price, VAT-inclusive when the
tenant is VAT-registered), `cost_price` (default/reference cost), `tax_type` (`vatable`, `vat_exempt`,
`zero_rated`), `track_inventory` (false for services), `allow_decimal_quantity`, `reorder_level`,
`status` (`active`/`archived`), `archived_at`.

**Variants decision:** each sellable SKU is a `products` row. A separate `product_variants` table was not
created in this phase because every POS, inventory, and pricing table would then need to reference two
levels, and none of the current requirements need grouped variants. Grouping (e.g. "T-shirt" → sizes)
can be added later with a nullable `parent_product_id`, without changing the transactional tables.

### price_history
Append-only. `tenant_id`, `product_id`, `old_price`, `new_price`, `old_cost`, `new_cost`, `reason`,
`changed_by`, `created_at`. Written by `ProductService` whenever price or cost changes.

## 3. Inventory

### inventory
Current balance per branch and product. `tenant_id`, `branch_id`, `product_id` (unique pair),
`quantity` (DECIMAL 15,3), `average_cost` (weighted-average cost at this branch), `reorder_level` (branch
override, nullable). **Only `StockLedger` writes to this table.**

### stock_movements
Immutable ledger. `tenant_id`, `branch_id`, `product_id`, `type` (`opening`, `adjustment`, `sale`,
`sale_void`, `refund`, `purchase_receipt`, `transfer_out`, `transfer_in`, `transfer_return`, `stock_count`),
`quantity_change` (signed), `quantity_before`, `quantity_after`, `unit_cost`, `reason`,
`reference_type`/`reference_id` (polymorphic link to the sale, transfer, receipt, …), `user_id`, `created_at`.
Invariant: for each (branch, product), `inventory.quantity` = sum of `quantity_change`.

### stock_counts / stock_count_items *(items table added: one count covers many products)*
Physical count. Header: `tenant_id`, `branch_id`, `reference`, `status` (`draft` → `completed`/`cancelled`),
`notes`, `created_by`, `completed_by`, `completed_at`.
Items: `stock_count_id`, `product_id`, `expected_quantity` (system balance snapshotted when the count is recorded),
`counted_quantity`, `variance`. Completing a count posts `counted − expected` as a `stock_count` movement, so later sales
are not overwritten.

### stock_transfers / stock_transfer_items
Header: `tenant_id`, `reference`, `from_branch_id`, `to_branch_id`, `status`
(`draft` → `in_transit` → `received`; `draft` → `cancelled`), `notes`, `created_by`, `dispatched_by/at`,
`received_by/at`. Items: `product_id`, `quantity`, `quantity_received`, `unit_cost`.
Dispatch deducts from source (`transfer_out`); receive adds to destination (`transfer_in`).

## 4. Purchasing

### suppliers
`tenant_id`, `name`, `contact_person`, `email`, `phone`, `address`, `tin`, `is_active`.

### purchase_orders / purchase_order_items
Header: `tenant_id`, `branch_id` (deliver-to), `supplier_id`, `reference` (unique per tenant), `status`
(`draft` → `ordered` → `partially_received` → `received`; `draft`/`ordered` → `cancelled`; `partially_received` → `closed`), `order_date`,
`expected_date`, `total`, `notes`, `created_by`. Items: `product_id`, `quantity_ordered`,
`quantity_received`, `unit_cost`, `line_total`.

### goods_receipts / goods_receipt_items
Header: `tenant_id`, `branch_id`, `purchase_order_id` (nullable — direct receipts allowed), `supplier_id`,
`reference`, `received_at`, `total_cost`, `notes`, `received_by`. Items: `purchase_order_item_id`
(nullable), `product_id`, `quantity`, `unit_cost`, `line_total`.
Posting a receipt adds stock (`purchase_receipt`) and updates the branch's weighted-average cost:
`new_avg = (max(old_qty,0) × old_avg + qty × unit_cost) / (max(old_qty,0) + qty)`.

## 5. POS

### registers
`tenant_id`, `branch_id`, `code` (unique per tenant), `name`, `is_active`.

### register_sessions (cashier shifts)
`tenant_id`, `branch_id`, `register_id`, `opened_by`, `closed_by`, `status` (`open`/`closed`),
`opening_float`, `cash_sales`, `cash_refunds`, `expected_cash`, `counted_cash`, `cash_difference`,
`opened_at`, `closed_at`, `notes`. Only one open session per register (enforced under a row lock on the register).

### sales
`tenant_id`, `branch_id`, `register_id`, `register_session_id`, `cashier_id`, `customer_id`,
`receipt_number` (unique per tenant), `idempotency_key` (**unique per tenant**), `request_hash`,
`status` (`completed`, `voided`), `payment_status` (`paid`, `partially_refunded`, `refunded`, `voided`),
`subtotal` (gross before discounts), `discount_total`, `vat_exemption_amount` (VAT removed for SC/PWD), `vatable_sales`, `vat_exempt_sales`,
`zero_rated_sales`, `vat_amount`, `total`, `amount_tendered`, `change_due`, `refunded_total`,
`discount_type` (`none`, `senior_citizen`, `pwd`), `discount_id_number`, `discount_holder_name`, `notes`,
`business_date` (tenant-local date), `sold_at`, `voided_at`, `voided_by`, `void_reason`.

### sale_items
Historical snapshot: `sale_id`, `product_id`, `sku`, `barcode`, `name`, `unit`, `tax_type`, `quantity`,
`unit_price`, `unit_cost`, `gross_amount`, `discount_type`, `discount_value`, `discount_amount`,
`vat_exemption_amount`, `vat_amount`, `line_total`, `quantity_refunded`. Product edits never alter past sales.

### payments
`tenant_id`, `sale_id`, `method` (`cash`, `card`, `gcash`, `maya`, `bank_transfer`, `other`), `amount`
(amount applied to the sale), `tendered` (cash handed over), `reference_number`, `status`
(`completed`, `voided`).

### refunds / refund_items
Header: `tenant_id`, `branch_id`, `sale_id`, `register_session_id`, `reference`, `status`
(`pending_approval` → `completed`/`rejected`, or directly `completed`), `reason`, `refund_method`,
`subtotal`, `vat_amount`, `total`, `requested_by`, `approved_by`, `approved_at`, `rejected_by`,
`rejected_at`, `rejection_reason`. Items: `refund_id`, `sale_item_id`, `product_id`, `quantity`,
`amount`, `vat_amount`, `unit_cost`, `restock`.
`sale_items.quantity_refunded` is only incremented when a refund is completed. Pending refunds also reserve
quantity so that two pending requests cannot over-refund.

### document_sequences *(added: gap-free per-branch numbering)*
`tenant_id`, `scope` (`tenant` or `branch:{id}`), `type` (`receipt`, `refund`, `transfer`, `purchase_order`,
`goods_receipt`, `stock_count`), `next_number`. Incremented under `SELECT … FOR UPDATE`.

## 6. Business operations

### customers
`tenant_id`, `name`, `email`, `phone`, `tin`, `address`, `notes`, `is_active`.

### expense_categories / expenses
Categories: `tenant_id`, `name` (unique per tenant). Expenses: `tenant_id`, `branch_id` (nullable =
business-wide), `expense_category_id`, `amount`, `expense_date`, `description`, `reference`,
`payment_method`, `recorded_by`, soft deletes (`deleted_at`) so deletions remain auditable.

### audit_logs
Append-only. `tenant_id` (nullable for platform events), `user_id`, `branch_id`, `action`
(e.g. `sale.completed`), `auditable_type`/`auditable_id`, `old_values`, `new_values`, `metadata` (JSON),
`ip_address`, `user_agent`, `created_at`.

### notifications
In-app notifications. `tenant_id`, `user_id`, `type` (`low_stock`, `refund_pending_approval`, …), `title`,
`body`, `data` (JSON), `read_at`, `created_at`.

## Consistency rules

1. **Prices**: sale prices come from `products.price` at checkout time and are copied into `sale_items`.
   Price changes write `price_history`. Clients cannot submit prices.
2. **Stock**: balance changes only through `StockLedger` → one `stock_movements` row per change, created in
   the same transaction, with the inventory row locked.
3. **Sales**: created only by `CheckoutService` in one transaction (sale, items, payments, stock, audit,
   sequence). The unique `(tenant_id, idempotency_key)` index makes duplicate submissions impossible.
4. **Refunds/voids**: never delete or rewrite the original sale. They add rows and update the denormalised
   counters (`refunded_total`, `quantity_refunded`, `payment_status`) under a lock on the sale row.
5. **History**: `price_history`, `stock_movements`, `audit_logs` are insert-only.
