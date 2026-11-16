# NEXORA POS — Architecture

Status: accepted for v1 (Milestone 0). See `DECISIONS.md` for ADRs.

## 1. Shape

```
apps/web        React 19 SPA (admin + POS terminal)
   │  HTTPS / JSON (cookie session)
apps/api        Express 5 REST API, domain services, RBAC, idempotency
   │  SQL (pooled, tenant-scoped transactions)
packages/db     Drizzle schema + SQL migrations + seed
packages/shared Money, VAT, pricing, permissions, Zod contracts, i18n types
PostgreSQL 18   Truth: money, stock ledger, payments, audit; RLS on domain tables
```

Single-region monolith by design: one deployable API, one SPA, one PostgreSQL.
This keeps transactions simple and is the cheapest architecture that can still
be trusted with money. Scale-out points are documented in ADR-004.

## 2. Technology

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript strict | Money/stock invariants benefit from one type system end to end |
| API | Express 5 + Zod | Boring, stable, middleware ecosystem; Zod contracts shared with the web app |
| Data access | `pg` + typed SQL | Migrations are SQL anyway; RLS session settings and report aggregates stay explicit, with no duplicated schema |
| DB | PostgreSQL 18 | RLS, `BIGINT` money, real constraints, window functions for reports |
| Web | React 19 + Vite + Tailwind 4 | Fast POS rendering, no framework runtime needed for a private dashboard |
| Data fetching | TanStack Query | Cache, retries and explicit loading/error states |
| Money | `BIGINT` satang + integer math | No float, no decimal string arithmetic in JS |
| Tests | Vitest (unit/API), Playwright (E2E) | Same runner for shared logic and HTTP integration |

Rejected: Next.js (server components add no value for a logged-in SPA plus a
separate API), Prisma (less control over RLS/`SET LOCAL` and aggregate SQL),
SQLite (no RLS, weaker concurrent write behaviour), microservices (premature).

## 3. Multi-tenancy

- `tenant_id` is present on every business row and leads every composite index.
- All domain tables have `FORCE ROW LEVEL SECURITY` and a policy:
  `tenant_id = current_setting('app.tenant_id', true)::uuid`.
- Every business request runs inside a transaction that starts with
  `SET LOCAL app.tenant_id = $1`. `SET LOCAL` is scoped to the transaction and
  resets on commit/rollback, so pooled connections cannot leak a tenant.
- The tenant is taken from the **session**, never from a request body or query.
- Platform-admin reads use a dedicated `withPlatformAdmin` helper that sets
  `app.platform_admin = 'on'`; the policy allows that only for read paths and
  every use is audited.
- `users`, `sessions`, `tenants`, `permissions` are global auth/platform tables
  and are not RLS-scoped; they are accessed only by auth/platform code.
- Store scope is separate from tenant scope: the `X-Store-Id` header is
  validated against the employee's `employee_stores` rows on every request.

## 4. Money and time

- All monetary values are integer **satang** (`BIGINT` in PG, `number` in JS
  below `2^53`). API returns satang; the UI formats with `Intl.NumberFormat`.
- VAT is a basis-point rate (`700` = 7%) stored in configuration, never a code
  constant. Prices are tax-inclusive by default for Thai retail.
- Rounding: half-up at the document level, once, after discount allocation.
- Timestamps are `timestamptz` (UTC). `business_date` is derived from the
  store's IANA timezone (`Asia/Bangkok` by default) at completion and frozen.
- `occurred_at` (device) and `created_at` (server) are both stored.

## 5. Transactions and idempotency

Checkout is one database transaction:

1. validate shift is open at the store and actor is assigned,
2. lock the shift row (`SELECT ... FOR UPDATE`),
3. recompute pricing **server-side** (client totals are never trusted),
4. allocate receipt number from `document_sequences` (`UPDATE ... RETURNING`),
5. insert `sales`, `sale_items`, `payments`,
6. append `inventory_movements` (sales deduction) and `cash_movements`,
7. update customer totals + loyalty ledger,
8. write `audit_logs` and `outbox`/notification rows,
9. store the response snapshot in `idempotency_keys`.

Every mutating endpoint requires `operationId` (UUID). Replaying the same key
returns the stored response; the same key with a different payload hash returns
`409 CONFLICT_OPERATION_REUSED`.

## 6. Payment truth

Payment methods are configured per store. `cash` and `manual` (bank transfer,
card terminal, QR verified by staff) are confirmed in the sale transaction with
an operator reference. A `qr` tender can be created as `pending` and confirmed
only by an explicit provider signal or a documented staff attestation that
records the reference, actor and timestamp. Rendering a QR never marks a sale
paid. A HMAC-verified webhook adapter exists for tests and future providers; the
sandbox adapter is labelled as such in the UI and never enabled in production.

## 7. Offline

POS keeps a catalog snapshot and an outbox in IndexedDB. Offline **cash** sales
are allowed only when the tenant policy enables them; card/QR are blocked.
Queued sales are replayed with their original `operationId`, so the server
commits each sale exactly once. The UI exposes pending/failed sync items with a
manual retry. The server remains the source of truth for money and stock.

## 8. Observability and security

- Correlation ID per request, structured JSON logs, actor/tenant on every line.
- `audit_logs` is append-only and covers refunds, voids, discounts above
  threshold, price overrides, stock adjustments, shift variance, role changes,
  exports and platform actions.
- Sessions: opaque 32-byte token, SHA-256 stored, httpOnly + SameSite=Lax
  cookie, 12-hour idle/7-day absolute expiry. Passwords: scrypt.
- CSRF: origin check + custom client header on all non-GET requests.
- Rate limits on login, lookup and checkout; stricter keyed limits can move to
  Redis when horizontally scaled.
- Helmet-style headers, JSON body limit, Zod input bounds, parameterised SQL
  only, no secrets in the web bundle.
- Append-only triggers on ledgers and payment events; immutable completed sale
  money columns.

## 9. Reporting

Reports read the OLTP tables with aggregate SQL over `(tenant_id, store_id,
business_date)` indexes. Refunds subtract; COGS comes from the cost snapshot on
`sale_items`, so historical margin does not move when a product cost changes.
Read models/warehouse are a later scale step, not needed for v1 volumes.

## 10. Known limits (honest)

- Weighted/loose goods: quantity is an integer unit; sold-by-weight is not
  enabled in v1 (schema uses integer `qty`).
- COGS uses the standard cost snapshot, not FIFO/moving-average layers.
- Payment provider integration is adapter-based; only the manual attestation
  and test HMAC adapters ship. PromptPay/e-Tax need a licensed provider and
  legal review before go-live.
- Background jobs (settlement import, expiry) are in-process scheduled tasks;
  a durable worker queue is the production next step.
- Reports are computed live; caching is intentionally omitted until measured.
