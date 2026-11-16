# PromptPay Security Review

Version: 1.0  
Reviewed: 2026-11-16

## 1. Assets

| Asset | Sensitivity | Location |
| --- | --- | --- |
| PromptPay proxy (mobile / national ID) | High — PII and payment routing | `promptpay_accounts.encrypted_identifier` |
| Encryption key(s) | Critical | `PROMPTPAY_ENCRYPTION_KEY` or HKDF from `SESSION_SECRET` |
| QR payload | Medium — contains the proxy and amount | Encrypted at rest in `payment_sessions.payload_encrypted`; never logged |
| Payment state and verifier | High — money integrity | `payment_sessions`, `payment_transactions`, `payments` |
| Audit trail | High — non-repudiation | `payment_audit_logs`, `audit_logs` |
| Staff session cookie | Critical | HttpOnly, SameSite=Lax, Secure in production |

## 2. Threat model and controls

### 2.1 Database or backup disclosure

- The proxy is encrypted with **AES-256-GCM** (12-byte random IV, 16-byte auth
  tag) before storage. The full value is never stored in plaintext.
- Duplicate detection uses **HMAC-SHA256** over the normalized value with a
  separate derived key. The HMAC is not reversible.
- Only `masked_identifier` is returned by the API (`081-•••-5678`,
  `X-XXXX-XXXXX-XX-3`).
- QR payloads are also stored encrypted (`payload_encrypted`) because the POS
  must re-render the exact same QR before expiry. The plaintext payload is
  never written to logs, audit metadata or API responses outside development.
- A payload integrity check recomputes SHA-256 and compares it with
  `payload_hash` before re-rendering. A mismatch fails closed.

### 2.2 Key management

- Preferred: a dedicated 32-byte `PROMPTPAY_ENCRYPTION_KEY` (64 hex chars or
  base64), provided by the platform secret manager.
- Development/test fallback: HKDF-SHA256 from `SESSION_SECRET` with distinct
  domain-separation labels for encryption and hashing.
- Losing the key makes stored proxies unrecoverable. Back it up with the same
  controls as the database encryption keys.
- Key rotation is not automated in v1. A future rotation must decrypt and
  re-encrypt every account atomically, then invalidate the old key. Documented as
  a residual limitation.

### 2.3 Access control

| Action | Permission |
| --- | --- |
| View masked accounts | `promptpay.accounts.read` |
| Create/edit/delete accounts, change default | `promptpay.accounts.manage` |
| Create a POS QR session | `sales.create` |
| View payment history/detail | `payments.read` |
| Confirm money received, cancel/regenerate QR | `payments.confirm` |

- Owners and managers get account management by default.
- Cashiers can read the masked account list and confirm receipt because they
  hold `payments.confirm`, but cannot change the receiving account.
- Accountants can read accounts and payment history, not manage accounts.
- Backend permission middleware is authoritative; hiding UI controls is not a
  security boundary.
- Every PromptPay table is protected by PostgreSQL **FORCE ROW LEVEL SECURITY**
  keyed by `app.tenant_id`, in addition to application-level tenant filters.

### 2.4 IDOR and tenant isolation

- Session endpoints require both `tenant_id` and the active `store_id`; a
  session from another store or tenant returns 404.
- Checkout locks the session with `FOR UPDATE`, verifies tenant, store,
  operation id, amount, status and `sale_id IS NULL`.
- A unique partial index on `payments.promptpay_session_id` and a unique index
  on `payment_sessions.sale_id` prevent a session being attached to two sales.
- A cross-tenant API test asserts a second tenant receives 404.

### 2.5 Money integrity

- The server, not the client, computes the cart total from database prices,
  promotions, loyalty and tax. The client may request a partial session amount,
  but it must be positive and cannot exceed the server-priced total.
- Creating a QR does not create a payment, a sale, or a `paid` status.
- Confirmation requires `payments.confirm`, locks the session, verifies the
  received amount equals the session amount, and writes exactly one
  `payment_transactions` row.
- Repeated confirmation is idempotent: the second caller receives
  `alreadyVerified: true` and no extra transaction. A concurrency test sends two
  confirmations simultaneously and asserts one transaction.
- Checkout rejects an unpaid, cancelled, expired, mismatched, or already-linked
  session.
