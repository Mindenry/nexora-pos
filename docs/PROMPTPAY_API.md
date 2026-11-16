# PromptPay API

Base path: `/api`  
Auth: session cookie (staff)  
CSRF: mutations require `x-nexora-client: web` and, when present, a same-origin
`Origin` header. Store-scoped calls require `x-store-id`.

All responses use the existing envelope:

```json
{ "data": ..., "meta": ... }
```

Errors use:

```json
{
  "error": {
    "code": "DOMAIN_PROMPTPAY_NOT_PAID",
    "messageTh": "...",
    "messageEn": "...",
    "details": { },
    "correlationId": "...",
    "retryable": false
  }
}
```

## 1. Accounts

### `GET /promptpay/accounts`

Permission: `promptpay.accounts.read`  
Query: `includeInactive=true|false` (default false)

```json
{
  "data": [
    {
      "id": "uuid",
      "identifierType": "mobile",
      "maskedIdentifier": "081-•••-5678",
      "displayName": "Front counter",
      "isDefault": true,
      "isActive": true,
      "createdAt": "2026-11-16T09:00:00.000Z",
      "updatedAt": "2026-11-16T09:00:00.000Z"
    }
  ]
}
```

The full identifier is never returned.

### `POST /promptpay/accounts`

Permission: `promptpay.accounts.manage`

```json
{
  "identifierType": "mobile",
  "identifier": "0812345678",
  "displayName": "Front counter",
  "isDefault": true,
  "isActive": true
}
```

- `identifierType`: `mobile` or `national_id`
- `identifier` is validated and normalized; national ID requires a valid MOD-11
  check digit
- First account becomes default automatically
- Duplicate live identifier → `409 CONFLICT_DUPLICATE`
- Invalid identifier → `422 DOMAIN_PROMPTPAY_IDENTIFIER_INVALID` with
  `details.reason` (`empty`, `length`, `prefix`, `characters`, `checksum`)

Returns `201` with the masked account.

### `PATCH /promptpay/accounts/:id`

Permission: `promptpay.accounts.manage`  
All fields optional. Send `identifier` only to replace it; omitted means keep the
current encrypted value.

### `DELETE /promptpay/accounts/:id`

Permission: `promptpay.accounts.manage`  
Soft delete. If it was the default, the oldest remaining active account is
promoted. Returns `204`.

### `POST /promptpay/accounts/:id/default`

Permission: `promptpay.accounts.manage`  
Marks one active account as default and clears the previous default.

### `GET /promptpay/accounts/:id/static-qr`

Permission: `promptpay.accounts.read`

Returns a reusable **no-amount** QR. No session is created.

```json
{
  "data": {
    "account": { "id": "...", "displayName": "Front counter", "maskedIdentifier": "081-•••-5678" },
    "generatedAt": "2026-11-16T09:10:00.000Z",
    "pngDataUrl": "data:image/png;base64,...",
    "svg": "<svg ...>",
    "payload": "000201010211...6304ABCD"
  }
}
```

`payload` appears only when `NODE_ENV !== "production"` (debug copy button).
Generating this QR does **not** mean money was received.

## 2. Automatic settlement provider

