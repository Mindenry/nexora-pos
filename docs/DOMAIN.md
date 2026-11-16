# NEXORA POS — Domain Model & Invariants

The vocabulary follows `.agents/skills/pos-domain-expert`. One concept, one name.

## 1. Ubiquitous language

| Term | Code | Meaning |
| --- | --- | --- |
| Tenant | `tenant_id` | Commercial customer of the platform; isolation boundary |
| Business | `businesses` | Legal entity inside a tenant (tax id, receipt header) |
| Store | `store_id` / `branches` in UI | Physical branch that holds stock and rings sales |
| Shift | `shifts` | Cashier session owning float, cash movements and Z-report |
| Sale | `sales` | Completed commercial document with lines and tenders |
| Sale line | `sale_items` | One priced variant, discount and tax snapshot |
| Tender | `payments` | One payment attempt by one method |
| Refund | `refunds` / `refund_items` | Linked reversal of a sale, money and optionally stock |
| Movement | `inventory_movements` | Append-only stock change with reason and unit cost |
| On hand | `v_stock_on_hand` | `sum(qty_delta)` per store and variant |
| Business date | `business_date` | Trading day in the store timezone, frozen at completion |
| Outbox / queue | `idempotency_keys`, device outbox | Replay-safe command record |

## 2. Aggregate ownership

| Aggregate | Single writer | Never written by |
| --- | --- | --- |
| `sales` + `sale_items` + `payments` | checkout service | reports, inventory, UI |
| `refunds` + `refund_items` | refund service | checkout |
| `inventory_movements` | inventory service (sales/refunds call it) | any ad-hoc UPDATE |
| `shifts` + `cash_movements` | shift service (checkout appends cash) | reports |
| `loyalty_ledger` | loyalty service | customer edit screen |
| `document_sequences` | numbering service, inside the writing transaction | UI |
| `audit_logs` | audit helper (append-only) | anything that updates |

## 3. Invariants

| ID | Invariant | Enforced by |
| --- | --- | --- |
| INV-01 | For a completed sale `sum(payments.amount) = sales.total`; cash tendered above due is recorded as change | checkout service + tests |
| INV-02 | `sales.subtotal - sales.discount + 0 = sales.total`; line nets sum exactly to the total after allocated discounts | shared integer pricing + property tests |
| INV-03 | Stock never changes without an `inventory_movements` row; `on_hand = sum(qty_delta)` | append-only trigger, no balance column |
| INV-04 | A payment becomes `paid` only via a recorded confirmation (staff attestation with reference, or signed provider signal) | payment service |
| INV-05 | Every completed sale has an open `shift_id` at `occurred_at` | checkout precondition |
| INV-06 | Refund qty ≤ sold − already refunded; refund money ≤ captured − already refunded | refund service + row locks |
| INV-07 | Completed sales are immutable; corrections are refunds | DB trigger on money columns |
| INV-08 | `business_date` is set once at completion | checkout; no update path |
| INV-09 | Replaying an `operation_id` has one effect and returns the same response | `idempotency_keys` unique + request hash |
| INV-10 | Stock and money are correct after a browser crash between UI steps | server-side transaction; no client totals trusted |
| INV-11 | No tenant-scoped query returns another tenant's rows | RLS `FORCE` + isolation tests |
| INV-12 | Receipt numbers are allocated once, never reused | `document_sequences` row lock |

## 4. State machines

```
sale:      draft → completed → (partially_refunded → refunded)
                    └→ voided            (only before stock/payment settled; v1 allows authorised void)
payment:   pending → paid | failed | cancelled
           paid → partially_refunded → refunded
shift:     open → closed
purchase:  draft → submitted → approved → partially_received → received → closed
transfer:  draft → dispatched → received
                        └→ cancelled (before dispatch)
count:     draft → submitted → closed
refund:    completed  (v1 creates an approved refund atomically; approval permission required)
```

Illegal transitions throw `DOMAIN_*` errors with a stable code.

## 5. Permissions (v1 catalogue)

`products.read|create|update|delete`, `inventory.read|adjust|transfer|count`,
`sales.read|create|cancel`, `refunds.create`, `payments.read|confirm`,
`shifts.read|open|close|cash`, `customers.read|manage`, `promotions.manage`,
`purchasing.read|manage|approve`, `suppliers.manage`, `employees.manage`,
`reports.view|export`, `settings.manage`, `audit.view`, `platform.manage`.

Role defaults are seeded; a permission is always checked server-side against the
union of the employee's roles, and store scope against `employee_stores`.

## 6. Price and VAT pipeline

1. Line gross = `unit_price × qty` (integer satang; qty integer).
2. Line discount (amount or %) capped at line gross.
3. Order discount allocated across discounted lines proportionally using the
   largest-remainder method, so allocated parts sum exactly to the order discount.
4. `net = sum(discounted lines) − order discount`.
5. If prices include VAT at rate `r` bp: `tax = round(net × r / (10000 + r))`.
   Else: `tax = round(net × r / 10000)`, `total = net + tax`.
6. Rounding: half-up, exactly once at step 5. `total` is the amount collected.

Service charge and per-line tax overrides are schema-ready but not exposed in v1.

## 7. Failure semantics

| Failure | User sees | System state |
| --- | --- | --- |
| Network drops before commit | “ยังไม่ได้บันทึกการขาย” + retry with same operation id | Nothing committed |
| Network drops after commit, response lost | Retry returns the original receipt | One sale |
| Double tap on Pay | Button disabled; second request replayed | One sale |
| QR rendered, not confirmed | Sale waits with `pending` tender; not completed | No sale, no stock movement |
| Printer offline after commit | Sale completed, print job marked failed, reprint available | One sale |
| Offline cash sale | Queued locally with `pending sync` badge | Not in server reports yet |
| Reconnect replay | Idempotent commit, queue item cleared | One sale |
| Insufficient stock on server | `DOMAIN_INSUFFICIENT_STOCK` (if policy blocks) | Nothing committed |
| Shift closed concurrently | `DOMAIN_SHIFT_CLOSED` | Nothing committed |

## 8. Deferred explicitly

- Weighted goods (sell-by-weight), lot/expiry, BOM/recipes.
- FIFO / moving-average costing (standard cost snapshot is used).
- Automatic provider settlement import and chargeback workflow.
- e-Tax Invoice submission and credit/debit notes (needs provider + legal review).
- Multi-currency and FX.
- Loyalty redemption at the till (earning, tiers and liability report ship; spend
  rules need an approved programme policy).
