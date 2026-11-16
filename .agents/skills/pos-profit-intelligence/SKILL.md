---
name: pos-profit-intelligence
description: >
  Turns POS transactions into trustworthy profit and performance metrics: COGS from the inventory
  ledger, gross margin by item/category/store, basket analysis, ABC and dead stock, promo ROI,
  shrinkage, staff and hour performance, and metric contracts that reconcile to accounting. Use for
  "margin report", "best sellers", "why is profit down", "COGS wrong", "basket analysis", กำไร,
  ต้นทุนขาย, or dashboard definitions. Not for changing stock (pos-inventory-management) or
  statutory VAT filings (pos-thailand-commerce).
---

# POS profit intelligence

Most POS "profit" reports are wrong in the same three ways: they use the wrong COGS, they mix
business dates and calendar dates, and they ignore returns. This skill defines metrics precisely
enough to be tested, and treats every number as a contract with an owner and a reconciliation.

## When to use

- Defining or debugging margin, COGS, basket, promo or shrinkage metrics.
- Building dashboards for owners, store managers or finance.
- Answering "which products/stores/hours make money".
- Investigating a margin that moved without a price change.
- Designing data models for analytics without slowing checkout.

**Not this skill:** posting stock movements (`pos-inventory-management`); producing tax invoices or
VAT returns (`pos-thailand-commerce`); loyalty programme mechanics
(`pos-customer-loyalty`); infrastructure for backups (`pos-backup-recovery`).

## Metric contracts (write these down)

Every metric needs: definition, grain, source tables, filters, time basis, inclusion of returns and
tax, currency, owner, and a reconciliation target.

| Metric | Definition | Grain | Notes |
| --- | --- | --- | --- |
| Gross sales | Σ line gross before discounts, incl. VAT | line/day/store | Excludes voided/abandoned |
| Net sales | Σ line net after discounts, incl. VAT | line/day/store | The top line for most ops reports |
| Revenue (ex-VAT) | Net sales − output VAT | line/day/store | Use for margin and P&L |
| COGS | Σ `qty × unit_cost_at_issue` from stock movements | line/day/store | Never recompute with today's cost |
| Gross profit | Revenue ex-VAT − COGS | line/day/store | Service charge allocated per policy |
| Gross margin % | Gross profit ÷ Revenue ex-VAT | aggregate | Undefined when revenue = 0; show `—`, not 0% |
| Basket size | Items per completed sale | sale | Refunds counted on their own sale |
| ATV (average transaction value) | Net sales ÷ completed sales | store/day | State whether ex-VAT |
| Items per basket | Σ qty ÷ completed sales | store/day | Fractional; don't round to int |
| Sell-through | Units sold ÷ (opening + received) | variant/period | Define the window |
| Shrinkage | Book stock − counted stock at cost | location/period | Only from approved counts |
| Promo uplift | Sales during promo vs baseline | campaign | Baseline method must be stated |
| Points liability | Outstanding points × redemption value | tenant/month | Finance-owned |

Rules:

1. **Use `business_date`, not `created_at::date`.** A sale at 00:30 belongs to the trading day the
   store defines, in `Asia/Bangkok`.
2. **Refunds are negative revenue in the period they occur**, not a retroactive edit of the original
   period. Show both "as sold" and "as adjusted" if finance needs it.
3. **Ex-VAT for margin, incl-VAT for cashier-facing totals.** Never mix them in one table without
   labelling.
4. **Zero revenue must not produce 0% margin**; it produces "undefined" and is excluded from averages.
5. **Rounding happens once**, at the presentation layer; aggregates carry integer satang.
6. **Attribution is explicit**: a sale belongs to the store, shift, cashier and device that completed
   it, even if a different store fulfils a return.

## COGS: the only correct source

```sql
-- margin by variant for a period, using movement snapshots
with sold as (
  select m.tenant_id, m.store_id, m.variant_id,
         sum(m.qty_delta_milli)            as qty_sold_milli,   -- negative for sales
         sum(m.qty_delta_milli * m.unit_cost) as cogs_satang
  from   stock_movement m
  where  m.tenant_id = $1
    and  m.reason_code in ('sale','sale_refund_restock','refund_damaged')
    and  m.business_date between $2 and $3
  group  by 1,2,3
)
select variant_id,
       -sum(qty_sold_milli)      as units_milli,
       -sum(cogs_satang)         as cogs_satang
from   sold
group  by variant_id;
```

