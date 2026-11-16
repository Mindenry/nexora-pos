# PromptPay Research

Version: 1.0  
Research date: 2026-11-16  
Scope: PromptPay person-to-person credit transfer QR (EMVCo Merchant-Presented
Mode), mobile number and Thai national ID proxies, manual settlement inside a
POS. Merchant bill payment, e-wallet proxies, cross-border QR and card rails are
out of scope.

## 1. Method

1. Read the Bank of Thailand (BOT) public PromptPay page and the BOT
   "Policy Guideline: Standardized Thai QR Code for Payment Transactions"
   (FPG circular, 17 April 2019).
2. Read EMVCo's public Merchant-Presented Mode (MPM) specification page and the
   published v1.1 document metadata.
3. Read the source code and test vectors of two independent open-source
   PromptPay implementations.
4. Compare npm packages by licence, maintenance, dependencies and validation
   behaviour.
5. Build the payload engine in-house and compare its output byte-for-byte with
   published reference vectors.
6. Research automatic settlement channels and classify what is actually
   possible without a merchant agreement.

Facts below are separated from interpretations. Where a primary document could
not be parsed in this environment, that is stated.

## 2. Sources

| ID | Source | URL | Accessed | Use |
| --- | --- | --- | --- | --- |
| S1 | Bank of Thailand — PromptPay | https://www.bot.or.th/en/financial-innovation/digital-finance/digital-payment/promptpay.html | 2026-11-16 | What PromptPay is, registration with citizen ID / mobile number, one phone per account, fee table |
| S2 | BOT — Policy Guideline: Standardized Thai QR Code for Payment Transactions (EN PDF) | https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2562/EngPDF/25620084.pdf | 2026-11-16 | Official Thai QR tag 29–31 allocation. The PDF body could not be text-extracted with the tools available; tag details were cross-checked against S3, S4 and S5 |
| S3 | EMVCo — EMV QR Codes | https://www.emvco.com/emv-technologies/qr-codes/ | 2026-11-16 | MPM/CPM scopes, MPM v1.1 published 27 Nov 2020, self-evaluation |
| S4 | dtinth/promptpay-qr — README and `index.js` (MIT) | https://github.com/dtinth/promptpay-qr and https://raw.githubusercontent.com/dtinth/promptpay-qr/master/index.js | 2026-11-16 | Working reference implementation, tag order, proxy encoding, CRC, published test vectors |
| S5 | ultramcu/go-promptpay — README and `encode_test.go` (MIT) | https://github.com/ultramcu/go-promptpay | 2026-11-16 | Independent implementation and golden vectors, including national ID |
| S6 | promptpay-qrcode — structure document (MIT) | https://github.com/devhyphenplus/promptpay-qrcode/blob/main/docs/promptpay-qr-structure.md | 2026-11-16 | Secondary cross-check of tag 29/30/62/63, static/dynamic semantics, BOT guideline citation |
| S7 | National ITMX — PromptPay AnyID | https://www.itmx.co.th/product-and-service/MTY2NjU0Mjk0MA== | 2026-11-16 | ITMX describes PromptPay AnyID (mobile, citizen ID, tax ID, biller ID, QR) |
| S8 | National ITMX — Standard API Transaction Verification | https://www.itmx.co.th/product-and-service/MTY2NjU0Mjk3OQ== | 2026-11-16 | Existence of an interbank slip/transaction verification API channel, not a public self-service API |
| S9 | npm registry — `qrcode` 1.5.4 | https://registry.npmjs.org/qrcode/latest | 2026-11-16 | Version, MIT licence, dependencies, engine requirement |
| S10 | npm registry — `promptpay-qr` 0.5.0 | https://registry.npmjs.org/promptpay-qr/latest | 2026-11-16 | Version, MIT licence, dependencies |
| S11 | npm registry — `promptpay-qrcode` 1.2.1 | https://registry.npmjs.org/promptpay-qrcode/latest | 2026-11-16 | Version, MIT licence, peer dependency on `qrcode` |
| S12 | soldair/node-qrcode README | https://github.com/soldair/node-qrcode | 2026-11-16 | PNG/SVG rendering capability, maintenance status context |

Limitation: no licensed Thai bank test account or acquirer sandbox was
available. No claim is made that any specific bank application was tested.

## 3. Confirmed facts

### 3.1 PromptPay identifiers

- PromptPay lets a payer transfer using a citizen ID, a mobile number (or
  another registered identification number) or a bank account number (S1).
- Registration links a bank account to the proxy. A phone number cannot be
  linked to more than one account; a person may link a citizen ID to one account
  and a phone number to another (S1).
