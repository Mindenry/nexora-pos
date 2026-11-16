---
name: pos-shift-cash-management
description: >
  Owns cashier shifts and the cash drawer: opening float, cash in/out, petty cash, safe drops,
  blind counts, variance handling, X and Z reports, handover between cashiers, and shift-level
  cash reconciliation. Use for "close shift", "drawer is short/over", "ปิดกะ", "เงินทอนไม่ตรง",
  opening float, Z-report, or end-of-day cash. Not for card/QR settlement
  (pos-payment-reconciliation), sale totals (pos-sales-checkout), or receipt tax fields
  (pos-thailand-commerce).
---

# POS shift & cash management

The shift is the unit of **cash accountability**. A sale belongs to exactly one open shift; a shift
belongs to exactly one cashier at a time; the drawer must be explainable from float + cash sales −
cash refunds + cash in/out. If it is not, you have a variance, and a variance without an explanation
is either an error or a loss.

## When to use

- Building shift open/close, X/Z reports, cash movements, safe drops or handover.
- A drawer count does not match the system.
- Designing end-of-day procedures, manager overrides or cash variance policy.
- Deciding what blocks a shift close, and what happens to unfinished work.

**Not this skill:** provider settlement and refunds by card/QR
(`pos-payment-reconciliation`); sale arithmetic (`pos-sales-checkout`); VAT/receipt law
(`pos-thailand-commerce`); background backup of shift data (`pos-backup-recovery`).

## Shift state machine

```text
         ┌────────────┐  declare float + count
created ─▶│   open     │◀──┐ handover (new cashier, same drawer or new drawer)
         └─────┬──────┘   │
               │ close requested
               ▼
         ┌────────────┐  count + variance review
         │  closing   │
         └──┬──────┬──┘
   variance ok │    │ variance above threshold
               ▼    ▼
        ┌──────────┐ ┌────────────────┐
        │  closed  │ │ pending_review │──▶ closed (approved, reason recorded)
        └──────────┘ └────────────────┘
```

- One open shift per `(device, drawer)` at a time — enforce with a partial unique index.
- One cashier per open shift. A second cashier needs a handover, not a shared login.
- Closing is idempotent: the same `operation_id` returns the same Z-report.
- A closed shift is immutable; corrections are adjustment documents linked to it.

## Cash mathematics

```text
expected_cash =
    opening_float
  + cash_sales_applied          # net kept after change is given
  − cash_refunds
  + cash_in
  − cash_out
  − safe_drops
  ± petty_cash
  ± cash_rounding_adjustments

counted_cash  = Σ denomination counts (blind count)
variance      = counted_cash − expected_cash
```

Sign convention: positive variance = over, negative = short. Report it in words, not just a number,
because operators read "short ฿120" correctly and "variance −12000" wrongly.

All amounts are integer satang. Denominations are configured per currency (THB: 1000, 500, 100, 50,
20 baht notes; 10, 5, 2, 1 baht coins; 25, 50 satang coins). Count by denomination, multiply, sum —
never type a total directly when a denomination grid exists.

## Opening a shift

1. Cashier authenticates (personal credential, not a shared PIN).
2. System proposes the float from the previous close or a store default; the cashier **counts it** and
   confirms the actual amount. A confirmed float different from the proposal is a variance event at
   open, recorded with a reason.
3. Bind `device_id`, `drawer_id`, `store_id`, `business_date`, `opened_at`, `opened_by`.
4. Open the drawer via the hardware adapter; if it fails, allow manual open and log the failure.
5. Refuse to open a second shift on the same drawer; offer handover or close first.
6. If an offline device has unsynced sales from a previous shift, do not silently attach them to the
   new shift — resolve by `occurred_at` into the correct shift (see below).

## Cash movements

Every non-sale cash change is a typed, audited movement:

| Type | Direction | Requires | Notes |
| --- | --- | --- | --- |
| `float_in` | + | cashier | Opening float only, once per shift |
| `cash_in` | + | cashier + reason | Change fund top-up, owner deposit |
| `cash_out` | − | cashier + reason | Petty cash, supplier payment at door |
| `safe_drop` | − | cashier + witness (configurable) | Reduces drawer risk; stays in store safe |
| `bank_deposit` | − | manager | Leaves the store; separate from drawer |
| `cash_refund` | − | permission | Linked to refund document |
| `rounding` | ± | system | From cash rounding policy |
| `correction` | ± | manager + reason | Fixes a posted error, never deletes it |

