---
name: pos-customer-loyalty
description: >
  Builds POS loyalty: member identity and lookup, points earn/burn/expire as an append-only ledger,
  tiers and benefits, coupons and vouchers, accrual and redemption at checkout, reversal on refund,
  points liability, and consent/PDPA. Use for "points not added", "member discount", "redeem points",
  tier upgrade, coupon abuse, สมาชิก, แต้มสะสม, or loyalty fraud. Not for generic CRM/marketing
  automation or payment settlement (pos-payment-reconciliation).
---

# POS customer loyalty

Loyalty is a **second currency** issued by the merchant. Points have a cost, an expiry, a liability
on the balance sheet and a fraud surface. Treat the points ledger with the same seriousness as the
cash drawer, and treat member data with the same seriousness as payment data.

## When to use

- Designing member lookup, enrolment, tiers or benefits at the till.
- Points accrual, redemption, expiry, adjustment or migration.
- Coupons, vouchers, gift cards used as tender, or promotions tied to identity.
- Investigating missing/duplicate points, tier errors or coupon abuse.
- Refund/void interactions with points and vouchers.

**Not this skill:** order pricing arithmetic in general (`pos-sales-checkout`); payment capture and
refunds (`pos-payment-reconciliation`); VAT treatment of discounts (`pos-thailand-commerce`); PDPA
programme duties (`pos-thailand-commerce`, `pos-multi-tenant-saas`).

## Model

```text
customer ──* membership ──* points_entry (append-only)
    │                          ├─ type: earn | redeem | expire | adjust | reverse | migrate
    │                          ├─ points_delta (signed integer)
    │                          ├─ source (sale | refund | campaign | manual | expiry_job)
    │                          └─ expires_at (for earn lots)
    └─* coupon_issue ──* coupon_redemption ──* sale
```

Use **integer points** (or integer milli-points if you must support fractional accrual; decide once).
Never float. A points balance is `Σ points_delta`; a cached balance is a projection with a
reconciliation job.

## Points as lots (the part that is usually wrong)

If points expire, you cannot store one balance. Store **earn lots** with `expires_at` and consume
oldest-first (FIFO) on redemption.

```text
earn(sale S): +120 points, expires_at = S.business_date + 12 months
redeem(100):  consume from oldest non-expired lot; write one redeem entry per lot consumed
expire(job):  for each lot with remaining > 0 and expires_at <= today, write an expire entry
refund(sale S): reverse the earn entries of S that are still unspent; never create a negative balance
```

Rules:

- Redemption consumes lots FIFO. Record the lot breakdown so a later refund can reverse precisely.
- Expiry runs daily in the tenant's timezone, is idempotent per lot per day, and is auditable.
- Reversing an earn that was already spent: create a debt/adjustment entry and flag the member,
  rather than allowing a negative spendable balance. Policy decides whether the debt blocks future
  redemption.
- A points entry is immutable; corrections are new entries with `reverses_entry_id`.

## Accrual rules

Accrual must be **deterministic, explainable and snapshot at sale time**.

```text
base        = eligible spend (usually net excluding VAT, excluding gift cards, excluding taxes/fees)
rate        = tier rate or campaign rate, effective-dated
points      = floor(base / earn_unit) * points_per_unit        // or floor(base * rate)
exclusions  = tobacco, alcohol, gift cards, delivery fees, service charge, already-discounted lines
rounding    = floor at document level, once
```

- Store the rule ID/version and the computed base on the sale, so "why did I get 87 points?" is
  answerable a year later.
- Never accrue on a `pending` sale; accrue on completion, in the same transaction or via a durable
  outbox event with idempotency.
- Accrual must be idempotent by `(tenant_id, sale_id)` — offline replay must not double-award.
- Tier multipliers apply to the rate, not to already-awarded points.
- Campaign bonuses are separate entries with their own expiry and funding source.

## Redemption at checkout

1. Identify the member (phone, card, QR, or search) with a fast, rate-limited lookup.
2. Show spendable balance and the **cash value** of points (e.g. 100 points = ฿1) before applying.
3. Redemption is a **tender-like discount** with a cap: cannot exceed the payable amount, cannot
   create cash change, and cannot be combined with excluded promotions.
4. Reserve points at tender start, commit on sale completion, release on abandon/timeout. A
   reservation is not a ledger entry; the commit is.
5. Record `points_used`, `cash_value`, `lot_breakdown`, and the resulting payable amount on the sale.
6. If the sale fails after reservation, release within the timeout; never leave points held forever.

