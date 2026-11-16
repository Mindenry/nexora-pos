---
name: pos-thailand-commerce
description: >
  Thai retail compliance and money rules for POS: 7% VAT inclusive/exclusive arithmetic, per-line and
  document rounding, receipt vs abbreviated/full tax invoice, credit/debit notes, required fields,
  branch and tax IDs, e-Tax Invoice boundaries, PromptPay QR limits, PDPA duties, and Thai
  language/formatting. Use for ใบกำกับภาษี, ใบเสร็จ, VAT 7%, ภาษีมูลค่าเพิ่ม, PromptPay, e-Tax,
  Thai receipt fields, or Thai address/date formatting. Not for gateway settlement mechanics
  (pos-payment-reconciliation) or general cart logic (pos-sales-checkout).
---

# Thai commerce for POS

> **Scope and caveat.** This is engineering guidance for building a POS that a Thai accountant and
> the Revenue Department can accept — **not legal or tax advice**. Rates, thresholds, document rules
> and filing mechanics change by Royal Decree, Departmental Instruction and Departmental
> Notification. Read the VAT rate, thresholds and e-tax rules from configuration, and confirm the
> current requirements with the Revenue Department (rd.go.th), an accredited e-Tax service provider
> and a Thai accountant before go-live and at every annual review.

## When to use

- Computing VAT, discounts, service charge and rounding for Thai sales.
- Designing receipt, abbreviated tax invoice, full tax invoice, credit note and debit note output.
- Deciding what a POS may call a "tax invoice" and which fields are mandatory.
- Wiring PromptPay QR and e-Tax Invoice integration boundaries.
- Handling Thai dates, numbers, addresses, branch codes and Thai-language documents.
- Data protection duties for customer data collected at the till.

**Not this skill:** provider status confirmation, webhooks and settlement
(`pos-payment-reconciliation`); cart state machine (`pos-sales-checkout`); cash drawer
(`pos-shift-cash-management`).

## VAT fundamentals

Thailand's standard VAT rate has been **7%** for many years through periodic extensions. Treat it as
configuration with an effective date, never a constant, and add a test that fails loudly if the rate
in config disagrees with the accountant-approved table.

| Concept | Rule |
| --- | --- |
| Standard rate | 7% of the value of taxable goods/services |
| Registration | Business exceeding the annual turnover threshold must register (currently 1.8M THB; verify) |
| Output tax | VAT charged on sales; remitted via ภ.พ.30 |
| Input tax | VAT paid on purchases; credited against output tax |
| Zero-rated | 0% with input tax credit (e.g. exports, per conditions) |
| Exempt | No VAT charged and no input credit (e.g. certain foods, books, services per schedule) |
| Non-registrant | No VAT on receipts; must not issue a tax invoice |

### Inclusive vs exclusive arithmetic

Prices on a Thai retail shelf are normally **VAT-inclusive**. Never store a "VAT" figure computed
from floating point.

```text
// VAT-inclusive (shelf price includes VAT)
base_excl = round_half_up(total_incl * 100 / 107)
vat       = total_incl − base_excl          // exact, no residual

// VAT-exclusive (price before tax)
vat       = round_half_up(net_excl * 7 / 100)
total     = net_excl + vat
```

Formulas in integer satang, with `round_half_up` defined once and property-tested:

```ts
const VAT_RATE_BP = 700; // basis points, from effective-dated config

// VAT inside a tax-inclusive total: VAT = total × r / (10000 + r), rounded half-up to the satang
function vatFromInclusive(totalIncl: number, rateBp: number): number {
  const d = 10000 + rateBp;
  return Math.floor((totalIncl * rateBp + d / 2) / d);
}
function baseFromInclusive(totalIncl: number, rateBp: number): number {
  return totalIncl - vatFromInclusive(totalIncl, rateBp);
}

// VAT added to a tax-exclusive amount, rounded half-up to the satang
function vatFromExclusive(netExcl: number, rateBp: number): number {
  return Math.floor((netExcl * rateBp + 5000) / 10000);
}
```

At document level, compute the VAT on the document total and reconcile with the sum of line VATs.
The difference (a few satang) is allocated to the largest line as a **tax adjustment**, so:

```text
Σ line.vat = document.vat
Σ line.base = document.base
document.total = document.base + document.vat
```

Never show "VAT 7%" with a total that does not recompute exactly. Auditors and customers both check.