Rules:

- A movement is an append-only row with `shift_id`, `amount`, `reason_code`, `note`, `created_by`,
  `approved_by`, `occurred_at`, `operation_id`. No edit, no delete.
- `cash_out` above a threshold needs an approver; all movements above another threshold need a note.
- Safe drops are not sales and not expenses; they move cash within the store. Bank deposits move it
  out of the store. Keep the two separate or your cash position will be wrong.
- Petty cash spent from the drawer is an expense with a receipt; it is not a discount.

## X-report vs Z-report

| | X-report (mid-shift) | Z-report (close) |
| --- | --- | --- |
| Purpose | Snapshot for the cashier/manager | Final, immutable close of the shift |
| Changes state | No | Yes: shift → closed |
| Resets counters | No | Yes, for the shift |
| Numbering | Optional, non-legal | Sequential per store/device, gapless |
| Contents | Sales by method, refunds, voids, cash in/out, expected cash | Same + counted cash, variance, tax summary, sequence range, signatures |

Z-report contents (minimum): store legal identity, device, shift ID, cashier, open/close time,
business date, document/receipt number range (from–to, with voided numbers), gross/net/discount/
service/rounding, tax breakdown by rate, sales by tender with counts, refunds and voids with
references, cash movements, opening float, expected vs counted cash, variance and reason, totals per
department/category if used, signature lines for cashier and manager.

Generate the Z-report **inside the close transaction** and store the rendered snapshot. Reprints
render from the snapshot, never recompute.

## Closing a shift: workflow

1. **Pre-flight** (must pass or be explicitly overridden):
   - no `pending` payment intents on this shift (cancel or resolve first);
   - no draft sales idle beyond a threshold (abandon them with a reason);
   - no unsynced sales from this device for this shift, or acknowledge that they will sync later;
   - all refunds/voids initiated in this shift are in a terminal state.
2. **Blind count**: the cashier enters denominations without seeing expected cash. A supervisor may
   count independently; two counts are better.
3. **System computes** expected cash and variance.
4. **Variance policy**:
   - within tolerance (e.g. ≤ ฿20 or a configured band): close, record variance, no approval;
   - above tolerance: `pending_review`, requires manager approval with reason code and note;
   - repeated variances by the same cashier: escalate to a pattern alert, not just a single close.
5. **Finalise**: write Z-report snapshot, close shift, release the drawer, post cash to the store's
   cash position, emit events for accounting.
6. **Next shift** opens with the remaining drawer float or a fresh float from the safe, counted.

Never "fix" a variance by editing sales, deleting a cash movement, or adding a fake `cash_in`. The
only legitimate correction is an explicit adjustment with a reason and an approver.

## Handover

- Close the current shift (or transfer custody with a signed count) and open a new one; do not share
  a login.
- Mid-day handover with the same drawer: count, record `handover_out`/`handover_in` counts, keep both
  shifts' Z-reports.
- Every sale carries the `shift_id` of the cashier who completed it, even if the device stays open.
- If a cashier leaves mid-transaction, the sale stays with their shift until completed or voided by a
  supervisor.

## Late and offline sales

The hard case: a device was offline, completed sales, and the shift closed before sync.

1. Sales carry `occurred_at` and `shift_id` from the device.
2. On sync, if the referenced shift is closed, post the sale to that closed shift's Z-report
   **only if** the close is still provisional (within a defined grace window); otherwise post to a
   `late_posted` bucket attached to the original shift, and produce an amended Z-report marked
   `AMENDED` with a new sequence — never silently rewrite the closed report.
3. Cash from those sales increases the drawer expectation of the shift that physically holds it. If
   the cash was already counted and banked, create a receivables/shortfall record with an owner.
4. Never reassign the sale to the current shift just to make numbers work.

Define the grace window (e.g. 24 hours) and the amended-report rules with finance before go-live.

## Business rules

- A sale cannot complete without an open shift on its device.
- Refunds are posted to the shift that processes them, with a link to the original sale's shift.
- Cash rounding differences accumulate in a `rounding` bucket per shift and are reported, not hidden.
- Tips in cash belong to staff, not the drawer; track them separately and do not include them in
  expected cash unless the policy says so.
- Opening float is a loan to the drawer, not revenue.
- A drawer cannot be closed by the same person who opened it without an approver when variance
  exceeds threshold (separation of duties).
