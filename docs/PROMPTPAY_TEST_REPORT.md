# PromptPay Test Report

Version: 1.0  
Executed: 2026-11-16  
Environment: Windows, Node 26, PostgreSQL 18, Chrome, real `nexora_dev` /
`nexora_test` databases.

## 1. Result summary

| Suite | Command | Result |
| --- | --- | --- |
| PromptPay engine unit tests | `npx vitest run packages/promptpay/src/payload.test.ts` | **37 passed** |
| All unit/integration tests | `npm test` | **89 passed** (6 files) |
| API PromptPay integration | `npx vitest run apps/api/test/promptpay.test.ts` | **21 passed** |
| End-to-end (Chrome) | `npx playwright test` | **21 passed** |
| TypeScript | `npm run typecheck` | Clean |
| ESLint | `npm run lint` | Clean |
| Production build | `npm run build` | Passed (recorded below) |

The pre-existing 30 product tests still pass after the checkout pricing refactor.

## 2. Engine tests (37)

File: `packages/promptpay/src/payload.test.ts`

### CRC

- `CRC16_CCITT_FALSE("123456789") == 0x29B1`.

### Mobile

- `0812345678`, `081-234-5678`, `+66812345678`, `66812345678` all normalize to
  `0812345678` / `0066812345678`.
- `06` and `09` prefixes accepted.
- Empty, 9 digits, 11 digits, `02`/`07` prefixes, letters and a bad `+66` form
  rejected with explicit reasons.

### National ID

- Checksum-valid: `1101700230708`, `1100112345678`, `1-1001-12345-67-8`.
- Rejected: empty, 12/14 digits, wrong check digit, letters, all zeros.
- Masking never contains the full value.

### Payload reference vectors (exact string equality)

| Case | Result |
| --- | --- |
| Mobile static | matches `...6304823E` |
| Mobile 100.00 | matches `...5406100.005802TH6304F142` |
| Mobile 100.50 | matches `...5406100.505802TH6304FFE3` |
| National ID static | matches `...6304E850` |
| National ID 50.00 | matches `...63045583` |

Vectors are from `ultramcu/go-promptpay` v0.1.0 `encode_test.go` (MIT), listed in
`docs/PROMPTPAY_SPECIFICATION.md` §8.

### Other engine coverage

- Amount formatting `0.01`, `0.50`, `4.22`, `1000.00`.
- Zero/negative/fractional/over-limit amounts rejected.
- Reference label `PP-7K3M9Q` round-trips through tag 62-05.
- Tampered CRC fails decoding.
- Malformed and non-PromptPay strings fail closed.
- Invalid identifier is rejected before any payload is built.
- Unsafe reference labels (space/hash) are rejected.
- Every payload decodes with `crcValid: true`.

## 3. API integration tests (21)

File: `apps/api/test/promptpay.test.ts` (real PostgreSQL, fresh schema, cookies).

### Accounts

- Create mobile account → `201`, masked `081-•••-5678`; response contains no
  full phone; DB ciphertext does not contain the plaintext and starts with
  `v1:`; hash is 64 hex.
- Invalid national ID `1101700230709` → `422 DOMAIN_PROMPTPAY_IDENTIFIER_INVALID`.
- Duplicate `0812345678` → `409`.
- Create national ID account, set default, list shows the first account no
  longer default; rename works.
- Accountant can read (masked) but cannot create (`403`).
- Delete account soft-deletes it and promotes a remaining active default.
- Static no-amount QR: PNG data URL, SVG, decode yields `amountSatang: null`,
  `pointOfInitiation: "static"`, no full phone in the response.

### Sessions

- Create → `201`, server-priced amount 10,000 satang, debug payload has valid
  CRC, mobile proxy `0066812345678`, reference label matches.
- `GET` returns the same reference and PNG/SVG.
- Wrong received amount `9,999` → `422 DOMAIN_PROMPTPAY_AMOUNT_MISMATCH`.
- Correct confirmation → `paid`, `verificationMethod: manual`, verifier name,
  slip reference stored.
- Second confirmation → `alreadyVerified: true`; exactly one
  `payment_transactions` row.
- Checkout with the verified session → `201` sale, session `sale_id` set.
- Replay same checkout payload → same sale id, `replayed: true`.
- Reuse the session with a new operation → `409 DOMAIN_PROMPTPAY_ALREADY_LINKED`.
- Checkout before confirmation → `409 DOMAIN_PROMPTPAY_NOT_PAID`.
- Cancel → `cancelled`; confirm afterwards → `409 SESSION_STATE`.
- Force expiry in DB → `GET` returns `expired` and no QR; confirm → `409
  DOMAIN_PROMPTPAY_EXPIRED`; override with note → `paid` and
  `metadata.expiredOverride: true`.
