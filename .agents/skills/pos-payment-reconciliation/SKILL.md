---
name: pos-payment-reconciliation
description: >
  Owns the money-movement side of POS payments: payment intent lifecycle, gateway abstraction, signed
  webhooks, status polling, QR/PromptPay confirmation boundaries, capture/void/refund at the provider,
  settlement batches, fees, chargebacks, and daily reconciliation. Use for "payment stuck pending",
  "customer paid but sale not completed", duplicate charge, webhook missed, settlement mismatch,
  PromptPay QR, or refund not reaching the customer. Not for cart totals (pos-sales-checkout), Thai tax
  invoice fields (pos-thailand-commerce), or shift cash counts (pos-shift-cash-management).
---

# POS payment & reconciliation

A QR code, a redirect, a printed slip and a "success" screen are all **claims**. Money is confirmed
only by a trusted provider signal you can authenticate. Everything in this skill follows from that.

## When to use

- Integrating a payment gateway, EDC, PromptPay QR, wallet or bank transfer at the till.
- Payment state is stuck, duplicated, partially captured, or shows paid with no money.
- Building daily settlement/reconciliation, fee accounting or chargeback handling.
- Designing refunds that must reach the original instrument.
- Auditing "the POS says ฿12,400 but the bank settled ฿12,180".

**Not this skill:** pricing/tax/discount arithmetic (`pos-sales-checkout`); legal receipt and VAT
obligations (`pos-thailand-commerce`); drawer counts and Z-reports
(`pos-shift-cash-management`); printer/EDC transport details (`pos-hardware-integration`).

## Hard boundary: what is not proof of payment

| Signal | Proof? | Why |
| --- | --- | --- |
| QR generated / displayed | **No** | A request for payment is not a payment |
| Customer shows a slip/screenshot | **No** | Forgeable, replayable, and can be cancelled |
| Browser redirect to `?status=success` | **No** | Client-controlled query string |
| Client-side SDK callback | **No** | Runs in an untrusted environment |
| Provider webhook with valid signature | **Yes**, for the event it describes | Authenticated server-to-server |
| Provider server-to-server status query | **Yes**, when signed/authenticated | The authoritative fallback |
| Bank statement / settlement file | **Yes**, for settlement, later | Best for end-of-day proof |
| Manual attestation by an authorised operator | Conditional | Only with a documented, audited procedure |

Therefore: **never mark a sale paid because a QR was rendered or a slip was shown.** Confirm via
webhook, and reconcile with a signed status query. If neither is available, the tender stays
`pending` or `needs_review` and the sale is not completed.

## Payment state machine

```text
created ──▶ pending ──┬──▶ authorized ──▶ captured ──▶ settled
   │                  │        │              │
   │                  │        └──▶ voided    ├──▶ partially_refunded ──▶ refunded
   │                  ├──▶ failed               └──▶ reversed (chargeback)
   │                  ├──▶ expired
   │                  └──▶ needs_review  ◀── amount/ref mismatch, late webhook
   └──▶ cancelled
```

Rules:

- `captured` requires a provider confirmation event with matching amount, currency and reference.
- `settled` is a **separate** fact from `captured`; it arrives in a settlement batch, often T+1.
- `needs_review` is a first-class state, not an error log. It must be visible to an operator with a
  resolution workflow, and it must never silently become `captured`.
- Terminal states are final; corrections are new events/records.
- Every transition is appended to `payment_event` with raw provider payload hash, signature status,
  actor (`system` or staff ID) and correlation ID.

## Gateway abstraction

Keep the provider behind a narrow port. The domain must not import SDK types.