- Voided receipts stay in the number range and appear on the Z-report.
- Store-level cash position = Σ closed shifts' counted cash − bank deposits ± safe movements.

## Edge cases

| Case | Handling |
| --- | --- |
| Cashier closes with a pending QR payment | Block; show the payment and let them resolve/cancel |
| Power loss mid-close | Close is a single transaction; on restart the shift is still open, count is re-entered |
| Two devices share one physical drawer | Forbid; one drawer → one active shift |
| Customer pays by QR after the drawer was counted | Payment resolves to `needs_review`; refund or add to next shift with an audit link |
| Refund given from the next shift's float | Allowed; posts as `cash_refund` on the refunding shift |
| Count entered in baht with decimals | Parse to satang; reject more than 2 decimals; never `parseFloat` blindly |
| Variance exactly at tolerance boundary | Use `>` not `>=` and document it in the policy test |
| Safe drop during count | Freeze movements during count; post after |
| Manager approves their own variance | Forbidden above threshold; require a second approver |
| Device clock wrong at close | Use server time for `closed_at`; keep device time as `occurred_at` |

## Security

- Cash operations are high-risk: permissions `shift.open`, `shift.close`, `shift.cash_in`,
  `shift.cash_out`, `shift.safe_drop`, `shift.variance.approve`, `shift.zreport.reprint`.
- Separation of duties: close vs approve, refund vs approve refund.
- Blind counts must be blind in the UI and the API (do not ship expected cash to the client before
  the count is submitted).
- Every Z-report reprint is audited with reason; reprints are watermarked.
- Cash movement notes are free text — sanitise, cap length, and never interpolate into SQL/logs raw.
- Rate-limit and alert on repeated failed logins at a drawer.
- CCTV/POS correlation timestamps must share the server clock offset policy.

## Error handling

| Code | Meaning | Action |
| --- | --- | --- |
| `SHIFT_ALREADY_OPEN` | Drawer already has a shift | Handover or close |
| `SHIFT_NOT_OPEN` | No active shift | Open a shift |
| `SHIFT_PENDING_PAYMENTS` | Unresolved tenders | Resolve, cancel or park |
| `SHIFT_OPEN_DRAFT_SALES` | Idle drafts | Abandon with reason |
| `SHIFT_VARIANCE_REQUIRES_APPROVAL` | Over threshold | Manager approval |
| `SHIFT_ALREADY_CLOSED` | Replay of close | Return the stored Z-report |
| `SHIFT_COUNT_INVALID` | Bad denominations | Recount |
| `SHIFT_ZREPORT_UNAVAILABLE` | Snapshot missing | Escalate; do not recompute |

Failures must never half-close: the transaction writes the Z-report, the shift state and the outbox
together.

## Testing requirements

- Property test: for random sequences of sales, refunds and cash movements,
  `expected_cash = float + Σsigned movements` and the close variance equals counted − expected.
- Golden Z-report test: fixed fixture produces an exact snapshot (byte-stable render).
- Idempotent close: double submit → one Z-report.
- Concurrency: two closes on one shift → exactly one succeeds; two shifts on one drawer → one fails.
- Variance policy boundaries: below, equal, above tolerance.
- Offline: close while offline persists; sync later attaches sales correctly or amends per policy.
- Denomination parsing: `0.25`, `1,000`, Thai digits, empty, negative.
- Authorization: cashier cannot approve own variance; reprint requires permission.
- Performance: close with 500 sales under 2 s.

## Anti-patterns

- Editing a sale or deleting a cash movement to remove a variance.
- Showing expected cash before the blind count is submitted.
- Letting a sale complete without a shift.
- One shared cashier login per store.
- Treating safe drops as expenses or bank deposits as drawer movements.
- Recomputing a closed Z-report after a catalog or tax change.
- Assigning late offline sales to the current shift.
- Allowing manager self-approval of large variances.
- Quietly writing off differences into rounding.
- Using floats for cash amounts or parsing currency with `parseFloat`.

## Cross-skill references

Sale completion and refund documents: `pos-sales-checkout`. Card/QR confirmation and settlement:
`pos-payment-reconciliation`. Money contract and audit rules: `pos-domain-expert`. Offline queue:
`pos-offline-sync-engine`. Drawer hardware and printer: `pos-hardware-integration`. Thai receipt/tax
fields: `pos-thailand-commerce`. Retention of Z-reports: `pos-backup-recovery`.
