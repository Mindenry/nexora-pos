---
name: pos-inventory-management
description: >
  Designs and debugs POS stock control as an append-only ledger: movements and reasons, stock on hand
  per location, weighted-average and FIFO costing, transfers, stocktake/cycle count, recipes and BOMs,
  lot/expiry, negative-stock policy, reorder points and shrinkage. Use for "stock is wrong", overselling,
  stocktake variance, transfer mismatch, cost of goods, "official stock", สต๊อกไม่ตรง, or inventory
  audit queries. Not for sale totals (pos-sales-checkout), margin dashboards
  (pos-profit-intelligence), or backup of inventory data (pos-backup-recovery).
---

# POS inventory management

Stock is a **ledger**, not a number. A product row may cache `on_hand`, but the truth is the sum of
immutable movements. Every discrepancy must be explainable by a reason-coded entry, because the
difference between book stock and shelf stock is either a documented event or theft.

## When to use

- Adding or changing stock behaviour: receiving, selling, returning, adjusting, transferring.
- Building stocktake/cycle count, costing, reorder or expiry features.
- Investigating "we have 3 but the system says 0", overselling, or negative stock.
- Designing multi-location stock (store floor, backroom, warehouse, damaged, in-transit).
- Auditing shrinkage or proving inventory value for accounting.

**Not this skill:** the sale totals and receipt (`pos-sales-checkout`); margin or ABC analysis
(`pos-profit-intelligence`); per-tenant isolation mechanics (`pos-multi-tenant-saas`).

## Model

```text
location (store floor | backroom | warehouse | damaged | in_transit | virtual)
variant  ──* stock_movement ──* stock_balance (materialised)
                 │
                 ├─ reason_code, qty_delta_milli, unit_cost, total_cost
                 ├─ source (sale | refund | receipt | adjustment | transfer | stocktake | recipe | writeoff)
                 └─ reverses_movement_id (nullable)
```

`qty_milli` (1000 = one unit) supports weighed goods, liquids and partial packs without floats.
Money is integer satang.

### Reason codes are a closed set

| Reason | Direction | Notes |
| --- | --- | --- |
| `sale` | − | From completed sale line; never from a draft |
| `sale_refund_restock` | + | Only sellable returns |
| `refund_damaged` | + into `damaged` | Returned but not sellable; never back to sellable stock |
| `purchase_receipt` | + | Supplier delivery, captures unit cost |
| `purchase_return` | − | Back to supplier |
| `transfer_out` / `transfer_in` | − / + | Paired, with in-transit in between |
| `stocktake_gain` / `stocktake_loss` | + / − | Count-driven, approver required |
| `adjustment` | ± | Manual, reason text required |
| `recipe_consumption` | − | Ingredient usage from a sold bundle/combo |
| `recipe_production` | + | Prepared item produced from ingredients |
| `writeoff_expiry` / `writeoff_damage` | − | Batch-aware |
| `theft_suspected` | − | Flags investigation, not proof |
| `initial_load` | + | Opening balance at go-live, once per location |

No free-text-only adjustments: reject `reason = 'other'` without `reason_note` and an approver.

## Invariants

1. `on_hand(location, variant) = Σ qty_delta_milli` over all movements, always. Any cached balance
   must be reconcilable to this sum; a nightly job asserts it and alerts on drift.
2. Movements are immutable. Corrections are reversing movements linked by `reverses_movement_id`.
3. Every movement has `tenant_id`, `store_id`, `location_id`, `variant_id`, `occurred_at`,
   `received_at`, `source_type`, `source_id`, `created_by`, `operation_id`.
4. A movement from a business document uses that document's ID as `source_id`; one document cannot
   post twice (unique index on `(tenant_id, source_type, source_id, variant_id, reason_code)` where
   appropriate).
5. Cost is stored on the movement at the time of the event, so historical COGS never changes.
6. Negative on-hand is a **policy decision**, not an accident: allow-with-flag for retail floor,
   forbid for warehouse/regulated goods, and always report.

## Costing

Weighted average is the default for retail; FIFO/lot for serialised, perishable or high-value goods.

```text
on receipt:
  new_qty   = on_hand + qty_in
  new_value = on_hand_value + (qty_in * unit_cost) + landed_costs
  new_avg   = round(new_value / new_qty)        # keep value as the stored truth, not avg × qty

on issue (sale/writeoff):
  unit_cost_at_issue = current_avg               # snapshot into the movement
  value_out          = round(qty_out * unit_cost_at_issue)
```

