---
name: pos-domain-expert
description: >
  Entry point for any POS (point of sale) design, review, migration or debugging task. Holds the canonical POS domain
  model, the money/time/idempotency contracts, the invariants every module must satisfy, and the routing table to the
  eleven specialist pos-* skills (checkout, inventory ledger, payments, shift cash, offline sync, multi-tenant SaaS,
  Thailand VAT/receipts, loyalty, profit analytics, hardware, backup/DR). Trigger on "POS", "point of sale",
  "ขายหน้าร้าน", "เครื่อง POS", "แคชเชียร์", "checkout", "receipt", "shift close", "stock ledger", "offline sale",
  "ปิดกะ", "ใบเสร็จ", or when reviewing or extending a POS codebase. Not for generic e-commerce carts, marketing sites or
  game UI.
---

# POS domain expert

A POS is a **money-moving, stock-moving, legally receipted** system running on unreliable hardware in
an unreliable network, operated by staff who are not engineers, inside a store where a queue is
forming. Every design decision is judged against that sentence.

This skill is the anchor: it defines the shared language, the non-negotiable invariants and how the
other POS skills fit together. Load a specialist skill for depth; the invariants here always apply.

## When to use

- Starting, reviewing or refactoring any POS codebase, schema or API.
- A cross-cutting change that touches sales, stock, payments and reporting at once.
- Choosing which specialist skill applies to a request.
- A disagreement about where a rule belongs (tax, discount, stock, tender, shift).

**Not this skill:** generic e-commerce/cart work without a store terminal, loyalty programme
marketing design, infrastructure-only work.

## Ubiquitous language

Use these terms in code, events, database columns and conversations. One concept gets one name.

| Term | Meaning |
| --- | --- |
| `tenant` | Commercial customer of the platform; the isolation boundary |
| `store` | A physical branch that holds stock and rings sales |
| `device` / `terminal` | A registered register (PC, tablet, mPOS) with an ID and a local database |
| `shift` | Cashier session between open and close; owns opening float and cash movements |
| `sale` | A commercial transaction with lines, totals and one or more tenders |
| `sale_line` | A priced unit of a variant/SKU, possibly discounted or tax-overridden |
| `tender` / `payment` | A single attempt to pay, by one method, for one amount |
| `settlement` | Provider/bank movement that pays out captured tenders, net of fees |
| `refund` | Return of money and, usually, restock, linked to an original sale |
| `void` | Cancellation of an unpaid/unsent sale, or reversal of a completed one (rare, authorised) |
| `movement` / `ledger entry` | Append-only stock change with reason, quantity and cost |
| `stock on hand` | Sum of movements per (location, variant); never a mutable counter of record |
| `reconciliation` | Proving that recorded money equals money the provider/cash actually moved |
| `outbox` | Durable queue of domain events written in the same transaction as the state change |
| `business_date` | Trading day in the store's timezone, used for Z-reports and accounting |

Map local language explicitly: Thai receipts say `ใบเสร็จรับเงิน` (receipt), `ใบกำกับภาษี` (tax
invoice), `ใบกำกับภาษีอย่างย่อ` (abbreviated tax invoice), `ส่วนลด` (discount), `เงินสด` (cash),
`เงินทอน` (change), `กะ` (shift), `สต๊อก` (stock), `คลังสินค้า` (warehouse).

## Canonical model

```text
tenant 1─* store 1─* device
  │              └─* shift 1─* cash_movement
  └─* sale 1─* sale_line
         ├─* tender 1─* payment_event
         ├─* refund_line ──> original sale_line
         └─* stock_movement (via sale_line)
product 1─* variant 1─* barcode
variant 1─* stock_movement *─1 location
```

Minimum identifier set on every business row: `tenant_id`, `store_id`, `business_date`,
`created_at` (UTC), `created_by`. Terminal-originated rows also carry `device_id` and
`operation_id`.

## Contracts every POS module must honour

### MONEY-01 — integer minor units only