### Discounts, service charge and VAT

- Discounts reduce the taxable base; apply them before VAT and show the base, discount, VAT and total.
- A service charge is consideration for service and is normally subject to VAT when the seller is
  registered — confirm treatment with the accountant per business model; the POS must support both
  "service charge taxable" and "not taxable" as configuration, with a snapshot.
- Cash rounding (e.g. to the nearest ฿0.25/฿0.50) happens **after** VAT, is shown separately, and is
  not a discount. It gets its own account.
- Promotions funded by a supplier may need separate reporting; keep a `funding_party` on the discount
  so the accountant can split it.
- Tips are not revenue of the merchant when passed to staff; keep them separate from VAT-bearing
  totals unless the accountant says otherwise.

## Documents

| Document | Thai | Issued when | Key characteristics |
| --- | --- | --- | --- |
| Receipt | ใบเสร็จรับเงิน | Payment received | Proof of payment; not necessarily a tax invoice |
| Abbreviated tax invoice | ใบกำกับภาษีอย่างย่อ | Retail sale to consumer | Must carry the words, seller identity and VAT; full invoice available on request |
| Full tax invoice | ใบกำกับภาษี (เต็มรูป) | Buyer needs input tax credit | Buyer name/address/tax ID, full particulars |
| Credit note | ใบลดหนี้ | Return, discount after issue, correction reducing VAT | References original tax invoice; reduces output tax |
| Debit note | ใบเพิ่มหนี้ | Undercharge, price increase after issue | References original; increases output tax |
| e-Tax Invoice / e-Receipt | ใบกำกับภาษีอิเล็กทรอนิกส์ | Digital issuance via accredited provider | XML + digital signature + submission to RD |

### Minimum content to design for

Confirm current mandatory fields, but a production design should carry:

- Seller legal name, address, **13-digit tax identification number**, branch (5-digit code;
  head office commonly `00000`) and the word for branch.
- Document type label in Thai, and document number from a controlled sequence.
- Issue date (and time for POS).
- Buyer name, address and tax ID for a full tax invoice; for abbreviated, buyer is optional.
- Description, quantity, unit price per line; discounts shown.
- Value excluding VAT, VAT amount and rate, total including VAT.
- In the case of an abbreviated tax invoice, a statement that a full tax invoice can be issued, and
  how to obtain it (per current rules).
- Payment method and change for a receipt.
- "Original / copy / reprint" marking; reprints must not look like originals.
- Credit/debit notes must reference the original document number and date and state the reason.

Store the rendered snapshot. A reprint reconstructs from the snapshot only.

### POS-specific practice

- A POS receipt may serve as an **abbreviated tax invoice** if it contains the required particulars
  and the wording; do not print "ใบกำกับภาษี" on a document that lacks them.
- When a customer asks for a full tax invoice, capture buyer details at or after the sale and issue a
  linked full tax invoice — never silently reprint the receipt as a full invoice.
- Voided/abbreviated documents keep their numbers; the Z-report lists the used range and voids.
- Number sequences are per store (and per document type), gapless within the period, controlled by
  the server or a leased block (`pos-offline-sync-engine`).
- A tax invoice must be issued by a VAT-registered seller. Non-registrants print a receipt only.

## e-Tax Invoice boundaries

- Production e-Tax Invoice / e-Receipt generally requires an **accredited service provider**,
  XML in the prescribed schema, a digital signature, and submission to the Revenue Department, with
  buyer delivery. Confirm service-provider list and submission deadline (commonly by the 15th of the
  following month) with the provider.
- Your POS should treat the e-tax provider as a **downstream document service**, not as payment
  confirmation: the sale is complete on payment; the e-document has its own status
  (`queued → submitted → accepted → rejected`) and retry path.
- Never fabricate an RD acceptance status. Store the provider's reference, timestamp and raw
  response; surface rejections to finance with the reason.
- Keep the human-readable receipt/invoice available even when the e-document fails.
- Digital signatures and provider credentials live server-side; devices never hold them.

## PromptPay QR boundaries

PromptPay is an EMVCo QR overlay on Thai bank transfer rails.