Store `qty_milli` and `value_satang` on the ledger aggregate, derive `avg_cost` for display. Never
recompute historical COGS from today's average: it silently restates past margins and tax filings.

Landed cost (freight, duty) is allocated at receipt, proportionally by value, and included in the
receipt movement; do not book it as a separate expense if you need true margin.

## Workflow: add or repair stock control

1. **Inventory the current writes.** Grep every place that changes stock: sale completion, refund,
   receiving, manual edit, import, sync. Any `UPDATE product SET qty` is a defect.
2. **Define locations** and which are sellable. The sales module may only deduct from a sellable
   location.
3. **Create the movement table** with the columns above, append-only grants, and indexes on
   `(tenant_id, location_id, variant_id, occurred_at)`.
4. **Add `stock_balance`** as a materialised projection maintained in the same transaction as the
   movement insert (or by a trigger), with a reconciliation query.
5. **Route each business event** through one `post_movement()` function that validates reason,
   direction, permission and idempotency.
6. **Backfill** with a single `initial_load` movement per location/variant; never fabricate history.
7. **Implement stocktake** as a count document that produces `stocktake_gain/loss` movements on
   approval, never as direct balance writes.
8. **Schedule** the drift check, low-stock report and expiry report; alert, don't auto-fix.

## Transfers

Two-phase, with in-transit as a real location:

```text
draft → dispatched (out from source, into in_transit) → received (out of in_transit, into target)
      ↘ cancelled (only before dispatch)
      ↘ short_received (received qty < dispatched; variance movement + investigation)
```

- Never decrement source and increment target in one step across unreliable networks: a lost
  response creates phantom stock.
- Each leg is idempotent with its own `operation_id`.
- Variance beyond tolerance requires an approver and a reason; shrinkage in transit is a real cost.
- Value moves with the goods at the dispatch cost.

## Stocktake & cycle count

1. Freeze the scope (location, category, or ABC class) — or accept movement during count and record
   the count timestamp, then reconcile against movements after that timestamp. Freezing an entire
   store during trading hours is usually wrong; count by zone.
2. Capture `counted_qty` per variant/batch, blind (the counter does not see book stock).
3. Compute variance = counted − book-at-count-time. Recount variances above threshold.
4. Approve → generate one movement per variance with `stocktake_gain`/`stocktake_loss`, approver ID
   and count document link.
5. Report value impact at current average cost; post to a shrinkage account.
6. Never allow "set stock to N" without a movement; that is the classic audit failure.

## Recipes, bundles and combos

- A recipe/BOM defines component quantities per produced unit (with yield and waste %).
- Selling a bundle deducts components, not the bundle SKU (or deducts the bundle and posts a
  production movement — pick one and document it).
- Prepared food: `recipe_production` consumes ingredients and creates the sellable prepared item,
  with a batch and expiry. Selling it then deducts the prepared item.
- Modifiers that change ingredients must change the BOM resolution at sale time; snapshot the
  resolved components on the movement so reprints and cost stay correct.
- Cost of a bundle = Σ component cost at production/issue time, not menu price.

## Batch, lot and expiry

- Track `lot_id`, `expiry_date` on receipt; issue FEFO (first-expired-first-out) by default.
- Movements reference the lot for tracked variants; untracked variants keep `lot_id = null`.
- Expiry job proposes `writeoff_expiry` movements; a human approves value above threshold.
- Recall = query all movements for a lot, list affected sales and customers (via loyalty link).
- Never mix lots in one balance without lot-level rows; "average expiry" is not a thing.

## Business rules

- Selling below zero: allowed only per policy; completion still succeeds (never block a paid
  customer), and the sale is flagged `oversold` for investigation.
- Stock is per `(location, variant)`; "store stock" is a sum over sellable locations, explicitly.
- Reservations (online order, held item) are **not** movements. Model `reservation` separately and
  convert on fulfilment or expiry. Mixing them corrupts on-hand.
- Returns restock only sellable goods; damaged/expired go to their own location with a reason.
- Internal consumption (staff meal, samples) is a movement with reason and approver.
- Unit conversions (box → each) are defined on the variant and applied deterministically; never
  round a conversion silently.
