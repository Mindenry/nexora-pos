---
name: pos-sales-checkout
description: >
  Designs and debugs the POS sale itself: cart and line items, pricing and discounts, tax display,
  totals rounding, sale state machine, tender orchestration, receipt content snapshot, void, refund and
  exchange. Use for checkout flow, "total is wrong", "discount not applied", duplicate sales, "void a
  receipt", split payment, part refund, or receipt line/total mismatches. Not for provider settlement
  and webhook reconciliation (pos-payment-reconciliation), shift cash counts
  (pos-shift-cash-management), or Thai legal receipt fields (pos-thailand-commerce).
---

# POS sales & checkout

Checkout is a deterministic function from a priced cart plus tenders to an immutable, receipted
sale. Everything hard about it is arithmetic that must be exact, state that must not fork, and
failure that must not lose money.

## When to use

- Building or changing the cart, pricing engine, discount rules or totals.
- Sale lifecycle: draft → completed → voided/refunded/partially refunded.
- Split, mixed and partial tenders; change; over/short tender.
- Receipt snapshot content and reprints.
- Investigating total mismatches, duplicate sales, or one sale charged twice.

**Not this skill:** gateway lifecycle, settlement and chargebacks
(`pos-payment-reconciliation`); cash drawer counting and Z-reports (`pos-shift-cash-management`);
jurisdiction-specific tax invoice fields (`pos-thailand-commerce`); queue and conflict handling
(`pos-offline-sync-engine`).

## Sale state machine

```text
         ┌──────────┐  add/edit lines   ┌───────────┐
new ────▶│  draft   │──────────────────▶│  pricing  │
         └────┬─────┘                   └─────┬─────┘
              │ abandon (empty)               │ tender started
              ▼                               ▼
         ┌──────────┐                   ┌───────────┐
         │ abandoned│                   │  pending  │◀── partial tender
         └──────────┘                   └─────┬─────┘
                                    all tenders│captured/confirmed
                                               ▼
                                         ┌───────────┐
                                         │ completed │──▶ refund/void ⇒ new documents
                                         └───────────┘
```

Allowed: `draft → abandoned`, `draft → pending`, `pending → pending` (more tenders),
`pending → completed` (only when `sum(tenders) = total`), `pending → draft` (remove tender, with
authorisation), `completed → refunded/partially_refunded` via a child document. Everything else is
`SALE_INVALID_TRANSITION`.

A completed sale is **immutable**. Never allow line edits, total edits, or "reopen sale".

## Totals algorithm (single source of truth)

Compute per line, then aggregate. All values integer satang.

```text
line.gross        = round(unit_price * qty_milli / 1000)  (qty_milli = 1000 for whole units)
line.discount     = allocate(order_discount) + line_discount
line.net          = line.gross - line.discount           (clamp ≥ 0)
line.tax          = tax_for(line.net, tax_code, price_includes_tax)
line.total        = line.net                              (tax-inclusive prices: tax is inside net)
sale.subtotal     = Σ line.gross
sale.discount     = Σ line.discount
sale.net          = Σ line.net
sale.tax          = Σ line.tax
sale.service      = service_charge(sale.net)              (if configured, taxable per policy)
sale.rounding     = cash_rounding(sale.grand_total)       (policy-driven, posted separately)
sale.grand_total  = sale.net + service + rounding
```

Rules:

1. **Discount allocation must be exact.** Allocate an order-level discount proportionally by line
   net, then hand the remainder satang to the largest line (deterministic tie-break by `line_no`).
   `Σ allocated = order discount` — assert it.
2. **Rounding is not a discount.** Cash rounding (nearest 0.25/0.50/1.00 THB) is its own line in
   the totals and its own ledger account. VAT is calculated **before** cash rounding.
3. **Tax-inclusive vs tax-exclusive is a property of the price list**, not the cashier's mood.
   Mixed tax codes in one basket are legal (e.g. VAT-exempt goods); keep per-line tax.
4. **Recompute from lines, never trust a client-sent total.** Compare and reject with
   `SALE_TOTAL_MISMATCH` including both values.