```ts
interface PaymentProvider {
  readonly id: string;
  createIntent(input: {
    tenantId: string; storeId: string; saleId: string;
    amount: number; currency: 'THB';
    method: 'card_present' | 'qr_promptpay' | 'wallet' | 'bank_transfer';
    reference: string;                 // our idempotency reference
    expiresInSec?: number;
  }): Promise<{ providerRef: string; qrPayload?: string; expiresAt?: string }>;

  getStatus(providerRef: string): Promise<{
    state: 'pending' | 'authorized' | 'captured' | 'failed' | 'expired' | 'cancelled' | 'refunded';
    amount: number; currency: string; paidAt?: string;
    instrument?: { brand?: string; last4?: string };
  }>;

  refund(input: { providerRef: string; amount: number; reason: string; refundRef: string }):
    Promise<{ providerRefundRef: string; state: 'pending' | 'succeeded' | 'failed' }>;

  void?(input: { providerRef: string }): Promise<{ state: 'voided' | 'failed' }>;

  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<{
    valid: boolean; eventId: string; type: string; payload: unknown;
  }>;
}
```

Mapping table per provider (document it, don't guess): their status names → your states, their
amount units (satang vs baht, minor-unit quirks), their idempotency header, their webhook signature
algorithm, their retry/ordering guarantees, their refund window.

## Webhook ingestion

```text
raw request → verify signature over the RAW bytes (not parsed JSON)
            → reject if invalid (401, log, alert)
            → insert into webhook_inbox(event_id unique, provider, raw, received_at)
            → ack 2xx immediately
            → async worker: load payment by providerRef/reference
            → if event older than current state (ordered by provider event time/sequence): ignore
            → apply transition + payment_event + outbox in one transaction
            → if amount/currency/reference mismatch: needs_review, never capture
```

Non-negotiables:

1. **Idempotency**: provider event ID unique index; a redelivered webhook is a no-op.
2. **Verify on raw bytes**; and tolerate header casing and clock skew.
3. **Ack fast**, process asynchronously; a slow handler causes provider retries and duplicates.
4. **Never trust the payload's amount** to set the sale total; compare and flag.
5. **Out-of-order events** are normal. Compare provider timestamps/sequences; a `captured` must not
   be overwritten by a late `pending`.
6. **Unknown references** (payment not yet synced from an offline device) go to a holding table and
   are matched later — do not drop them.
7. **Signature secret rotation** supported with two active secrets.

## Authoritative status query (fallback)

Run a poller for every payment in `pending` older than N seconds, with exponential backoff and a
hard stop (e.g. 15 minutes) that moves it to `needs_review` and notifies the store.

```sql
-- candidates, oldest first, bounded batch
select tenant_id, payment_id, provider_ref
from   payment
where  state = 'pending'
  and  created_at < now() - interval '30 seconds'
  and  next_poll_at <= now()
order  by next_poll_at
limit  100
for update skip locked;
```

Polling is not a substitute for webhooks, and webhooks are not a substitute for daily settlement
matching. Use all three: webhook (fast), poll (safety net), settlement file (truth for payout).

## QR / PromptPay integration boundaries

PromptPay is an overlay on EMVCo QR plus the Thai banking rails. At the POS:

1. Generate the QR from **our** payment intent (or the provider's), bound to `amount`, `reference`
   and an expiry. The QR payload is not a receipt and not a confirmation.
2. Display a countdown and a clear "waiting for confirmation" state. The cashier must be able to
   cancel.
3. Confirm only from the provider's transaction status API or webhook. Some providers expose slip
   verification; treat it as supporting evidence, not the primary authority, and never call an
   undocumented endpoint scraped from a bank website.
4. Handle these explicitly: **expired QR**, **amount mismatch** (customer edits the amount in a
   banking app — common), **duplicate payment** (two customers scan the same QR), **late payment**
   after cancellation, **partial payment**.
5. Duplicate/late payments are refunded through the provider where possible; otherwise they become
   an audited `unallocated_receipt` liability with a matching process. Never silently keep the money.
6. Credentials live server-side only. The terminal receives a short-lived QR payload or a signed
   intent token, never the merchant secret.
7. Slip fraud: enforce "one slip → one payment" by provider transaction ID uniqueness, not image
   hashing.

Thai-specific tax and PromptPay documentary rules: `pos-thailand-commerce`.

## Refunds, voids and chargebacks

- **Void** only before capture/settlement where the provider allows it; otherwise refund.
- **Refund** is a new provider transaction referencing the original. Cap at
  `captured − already_refunded` per payment, enforced transactionally.
- Refunds may be async (`pending → succeeded/failed`); never mark the customer refunded until the
  provider confirms, and show "refund initiated" in the meantime.
- Refund to the original instrument by default. Alternate methods need approval and a reason; they
  are a fraud vector.
- **Chargeback**: create a case with deadline, attach sale snapshot, receipt, signature/CCTV
  reference, and delivery evidence; post a receivable and a fee. Do not delete or edit the sale.
- Partial refunds must keep a per-line, per-tender allocation so VAT credit notes and stock returns
  stay consistent (`pos-sales-checkout`).

## Daily reconciliation

Match three (or four) sources per store per business date:

| Source | Contains | Purpose |
| --- | --- | --- |
| POS payments | captured/refunded per method, per terminal | What we think happened |
| Provider transactions | status, amount, fee, settlement batch ID | What the provider thinks |
| Bank settlement | net payout, batch, date | What actually arrived |
| Cash count / Z-report | drawer cash | Cash side (`pos-shift-cash-management`) |

```text
expected_net = Σ captured − Σ refunded − Σ provider_fees − Σ chargebacks
variance     = settled_amount − expected_net
```

Outputs: matched, `pos_only` (captured in POS, missing at provider → investigate fast), `provider_only`
(money arrived with no POS sale → unallocated), `amount_mismatch`, `fee_mismatch`, `late_settlement`.

Operational rules:

- Run reconciliation **daily and automatically**; a monthly-only process hides losses for weeks.
- Match keys: provider reference first, then (amount, timestamp window, terminal), then manual.
- Never adjust a payment to force a match. Create an explicit `recon_exception` with an owner and
  deadline.
- Fee accounting is revenue-relevant: store the fee per transaction, not just a monthly total.
- Keep raw provider payloads for the dispute window (typically 120–180 days; confirm per contract).
- Close the day only when exceptions are zero or explicitly accepted with a reason.

## Workflow: integrate a payment method

1. **Read the provider contract**: statuses, signature scheme, idempotency header, amount units,
   refund window, settlement schedule, sandbox limits.
2. **Write the port and an in-memory fake** that can simulate pending, captured, failed, expired,
   duplicate and late events.
3. **Map provider states to your states** in one place, with `needs_review` for anything unknown.
4. **Implement create-intent** with your `reference` as the provider idempotency key.
5. **Implement webhook ingestion**: raw-body verification, inbox, fast ack, async apply.
6. **Implement the status poller** with bounded backoff and an escalation path.
7. **Gate sale completion on confirmed tenders**; test the underpaid and overpaid cases.
8. **Implement refund/void** with caps and async confirmation.
9. **Build the settlement matcher** with fixtures before seeing real data.
10. **Run a pilot store** with daily reconciliation and a named owner for exceptions.

## Business rules

- One sale may have many tenders; one tender maps to at most one provider transaction.
- Currency is fixed per sale; no FX at the till.
- `amount` sent to the provider equals the tender's `appliedAmount` in minor units, and is compared
  exactly on confirmation (no tolerance except documented rounding for specific methods).
- A payment intent expires; expired intents are never revived — create a new one.
- Offline card approval is **not** a normal payment: apply a floor limit, mark `offline_approved`,
  and treat unconfirmed offline approvals as risk exposure to be reconciled within the provider's
  allowed window.
- Store-and-forward EDC receipts must be reconciled when the terminal uploads; a declined upload is
  a chargeback waiting to happen.
- Tips/service charges, if supported, are part of the captured amount and must be split for payout
  reporting.

## Edge cases

| Case | Handling |
| --- | --- |
| Webhook arrives before the sale row is committed | Holding table keyed by reference; retry matching |
| Webhook arrives twice | Unique `event_id`; second is a no-op |
| Paid amount ฿1 less than total | `needs_review`; do not auto-capture; operator decides top-up/refund |
| Customer pays twice (two phones) | Second payment → refund flow; first completes the sale |
| Payment confirmed after the cashier cancelled and took cash | Refund the QR payment; never keep both |
| Provider down at the till | Fall back to cash only, or offline-approved card within limits; show status |
| Refund fails (closed card) | Retry window, then alternate method with approval |
| Terminal replaced mid-shift | Payments keyed by terminal; reconciliation groups by store, not device |
| Settlement split across days | Match by batch ID, allow `late_settlement` |
| Provider sends an unknown status string | Map to `needs_review`, alert, never guess |

## Security

- PCI scope: never store PAN/CVV/track data. Use provider-hosted or P2PE/point-to-point encrypted
  flows. Tokenise and keep only `brand`, `last4`, `providerRef`.
- Webhook endpoint: verify signature, enforce timestamp tolerance, rate limit, and do not leak
  whether a reference exists.
- Provider API keys in a secret manager, per environment, rotatable, never in the device bundle.
- Least privilege: refund permission separate from sale permission; refunds above a threshold need
  an approver.
- Audit every manual resolution: who marked `needs_review` resolved, what evidence, what amount.
- PII minimisation in logs: redact names, phone numbers, and any QR payload containing an account
  identifier.

## Error handling

| Code | Retry | Meaning / action |
| --- | --- | --- |
| `PAY_PROVIDER_TIMEOUT` | yes, same idempotency key | Unknown outcome — never assume failure |
| `PAY_PROVIDER_DECLINED` | no | Show decline, take another tender |
| `PAY_WEBHOOK_INVALID_SIGNATURE` | no | Reject, alert security, do not process |
| `PAY_AMOUNT_MISMATCH` | no | `needs_review` with both amounts |
| `PAY_DUPLICATE_REFERENCE` | no | Return existing payment |
| `PAY_REFUND_EXCEEDS_CAPTURED` | no | Reduce amount |
| `PAY_UNKNOWN_STATE` | yes (bounded) | Poll; then `needs_review` |
| `PAY_INTENT_EXPIRED` | no | Create a new intent |

On timeout the correct default is **unknown**, not failed. Report it to the cashier as "checking"
with a blocking spinner for a bounded time, then move to a documented recovery path.

## Testing requirements

- State machine table test for every (state, event) pair including late/duplicate events.
- Webhook contract tests with real captured payloads (redacted) plus signature fixtures, invalid
  signature, wrong timestamp, replayed event.
- Idempotency: create intent twice with the same reference → one provider transaction.
- Timeout path: provider returns 504 after actually capturing → poll finds captured, sale completes,
  no double charge.
- Reconciliation fixtures: matched, POS-only, provider-only, amount mismatch, fee mismatch, late.
- Refund cap test under concurrency.
- Clock skew: event with a timestamp 10 minutes in the past does not regress state.
- Load: 500 webhooks/min with p95 processing < 500 ms.
- Sandbox E2E for each method, including QR expiry and wrong-amount scenarios.

## Anti-patterns

- Marking paid on QR render, redirect, or a customer slip.
- Trusting the amount in a webhook to set the sale total.
- Processing webhooks synchronously before responding.
- Verifying signatures over re-serialised JSON instead of raw bytes.
- Using a provider status string directly as your domain state.
- Retrying a charge with a fresh idempotency key (double charge).
- Reconciling monthly, or only when someone complains.
- "Fixing" a settlement gap with a manual journal entry and no exception record.
- Storing card data "just for chargebacks".
- Letting the device hold provider secret keys.

## Cross-skill references

Tender orchestration and refund documents: `pos-sales-checkout`. Thai PromptPay/VAT receipt
boundaries: `pos-thailand-commerce`. Cash variance and Z-report: `pos-shift-cash-management`.
Offline card risk and sync ordering: `pos-offline-sync-engine`. EDC transport:
`pos-hardware-integration`. Fee and margin impact: `pos-profit-intelligence`.