| Fact | Engineering consequence |
| --- | --- |
| The QR is a payment **request** | Rendering it proves nothing; do not mark paid |
| Amount can be edited in some apps if the QR is not amount-bound | Prefer amount-bound QR and validate the paid amount |
| Confirmation arrives via the provider/bank, not the QR | Use signed webhook or authenticated status API (`pos-payment-reconciliation`) |
| Duplicate scans are possible | One intent → one expected payment; reconcile extras as refunds |
| QR can expire | Show countdown, allow regenerate, never revive an expired intent |
| Slip images are forgeable | Never accept a slip as the sole proof; verify by provider transaction ID |

Tag structure (for building or validating payloads): EMVCo `00` payload format, `53` currency
(`764` THB), `54` amount, `58` country `TH`, `29` PromptPay credit transfer (mobile/National ID/
e-Wallet) or `30` Bill Payment (Billder ID, ref 1/ref 2), `63` CRC. Validate the CRC and the amount
before display; reject a payload that does not parse. This is a format concern only — it is not
confirmation of payment.

## PDPA and customer data at the till

- Collect the minimum: phone for loyalty/points, name if a tax invoice requires it, consent for
  marketing **separately** from the transaction.
- Record consent version, timestamp, channel and purpose; provide withdrawal and access paths.
- Do not print full phone numbers or national IDs on receipts unless legally required or the customer
  asks; mask by default.
- Retention: transaction and tax records per Revenue Code requirements (commonly five years; confirm);
  marketing consent data only as long as the purpose holds.
- A data-subject request must be executable per tenant without leaking other customers
  (`pos-multi-tenant-saas`).
- CCTV and POS correlation is personal data; define purpose, retention and access control.

## Thai formatting

- **Dates**: display Buddhist Era (พ.ศ.) or Gregorian per document policy; store ISO/UTC. BE = CE +
  543\. Be explicit on receipts which calendar is used.
- **Numbers**: `th-TH` grouping with `Intl.NumberFormat('th-TH')`; currency `THB` with `฿`. Thai
  digits are acceptable in UI but store ASCII digits.
- **Address**: บ้านเลขที่ / หมู่ / ซอย / ถนน / ตำบล / อำเภอ / จังหวัด / รหัสไปรษณีย์; keep a
  free-form line plus structured fields for tax invoices.
- **Names**: titles (นาย/นาง/นางสาว/บริษัท) are meaningful; do not strip them.
- **Sorting**: Thai collation differs from byte order; sort with ICU/`Intl.Collator('th')` where
  order matters to a human.
- **Line breaking**: Thai has no spaces between words; do not truncate with a naive word wrap. Test
  receipt templates with long Thai product names.

## Workflow: add Thai compliance to a POS

1. **Identify the seller's VAT status** and document types to issue; encode as tenant config with
   effective dates.
2. **Implement money as satang** and a single VAT function with golden tests for inclusive/exclusive,
   discounts, service charge and rounding.
3. **Define document sequences** per store and type; implement gapless allocation and void tracking.
4. **Build templates** for receipt, abbreviated tax invoice, full tax invoice, credit/debit note;
   assert required fields in a renderer test.
5. **Snapshot** the buyer, seller, lines, tax breakdown and legal text at issue time.
6. **Implement credit/debit notes** linked to originals; never edit an issued document.
7. **Integrate PromptPay** with amount-bound QR and provider-only confirmation.
8. **Integrate e-Tax** as an async document service with explicit statuses and retries.
9. **Add PDPA** consent, masking and retention jobs.
10. **Get sign-off** from a Thai accountant on sample documents, then freeze the templates for the
    period.

## Business rules

- Never issue a tax invoice for a sale that is not paid/legally complete, unless the business process
  (credit sale) explicitly requires it and is documented.
- A full tax invoice requires buyer tax details; if they are missing, issue an abbreviated one and
  link the later full invoice.
- Corrections after issuance are credit/debit notes, never a reprint with changed numbers.
- Rounding never changes the VAT base; document the rounding account.
- Zero-rated and exempt lines must be separated on the tax invoice; do not lump them into 7%.
- Service charge, delivery fees and tips each have a defined VAT treatment in config; do not hard-code.
- A cancelled sale's document number remains consumed and visible in the Z-report.
- The seller's legal name, tax ID and branch on the receipt come from tenant config, not the store
  nickname.

## Edge cases

