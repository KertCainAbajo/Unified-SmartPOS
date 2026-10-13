# Unified SmartPOS — Project Plan

## Goal

Build a secure, tested, multi-tenant point-of-sale backend (Laravel REST API + MySQL) for
Philippine businesses. Two clients will consume the same API later:

- React + TypeScript web application (Sanctum SPA cookie authentication)
- React Native + Expo mobile application (Sanctum personal access tokens)

**This phase is backend + database only.** No web or mobile screens are built.

## Environment findings (2026-10-13)

| Item | Found | Decision |
|---|---|---|
| PHP | 8.5.1 (NTS, x64) with `pdo_mysql`, `pdo_sqlite`, `bcmath`, `mbstring`, `openssl` | Used as-is |
| Composer | 2.8.12 | Used as-is |
| Laravel | Not installed (empty repo) | **Laravel 13.x** (see below) |
| MySQL | MySQL Community Server 8.0.46 running as Windows service `MySQL80` on port 3306 | Target production/dev database. Root credentials are not known to the agent, so automated tests use SQLite; a MySQL test profile is provided. |
| Node | 25.2.1 | Not needed for this phase |

### Why Laravel 13 instead of Laravel 12

The brief asks for Laravel 12 "as the initial baseline, after checking current support". As of
October 2026 Laravel 13 is the current major release (13.36). Laravel 12's bug-fix window ended in
August 2026 and its security-fix window ends in February 2027. Starting a new product on a
version that is about to lose security support would force a major upgrade almost immediately,
so the project starts on Laravel 13 (PHP ≥ 8.3). Nothing in this codebase depends on a
Laravel 13-only feature other than the skeleton's model attribute style, so the design applies
equally to Laravel 12.

## Milestones

| # | Stage | Outcome |
|---|---|---|
| 1 | Environment & database | Laravel 13 + Sanctum installed, MySQL `.env` profile, SQLite test profile |
| 2 | Migrations & relationships | Full schema, models, relationships, factories |
| 3 | Authentication & tenancy | Registration/onboarding, login (token + SPA), password reset, email verification, profile, memberships, RBAC, branch scoping |
| 4 | Products & inventory | Categories, products, price history, stock ledger, adjustments, counts, transfers, low stock |
| 5 | POS checkout & payments | Registers, cashier sessions, checkout engine, idempotency, receipts, voids |
| 6 | Purchasing & refunds | Suppliers, POs, goods receipts (weighted-average cost), refunds with approval workflow |
| 7 | Reporting & audit logs | Report services, audit log API, notifications, expenses, customers |
| 8 | Tests, docs, hardening | Full test suite, OpenAPI document, README, rate limiting review |

Progress for every milestone is tracked in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Out of scope for this phase

- Web and mobile frontends
- BIR CAS/POS accreditation artefacts (e-journal export, Z-reading format certification)
- Online payment gateway integration (GCash/Maya are recorded as tender types only)
- Offline-first sync for the mobile app (idempotency keys are designed to support it later)
- Multi-currency (all amounts are PHP)