Typical Thai programme values (configure per tenant, do not hard-code): ฿25 spent = 1 point,
100 points = ฿1, 12-month expiry, tiers at annual spend thresholds.

## Tiers

- Tier is derived from a rolling 12-month eligible spend (or lifetime, per programme) and
  recalculated by a scheduled job; store `tier_at` and `tier_valid_until`.
- Never downgrade mid-visit based on a partial period in a way that surprises the customer; apply at
  the next evaluation date and show the date.
- Tier benefits (multiplier, free shipping, birthday reward) are configuration with effective dates.
- Manual tier overrides need permission, reason and expiry; they are a common abuse vector.
- A tier change does not retroactively change past accrual.

## Coupons, vouchers and gift cards

| Instrument | Nature | Accounting | Key control |
| --- | --- | --- | --- |
| Coupon (percent/amount) | Price reduction | Contra-revenue / marketing expense | Single use, campaign budget, stacking rules |
| Voucher (fixed value) | Tender | Liability until redeemed | Unique code, expiry, redeem-once |
| Gift card | Stored-value tender | Liability, breakage policy | Activation, balance ledger, no cash-out |
| Member price | Price list variant | Revenue reduction | Eligibility check, not a coupon |

Rules:

- Every code is unique, hashed at rest, and validated server-side; never trust a client-sent discount.
- Redemption is idempotent by `(code, sale_id)`; replaying a sync must not double-redeem.
- Stacking policy is explicit and enforced in one place: max one order-level coupon + one line-level
  promotion unless a campaign declares compatibility.
- Vouchers/gift cards are tenders, not discounts, and must not reduce VAT base the way a discount
  does; consult the accountant (`pos-thailand-commerce`).
- Coupon abuse controls: per-member limits, per-device limits, velocity limits, employee exclusion,
  and a fraud review queue for anomalies.
- Expired instruments must fail closed with a clear message; no manual override without approval.

## Refunds and voids

- Refund reverses points earned on the refunded portion, proportionally to the refunded lines.
- If the customer already spent the points, create a debt entry and follow policy; do not silently
  allow a negative spendable balance.
- Points used as payment are returned to the member on a full refund (re-issue as a new lot with a
  fresh expiry, or restore the original lots — pick one and document it).
- Coupons: a full refund may reissue the coupon once with the original expiry; a partial refund
  usually does not. Encode the policy per campaign.
- Never reverse by editing the original entries; always append.
- Refund of a sale from another store/brand must still reverse the correct member's points.

## Consent and privacy

- Enrolment captures consent for the programme and **separate** consent for marketing; record version,
  timestamp, channel and language.
- Phone number is the usual identifier in Thailand: normalise to E.164 (`+66…`), validate, and treat
  as personal data. Do not print it in full on receipts by default.
- Provide access, correction, withdrawal and deletion paths; deletion is limited by tax retention of
  the underlying transactions.
- Do not share member data across tenants. A franchise group is multiple tenants unless the customer
  consented to a shared programme — model that explicitly.
- Staff can see only what the task needs; bulk export is a privileged, audited action.
- Never use loyalty data to price-discriminate in ways the programme terms do not disclose.

## Workflow: implement loyalty on an existing POS

1. **Define the programme contract**: earn base, rate, rounding, expiry, tiers, redemption value,
   caps, exclusions, refund policy, coupon stacking. Write it as a spec with examples.
2. **Create the ledger** (`points_entry`, `coupon_issue`, `coupon_redemption`) with tenant-leading
   keys, immutability and idempotency.
3. **Wire completion**: on sale completion, emit one loyalty command with `operation_id`; the handler
   writes earn lots and any campaign bonus in one transaction.
4. **Wire redemption**: reserve → commit/release around the tender lifecycle.
5. **Wire refunds**: proportional reversal + debt handling.
6. **Build the balance projection** and a nightly reconciliation against the ledger.
7. **Add expiry and tier jobs** with idempotency, timezone correctness and audit.
8. **Add anti-fraud dashboards**: same-phone velocity, employee-linked accounts, coupon redemption
   spikes, manual adjustments.
9. **Test offline**: earn and redeem without network, replay without duplication.

## Business rules

- Points are not money: no cash-out, no transfer between members unless the programme says so.
- Balance cannot go below zero for spendable points; debt is tracked separately.
- Accrual and redemption are per member per sale; one sale cannot split earn across two members.
- A member can be attached after the sale within a configured window (e.g. same day) to earn points,
  with an audit record; the rule must be explicit to prevent receipt harvesting.