| Case | Handling |
| --- | --- |
| ฿0.01 rounding residual across 40 lines | Allocate to the largest line; assert document total = Σ lines |
| Customer wants a full tax invoice 3 days later | Issue a linked full invoice from the stored snapshot; do not re-ring the sale |
| Partial return of a discounted basket | Credit note VAT recomputed from the returned lines' snapshot, capped |
| Price includes VAT, line discount 100% | Base and VAT both 0; no negative VAT leakage |
| Foreign currency payment | Convert only if the business supports it; the tax invoice stays in THB with the rate documented |
| Customer pays ฿1,000 for a ฿999.50 sale | Cash rounding policy applies; change is a tender fact |
| Branch opened mid-period | New branch code and new sequences; no reuse of the head-office range |
| VAT rate changes | New effective-dated rate; old sales unchanged; reprint uses snapshot |
| PromptPay paid after QR expiry | Provider decides; treat as late payment, refund or allocate with audit |
| Buyer tax ID invalid (checksum) | Warn and require confirmation; do not silently drop it |

## Security

- Tax IDs, addresses and phone numbers are personal data: encrypt at rest, restrict exports, mask in
  logs and UI where full value is unnecessary.
- Document sequences and signing keys are server-side assets; a device compromise must not allow
  forging tax invoices.
- e-Tax provider credentials and certificates in a secret manager with rotation and dual control.
- Every reprint, credit note and debit note is audited with actor, reason and original reference.
- Prevent template injection: legal text and product names are data, not executable templates.
- Backups containing tax documents are encrypted and access-controlled (`pos-backup-recovery`).

## Error handling

| Code | Meaning | Action |
| --- | --- | --- |
| `TH_VAT_RATE_MISSING` | No effective rate for the date | Block completion; fix config |
| `TH_TAX_ID_INVALID` | Buyer tax ID fails validation | Warn, require confirmation |
| `TH_DOC_SEQUENCE_EXHAUSTED` | Number block used up | Replenish before trading |
| `TH_DOC_TYPE_FORBIDDEN` | Non-registrant issuing tax invoice | Block; issue receipt |
| `TH_ETAX_REJECTED` | Provider/RD rejected | Queue human review; keep receipt valid |
| `TH_ETAX_UNAVAILABLE` | Provider down | Queue with retry; do not block the sale |
| `TH_BUYER_DETAILS_REQUIRED` | Full invoice without details | Collect or issue abbreviated |
| `TH_CREDIT_NOTE_EXCEEDS_ORIGINAL` | Over-credit | Cap to original line/total |
| `TH_QR_INVALID_PAYLOAD` | Bad EMVCo/CRC | Regenerate; do not display |

Document-service failures never unwind a paid sale; they create a follow-up task with an owner.

## Testing requirements

- VAT golden table: inclusive/exclusive, 0%, exempt, mixed basket, discounts, service charge,
  rounding — exact satang, both directions.
- Property: `base + vat = total` for every generated basket; document VAT = Σ line VAT after
  allocation.
- Renderer validation: every mandatory field present for each document type, in Thai, with long names
  and addresses; snapshot reprint byte-identical.
- Sequence: concurrent issuance is gapless and unique per store/type; voids recorded.
- Credit/debit note caps and VAT reversal correctness.
- PromptPay: amount-bound payload validates; wrong amount and expiry are rejected; no state change
  without a provider signal.
- e-Tax: accepted, rejected and timeout paths; retry does not duplicate a document.
- Locale: BE/CE dates, Thai numerals input, `Intl` grouping, Thai collation.
- PDPA: consent capture/withdrawal, export and erasure respecting retention.

## Anti-patterns

- Hard-coding 7% and 1.8M THB in code.
- Computing VAT with floats or per-line rounding that does not reconcile to the document.
- Labelling every receipt "ใบกำกับภาษี".
- Reprinting with a new number, or editing an issued invoice.
- Treating a PromptPay QR or slip as payment confirmation.
- Putting the seller's tax ID in a template file instead of tenant config.
- Emailing e-Tax documents from the device with merchant credentials.
- Printing full national IDs/phone numbers by default.
- Mixing exempt and taxable lines into one VAT line.
- Assuming the accountant's sample is legally sufficient without checking current notifications.

## Cross-skill references

Sale totals and receipt snapshot: `pos-sales-checkout`. Payment confirmation and settlement:
`pos-payment-reconciliation`. Cash rounding and Z-report: `pos-shift-cash-management`. Tenant config
and retention: `pos-multi-tenant-saas`. QR payload from the device: `pos-hardware-integration`.
Evidence retention and restore: `pos-backup-recovery`.