- Reorder point = demand during lead time + safety stock, computed from a rolling window and
  reviewed, not hard-coded per product forever.

## Edge cases

| Case | Handling |
| --- | --- |
| Two devices sell the last unit offline | Both complete; server accepts negative and flags; owner decides policy |
| Partial receipt vs PO | Receive actual, keep open balance; do not auto-close the PO |
| Transfer lost in transit | In-transit is visible; a timeout job flags it, never auto-receives |
| Refund of a sale from another store | Restock at the returning store with `cross_store_refund` reason; do not credit the origin store's ledger |
| Unit cost changes mid-period | New receipts change the average; historical movements keep their snapshot |
| Stocktake during a sale | Use count timestamp; exclude movements after it, or recount the zone |
| Ingredient sold as a standalone item | Same variant, same ledger; BOM only applies to the bundle path |
| Zero cost item (donation, promo) | Allowed, but margin reports must exclude rather than divide by zero |
| Duplicate sync of a sale | Idempotency on `operation_id` prevents a second deduction |
| Negative quantity on a return | Represent as positive movement with `sale_refund_restock`, not a negative-of-negative |

## Security

- Separate permissions: `inventory.read`, `inventory.adjust`, `inventory.stocktake`, `inventory.transfer`,
  `inventory.cost.read`. Cost is commercially sensitive.
- Adjustments above value/qty thresholds need a second approver; record both actors.
- Append-only grants at the database level (`INSERT` only for the app role on the movement table).
- Tenant and store scoping in the query layer plus RLS; a store manager sees their stores only.
- Exports (CSV) are audited and rate-limited; they leak supplier costs and shrinkage.
- Never trust a client-sent `location_id` without checking the actor's scope.

## Error handling

| Code | Meaning | Action |
| --- | --- | --- |
| `STOCK_INSUFFICIENT` | Policy forbids negative | Block the operation, show available |
| `STOCK_NEGATIVE_FLAGGED` | Allowed but flagged | Complete, create investigation task |
| `STOCK_MOVEMENT_DUPLICATE` | Same source posted twice | Return existing movement |
| `STOCK_LOCATION_NOT_SELLABLE` | Wrong location | Choose a sellable location |
| `STOCK_COST_MISSING` | No cost basis for issue | Use last known cost, flag for finance |
| `STOCK_TRANSFER_STATE_INVALID` | Illegal leg | Reload transfer |
| `STOCK_COUNT_ALREADY_APPROVED` | Double approval | Show approved document |
| `STOCK_VARIANT_NOT_FOUND` | Bad SKU | Rescan |

Failed postings must roll back the whole business document transaction; a sale that commits but
fails to deduct stock is worse than a sale that fails loudly.

## Testing requirements

- Property test: after any sequence of movements, `on_hand = Σ qty_delta` and `value ≥ 0`.
- Golden costing tests for receipt/issue/return/adjustment sequences, including landed cost.
- Idempotency: replay each source event; exactly one movement.
- Transfer state machine table test including cancellation and short receipt.
- Stocktake: count + concurrent sale → variance computed at the right timestamp.
- Concurrency: 50 parallel sales of the same variant do not lose movements or deadlock
  (lock ordering by `variant_id`).
- Cross-tenant isolation test on the movement and balance tables.
- Reconciliation job test: inject a corrupted cache and assert the job detects it.
- Performance: posting a 200-line sale under 100 ms.

## Anti-patterns

- A mutable `qty` column as the source of truth.
- "Set stock" admin actions that write a balance directly.
- Deducting stock when the cart is created rather than when the sale completes.
- Deducting on the device only and never reconciling with the server ledger.
- Recomputing historical COGS with the current average cost.
- Using reservations as movements, or movements as reservations.
- One `adjustment` reason for everything, with no approver.
- Auto-fixing drift by overwriting balances, destroying the evidence.
- Treating in-transit as "already at destination".
- Rounding unit conversions per line item instead of per document.

## Cross-skill references

Sale-to-stock posting: `pos-sales-checkout`. Shrinkage and margin reporting:
`pos-profit-intelligence`. Cost snapshots feed `pos-profit-intelligence`. Offline posting order and
conflicts: `pos-offline-sync-engine`. Tenant scoping: `pos-multi-tenant-saas`. Backups of the ledger:
`pos-backup-recovery`. Batch/expiry and barcode label formats: `pos-hardware-integration`.
