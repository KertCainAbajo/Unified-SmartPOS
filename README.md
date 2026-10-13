# Unified SmartPOS — Backend API

Multi-tenant point-of-sale backend for Philippine businesses: one Laravel REST API and one MySQL database,
shared by a future React web app and a React Native (Expo) mobile app.

This repository currently contains **only the backend** (no web or mobile UI).

| Document | Purpose |
|---|---|
| [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md) | Scope, environment findings, milestones |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, request lifecycle, tenancy, RBAC, consistency |
| [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | Every table, relationships, invariants |
| [docs/API_SPECIFICATION.md](docs/API_SPECIFICATION.md) | Endpoints, permissions, workflows, report formulas |
| [docs/openapi.json](docs/openapi.json) | OpenAPI 3.1 contract (generated) |
| [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) | What is done, verified, blocked, and out of scope |

## Prerequisites

- PHP **8.3+** (developed on 8.5.1) with `pdo_mysql`, `bcmath`, `mbstring`, `openssl`, `pdo_sqlite` (tests)
- Composer 2
- MySQL **8.0+**
- Laravel **13** (installed through Composer; see PROJECT_PLAN.md for why 13 rather than 12)

## Setup

```bash
composer install
cp .env.example .env
php artisan key:generate
```

### Create the databases (MySQL)

Run as a MySQL administrator. Choose your own strong password and never commit it.

```sql
CREATE DATABASE smartpos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE smartpos_testing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'smartpos'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON smartpos.* TO 'smartpos'@'localhost';
GRANT ALL PRIVILEGES ON smartpos_testing.* TO 'smartpos'@'localhost';
```

Then set `DB_DATABASE=smartpos`, `DB_USERNAME=smartpos` and `DB_PASSWORD=…` in `.env`.

### Migrate and seed

```bash
php artisan migrate                 # schema
php artisan db:seed                 # roles & permissions; demo data only when APP_ENV=local
php artisan smartpos:verify-integrity   # read-only ledger/financial consistency check
```

`RolesAndPermissionsSeeder` is idempotent and safe in every environment. `DemoSeeder` refuses to run in production.

#### Demo accounts (local development only)

Password for all demo accounts: **`DemoPass123`**. These credentials are public demo data; never use them anywhere real.

| Email | Role |
|---|---|
| owner@demo.smartpos.test | Business Owner (all branches) |
| manager@demo.smartpos.test | Branch Manager (Main) |
| cashier@demo.smartpos.test | Cashier (Main, has an open shift) |
| cashier.makati@demo.smartpos.test | Cashier (Makati) |
| inventory@demo.smartpos.test | Inventory Staff (Main, Makati) |
| admin@demo.smartpos.test | Platform Super Admin (no business access) |

The demo business "Aling Nena Mini Mart" has 2 branches, 6 categories, 14 products (incl. VAT-exempt rice sold by kg),
opening stock, 2 suppliers, a draft purchase order, 5 sales (cash, GCash, card, Senior Citizen) and 3 expenses.

## Run locally

```bash
php artisan serve        # http://127.0.0.1:8000
```

## Try the API

```bash
# Log in (mobile/token style)
curl -s -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"email":"cashier@demo.smartpos.test","password":"DemoPass123","device_name":"curl"}'

TOKEN=...   # value of "token"

# Businesses and roles of the current user
curl -s http://127.0.0.1:8000/api/v1/me/memberships -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json'

# Checkout (prices and totals are computed by the server)
curl -s -X POST http://127.0.0.1:8000/api/v1/tenants/1/sales \
  -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"register_id":1,"items":[{"product_id":1,"quantity":2}],"payments":[{"method":"cash","amount":"200"}]}'
```

Browser SPA clients: call `GET /sanctum/csrf-cookie`, then `POST /api/v1/auth/login` **without** `device_name`
from an origin listed in `SANCTUM_STATEFUL_DOMAINS` / `CORS_ALLOWED_ORIGINS`.

## OpenAPI documentation

- Contract: [docs/openapi.json](docs/openapi.json). Regenerate after API changes: `php artisan scramble:export`
- Interactive docs (local environment only): `http://127.0.0.1:8000/docs/api`

## Tests

```bash
php artisan test                                        # SQLite in-memory (default, no setup)
php artisan test --configuration=phpunit.mysql.xml      # MySQL: uses smartpos_testing (wiped each run)
./vendor/bin/pint --test                                # code style
```

Safety: the test base class refuses to run against any database that is not `:memory:` or named `*_test` /
`*_testing`, so tests can never wipe the development or production database.

## Project structure

```
app/
  Enums/                 status and type enums
  Exceptions/            BusinessRuleException (422 + machine-readable code)
  Http/Controllers/Api/V1/{Auth,Tenancy,Catalog,Inventory,Pos,Purchasing,Operations,Reports,Platform}
  Http/Middleware/       ResolveTenant, EnsurePlatformAdmin, EnsureEmailIsVerifiedWhenRequired
  Http/Requests/         Form Requests
  Http/Resources/        API Resources
  Models/
  Policies/              TenantScopedPolicy + per-model policies
  Services/              Checkout, StockLedger, transfers, counts, purchasing, refunds, reports, audit
  Support/               Money (bcmath), Permissions catalogue, TenantContext
database/migrations, seeders, factories
tests/Unit, tests/Feature
```

## Current limitations

See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md). The most important ones:

- Verified on SQLite only so far; MySQL migrations/tests must be run once credentials are configured.
- Concurrency protection (row locks) needs a parallel load test on MySQL.
- No product variants, promotions, credit sales, payment-gateway integration or BIR accreditation features yet.