5. **Idempotent completion** uses `operation_id`; the completion transaction also writes stock
   movements, loyalty accrual and the receipt snapshot.

### Worked example (THB, VAT 7% inclusive)

| Step | Value (satang) |
| --- | --- |
| 2 × ฿59.00 | gross 11,800 |
| 10% line discount | −1,180 |
| net | 10,620 |
| VAT inside net: `round(10,620 × 7/107)` | 695 |
| net excl. VAT | 9,925 |
| grand total | 10,620 |
| cash rounding to ฿0.25 | 0 (already a multiple) |

VAT arithmetic details live in `pos-thailand-commerce`; the invariant here is that
`tax + net_excl = net_incl` exactly, with no residual satang.

## Tender orchestration

A sale is completed when **verified** value covers the total. The sale module does not verify
payments; it consumes the payment module's confirmed events.

```ts
type Tender = {
  tenderId: string;          // client UUIDv7, idempotency key
  method: 'cash' | 'card_present' | 'qr_promptpay' | 'transfer' | 'voucher' | 'credit_account';
  amount: number;            // satang, requested by cashier
  appliedAmount: number;     // satang, min(amount, remaining due); drives paid_total
  capturedAmount?: number;   // satang, confirmed by provider (may exceed applied for cash)
  changeAmount?: number;     // satang, cash only: capturedAmount − appliedAmount
  status: 'pending' | 'confirmed' | 'failed' | 'cancelled' | 'needs_review';
  providerRef?: string;
};

// completion gate
const applied = tenders.filter(t => t.status === 'confirmed')
                       .reduce((s, t) => s + t.appliedAmount, 0);
if (applied < sale.grandTotal) return err('SALE_UNDERPAID', { applied, due: sale.grandTotal });
```

- **Cash**: confirmed at the drawer. `change = cashReceived − cashDue` is recorded as a tender
  attribute, not a negative line.
- **Card/QR**: `pending` until the provider signal arrives (`pos-payment-reconciliation`). If the
  operator must not wait, hold the sale as `pending` and print a **provisional** slip clearly marked
  as not a tax invoice.
- **Split tender**: each tender is its own idempotent record; a failure of the second does not roll
  back the first. Recovery is "retry tender" or "void sale with reversal of confirmed tenders".
- **Overpayment by non-cash**: reject unless the method supports it; never issue cash change for a
  card overpayment without a documented cash-advance policy.
- **Underpayment**: never complete. No "pay later" flag on a completed sale.

## Receipt snapshot

At completion, freeze everything the receipt needs into `receipt_snapshot` (JSONB) — seller legal
name, tax ID, branch, address, line descriptions, quantities, unit prices, discounts, tax breakdown,
payment methods, change, cashier, device, receipt number, timestamp, and tax-invoice type.

Why: catalog names, prices, tax rates and addresses change. A reprint in 2029 must reproduce the
2026 document. Reprints are marked `REPRINT`, carry the original receipt number and a reprint
counter, and never mint a new tax-invoice number.

Numbering: per store, per document type, gapless within a fiscal period, allocated inside the
completion transaction from a `document_sequence` row with `SELECT … FOR UPDATE`. Gaps require a
voided-number record with reason.

## Void vs refund vs exchange

| Operation | When | Money | Stock | Document |
| --- | --- | --- | --- | --- |
| Abandon draft | Nothing captured | none | none | none |
| Void before completion | Tender failed/cancelled | reverse pending tenders | none | void record |
| Void completed sale | Same business day, manager, no goods left | reverse each tender per method rules | restock if goods returned | credit note + void link |
| Refund | Goods returned, full or partial | refund to original tender first | restock per line, condition-aware | refund document |
| Exchange | Return + new sale | net difference tendered | restock + deduct new | both documents linked |

Rules:

1. Refund quantity per line ≤ `sold_qty − already_refunded_qty` (enforced with a row lock).
2. Refund amount per tender ≤ `captured − already_refunded`; never refund more cash than was taken
   in cash for that sale.
3. Refund to original method by default. A different method needs a reason code and elevated
   permission — it is a classic fraud path.
4. Restock only what is physically returned and sellable; damaged goods go to a `damaged` location
   via `pos-inventory-management`, not back to sellable stock.