Why this and not `sale_line.unit_cost`: the movement is the accounting event, it includes returns and
write-offs, and its cost was frozen at issue. If you compute margin from `sale_line` joined to
`product.cost`, every cost update silently rewrites history.

Reconciliation gate: for a closed period, `Σ movement COGS` must equal the inventory subledger change
posted to accounting, within a documented tolerance (ideally zero). If it does not, the report is
not trusted until explained.

## Basket analysis

- **Market-basket rules** need support, confidence and lift, computed over completed sales with at
  least two lines, excluding returns:
  `support(A→B) = n(A∧B)/N`, `confidence = n(A∧B)/n(A)`, `lift = confidence/P(B)`.
- Use item pairs at the variant level for assortment, category level for merchandising.
- Minimum support threshold matters: with 5,000 baskets, pairs under ~0.1% support are noise.
- Exclude items that are always together by construction (combo components) or you rediscover the
  recipe.
- Segment by store format and daypart; chain-wide rules hide local behaviour.
- Report confidence intervals or at least sample sizes; a 3-basket pair is not an insight.

## Assortment and inventory metrics

- **ABC classification** by revenue contribution (A ≈ 80%, B ≈ 15%, C ≈ 5%), recomputed quarterly;
  state the grain (variant per store, not tenant-wide).
- **GMROI** = gross margin ÷ average inventory at cost. Better than margin % for shelf-space
  decisions.
- **Weeks of cover** = on hand ÷ average weekly units sold; use median to resist promo spikes.
- **Dead stock** = no sale in N days AND positive on hand; N by category (fresh vs hard goods).
- **Sell-through** must state the window and whether received stock is included.
- **Shrinkage rate** = shrinkage at cost ÷ net sales at cost, per period, per store. Small
  denominators produce meaningless percentages.
- **Stock accuracy** = 1 − |book − counted| ÷ counted, measured from cycle counts, not from a
  one-off annual stocktake.

## Promotions and discounts

Evaluate a promotion against a **pre-period baseline** and, where possible, a control store:

```text
uplift_units   = promo_units − expected_units(baseline)
incremental_gp = uplift_units × unit_gross_profit_after_promo
promo_cost     = discount_given + fixed_costs + cannibalisation_estimate
roi            = incremental_gp ÷ promo_cost
```

- Separate **discount depth** from **volume**; a 30% discount that grows units 10% destroys margin.
- Watch pull-forward: measure the week after the promo, not just during it.
- Attribute supplier-funded discounts to the supplier, not to store margin.
- Coupon cost is not the same as discount cost when redemption is incremental vs would-have-bought.
- Loyalty redemption is a liability settlement, not a discount; keep it out of promo ROI.

## Data model for analytics

Keep OLTP clean and build projections:

```text
fact_sale_line(tenant_id, business_date, store_id, sale_id, line_no, variant_id,
               qty_milli, gross_satang, discount_satang, net_satang, vat_satang,
               cogs_satang, cashier_id, shift_id, channel)
fact_payment(tenant_id, business_date, store_id, payment_id, method, amount_satang,
             fee_satang, state, settled_date)
fact_stock_day(tenant_id, business_date, location_id, variant_id,
               opening_qty_milli, received_qty_milli, sold_qty_milli,
               adjusted_qty_milli, closing_qty_milli, closing_value_satang)
dim_variant, dim_store, dim_staff, dim_campaign (SCD-2 where history matters)
```

- Rebuild facts from immutable source events; make the pipeline idempotent per business date and
  tenant.
- Late-arriving offline sales must update the affected day and re-run dependent aggregates; publish
  a `data_version` so dashboards can show freshness.
- Never let a dashboard query the OLTP primary during trading hours.
- Store both `occurred_at` and `received_at` so "as of" restatements are explainable.

## Workflow: build or fix a profit report

1. **Interview the consumer**: what decision does this number drive? If none, don't build it.
2. **Write the metric contract** (definition, grain, filters, time basis, owner, reconciliation).
3. **Locate the source of truth** for each input; reject any metric that needs an editable table.
4. **Model the fact table** at the finest grain you will ever need (line, day, store).
5. **Implement COGS from movements**, not from catalog cost.
6. **Handle returns, voids, rounding, service charge and tax explicitly.**
7. **Reconcile to accounting** for a closed month: revenue, VAT, COGS, payments, cash.
8. **Add data-quality checks**: orphan sale lines, negative revenue, missing cost, duplicate facts,
   timezone gaps, sales outside an open shift.
9. **Publish with freshness and definitions** visible in the UI.
10. **Test with a hand-computed fixture** of 10 sales covering discounts, returns, mixed tax, weighed
    goods and a cross-store refund.

