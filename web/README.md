# Unified SmartPOS — Web app

React 19 + TypeScript + Vite single-page app for owners, managers, cashiers and inventory staff.
It talks only to the Laravel API in the parent folder (`/api/v1`).

## Run it (development)

Two terminals, from the repository root:

```bash
# 1. API (Laravel) on http://127.0.0.1:8000
php artisan serve

# 2. Web app on http://localhost:5173
cd web
npm install        # first time only
npm run dev
```

Open **http://localhost:5173** and sign in. Local demo accounts (password `DemoPass123`):
`owner@`, `manager@`, `cashier@`, `cashier.makati@`, `inventory@demo.smartpos.test`.

## How authentication works

The app uses **Sanctum SPA (cookie) authentication**, not tokens in browser storage:

1. Vite proxies `/api` and `/sanctum` to Laravel, so the browser sees a single origin.
2. Before the first state-changing request the app calls `GET /sanctum/csrf-cookie`; every
   mutation sends the `X-XSRF-TOKEN` header. A 419 (expired token) is refreshed and retried once.
3. `POST /api/v1/auth/login` **without** `device_name` starts a session (HTTP-only cookie).

Requirements in the Laravel `.env`: `SANCTUM_STATEFUL_DOMAINS` must include `localhost:5173`
(it does by default in `.env.example`). To proxy to another API address set
`VITE_API_PROXY_TARGET` in `web/.env.local`.

For production, serve the built files from the same domain as the API (e.g. `app.example.com`
for the SPA and `app.example.com/api` for Laravel, or sibling subdomains listed in
`SANCTUM_STATEFUL_DOMAINS` with `SESSION_DOMAIN=.example.com`).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with API proxy |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm test` | Unit tests (Vitest) |

## Structure

```
src/
  lib/          api client (CSRF, errors), types, money/date formatting, cart logic, query hooks
  auth/         session user provider
  tenant/       business context: permissions, branches, selected branch
  components/   UI kit, app shell, receipt view, product search
  pages/        one folder per area (pos, sales, catalog, inventory, purchasing, operations, reports, admin)
```

## Design rules

- **The server is the source of truth.** The POS asks `POST /sales/quote` for totals (VAT, SC/PWD,
  discounts) and never computes prices itself; checkout sends only product IDs, quantities,
  discount requests and tendered amounts.
- **Idempotent checkout.** Each payment attempt carries an `Idempotency-Key`; an identical retry
  (e.g. after a network error) reuses the key, so a sale can never be recorded twice.
- **Money as strings.** Amounts are decimal strings from the API; display math (change preview)
  uses integer centavos.
- **Permissions hide, the API enforces.** Menu items and buttons follow the member's permissions
  from `/tenants/{id}/context`, but every action is still authorized by the backend.

## Not yet included

Offline mode, hardware integrations (cash drawer kick, direct thermal printing — the browser print
dialog is used), custom role editor UI, and end-to-end browser tests.