5. Voiding after the Z-report/business date closed is a refund plus an adjustment, never a delete.
6. Every void/refund writes an audit record with actor, approver, reason and original document link.

## Data model

```sql
create table sale (
  tenant_id        uuid not null,
  sale_id          uuid not null,
  store_id         uuid not null,
  device_id        uuid not null,
  shift_id         uuid not null,
  receipt_no       text not null,
  status           text not null check (status in
                     ('draft','pending','completed','voided','partially_refunded','refunded','abandoned')),
  business_date    date not null,
  currency         char(3) not null default 'THB',
  subtotal         bigint not null,
  discount_total   bigint not null,
  net_total        bigint not null,
  tax_total        bigint not null,
  service_total    bigint not null default 0,
  rounding_total   bigint not null default 0,
  grand_total      bigint not null,
  paid_total       bigint not null default 0,
  customer_id      uuid,
  price_list_id    uuid not null,
  tax_snapshot     jsonb not null,
  receipt_snapshot jsonb,
  occurred_at      timestamptz not null,
  received_at      timestamptz not null default now(),
  completed_at     timestamptz,
  original_sale_id uuid,
  operation_id     uuid not null,
  constraint sale_pk primary key (tenant_id, sale_id),
  constraint sale_op_uq unique (tenant_id, operation_id),
  constraint sale_totals_ck check (grand_total = net_total + service_total + rounding_total),
  constraint sale_paid_ck  check (paid_total <= grand_total)
);

create table sale_line (
  tenant_id   uuid not null,
  sale_id     uuid not null,
  line_no     int  not null,
  variant_id  uuid not null,
  description text not null,
  qty_milli   bigint not null,          -- 1000 = 1 unit; supports weighed goods without float
  unit_price  bigint not null,
  line_discount bigint not null default 0,
  order_discount_alloc bigint not null default 0,
  net_amount  bigint not null,
  tax_code    text not null,
  tax_amount  bigint not null,
  tax_rate_bp int  not null,             -- basis points, snapshot of rate used
  constraint sale_line_pk primary key (tenant_id, sale_id, line_no)
);
```

`qty_milli` avoids floats for weighed goods while keeping integer arithmetic. Round the extended
price once, at line level, with an explicit rule.

## Workflow: implement or fix checkout

1. **Locate the single totals function.** If totals are computed in more than one place (UI, API,
   printer), that is the bug. Consolidate into one pure function with golden tests.
2. **Fix the money type** to integer minor units at the boundary; reject floats at parse time.
3. **Model the sale state machine** explicitly with a transition table and guard function.
4. **Add `operation_id`** to completion and refund endpoints plus the unique constraint.
5. **Move stock, loyalty and receipt writes into the completion transaction**; emit outbox events.
6. **Gate completion on confirmed tenders**; never on a client `paid: true` flag.
7. **Snapshot the receipt** and implement reprint from the snapshot only.
8. **Implement void/refund** as new documents with quantity and amount caps enforced in SQL.
9. **Add invariant tests** (below) and a reconciliation query for orphan sales.
10. **Review operator-facing errors** in Thai and English with a recovery action.

## Business rules

- Minimum age / restricted items enforced at line add, re-checked at completion.
- Price override requires permission and reason; the original price is retained.
- Discount stacking policy is explicit: max one order-level + one line-level unless a campaign
  declares compatibility.
- Zero-value lines (freebies) need a reason code; they still move stock.
- Rounding and service charge are configuration with effective dates; a sale snapshots what applied.
- A sale cannot complete with an empty cart or with negative grand total.
- Gift cards/vouchers are tenders (liability), not discounts.
- Reopening a completed sale is forbidden; corrections are new documents.

## Edge cases