All provider endpoints require `promptpay.providers.manage` (owner/manager).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/promptpay/provider` | Current config, secret never returned |
| POST | `/promptpay/provider` | Create; returns the secret **once** |
| PATCH | `/promptpay/provider` | Update name, active flag, auto-confirm |
| DELETE | `/promptpay/provider` | Remove config and its event history |
| POST | `/promptpay/provider/rotate` | Rotate secret; returns the new secret once |
| POST | `/promptpay/provider/test` | Signed self-test; records `ignored/session_not_found`, never moves money |
| GET | `/promptpay/provider/events?limit=20` | Recent webhook events |

`GET /promptpay/provider`:

```json
{
  "data": {
    "id": "uuid",
    "provider": "generic_webhook",
    "displayName": "Bank webhook",
    "publicId": "ppwh_…",
    "webhookPath": "/api/payments/webhook/promptpay/ppwh_…",
    "isActive": true,
    "autoConfirm": true,
    "lastEventAt": "2026-11-16T10:00:00.000Z",
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

Creation and rotation return:

```json
{ "data": { "config": { }, "secret": "whsec_…" } }
```

The secret is shown only in that response; it is stored encrypted.

### Public webhook endpoint

```
POST /api/payments/webhook/promptpay/:publicId
```

No session cookie and no CSRF header. Authentication is the HMAC signature.

Headers:

```
content-type: application/json
x-nexora-event-id: evt_123
x-nexora-timestamp: 1760000000
x-nexora-signature: sha256=<hex>
```

Signature:

```
HMAC_SHA256(secret, `${timestamp}.${rawBody}`)
```

- Timestamp must be within ±300 seconds.
- `x-nexora-event-id` must equal `body.eventId`.
- Duplicate `(config, eventId)` is idempotent and does not create another
  transaction.
- The config must be active; otherwise `404`.
- Invalid signature/timestamp → `401`.

Body:

```json
{
  "eventId": "evt_123",
  "type": "payment.received",
  "reference": "PP-04F8A1755AE3",
  "amountSatang": 12900,
  "currency": "THB",
  "transactionRef": "BANK-TXN-001",
  "paidAt": "2026-11-16T10:00:00.000Z",
  "storeId": "uuid (optional)"
}
```

Result `data.status`:

| Status | Meaning |
| --- | --- |
| `processed` | Session marked paid and transaction inserted |
| `already_paid` | Session was already paid/refunded; no duplicate transaction |
| `ignored` | Unknown reference, auto-confirm disabled, or duplicate event |
| `rejected` | Amount/store/state mismatch; session unchanged |

When `autoConfirm` is false the event is recorded as `ignored` and a staff member
must confirm manually.

Session responses now include:

```json
"verificationMode": {
  "mode": "automatic",
  "autoConfirm": true,
  "displayName": "Bank webhook"
}
```

The POS polls a pending session every 4 seconds only when this is automatic and
`autoConfirm` is true.

## 3. Sessions

### `POST /promptpay/sessions`

Permission: `sales.create`  
Creates a dynamic, fixed-amount QR for a cart. The server computes the cart
total; the client never supplies a trusted total.

```json
{
  "operationId": "uuid",
  "items": [{ "variantId": "uuid", "qty": 1, "lineDiscount": null }],
  "orderDiscount": null,
  "couponCode": "",
  "customerId": null,
  "redeemPoints": 0,
  "accountId": "uuid (optional; default if omitted)",
  "amountSatang": 12900,
  "expiresInSeconds": 300
}
```

- `amountSatang` is optional. If provided it must be `> 0` and `<=` the
  server-priced total. Omit it for the full order total.
- `expiresInSeconds`: 60–900; default 300.
- Re-posting the same `operationId` with the same amount/account returns the
  existing pending session instead of creating a duplicate.
- A changed amount/account, or an expired session, creates a new session and
  marks the previous one `cancelled`/`expired`.

Response `201`:

```json
{
  "data": {
    "id": "uuid",
    "reference": "PP-04F8A1755AE3",
    "status": "pending",
    "amountSatang": 12900,
    "currency": "THB",
    "expiresAt": "2026-11-16T09:15:00.000Z",
    "createdAt": "2026-11-16T09:10:00.000Z",
    "paidAt": null,
    "cancelledAt": null,
    "failureReason": "",
    "account": {
      "id": "uuid",
      "displayName": "Front counter",
      "identifierType": "mobile",
      "maskedIdentifier": "081-•••-5678"
    },
    "sale": null,
    "verifiedBy": null,
    "verification": null,
    "qr": {
      "pngDataUrl": "data:image/png;base64,...",
      "svg": "<svg ...>",
      "payload": "000201...6304ABCD"
    },
    "audit": []
  }
}
```

Errors:

- `422 DOMAIN_PROMPTPAY_NOT_CONFIGURED` — no active account
- `422 DOMAIN_PAYMENT_MISMATCH` / `VALIDATION_FAILED` — invalid amount
- `422 DOMAIN_INSUFFICIENT_STOCK` — cart cannot be priced
- `403 AUTH_PERMISSION_DENIED` — caller cannot sell

### `GET /promptpay/sessions`

Permission: `payments.read`  
Query: `page`, `pageSize`, `status`, `search` (reference or sale number), `from`,
`to` (`YYYY-MM-DD`), `review=1` (paid sessions not linked to a sale). The meta
summary includes `reviewCount`.

Returns session rows plus:

```json
{
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 12,
    "totalPages": 1,
    "summary": { "count": 12, "paidCount": 10, "paidSatang": 129000, "pendingCount": 2 }
  }
}
```

### `GET /promptpay/sessions/:id`

Permission: `payments.read`  
Returns the full session, current QR (only while `pending`), verification,
linked sale, verifier and audit timeline. Overdue pending sessions become
`expired` on read. Store scope is enforced.

### `POST /promptpay/sessions/:id/confirm`

Permission: `payments.confirm`  
Manual staff settlement.

```json
{
  "receivedAmountSatang": 12900,
  "reference": "SLIP-123",
  "note": "Checked bank statement",
  "overrideExpired": false
}
```

- `receivedAmountSatang` is optional; if omitted the session amount is used. If
  present it must equal the session amount.
- Idempotent: confirming a paid session returns `200` with
  `meta.alreadyVerified: true` and does not create a second transaction.
- Pending but overdue → commits `expired`, returns
  `409 DOMAIN_PROMPTPAY_EXPIRED`.
- `overrideExpired: true` allows an overdue/expired session to be marked paid,
  with an audited `expiredOverride` flag.
- Cancelled/refunded sessions → `409 DOMAIN_PROMPTPAY_SESSION_STATE`.

Response: same session shape with `status: "paid"`, `verifiedBy`,
`verification` and audit entries.

### `POST /promptpay/sessions/:id/cancel`

Permission: `payments.confirm`

```json
{ "reason": "Customer changed method" }
```

Only pending/expired sessions can be cancelled. Paid sessions must go through a
refund. Returns the updated session.

### `POST /promptpay/sessions/:id/regenerate`

Permission: `payments.confirm`  
Creates a new reference and expiry for a pending/expired session, keeping the
amount and account. Writes `qr_regenerated` to the timeline. Returns the session
with a new QR.

## 4. Checkout binding

`POST /pos/checkout` now accepts an optional `promptpaySessionId` on each
payment:

```json
{
  "operationId": "uuid",
  "items": [{ "variantId": "uuid", "qty": 1 }],
  "payments": [
    {
      "method": "promptpay",
      "amountSatang": 12900,
      "reference": "PP-04F8A1755AE3",
      "promptpaySessionId": "uuid"
    }
  ],
  "occurredAt": "2026-11-16T09:12:00.000Z",
  "offline": false
}
```

The checkout transaction:

1. Re-prices the cart from the database.
2. Locks the session with `FOR UPDATE`.
3. Verifies tenant/store/operation/amount.
4. Requires `status = 'paid'` and `sale_id IS NULL`.
5. Inserts the sale and `payments` row with `promptpay_session_id`.
6. Sets `payment_sessions.sale_id`, links `payment_transactions.sale_id`, and
   writes a `sale_linked` audit row.

Failure codes:

| Code | Status | Meaning |
| --- | --- | --- |
| `DOMAIN_PROMPTPAY_NOT_PAID` | 409 | Session missing, not paid, or not supplied for a PromptPay tender |
| `DOMAIN_PROMPTPAY_AMOUNT_MISMATCH` | 422 | Session amount differs from the re-priced total/payment amount |
| `DOMAIN_PROMPTPAY_ALREADY_LINKED` | 409 | Session already used by another sale |
| `DOMAIN_PROMPTPAY_SESSION_STATE` | 409 | Session belongs to another operation |

Offline checkout with a PromptPay tender is rejected; offline mode is cash-only.

## 5. Refunds

When a sale is fully refunded or voided, linked sessions and transactions move
to `refunded`. Partial refunds leave the session `paid` because money was only
partially returned; the payment row becomes `partially_refunded`.

## 6. Debug payload

`qr.payload` is returned only when `NODE_ENV !== "production"`. Production
clients receive PNG/SVG only. The payload is still stored encrypted at rest for
exact re-rendering before expiry.
