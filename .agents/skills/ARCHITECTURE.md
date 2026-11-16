# POS skills architecture

How the twelve skills divide the POS problem, what each one owns, and where the boundaries are. The
goal is that any single skill can be loaded alone and still be correct, while the set composes without
contradiction.

## Design goals

1. **One owner per concern.** A rule lives in exactly one skill; others reference it.
2. **Standalone correctness.** Each skill restates the contracts it depends on, so a missing sibling
   never leaves a dangerous gap.
3. **Progressive disclosure.** Metadata is enough to route; the body is enough to act; references are
   optional depth.
4. **Production bias.** Every section ends in a test, an invariant, or an operational procedure.
5. **No vendor lock-in.** Providers and hardware appear as ports and categories.

Non-goals: being a framework, a code generator, a compliance certificate, or a replacement for the
product's own documentation.

## Layer model

```text
┌──────────────────────────────────────────────────────────────────────┐
│ L0  pos-domain-expert                                                │
│    language · invariants · money/time/idempotency contracts · routing│
└───────────────┬──────────────────────────────────────────────────────┘
                │ every skill may reference L0
┌───────────────▼──────────────────────────────────────────────────────┐
│ L1  Core money & stock path                                          │
│  pos-sales-checkout   pos-inventory-management                       │
│  pos-payment-reconciliation   pos-shift-cash-management              │
└───────────────┬──────────────────────────────────────────────────────┘
                │ these produce the facts everything else consumes
┌───────────────▼──────────────────────────────────────────────────────┐
│ L2  Platform & environment                                           │
│  pos-offline-sync-engine   pos-multi-tenant-saas                     │
│  pos-backup-recovery       pos-thailand-commerce                     │
│  pos-hardware-integration                                            │
└───────────────┬──────────────────────────────────────────────────────┘
                │ consumes facts, never writes the money path
┌───────────────▼──────────────────────────────────────────────────────┐
│ L3  Growth & insight                                                 │
│  pos-customer-loyalty      pos-profit-intelligence                   │
└──────────────────────────────────────────────────────────────────────┘
```

Dependencies point downward only. `pos-profit-intelligence` reads facts; it never posts stock.
`pos-customer-loyalty` consumes a completed sale; it never completes one. `pos-thailand-commerce`
informs documents and tax; it does not decide when a sale is paid.

## Capability matrix

| Concern | domain | sales | inv | pay | shift | sync | saas | th | loy | profit | hw | dr |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Money arithmetic | ● | ● | ○ | ○ | ● | | | ● | ● | ● | | |
| Sale lifecycle | ● | ● | | ○ | ○ | ○ | | ○ | ○ | ○ | ○ | |
| Stock ledger | | ○ | ● | | | ○ | | | | ○ | | |
| Payment states | ● | ○ | | ● | ○ | ○ | | ○ | ○ | ○ | ○ | |
| Cash accountability | | ○ | | ○ | ● | ○ | | ○ | | ○ | ○ | |
| Offline behaviour | ● | ○ | ○ | ○ | ○ | ● | | | ○ | | ○ | ○ |
| Tenant isolation | ● | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| Audit trail | ● | ● | ● | ● | ● | ● | ● | ● | ● | ○ | ● | ● |
| Thai VAT/receipts | | ○ | | ○ | ○ | | ○ | ● | | ○ | ○ | ○ |
| Document retention | | ○ | ○ | ○ | ○ | | ○ | ● | | | | ● |
| Peripherals | | ○ | | ○ | ○ | ○ | | ○ | | | ● | |
| Recovery | | | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● |

● owns the rule · ○ consumes or applies it · blank = out of scope.

## Ownership matrix