| Case | Handling |
| --- | --- |
| Cashier double-taps "Pay" | Same `operation_id` → replay returns the original sale |
| Network drops after provider confirms but before sale completes | Sale stays `pending`; sync reconciles; never re-charge; link by provider ref |
| Price changed while cart open | Cart holds the snapshot; recompute only on explicit repricing |
| Two registers sell the last unit | Stock check is advisory at add; server completion may go negative → flag for `pos-inventory-management` |
| Discount makes line net negative | Clamp to 0 and record unapplied discount; never pay the customer via a line |
| Weighed item 0.437 kg | `qty_milli = 437`; extended price rounds once; unit price per kg |
| Currency mismatch in tender | Reject `TENDER_CURRENCY_MISMATCH`; no implicit FX at the till |
| Reprint after tax-rate change | Reprint from snapshot; totals must not change |
| Customer walks away mid-pending card payment | Timeout → cancel tender, release sale, keep provider ref for reconciliation |
| Refund original tender unavailable (card expired) | Alternate method with reason + manager approval, recorded as a distinct refund tender |

## Security

- Authorise every mutation server-side: `sales.create`, `sales.discount.apply`, `sales.void`,
  `sales.refund`, `sales.price_override`. Never rely on hidden buttons.
- Thresholds: discount > X% or refund > Y THB requires an approver distinct from the operator.
- Never log full card data; store only provider reference, last4 and scheme when the provider returns it.
- Sign or authenticate device commands; a device token is not a user session.
- Receipt reprints and exports are auditable (who, when, how many).
- Validate quantity, price and discount ranges server-side (`qty > 0`, `discount ≤ gross`,
  `price ≥ 0`), and reject NaN/Infinity at the JSON boundary.

## Error handling

Stable codes, retryable flag, operator message, and a recovery action:

| Code | Retry | Operator action |
| --- | --- | --- |
| `SALE_TOTAL_MISMATCH` | no | Refresh cart and re-price |
| `SALE_UNDERPAID` | yes | Take another tender |
| `SALE_INVALID_TRANSITION` | no | Reload sale; escalate if persisted |
| `SALE_ALREADY_COMPLETED` | no | Open receipt instead of paying again |
| `SALE_REFUND_EXCEEDS_CAPTURED` | no | Reduce refund amount |
| `SALE_PRICE_OVERRIDE_FORBIDDEN` | no | Request supervisor |
| `SALE_RECEIPT_SEQUENCE_EXHAUSTED` | no | Alert; do not trade without legal numbering |

Log with correlation ID, never log full customer PII. A failed completion must leave no partial
sale: one transaction, or compensating void.

## Testing requirements

- **Golden totals**: 30+ baskets covering discounts, mixed tax codes, weighed goods, service
  charge, rounding, zero-value lines; assert exact satang.
- **Property-based**: `Σ line.net = sale.net`; `Σ tender.confirmed = paid_total`;
  discount allocation sums exactly; totals are invariant under line ordering.
- **Idempotency**: same `operation_id` twice → one sale, identical response; different hash → 409.
- **State machine**: table-driven test over every (state, event) pair including illegal ones.
- **Concurrency**: two completes on the same draft → exactly one succeeds.
- **Refund caps**: parallel refunds cannot exceed sold quantity or captured amount.
- **Offline**: complete a cash sale with the network blocked, restart the app, verify persistence.
- **Reprint**: snapshot renders identically after catalog/price/tax changes.
- **Performance**: p95 completion < 300 ms local, < 800 ms server, printer excluded.

## Anti-patterns

- Recomputing totals in the UI, the API and the printer template separately.
- Storing `paid` boolean on sale instead of deriving from confirmed tenders.
- Using a sale row update to "fix" a completed total.
- Allocating discounts by rounding each line independently (sum drifts).
- Treating change as a negative tender line.
- Blocking checkout on printing; print failures must not fail the sale.
- Refunding by creating a negative sale with no link to the original.
- Trusting the client's `unit_price` without checking the price list version.
- Applying tax after cash rounding.
- Letting a device choose the receipt number.

## Cross-skill references

Money/time/idempotency contracts: `pos-domain-expert`. VAT math and receipt fields:
`pos-thailand-commerce`. Tender confirmation and refunds at the provider:
`pos-payment-reconciliation`. Stock effects: `pos-inventory-management`. Shift requirement:
`pos-shift-cash-management`. Queue and duplicate protection: `pos-offline-sync-engine`. Points
accrual: `pos-customer-loyalty`. Printer output: `pos-hardware-integration`.