- Therefore **a structurally valid phone number or citizen ID is not proof that
  the proxy is registered, active, or owned by the merchant**.
- ITMX describes the same AnyID family: mobile number, citizen ID, tax ID,
  biller ID and QR (S7).

### 3.2 Thai mobile normalization

S4 normalizes a Thai mobile number to a 13-character value inside tag 29:

```
0812345678        -> 0066812345678
+66812345678      -> 0066812345678
66812345678       -> 0066812345678
```

The value is `00` + country code `66` + the 9 national digits (leading `0`
removed). This is the value carried in sub-tag `29-01` (S4, S6).

### 3.3 National ID

- A citizen ID is 13 digits and uses the Thai MOD-11 check digit: weights
  13..2 over the first 12 digits, `check = (11 - (sum mod 11)) mod 10`.
- The national ID is carried in sub-tag `29-02`, not `29-01` (S4 source code,
  S5 golden vectors, S6).
- The checksum proves only that the 13 digits are well formed. It says nothing
  about PromptPay registration or account ownership.
- A valid test vector used by this project is `1101700230708` (S5). Another
  checksum-valid example is `1-1001-12345-67-8`.

### 3.4 QR structure

- PromptPay personal credit transfer uses EMVCo MPM template tag `29` with
  application identifier `A000000677010111` (S2, S4, S5, S6).
- Tag `00` is payload format `01`.
- Tag `01` is the point-of-initiation method: `11` static, `12` dynamic.
- Tag `53` is currency `764` (THB); tag `58` is country `TH`.
- Tag `54` carries the amount, formatted with two decimals, when present.
- Tag `62` is the additional-data template; sub-tag `05` is a reference label.
- Tag `63` is CRC-16/CCITT-FALSE (`poly 0x1021`, init `0xFFFF`, no reflection,
  no final XOR), computed over the payload including the literal `6304`.
- EMVCo MPM v1.1 was published 27 November 2020 (S3).

### 3.5 Static vs dynamic

- `01=11` means the same QR can be shown for more than one transaction.
- `01=12` means the merchant intends to show a new QR per transaction.
- MPM does not put a nonce, expiry or single-use token in the payload. A
  "dynamic" payload is still static text and can be re-scanned. Whether a repeat
  payment is accepted is a bank/issuer decision, not a QR property (S6, clearly
  documented from real-world observation; not independently verified here).
- Consequence for POS: **QR creation, scanning and expiry are never evidence of
  payment**. A human or a licensed provider must verify incoming funds.

### 3.6 Amount and limits

- EMVCo tag 54 is limited to 13 characters including the decimal point. The
  engine caps amounts at 999,999,999,999 satang (9,999,999,999.99 THB) so the
  encoded value cannot exceed 13 characters.
- Actual per-transaction limits depend on the payer's bank and the merchant's
  registration. The application therefore treats large amounts as an operational
  policy decision, not a standard guarantee.
- The BOT page lists standard PromptPay fee tiers (free up to 5,000 THB; tiered
  fees above that) but notes most banks waive digital transfer fees (S1).

## 4. Library evaluation

| Candidate | Version / licence | Dependencies | Maintenance | Verdict |
| --- | --- | --- | --- | --- |
| `promptpay-qr` (dtinth) | 0.5.0, MIT | `crc`, `minimist`, `qrcode@0.9` | Last npm publish 2022; stable but old dependencies | **Not adopted.** Excellent reference and test vectors. It accepts any digit string, pads phone numbers, and does not validate the national ID checksum, so it cannot be the validation layer. |
| `promptpay-qrcode` (devhyphenplus) | 1.2.1, MIT | Core zero-dependency; optional peer `qrcode` | Newer, documented structure and decoder | **Not adopted as runtime.** Useful cross-check of tags 29/30/62/63. Owning the small payload engine avoids an extra dependency and keeps validation explicit. |
| `go-promptpay` (ultramcu, Go) | 0.1.0, MIT | Go stdlib + go-thainum | 2026 release | **Not a JS dependency.** Used as an independent reference-vector source, including national ID. |
| `qrcode` (soldair/node-qrcode) | 1.5.4, MIT | `pngjs`, `yargs`, `dijkstrajs` | Mature; version 1.5.4; Node >=10.13 | **Adopted for rendering only.** Server-side PNG data URL and SVG, no third-party QR generation service. |
| `promptpay-qr` / `promptpay-qrcode` for images | — | — | — | Rejected: image rendering does not require a PromptPay-specific package. |