| Entity / decision | Owner | Consumers |
| --- | --- | --- |
| `sale`, `sale_line`, totals, receipt snapshot | `pos-sales-checkout` | pay, shift, loy, profit, th, hw |
| `tender` gating and refund documents | `pos-sales-checkout` | pay, shift |
| Payment intent, provider events, settlement | `pos-payment-reconciliation` | sales, shift, profit, dr |
| `stock_movement`, balances, costing | `pos-inventory-management` | sales, profit, dr |
| `shift`, `cash_movement`, Z-report | `pos-shift-cash-management` | sales, pay, profit, dr |
| Outbox, cursor, conflict policy | `pos-offline-sync-engine` | sales, inv, pay, shift |
| Tenant, RLS, roles, entitlements, config | `pos-multi-tenant-saas` | all |
| VAT math, document types, legal fields | `pos-thailand-commerce` | sales, pay, profit, dr |
| Points ledger, coupons, consent | `pos-customer-loyalty` | sales, profit |
| Metric definitions, fact tables | `pos-profit-intelligence` | — |
| Device ports and adapters | `pos-hardware-integration` | sales, shift, sync |
| Backup, restore, RPO/RTO | `pos-backup-recovery` | all (operational) |

## Contract catalogue

Defined in `pos-domain-expert`, applied everywhere.

| ID | Contract | Enforcement |
| --- | --- | --- |
| MONEY-01 | Integer minor units, no float | Type at boundary + schema `bigint` |
| TIME-01 | UTC storage, `business_date` from store timezone, device clock untrusted | Columns + reporting queries |
| IDEM-01 | `operation_id` unique per tenant, request hash, response replay | Unique index + command handler |
| LEDGER-01 | Append-only stock/cash/points/events; corrections are compensating entries | Grants + no UPDATE path |
| STATE-01 | Explicit state machines, illegal transitions rejected | Transition table + tests |
| AUDIT-01 | Actor, device, before/after, reason, correlation ID | Audit table + middleware |
| TENANT-01 | Tenant in every key, index, query and policy | RLS + composite PKs |

## Transaction boundaries

```text
Command (one DB transaction)
  ├── load aggregate + lock (sale, shift, stock rows)
  ├── validate state transition
  ├── write business rows (sale completed, movement, payment_event)
  ├── write idempotency record
  ├── write audit record
  └── write outbox events
Commit
  ↓
After commit (never inside the transaction)
  ├── print job
  ├── sync push
  ├── loyalty accrual (or outbox consumer)
  ├── analytics projection
  └── notifications
```

Rules:

- Money and stock that must agree commit together. Loyalty and analytics may be eventually
  consistent, but must be idempotent and replayable.
- Network I/O is forbidden inside the transaction. A provider call is a state transition driven by
  an event, not a call inside the sale commit.
- A partially failed flow leaves a named, recoverable state (`pending`, `needs_review`,
  `quarantined`), never a silent inconsistency.

## Event flow

```text
device command ──▶ local commit + outbox ──▶ sync push ──▶ server command
                                                              │
                                    ┌─────────────────────────┤
                                    ▼                         ▼
                            domain state change         outbox events
                                                              │
              ┌───────────────┬───────────────┬───────────────┼──────────────┐
              ▼               ▼               ▼               ▼              ▼
          printing        loyalty         analytics      settlement      notifications
```

Event envelope (minimum): `event_id`, `type`, `version`, `tenant_id`, `store_id`, `occurred_at`,
`received_at`, `correlation_id`, `causation_id`, `payload`, `schema_version`. Consumers must be
idempotent by `event_id` and tolerate at-least-once delivery.

## Where cross-cutting concerns live

| Concern | Mechanism | Lives in |
| --- | --- | --- |
| Authentication | Session for people, certificate/token for devices | saas, sync |
| Authorisation | Permission strings + store scope, checked server-side | saas, each module |
| Idempotency | `operation_id` + response snapshot | domain, all commands |
| Audit | Append-only record with before/after | domain, each module |
| Money | Integer minor units | domain, all |
| Time | UTC + business date | domain, all |
| Tenancy | `tenant_id` + RLS | saas, all queries |
| Config | Effective-dated rows, snapshotted on documents | saas, sales, th, inv |
| Observability | Correlation ID, structured logs, queue depth | all |
| Recovery | Backups + invariants after restore | dr |

