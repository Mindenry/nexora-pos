# PromptPay Implementation

Version: 1.0  
Implemented: 2026-11-16

## 1. Architecture

The engine is isolated from POS business logic:

```
apps/web (React)
  ├─ pages/promptpay.tsx              account management + history/detail
  ├─ components/promptpay-payment.tsx POS QR dialog + manual confirmation
  └─ lib/promptpay.ts                 typed API client

apps/api
  ├─ modules/promptpay.ts             HTTP boundary, Zod, permissions
  ├─ services/promptpay.ts            accounts, sessions, state machine, audit
  ├─ services/promptpay-crypto.ts     AES-256-GCM + HMAC
  ├─ services/payment-providers.ts    provider config, HMAC webhook, auto-confirm
  ├─ services/pos-pricing.ts          authoritative cart pricing (shared with checkout)
  ├─ services/checkout.ts             binds a verified session to exactly one sale
  ├─ services/payment-verification.ts provider interface for future adapters
  └─ services/refunds.ts              marks sessions/transactions refunded

packages/promptpay (zero runtime dependencies)
  ├─ identifier.ts                    phone/national-ID validation and masking
  ├─ crc16.ts                         CRC-16/CCITT-FALSE
  ├─ tlv.ts                           TLV encode/parse
  └─ payload.ts                       EMVCo PromptPay payload build/decode

packages/db/migrations
  ├─ 0009_promptpay.sql               tables, indexes, RLS, permissions
  ├─ 0010_promptpay_rls_defaults.sql  tenant-aware tender/grants
  ├─ 0011_promptpay_relabel_generic_qr.sql
  └─ 0012_payment_webhooks.sql        provider config + webhook event log
```

Layer mapping from the requirement:

| Layer | Implementation |
| --- | --- |
| Identifier validation | `packages/promptpay/src/identifier.ts` |
| Payload generator | `packages/promptpay/src/payload.ts` |
| EMVCo encoder | `packages/promptpay/src/tlv.ts` |
| CRC validator | `packages/promptpay/src/crc16.ts` |
| QR renderer | `apps/api/src/services/promptpay.ts` using `qrcode` |
| Session manager | `apps/api/src/services/promptpay.ts` |
| Transaction manager | `payment_transactions` + manual confirm |
| Status manager | explicit DB status state machine |
| Audit manager | `payment_audit_logs` + existing `audit_logs` |

The POS never builds a payload or a CRC. It asks the API for a session; the API
prices the cart from the database, validates the identifier, builds the payload,
renders the QR and stores the session.

## 2. Database

### 2.1 `promptpay_accounts`

`identifier_type`, `encrypted_identifier`, `identifier_hash`,
`masked_identifier`, `display_name`, `is_default`, `is_active`, `deleted_at`.
Partial unique indexes enforce one live identifier per tenant and at most one
active default.

### 2.2 `payment_sessions`

Links a cart operation (`operation_id`), an account, a store and later a sale.
Stores `amount_satang`, `reference`, `payload_hash`, `payload_encrypted`,
`status`, `expires_at`, `account_snapshot`, verifier and cancellation fields.

Key constraints:

- `UNIQUE (tenant_id, reference)`
- One `pending` session per `(tenant_id, operation_id)`
- One session per sale (`sale_id` unique when non-null)

### 2.3 `payment_transactions`

One verified transaction per session (`UNIQUE (payment_session_id)`), with
`verification_method` (`manual`, `provider_webhook`, `slip_verification`,
`statement_import`), verifier, time, reference, provider and metadata.

### 2.4 `payment_audit_logs`

Append-only timeline for created, confirmed, cancelled, expired, regenerated,
replaced and sale-linked events. Actor and metadata only; no PII.

### 2.5 `payments.promptpay_session_id`

The existing sale payment row points at the verified session. A partial unique
index prevents one session being used by two payments.

### 2.6 `payment_provider_configs` and `payment_webhook_events`

`payment_provider_configs` stores one tenant-wide signed webhook configuration:
unguessable `public_id`, encrypted HMAC secret, display name, active and
auto-confirm flags, last event time. Only owner/manager can read or change it.

`payment_webhook_events` is an idempotency and audit log keyed by
`(config_id, event_id)` with status `processed`, `already_paid`, `ignored` or
`rejected`, reason, amount, reference and payload hash. Secrets, raw payloads and
PII are not stored in the event log.

`payment_transactions.verified_by` is nullable only for provider-confirmed
transactions; manual confirmations still require a staff user.

### 2.7 RLS

All new tables have `ENABLE`/`FORCE ROW LEVEL SECURITY` and the same
tenant-isolation policy as the rest of the product.

## 3. State machine

```
                 create
                   │
                   ▼
   cancel ◄──── PENDING ──── expiry ───► EXPIRED
                   │                        │
                   │ staff confirm          │ override + note
                   ▼                        ▼
                  PAID ◄────────────────────┘
                   │
        checkout links sale
                   │
        full refund / void
                   ▼
                REFUNDED
```

Rules:

- `PENDING` never becomes `PAID` automatically.
- Expiry is lazy: reads/confirmation update an overdue pending row to `EXPIRED`.
- `EXPIRED` can only be confirmed with an explicit `overrideExpired` flag; this
  is audited with `expiredOverride: true`.
- `CANCELLED` and `REFUNDED` cannot be confirmed.
- `PAID` cannot be cancelled; use the refund flow.
- Re-generating a QR replaces the reference and expiry, keeps the same session
  and amount, and writes a `qr_regenerated` audit entry.

## 4. POS workflow

1. Cashier adds items and opens payment.
2. Cashier selects **พร้อมเพย์**.
3. The row shows **สร้าง QR** and the cart total; checkout stays disabled until
   verification.
4. The dialog posts the cart, discounts, customer, loyalty points and operation
   id to `POST /promptpay/sessions`.
5. The API re-prices from the database, picks the default/selected active
   account, creates or reuses a pending session, and returns a QR image.
6. The customer scans and pays in their banking app.
7. **Manual mode (default):** staff checks the incoming amount in the bank app
   and presses **ยืนยันรับชำระเงิน**; they must tick “I verified the money
   arrived” and may enter the slip reference/note.
   **Automatic mode:** if an active provider with auto-confirm is configured,
   the dialog shows a live banner and polls the session every 4 seconds. A
   correctly signed `payment.received` webhook marks it paid without staff
   action; the POS switches to “payment received” automatically.
8. The API locks the session, checks the amount, inserts one transaction, marks
   the session paid and audits the actor (or the provider event).
9. The POS row shows the reference and enables **ยืนยันการชำระเงิน**.
10. Checkout re-prices the cart, verifies the session is paid, matches the
    amount, has not been used, and belongs to the same operation, then inserts
    the sale and links the session.

If checkout fails after confirmation, the session remains paid but unlinked and
is visible in PromptPay history for reconciliation.

## 5. Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `PROMPTPAY_ENCRYPTION_KEY` | recommended | 32 bytes as 64 hex chars or base64. If absent, HKDF derives a key from `SESSION_SECRET` |
| `SESSION_SECRET` | yes | Existing secret; also the dev fallback master |
| `UPLOAD_DIR` | no | Unrelated to QR |

No bank API key, merchant account or third-party QR service is required to
generate a QR. No such credential is stored.

## 6. Setup

1. Run migrations: `npm run db:migrate`.
2. Set `PROMPTPAY_ENCRYPTION_KEY` (recommended) and restart the API.
3. Sign in as owner/manager.
4. Open **พร้อมเพย์ → บัญชีรับเงิน → เพิ่มบัญชี**.
5. Choose mobile or national ID, enter the proxy registered with PromptPay,
   name it, and mark it default.
6. Verify the recipient name in a banking app before receiving real money.
7. At the POS, select PromptPay and test with a small real amount.

Static no-amount QR is available from each account card
(**QR ไม่ระบุยอด**) for download/print.

## 7. Deployment

- Same-origin HTTPS deployment (cookies are `SameSite=Lax`).
- `npm run build`; run migrations once per release.
- Keep QR rendering server-side; no external image service.
- Serve `/api` and the SPA behind the same reverse proxy.
- Back up the encryption key separately from database backups.
- Monitor sessions stuck in `pending`, overrides and paid-unlinked sessions.

## 8. Automatic verification provider

The generic signed webhook is implemented:

1. Owner/manager creates a provider in **พร้อมเพย์ → ตรวจรับอัตโนมัติ**; the
   system generates an unguessable endpoint id and an HMAC secret shown once.
2. The provider sends `payment.received` with `x-nexora-timestamp`,
   `x-nexora-signature` and `x-nexora-event-id`.
3. The receiver verifies the HMAC over `${timestamp}.${rawBody}`, rejects
   timestamps older than 5 minutes, and requires the header event id to match
   the body.
4. Inside a tenant transaction it inserts the event id idempotently, locks the
   session, matches reference/store/amount, and requires status
   `pending` or `expired`.
5. With auto-confirm enabled it inserts one `payment_transactions` row
   (`provider_webhook`, no staff verifier), marks the session paid, writes an
   `auto_confirmed` timeline entry and an `audit_logs` row.
6. The POS polls the session every 4 seconds, updates the dialog and enables
   checkout. A manual fallback remains available.

This is **not** a bank API. A real provider must be contracted and configured to
send these events. If no provider is configured, the system stays in manual mode.
`payment-verification.ts` remains the interface for additional adapters
(slip verification, statement import).

A future adapter must keep the same invariants: signed requests, replay
protection, idempotency, one transaction per session, and no direct sale-paid
write.

## 9. Limitations

- Manual verification is the default. The signed webhook adapter works, but no
  real bank/PSP provider is connected or certified in this environment.
- No key rotation tooling for the encryption key, HSM or KMS integration
  (webhook HMAC secrets can be rotated from the UI).
- No bank-by-bank device certification.
- QR expiry is enforced by the POS, not by the QR payload.
- No SMS/notification scraping (intentionally).
- Static QR is not tied to a sale and is not proof of payment.
