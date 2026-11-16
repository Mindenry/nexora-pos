# Architecture Decisions (ADR log)

## ADR-001 — Modular monolith, not microservices
**Date:** 2026-11-16 · **Status:** accepted

Money, stock and cash must commit together. Splitting checkout, inventory and
payments into services would force sagas for a 3-table transaction that
PostgreSQL does atomically. One API process with module boundaries is simpler to
operate, test and reason about. Revisit only when team or load requires it.

## ADR-002 — Money as integer satang, `BIGINT`
**Date:** 2026-11-16 · **Status:** accepted

All money is integer minor units in the DB and in JS. API and UI transport
satang; formatting happens only at the edge. This eliminates float drift and
makes VAT reconciliation exact. `numeric` was rejected because it round-trips as
strings and invites accidental JS float conversion.

## ADR-003 — RLS plus tenant-leading indexes
**Date:** 2026-11-16 · **Status:** accepted

Every domain table has `FORCE ROW LEVEL SECURITY` and a policy on
`current_setting('app.tenant_id')`. Each request runs in a transaction that sets
it with `SET LOCAL`, sourced from the session. A missing `WHERE` cannot leak
another tenant's rows. Cost: all business queries must run through
`withTenant()`; this is enforced by repository structure and isolation tests.

## ADR-004 — PostgreSQL is the only stateful dependency in v1
**Date:** 2026-11-16 · **Status:** accepted

Sessions, rate-limit counters (in-process with strict limits), jobs and the
receipt sequence all live in PostgreSQL or the API process. This makes local
setup and backup a single concern. The scale-out path is: Redis for sessions and
rate limits, then a durable worker for outbox/settlement, then read replicas for
reports.

## ADR-005 — Server-side repricing, client preview only
**Date:** 2026-11-16 · **Status:** accepted

The POS shows totals computed with the same shared integer pricing library, but
checkout recomputes from variant IDs, quantities and the coupon code. Client
prices, discounts and totals are never trusted. This blocks price tampering and
keeps promotions authoritative.

## ADR-006 — Manual payment attestation before provider integration
**Date:** 2026-11-16 · **Status:** accepted

No licensed Thai PSP/PromptPay credentials exist in this environment. Cash is
confirmed in the sale transaction. Card/bank/QR create a tender with a staff
reference and an audited confirmation. A signed HMAC webhook adapter exists for
tests. The UI marks provider integration as “manual confirmation” so no one
believes a QR render means money arrived.

## ADR-007 — Offline cash only, opt-in per tenant
**Date:** 2026-11-16 · **Status:** accepted

The device caches the catalog and queues complete cash sales with UUIDv7
operation ids. Card/QR are blocked offline. Replays are idempotent. This matches
the risk profile of a small retailer without enabling unrecoverable card credit.

## ADR-010 — Own the PromptPay payload engine, outsource only QR rasterisation
**Date:** 2026-11-16 · **Status:** accepted

The payload is the security-critical part: identifier normalization, MOD-11
checksum, TLV lengths, AID, amount and CRC. Existing npm packages are useful
references but either accept unvalidated identifiers or pull old dependencies.
We implement the small engine in `packages/promptpay` with no runtime
dependencies, test it byte-for-byte against independently published vectors, and
use `qrcode` only to render a validated payload to PNG/SVG. Rendering can be
swapped without touching validation, sessions or the POS.

## ADR-011 — PromptPay settlement is manual by design
**Date:** 2026-11-16 · **Status:** accepted

No bank/PSP credentials exist, and neither QR creation, scanning nor expiry is
proof of payment. Every dynamic QR creates a `pending` session. A staff member
with `payments.confirm` must verify the exact amount; the system records the
actor, time, optional slip reference and audit trail. Checkout locks the session
and binds it to exactly one sale. A provider interface is reserved for a future
signed webhook/slip/statement adapter. SMS/notification scraping and banking-app
automation are rejected.

## ADR-009 — SQL-first data access (`pg`), no ORM
**Date:** 2026-11-16 · **Status:** accepted

The schema is defined by SQL migrations because RLS policies, append-only
triggers, partial indexes and money constraints are the design. An ORM would
duplicate that schema in TypeScript and hide the `SET LOCAL` transaction scope
that makes tenancy safe. We use `pg` with typed row interfaces and small query
helpers. Cost: hand-written SQL; mitigated by typed results, shared Zod
contracts and integration tests against real PostgreSQL.

## ADR-008 — No component framework, hand-built design system
**Date:** 2026-11-16 · **Status:** accepted

shadcn/ui was considered, but this product needs a dense, distinctive terminal
and admin surface, not a generic component catalogue. We use Tailwind tokens
plus ~20 owned primitives (button, input, dialog, table, toast, etc.). Fewer
dependencies, full control of accessibility and motion, no template look.