## Composition patterns

**Checkout completion (happy path).**
`sales` validates and commits the sale and movements → outbox → `pay` confirms tenders (or is
already confirmed) → `loy` accrues → `profit` projects → `hw` prints from the snapshot.

**Refund.**
`sales` caps quantity and amount, creates a refund document → `pay` refunds the tender → `inv`
restocks or marks damaged → `loy` reverses points → `profit` reports negative revenue in the refund
period → `th` issues a credit note.

**Offline sale, online later.**
`sync` stores locally and queues → `sales` accepts the money fact on the server → `inv` posts
movements with the original cost snapshot → `shift` attributes to the original shift or an amended
Z-report → `pay` handles any unknown card/QR outcome as `needs_review`.

**Tenant onboarding.**
`saas` creates tenant, store, sequences, config, owner and device enrolment → `th` validates tax and
document config → `inv` loads opening stock → `shift` opens the first float → `dr` records the
go-live backup.

**Incident: settlement gap.**
`pay` produces the exception list → `shift` confirms cash is unaffected → `profit` quantifies the
margin impact → `dr` confirms evidence is retained → `saas` records the tenant communication.

## Decisions (ADR summary)

| Decision | Rationale | Consequence |
| --- | --- | --- |
| 12 skills, not 1 mega-skill | Metadata routing stays precise; bodies stay under budget | Cross-references must be maintained |
| `pos-domain-expert` as anchor | One place for contracts and invariants | Specialists must not contradict it |
| Thai compliance separated | Jurisdiction content changes independently and is legally sensitive | Sales skill stays jurisdiction-neutral |
| Inventory as ledger, not counters | Auditability, concurrency, costing | More rows; projections required |
| Payment confirmation strictly provider-side | Prevents the most expensive class of loss | `needs_review` state and ops process required |
| Offline as a first-class skill | Store reality; affects every module | Conflict matrix and device auth required |
| Analytics separated from OLTP | Reporting must not slow checkout | Pipeline idempotency and freshness tracking |
| No shared code between skills | Skills must be portable and standalone | Duplication of a few contract paragraphs |

## Adding a thirteenth skill

1. Check it does not overlap an existing owner. If it does, extend that skill instead.
2. Pick an ID under 64 characters, `pos-` prefixed, kebab-case, and use it as the folder name.
3. Write the description with triggers and an explicit "Not for …" clause naming the sibling that
   owns the excluded cases.
4. Reuse the contract IDs rather than redefining money/time/idempotency.
5. Add it to the routing table in `pos-domain-expert`, to `README.md`, and to `ROUTING.md`.
6. Run the validator; fix description overlap before merging.
7. Add a composition example showing when it is loaded with its neighbours.

## Failure domains

| Failure | Blast radius | Contained by |
| --- | --- | --- |
| Wrong total | One sale, customer dispute | Sales invariants + golden tests |
| Double charge | Customer money, chargeback | Idempotency + payment events |
| Stock drift | Reorder, margin | Ledger + reconciliation job |
| Cash variance | Store P&L, fraud | Shift close + approvals |
| Cross-tenant read | Legal incident | RLS + IDOR tests |
| Lost offline sales | Revenue, receipts | Durable local DB + outbox |
| Thai receipt defect | Tax filing, penalties | Snapshot + field validation + accountant sign-off |
| Printer failure | Queue, not money | Print queue + reprint |
| Data loss | Everything | PITR + restore drills |

## Quality gates

- Structural validation (`scripts/validate-pos-skills.py`): frontmatter, names, sections, references.
- Consistency review: arithmetic formulas and state machines checked across skills by hand; every
  contradiction resolved in favour of `pos-domain-expert`.
- Standalone check: each skill can be read without opening a sibling; cross-references are optional
  depth, not required reading.
- Operational check: every failure mode named in a skill has a user-visible state and a test.