Decision: implement the EMVCo/PromptPay payload and validation ourselves in
`packages/promptpay`, and use `qrcode` only to turn a validated payload into a
PNG/SVG. This keeps the security-critical layer small, testable and replaceable.

## 5. Automatic payment verification research

The question is whether money arriving by PromptPay can be confirmed
automatically without a merchant account or bank API. Findings by category:

### A. Possible without a bank API

- **Staff manual verification**: staff look at the banking app/statement and
  confirm the exact amount, then the POS records who confirmed and when. This is
  what the system implements. It is reliable only to the extent that staff are
  honest and actually check.
- **Reconciliation against an imported statement file**: possible only if the
  merchant can export statements; this is still manual/offline and not a webhook.
- **Internal matching**: comparing a QR reference shown on the customer's slip
  with the session reference helps staff, but is not cryptographic proof.

### B. Possible with a third-party service

- Licensed slip-verification services and payment gateways can verify a slip or
  receive a webhook. They require onboarding, contracts, fees and usually an API
  key. They are not a "no signup" solution. The project implements the receiving
  side of this model (signed webhook), but the merchant still needs the provider
  contract.
- ITMX documents a standard transaction-verification API (S8), but it is an
  interbank channel for participants, not an open public endpoint.

### C. Requires merchant registration / bank permission

- Merchant payment APIs and webhooks (acquirer/PSP) that report settlement.
- Bank statement APIs / host-to-host channels.
- Open banking/banking data access in Thailand is partner/consent based and not
  a general public API for arbitrary POS vendors.

### D. Not reliably possible without a transaction data channel

- Reading SMS or push notifications from a banking app. This is fragile
  (notification formats, language, multi-device), excludes iOS restrictions,
  creates a severe malware/privacy risk, and is not acceptable as a primary
  settlement proof.
- Scraping a banking app, intercepting its traffic, or bypassing authentication.
  This project does not do it and should never do it.

### Conclusion

There is **no reliable, free, self-service way** to confirm PromptPay settlement
without either (a) staff verification or (b) a contracted provider/bank data
channel. The production design therefore:

1. Marks a QR as `pending`, never `paid`, on creation.
2. Requires an authorised staff member to confirm the exact amount.
3. Records verifier, time, optional slip reference and a full audit trail.
4. Binds the verified session to exactly one sale at checkout.
5. Ships a **signed generic webhook adapter** (HMAC, replay window, event
   idempotency, auto-confirm) so a contracted bank/PSP can update the POS
   automatically. No real provider is connected in this environment.
6. Exposes a provider interface so slip/statement adapters can be added later
   without changing the POS.

## 6. Uncertainties and explicit limitations

- The BOT guideline PDF (S2) could not be text-extracted here; the tag 29
  sub-tag allocation was cross-checked against two independent implementations
  (S4, S5) and a secondary structure document (S6). The AID
  `A000000677010111` and `29-01`/`29-02` layout are consistent across all three.
- No Thai mobile banking application was available for scan testing. No bank
  compatibility claim is made.
- The statement that a `01=12` payload can be paid twice is documented by S6 as
  observed behaviour, not tested by this project. The design does not rely on
  single-use QR semantics.
- PromptPay registration status cannot be checked offline. The UI states this
  explicitly next to account management.
- Fees and limits are bank/product dependent and change over time. The BOT fee
  table is informational, not enforced by this system.

## 7. References

- S1 BOT PromptPay: https://www.bot.or.th/en/financial-innovation/digital-finance/digital-payment/promptpay.html
- S2 BOT Thai QR guideline PDF: https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2562/EngPDF/25620084.pdf
- S3 EMVCo QR Codes: https://www.emvco.com/emv-technologies/qr-codes/
- S4 dtinth/promptpay-qr: https://github.com/dtinth/promptpay-qr
- S5 ultramcu/go-promptpay: https://github.com/ultramcu/go-promptpay
- S6 promptpay-qrcode structure: https://github.com/devhyphenplus/promptpay-qrcode/blob/main/docs/promptpay-qr-structure.md
- S7 ITMX PromptPay AnyID: https://www.itmx.co.th/product-and-service/MTY2NjU0Mjk0MA==
- S8 ITMX transaction verification: https://www.itmx.co.th/product-and-service/MTY2NjU0Mjk3OQ==
- S9 `qrcode` npm: https://registry.npmjs.org/qrcode/latest
- S10 `promptpay-qr` npm: https://registry.npmjs.org/promptpay-qr/latest
- S11 `promptpay-qrcode` npm: https://registry.npmjs.org/promptpay-qrcode/latest
- S12 node-qrcode: https://github.com/soldair/node-qrcode