## Business rules

- Reports read only completed, non-voided sales unless explicitly labelled.
- A refund reduces revenue and COGS in the refund period; the original period stays as filed.
- Discounts reduce revenue; they are not expenses. Supplier funding is a receivable/contra-COGS per
  accounting policy.
- Service charge revenue is allocated to the P&L line finance chooses; margin reports must state it.
- Payment fees are a cost of the payment method, reported separately from gross margin and included
  in net contribution.
- Cash rounding is a rounding line, never a discount or a sale.
- Staff meals/internal consumption reduce stock and are a cost, not a sale.
- Inter-store transfers do not create revenue.
- Currency is THB; any FX is documented, with rates stored per transaction.
- A metric with a changed definition gets a new version, not a silent edit.

## Edge cases

| Case | Handling |
| --- | --- |
| Sale at 23:58 synced next day | Attribute to `business_date` from `occurred_at`; show freshness |
| COGS missing for a variant | Use last known cost and flag; exclude from margin averages until fixed |
| Negative stock at period end | Value at last cost, flag; do not invent cost |
| Return of a sale from last month | Negative revenue this month; disclose restatement in the report |
| Zero-revenue day | Margin undefined, not 0% |
| Weighed goods | Use `qty_milli`; do not round units before aggregation |
| Discount 100% line | Revenue 0, COGS positive → negative margin; show it |
| Service charge varies by channel | Split by channel, never blend |
| Gift card sale | Liability, not revenue, until redeemed |
| Tenant with two brands | Segment by brand/tenant config; do not blend margins |

## Security and privacy

- Row-level scoping by tenant and store; cost and margin are sensitive — `reports.financial.read`.
- Staff performance reports are personal data: restrict, aggregate where possible, and never expose
  individual rankings in a shared dashboard without policy.
- Exports are audited, watermarked, expiring links; no raw customer identifiers in analytics marts.
- Aggregate or pseudonymise customer-level analysis; keep consent scope in mind.
- Protect against inference: small-count suppression for sensitive segments.

## Error handling

| Code | Meaning | Action |
| --- | --- | --- |
| `REPORT_COST_MISSING` | No cost basis | Flag rows, show coverage %, alert |
| `REPORT_RECONCILIATION_FAILED` | Subledger ≠ accounting | Block publication of the period |
| `REPORT_LATE_DATA` | Offline sales arrived | Recompute day, bump `data_version` |
| `REPORT_PERIOD_OPEN` | Period not closed | Show provisional watermark |
| `REPORT_TENANT_MISMATCH` | Cross-tenant row detected | Drop, alert security |
| `REPORT_FACT_DUPLICATE` | Idempotency failure | Deduplicate, investigate pipeline |

Never show a confident number when the pipeline is degraded; show "provisional" with the reason.

## Testing requirements

- Hand-computed fixture: 10 sales with discounts, returns, tax-inclusive prices, weighed items, a
  cross-store refund; assert every metric to the satang.
- Reconciliation test: margin report vs general ledger for a closed month.
- Timezone/business-date boundaries including 00:00, DST-free `Asia/Bangkok`, month end.
- Idempotent pipeline: rebuild twice → identical facts.
- Late-data test: insert a sale for a past date, re-run, verify aggregates and freshness.
- Basket rule test against a known synthetic dataset with expected support/lift.
- ABC thresholds and tie-breaking determinism.
- Performance: 12 months of 1M lines aggregated under 5 s from the warehouse.
- Isolation: tenant A report never includes tenant B rows.

## Anti-patterns

- Computing COGS from current catalog cost.
- Reporting on `created_at` dates instead of `business_date`.
- Ignoring refunds, voids, or the fact that refunds belong to a later period.
- Blending VAT-inclusive and exclusive numbers in one margin table.
- Showing 0% margin for zero revenue.
- Averages over tiny samples presented as trends.
- One dashboard for all store formats.
- Querying OLTP live for month-end reports.
- Editing historical facts to "correct" a report instead of fixing the pipeline.
- Treating a supplier-funded discount as store margin.

## Cross-skill references

Movement and cost snapshots: `pos-inventory-management`. Revenue definition and receipts:
`pos-sales-checkout`. Payment fees and settlement: `pos-payment-reconciliation`. VAT split:
`pos-thailand-commerce`. Business date and audit invariants: `pos-domain-expert`. Analytics tenancy:
`pos-multi-tenant-saas`. Data durability: `pos-backup-recovery`.