- Two concurrent confirmations → both `200`, one `alreadyVerified: false`, the
  other `true`, exactly one transaction.
- Another tenant reading the session → `404`.
- POS bootstrap includes the `promptpay` tender; history filters return only
  paid rows with a positive paid summary.

### Signed provider webhook

- Create provider → `201`, public id `ppwh_…`, secret `whsec_…` returned once;
  GET never returns the secret.
- Correct HMAC `sha256(timestamp + "." + rawBody)` → event `processed`; session
  becomes paid with `verificationMethod: provider_webhook`, no staff verifier,
  `autoConfirmed: true`.
- Replaying the same event id → `processed` again but exactly one transaction.
- Forged signature and timestamp older than 5 minutes → `401`.
- Signed event with a wrong amount → `rejected/amount_mismatch`, session stays
  pending.
- `autoConfirm: false` → `ignored/auto_confirm_disabled`, session stays pending
  and verification mode reports manual.
- Provider self-test creates a signed event and records
  `ignored/session_not_found` without moving money.
- `review=1` returns only paid sessions with no linked sale and reports
  `reviewCount`; combining it with `status=pending` returns zero rows.

## 4. End-to-end tests (21)

### Existing journeys (17)

Login/cash sale, sales detail, language switch, mobile layout, keyboard flow,
offline queue/sync, customer display, 1024×768 layout, loyalty redemption,
platform console, iPad touch/keypad/favourites/cash count/scanner, scan-to-count
and scan-to-receive — all still pass.

### New PromptPay journeys (4)

1. **Add account UI** — create via the settings dialog, see the masked value,
   assert the full identifier is absent from the page body, delete via API.
2. **PromptPay sale** — add product → pay → choose PromptPay → QR image visible
   → reference matches `PP-[0-9A-F]{12}` → verify → tick confirmation →
   confirm → close → checkout enabled → sale success → history row shows
   reference and `ชำระแล้ว`.
3. **No premature checkout** — create a QR, close the dialog, assert the checkout
   button is disabled; reopen and assert the pending QR is reused; cancel it.
4. **Auto detection** — active provider + signed `payment.received` webhook →
   the POS dialog (polling every 4s) switches to “payment received” without
   staff action → checkout completes → provider event log shows `processed`.

## 5. Manual UI verification

Captured under `test-results/visual/`:

- `promptpay-accounts.png` — 1440×900 account management with masked identifier
  and checksum warning.
- `promptpay-accounts-ipad.png` — 1024×1366 portrait.
- `pos-promptpay-qr-ipad.png` — 1194×834 touch viewport, QR visible without
  overlays, amount/reference/account/expiry and action buttons.
- `promptpay-history.png` — paid and pending rows, verifier and sale link.
- `promptpay-static-ipad.png` — reusable no-amount QR with download/print and
  the “not proof of payment” warning.
- `promptpay-provider.png` — provider settings, webhook URL, secret rotation,
  delete and event log.
- `pos-promptpay-auto-ipad.png` — live “waiting for automatic confirmation”
  banner while the QR is pending.

Live browser flow performed:

- Owner login → create account → open POS → open shift → add product → pay →
  PromptPay → QR rendered → staff confirm → checkout → receipt
  `R-20261116-00008` → history shows paid session linked to that receipt.
- Session detail showed the audit timeline: created → confirmed → sale linked.

The QR was not scanned with a bank application; see the limitation below.

## 6. Build

`npm run build` passes for API and web. Final web output:

- main entry `376.28 kB` (`109.45 kB` gzip)
- POS chunk `97.06 kB` (`26.06 kB` gzip)
- PromptPay page chunk `46.47 kB` (`11.85 kB` gzip)

The PromptPay page is lazy-loaded; the POS dialog is part of the POS chunk.

## 7. Not tested / not claimed

- No real Thai mobile banking application scan or payment.
- No bank-by-bank compatibility, certification or merchant onboarding.
- No real thermal printer, scanner, cash drawer or EDC.
- No real bank/PSP webhook was available. The signed generic webhook receiver is
  exercised with synthetic signed events in API and E2E tests; a real provider
  contract and bank-side onboarding remain required.
- No load test, soak test, external penetration test, or production PITR.
- No SMS/notification-based verification (intentionally excluded).

These are documented as limitations, not silently treated as passing.
