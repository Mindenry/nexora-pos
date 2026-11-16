# NEXORA POS

Premium, production-oriented POS & retail management SaaS for Thai retail.
Thai-first UI with English switching, integer-satang money, an append-only stock
ledger, RBAC, tenant isolation, offline cash sales and a real PostgreSQL schema.

> **Status:** active build. See `ROADMAP.md` for exactly what works and what is
> deferred. No mock revenue is shown as real; seeded demo data is labelled.

## What is real

- PostgreSQL 18 schema with RLS, constraints, append-only ledgers and a
  migration runner.
- Express API with cookie sessions, scrypt password hashing, RBAC + store scope,
  Zod validation, idempotent checkout and audit logs.
- React admin + POS terminal backed by the API. No hardcoded dashboard numbers.
- Product images (uploaded or built-in artwork), customer-facing second display,
  loyalty points redemption, plan management.
- PromptPay QR engine (mobile or national ID, static or fixed amount) with
  encrypted accounts, staff-confirmed settlement, audit trail and sale binding —
  no bank API or merchant account required for QR generation. A signed provider
  webhook can auto-confirm and update the POS when a bank/PSP is contracted.
- Receipt branding (logo, accent, header/footer, 80mm/A4), a tenant system-health
  page, signed-webhook diagnostics/reconciliation, a PWA offline app shell and a
  Windows LAN agent that auto-starts and restarts the API/web servers.
- Checkout → payment → stock movement → receipt → shift cash, in one transaction.
- Refunds linked to sale lines, stock transfers, purchase receiving, stock counts.
- Reports computed from sales/ledger data (sales, profit, inventory, tax, staff).

## Prerequisites

- Node.js 22+ (built on 26)
- PostgreSQL 16+ (built on 18). Local project uses a `nexora` role and the
  `nexora_dev` / `nexora_test` databases.

## Setup

```powershell
npm install
# .env is required; copy .env.example and fill DATABASE_URL / SESSION_SECRET
npm run db:migrate
npm run db:seed          # demo tenant + products + 30 days of real sales
npm run dev              # API :4000, web :5173
```

Demo logins are printed by the seed and listed in `docs/DEMO.md`. They use
`@demo.nexora.local` addresses and the public demo password `NexoraDemo!2026`
(platform admin: `admin@nexora.local` / `NexoraAdmin!2026`). These are demo-only
credentials; never reuse them in production.

The project database in this workspace is a dedicated `nexora` role on
PostgreSQL 18 with `nexora_dev` and `nexora_test`. If you recreate it, create the
role/databases first, then run the migrations. Backups require the separate
`nexora_backup` BYPASSRLS role described in `docs/OPERATIONS.md`.

### Open on iPad / another device

```powershell
ipconfig                     # note the IPv4 address, e.g. 192.168.1.107
npm run serve:lan            # API must already be running (npm run dev:api)
```

Then open `http://<IPv4>:5173` on the tablet. Allow Node.js / TCP 5173 through
Windows Firewall if prompted. In development, private-LAN origins are accepted
for login; production still requires an exact `WEB_ORIGIN`/`WEB_ORIGINS` list.
If the tablet still cannot connect, check that both devices are on the same
Wi-Fi and that the router does not enable AP/client isolation.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | API + web in watch mode |
| `npm run serve:lan` | Build the SPA and serve it on `0.0.0.0:5173` for iPad/LAN testing |
| `npm run lan` | Serve the existing `apps/web/dist` on the LAN without rebuilding |
| `npm run agent` | Supervise built API + LAN server with auto-restart |
| `scripts/install-agent.ps1` | Register the agent as a logon Scheduled Task |
| `npm run build` | Bundle API and build SPA |
| `npm run typecheck` | Strict TypeScript across workspaces |
| `npm run lint` | ESLint |
| `npm test` | Unit + API integration tests (uses `nexora_test`) |
| `npm run test:e2e` | Playwright critical journeys |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:reset` | Drop, recreate, migrate and seed the dev DB |

## Documentation

- `docs/ARCHITECTURE.md` — shape, tenancy, transactions, security, limits
- `docs/DOMAIN.md` — language, invariants, permissions, failure semantics
- `docs/DECISIONS.md` — ADRs and rejected alternatives
- `docs/API.md` — endpoint reference
- `docs/DEMO.md` — demo accounts and tour
- `docs/SECURITY.md` — threat model and controls
- `docs/PROMPTPAY_RESEARCH.md` — standards, libraries and verification options
- `docs/PROMPTPAY_SPECIFICATION.md` — TLV/tag/CRC and reference vectors
- `docs/PROMPTPAY_COMPATIBILITY.md` — what was and was not tested
- `docs/PROMPTPAY_SECURITY.md` — payment-specific threat model
- `docs/PROMPTPAY_IMPLEMENTATION.md` — architecture, schema and workflow
- `docs/PROMPTPAY_API.md` — endpoint contract
- `docs/PROMPTPAY_TEST_REPORT.md` — evidence
- `ROADMAP.md` — milestone status