- The sale-level total is re-priced at checkout; a changed price/promotion
  produces `DOMAIN_PROMPTPAY_AMOUNT_MISMATCH` instead of silently accepting the
  old QR.
- Expiry is a state, not a payment. Normal confirmation after expiry is rejected;
  an authorised override requires an explicit flag, a note and an audit entry.

### 2.6 Input validation

- Zod validates every request body, path and query.
- Identifier validation is duplicated: frontend feedback and authoritative
  backend validation. The backend never trusts the frontend.
- Phone numbers accept only limited separators; national IDs accept digits,
  spaces and dashes only.
- Amounts are integer satang, bounded and re-checked by the payload engine.
- Reference labels are restricted to `A-Z0-9._-` and 25 characters, preventing
  TLV injection.
- Payload builder rejects non-printable ASCII and length overflow.

### 2.7 Injection and XSS

- All SQL uses parameterized queries (`$1`, `$2`, ...). No string interpolation
  of user input.
- React escapes rendered text. Merchant display names are rendered as text, not
  HTML. The print helpers HTML-escape values before writing an iframe document.
- The QR is delivered as a data URL; no third-party QR service is called.
- API responses include CSP `default-src 'none'; frame-ancestors 'none'` and
  `X-Frame-Options: DENY`.

### 2.8 CSRF, rate limiting, sessions

- Mutations require the `x-nexora-client: web` header and a same-origin
  `Origin` when present.
- Global API rate limiting is 1,200 requests/minute; login has a stricter limit.
- Session cookies are HttpOnly, SameSite=Lax and Secure in production.

### 2.9 Logging and audit

- Request logs contain method, path, status, duration, user id and tenant id —
  not identifiers or payloads.
- `payment_audit_logs` records created, confirmed, cancelled, expired,
  regenerated, replaced and sale-linked events with actor and timestamp.
- `audit_logs` records account create/update/delete/default changes and session
  create/confirm/cancel/regenerate/expiry.
- Audit metadata contains amount, masked account, display name, reference and
  reason; never the full identifier or raw payload.

## 3. Residual risks

| Risk | Severity | Notes |
| --- | --- | --- |
| Staff confirms without checking the bank | High | No technical control can prove fiat settlement without a provider; require dual control for large amounts and review audits |
| Colluding staff and customer | High | Same limitation; provider webhook or statement reconciliation is the real control |
| Malware on the POS device | High | Can alter the displayed amount or steal sessions; use device hardening, screen lock, OS updates |
| Key compromise | Critical | All proxies and payloads decryptable; rotate keys and re-encrypt |
| No automatic provider verification | High | Manual verification is the honest v1 boundary |
| No external penetration test | Medium | Required before production |
| No HSM/KMS integration | Medium | Keys live in process memory; use a managed secret store/KMS |
| Print helper iframe | Low | Only static escaped HTML and a server-generated data URL are written |
| SMS/notification verification | Not implemented | Explicitly rejected because of reliability, privacy and malware risk |

## 4. Security invariants

1. No full national ID or phone number in a log, audit row, API list response or
   error message.
2. No `paid` status without a `payment_transactions` row and a verifying user.
3. No sale with a PromptPay tender unless the session was `paid`, matched the
   server total, and was not used before.
4. No session may belong to two sales.
5. No QR image is returned for a status other than `pending`.
6. A payload whose hash does not match is never re-rendered.
7. Every account and session action is tenant-scoped by both application code
   and RLS.

## 5. Pre-production checklist

- [ ] Set a dedicated `PROMPTPAY_ENCRYPTION_KEY`; remove reliance on the
      `SESSION_SECRET` fallback.
- [ ] Store secrets in the platform secret manager, not `.env`.
- [ ] Confirm database backups are encrypted and access-controlled.
- [ ] Run an external penetration test covering IDOR, CSRF, RLS, race
      conditions and the QR endpoints.
- [ ] Add monitoring/alerting for repeated `alreadyVerified`, expired overrides,
      cancel-after-confirm attempts and sessions paid but not linked to a sale.
- [ ] Define dual-control rules for large PromptPay amounts.
- [ ] Train staff: never confirm until the amount is visible in the bank account.
- [ ] If automatic verification is added, require signed webhooks, replay
      protection and idempotency keys.