- Employee purchases may accrue but cannot redeem staff-only bonuses; define and enforce.
- Points expire silently only if terms allow; otherwise notify before expiry.
- Manual adjustments require permission, reason, cap and dual control above a threshold.
- Points liability is reported monthly at redemption cost, not at face value of the currency.

## Edge cases

| Case | Handling |
| --- | --- |
| Offline sale with unknown member | Store member reference locally; accrue on sync; if unresolvable, park for review |
| Duplicate sync of the same sale | `(sale_id)` idempotency prevents double earn |
| Member redeems more than payable | Cap at payable; do not issue change |
| Partial refund where some points already spent | Proportional reversal + debt entry |
| Points expire during an open cart | Re-validate at commit; show updated balance |
| Two tills redeem the last points simultaneously | Atomic lot consumption with row locks; second fails cleanly |
| Phone number shared by family | Programme policy; allow aliases, flag unusual velocity |
| Member merged (duplicate accounts) | Merge ledger with a `migrate` entry; never delete history |
| Coupon code leaked publicly | Budget cap + velocity limits + revoke; honour already-redeemed |
| Tier downgrade after return | Recompute at period end, not instantly on refund |

## Security

- Rate-limit lookup by phone to prevent enumeration; require partial match plus verification for
  sensitive actions.
- Never expose a member's full history to a cashier; show balance, tier and recent activity.
- Hash coupon/voucher codes at rest; display once at issue.
- Enforce campaign budgets server-side with atomic counters, not a nightly recalculation.
- Audit every manual adjustment, tier override, merge and export.
- Watch for collusion: staff awarding points to their own account, refunding to a different member,
  or repeatedly applying "goodwill" points. Alert, don't just log.
- Encrypt member PII and apply retention; keep marketing consent separable from transaction records.

## Error handling

| Code | Meaning | Action |
| --- | --- | --- |
| `LOYALTY_MEMBER_NOT_FOUND` | Lookup miss | Enrol or continue as guest |
| `LOYALTY_INSUFFICIENT_POINTS` | Balance below request | Reduce redemption |
| `LOYALTY_REDEMPTION_EXCEEDS_PAYABLE` | Over-cap | Cap or reject |
| `LOYALTY_ALREADY_ACCRUED` | Duplicate sale | Return existing entry |
| `LOYALTY_EXPIRED_COUPON` | Expired instrument | Offer alternatives |
| `LOYALTY_COUPON_ALREADY_USED` | Replay | Show original sale |
| `LOYALTY_TIER_CONFIG_MISSING` | Config gap | Treat as base tier; alert |
| `LOYALTY_LEDGER_DRIFT` | Projection ≠ ledger | Freeze adjustments, reconcile, alert |

Loyalty failures must never block a sale; degrade to "points pending" with a visible note.

## Testing requirements

- Ledger property: balance = Σ entries; no spendable negative; lot consumption FIFO and exact.
- Idempotency: replay completion/refund/coupon events 5× → one effect.
- Expiry: timezone boundaries, leap day, partial lot spend, idempotent daily run.
- Redemption: cap at payable, concurrent redemption, reservation timeout release.
- Refund proportionality: 3-line sale, refund 1 line, exact points reversal; spent-points debt path.
- Tier evaluation: rolling window edges, downgrade timing, override expiry.
- Coupon: single use, stacking matrix, budget cap under concurrency, revoke behaviour.
- Offline: earn/redeem queued, resync duplicate-safe, conflict visibility.
- Isolation: member lookup in tenant B cannot find tenant A data.
- Performance: lookup p95 < 150 ms; commit < 100 ms.

## Anti-patterns

- One mutable `points_balance` column with no ledger.
- Floating-point points and cash conversion.
- Awarding points before payment is confirmed.
- Expiring by deleting entries.
- Allowing negative spendable balance without a debt record.
- Trusting a client-sent discount or points value.
- Hard-coding earn rates and redemption value in the app.
- Merging member accounts by deleting one side's history.
- Sharing loyalty data across tenants without consent.
- Blocking checkout on a loyalty service timeout.

## Cross-skill references

Sale completion and refund lines: `pos-sales-checkout`. Tender semantics for vouchers:
`pos-payment-reconciliation`. VAT treatment of discounts and vouchers: `pos-thailand-commerce`.
Offline queueing: `pos-offline-sync-engine`. Tenant isolation and config: `pos-multi-tenant-saas`.
Liability and campaign ROI in reports: `pos-profit-intelligence`.