Store and compute money as integers in the currency's minor unit (`THB` → satang, `BIGINT`).
Never `float`, never `double`, never `numeric` passed through JavaScript `number` for arithmetic.
Format at the presentation edge only. Round once, at a named boundary, with a documented rule
(half-up is the Thai retail convention; use banker's rounding only if your accountant says so).

### TIME-01 — two clocks, one authority

`occurred_at` is the device clock (what the customer experienced). `received_at` and all accounting
timestamps are server clocks. Store `timestamptz` in UTC, plus `business_date` computed from the
store timezone (`Asia/Bangkok`, UTC+7, no DST). Never derive a Z-report from device time alone.

### IDEM-01 — every write is replayable

Every command carries a client-generated `operation_id` (UUIDv7). The server stores
`(tenant_id, operation_id) → request_hash, response_snapshot, status` and returns the stored
response on replay. A repeated `operation_id` with a different `request_hash` is a **409 conflict**,
never a silent overwrite. This is what makes offline retries, flaky networks and double-taps safe.

### LEDGER-01 — append-only for anything that must add up

Stock, cash movements, payment events, loyalty points and audit records are append-only. Corrections
are new compensating entries with `reverses_id`/`reason_code`. No `UPDATE` that changes a quantity
or amount, no `DELETE` outside retention jobs on non-financial data.

### STATE-01 — explicit state machines

A sale, a payment, a shift and a sync item each have a small, explicit state set and legal
transitions. Illegal transitions fail loudly with a domain error code, not an exception in a log.

### AUDIT-01 — attributes, not just a timestamp

Every sensitive action records actor, role, device, before/after values, reason code, and a
correlation ID. Sensitive means: void, refund, discount above threshold, price override, stock
adjustment, shift close variance, permission change, data export.

### TENANT-01 — tenant scope is structural

`tenant_id` leads every composite key and every index, and is present in every query. Isolation is
enforced by the database (RLS or schema-per-tenant), not by remembering to add a `WHERE`.

## Core invariants

| ID | Invariant | Why it matters |
| --- | --- | --- |
| INV-01 | For a completed sale, `sum(tender.applied) = sale.grand_total`; cash tendered above the amount due returns change recorded on the tender | The drawer and the books must agree |
| INV-02 | Totals recompute exactly in integer math: `Σ line.net + service + rounding = grand_total`, and `subtotal − Σ discounts = Σ line.net` | Disputes, audits, VAT filings |
| INV-03 | Stock never changes without a movement row; `on_hand = sum(qty_delta)` per location | Shrinkage is explainable |
| INV-04 | A payment is "paid" only on a verified provider signal (webhook, signed API poll, or documented manual attestation) | QR generation is a request, not a confirmation |
| INV-05 | Every completed sale has a `shift_id` that was open at `occurred_at` | Cash accountability |
| INV-06 | Refunds never exceed captured amount per tender, nor sold quantity per line | Fraud and chargeback control |
| INV-07 | Finalised sales are immutable; corrections are refunds/voids with new documents | Legally defensible receipts |
| INV-08 | Business date on a sale is fixed at completion and never recomputed | Z-report and VAT period stability |
| INV-09 | Replaying the same `operation_id` produces no second stock, cash or money effect | Offline retries |
| INV-10 | A device can complete a cash sale with zero network and lose no data on power failure | Store reality |
| INV-11 | Every tenant-scoped read is filtered by `tenant_id` at the database, not the UI | Data breach prevention |
| INV-12 | Money and stock reconciliations are runnable on demand and asserted in CI | Drift is found before the auditor finds it |

## Reference architecture

```text
┌─────────────────────────── device (untrusted network, trusted operator) ──┐
│ UI/terminal ── local command bus ── SQLite (sale, outbox, catalog cache)  │
│      │                                   │                                 │
│  hardware adapters (scanner, printer, drawer, scale, EDC)                  │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │ signed, idempotent, sequenced sync
┌──────────────────────────────▼────────────────────────────────────────────┐
│ API edge: authn → tenant resolve → RBAC → rate limit → idempotency gate    │
│ Domain modules: sales · pricing/tax · inventory · payments · shifts · CRM  │
│ PostgreSQL: transactional writes + outbox in the same transaction          │
│ Workers: outbox relay · webhook ingest · settlement matcher · reports       │
└────────────────────────────────────────────────────────────────────────────┘
```

Rules that follow from this shape:

1. The device never talks to a payment provider with secret credentials.
2. The device owns **draft and queue** state; the server owns **money truth**.
3. Every server command is a single database transaction that also writes its outbox events.
4. Reporting reads projections, never the OLTP tables, and never the device.

## Command pipeline (use this order every time)

1. **Authenticate** the actor and device; resolve `tenant_id` from the credential, not the payload.
2. **Authorise** the permission (`sales.void`, `shift.close`, `inventory.adjust`, …).
3. **Validate** shape and domain preconditions; reject with a stable error code.
4. **Idempotency gate**: look up `operation_id`; replay, conflict or proceed.
5. **Transaction**: lock the aggregates that can conflict (shift row, stock rows, sale row),
   apply the state change, append ledger rows, write outbox events.
6. **Commit**, then return the canonical response snapshot.
7. **After commit**: enqueue print, notify, sync push. Never do network I/O inside the transaction.

## Workflow: approach an unfamiliar POS task

1. **Find the money and stock flow.** Which amounts move, in which direction, and which document
   proves it? If you cannot name the document, the requirement is not understood yet.
2. **Name the aggregates.** Usually: sale, tender, shift, stock balance, payment intent, member.
   Each has one owner module and one writer.
3. **List the invariants at risk** from the table above. A change that cannot break an invariant is
   probably a UI change; one that can break three needs a design note.
4. **Draw the transaction boundary.** What must commit together? What may be eventually consistent?
   Money and stock in the same command usually share a transaction; printing, notifications and
   analytics do not.
5. **Walk the failure path first.** Offline, duplicate submit, timeout with unknown outcome, partial
   write, provider rejection, printer failure, power loss. Decide the user-visible state for each.
6. **Check the legal and audit surface.** Receipt content, numbering, retention, approvals, reason
   codes, and who can see what.
7. **Load the specialist skill** from the routing table and apply its rules; do not restate them.
8. **Write the test that would have caught the bug** before writing the fix.
9. **Record the decision** (ADR or short design note) with the rejected alternative and why.
10. **Verify in a real-ish environment**: offline toggle, slow network, two devices, a real printer.

## Business rules (cross-cutting)

- Every business row is tenant-scoped; every financial document is store-scoped and business-dated.
- Money is integer minor units; currency is explicit; no implicit FX anywhere in the sale path.
- Configuration (tax, rounding, discounts, templates) is effective-dated and versioned; documents
  snapshot what applied.
- Completed documents are immutable. Corrections are new documents with a link and a reason.
- Deletion is allowed only for non-financial, non-audited data; everything else is status or
  compensating entries.
- Approvals are separate from execution for voids, large discounts, refunds, stock adjustments and
  cash variances. The approver is recorded.
- Offline behaviour is a product decision per capability, documented in a table, not emergent.
- A receipt/tax document number is allocated once, is gapless per period, and is never reused after
  a restore, a device swap or a void.
- Idempotency keys are mandatory on every state-changing command that can be retried.
- Time: store UTC, report in store timezone, fix `business_date` at completion.

## Edge cases (cross-cutting)

| Case | Expected behaviour |
| --- | --- |
| Network dies after the provider captured but before the sale committed | Payment stays `pending`; reconcile by provider ref; never re-charge |
| Same command arrives twice (retry, double-tap, sync replay) | One effect; identical response returned |
| Two devices sell the same last unit | Both sales stand; stock goes negative and is flagged |
| Device clock is two years wrong | Clamp/flag `occurred_at`; books use server time |
| Tenant changes tax rate at 10:00 | Sales before/after use their effective rate; no retro-edit |
| Power loss during a sale | Either fully committed or fully absent; local DB must recover |
| Printer fails after commit | Sale stands; job queued; reprint marked |
| Migration fails mid-deploy | Old code still works or writes are blocked; no half-migrated reads |
| Device replaced mid-shift | Outbox drained, token revoked, shift reconciled |
| Backup restored | Sequences reconciled, webhooks replayed, invariants re-checked |

## Security baseline

- Authenticate people and devices separately; a device token is not a user session.
- Authorise every mutation server-side against a permission, with store scope; UI hiding is not
  control.
- Least privilege by default; sensitive reads (cost, PII, exports) are their own permissions.
- Secrets in a secret manager, never in the repo, the device bundle or logs.
- Encrypt in transit and at rest; encrypt device-local databases.
- Validate and bound all input: quantities, prices, discounts, dates, IDs, currency, enum values.
  Reject NaN/Infinity and unknown fields at the boundary.
- Log identifiers and outcomes, not PII or card data; correlation IDs on every request.
- Rate-limit authentication, scanning, lookup and export endpoints.
- Keep an append-only audit trail for sensitive actions with before/after and reason.
- Treat receipt content, printer control characters and CSV exports as injection surfaces.

## Error handling

Use a stable, documented taxonomy. Operators see a message and an action; logs carry the detail.

| Class | HTTP | Retry? | Example | Operator action |
| --- | --- | --- | --- | --- |
| `VALIDATION_*` | 422 | no | `VALIDATION_QTY_INVALID` | Correct the input |
| `AUTH_*` | 401/403 | no | `AUTH_PERMISSION_DENIED` | Request supervisor |
| `CONFLICT_*` | 409 | no | `CONFLICT_OPERATION_REUSED` | Reload and retry deliberately |
| `DOMAIN_*` | 409/422 | no | `DOMAIN_SHIFT_NOT_OPEN` | Open a shift |
| `INFRA_*` | 500/503 | yes, backoff | `INFRA_DB_UNAVAILABLE` | Retry, then escalate |
| `DEVICE_*` | n/a local | conditional | `DEVICE_PRINTER_OFFLINE` | Check hardware |

Rules: never map a timeout to "failed" when the outcome is unknown; never retry a domain rejection;
include `correlation_id`, `retryable`, and a machine-readable `code`; keep the original cause in the
server log only; and make the message bilingual where staff are Thai-speaking.

## Testing requirements (pack-wide)

Every module must ship the level below plus its specialist tests:

- **Unit**: pure functions for money, tax, allocation and state guards, with exact satang assertions.
- **Property-based**: totals reconcile, ledgers sum, idempotent replay has one effect, ordering does
  not change aggregates.
- **Database integration**: real PostgreSQL for constraints, RLS, locks and transaction rollback.
- **Contract**: provider webhooks, device sync payloads, printer/receipt rendering.
- **End-to-end**: offline sale → reconnect → sync → close shift → reconcile, on a clean database.
- **Concurrency**: the two-writer cases (last unit, last points, same shift close).
- **Chaos**: kill between commit and publish, drop the network mid-batch, pull a cable.
- **Security**: IDOR across tenants, permission matrix, input injection, secret leakage in logs.
- **Performance budgets**: checkout p95, sync batch time, report latency, receipt print start.
- **Recovery**: restore from backup and re-run invariants (`pos-backup-recovery`).

A test suite that never exercises offline, duplicate submission or a closed period is not a POS test
suite.

## Routing table

| The request is about… | Load |
| --- | --- |
| Cart, pricing, discounts, tax display, receipt content, void/refund of a sale | `pos-sales-checkout` |
| Stock levels, movements, transfers, stocktake, costing, reorder | `pos-inventory-management` |
| Card/QR tenders, gateway webhooks, settlement, chargebacks, refund at provider | `pos-payment-reconciliation` |
| Opening float, cash in/out, X/Z report, variance, safe drop | `pos-shift-cash-management` |
| Offline queue, sync protocol, conflicts, device registration, clock skew | `pos-offline-sync-engine` |
| Tenant isolation, RLS, provisioning, plans, per-tenant config, RBAC rollout | `pos-multi-tenant-saas` |
| VAT 7%, Thai receipt/tax-invoice fields, PromptPay/e-Tax boundaries, PDPA | `pos-thailand-commerce` |
| Members, points, tiers, coupons, consent | `pos-customer-loyalty` |
| COGS, margin, basket analysis, shrinkage, KPI definitions | `pos-profit-intelligence` |
| Scanner, printer, drawer, scale, EDC, kiosk integration and failures | `pos-hardware-integration` |
| Backup schedule, PITR, RPO/RTO, restore drills, DR runbook | `pos-backup-recovery` |

If a specialist skill is unavailable, the invariants and contracts above are sufficient to make a
safe, conservative decision; state the assumption explicitly in the output.

## Design review checklist

- [ ] Money is integer minor units end to end; no float in the path.
- [ ] Every mutating endpoint takes `operation_id`; replay is tested.
- [ ] Completed sale is immutable; refund/void produces new linked documents.
- [ ] Stock, cash and points have ledgers, not editable balances.
- [ ] Payment "paid" state is driven by a verified provider signal with signature check.
- [ ] Shift is required to complete a sale; close produces a Z-report and variance record.
- [ ] Offline behaviour is defined for every screen: what queues, what blocks, what the cashier sees.
- [ ] Tenant ID is enforced in the data layer; isolation test exists for every new table.
- [ ] Every sensitive action writes an audit record with before/after and reason.
- [ ] Reconciliation jobs and invariant tests run in CI, not just in a runbook.
- [ ] Receipt content matches the jurisdiction's required fields and the stored sale snapshot.
- [ ] Timezone, currency, tax rate and rounding are configuration with a period version, not constants.
- [ ] Failure paths are user-readable in the operator's language, with a recovery action.

## Anti-patterns

| Anti-pattern | Why it breaks | Do instead |
| --- | --- | --- |
| `balance = balance - qty` on a product row | No history, no audit, races under concurrency | Append movements and sum them |
| Marking a QR payment paid when the QR is rendered | Money may never arrive | Confirm via provider webhook/signed poll |
| Editing a completed sale to fix a mistake | Breaks receipts, VAT, reconciliation | Void or refund with new documents |
| Trusting device timestamps for accounting | Clock skew, retroactive edits | Store both clocks; use server time for books |
| `float` for prices | 0.1 + 0.2 errors in totals and VAT | Integer satang |
| Soft-deleting sales/stock rows | Reports and audits diverge | Status + compensating entries |
| One shared schema with `WHERE tenant_id = …` written by hand only | One forgotten filter = breach | RLS + tenant-leading keys |
| Retrying a failed "create sale" request without an idempotency key | Duplicate sales and double stock deduction | `operation_id` + unique constraint |
| Blocking checkout on a slow network call to the tax service | Queue collapses | Local computation, server reconcile later |
| Treating offline card approval as a normal payment | Unrecoverable credit risk | Floor limits, explicit risk state, provider rule |

## Cross-skill references

`pos-sales-checkout` · `pos-inventory-management` · `pos-payment-reconciliation` ·
`pos-shift-cash-management` · `pos-offline-sync-engine` · `pos-multi-tenant-saas` ·
`pos-thailand-commerce` · `pos-customer-loyalty` · `pos-profit-intelligence` ·
`pos-hardware-integration` · `pos-backup-recovery`

## Output expectations

When answering a POS question, deliver: the affected aggregates, the transaction boundary, the
invariant that could break, the failure modes (offline, duplicate, partial failure, permission
denied), and the test that proves it. Skip generic advice that would apply to any CRUD app.
