# NEXORA POS — Security & threat model

Scope: the API, PostgreSQL schema, browser app, tenant isolation, money path,
and the demo/offline surfaces. Reviewed 2026-11-16.

## Assets

Money records, stock ledger, personal data (customers/employees), credentials,
session tokens, payment references, receipts, audit history, subscription state.

## Threat model (STRIDE, abbreviated)

| Threat | Vector | Control |
| --- | --- | --- |
| Spoofing | Stolen session cookie | httpOnly + SameSite=Lax, opaque 32-byte token, SHA-256 at rest, 12h/7d expiry, revoke on password change, secure cookies in production |
| Tampering | Client changes price/discount/total | Server re-prices from variant ids and DB prices; client totals are ignored; completed sale money columns are trigger-protected |
| Repudiation | “I did not refund that” | Append-only `audit_logs` with actor, role, before/after, reason, correlation id; refund/void produce new documents |
| Information disclosure | Guessing another tenant’s id | `FORCE ROW LEVEL SECURITY` + `SET LOCAL app.tenant_id` from session; composite indexes lead with tenant; isolation tests; no tenant id accepted from the client |
| Information disclosure | IDOR on sale/product | RLS hides the row; API returns 404; integration test asserts it |
| Denial of service | Login/scan flooding | Rate limits on login/global; bounded Zod inputs; body size 2 MB; JSON only |
| Elevation of privilege | Hiding a button | Permission checked in API middleware against role_permissions; store scope checked against employee_stores; UI hiding is cosmetic only |
| Injection | SQL/CSV/receipt content | Parameterised SQL only; sort whitelist; CSV/receipt HTML escaped; no dynamic SQL from user input |
| Malicious upload | Product image upload | Only PNG/JPEG/WebP; magic-byte check; SVG and HTML rejected; 1.3 MB cap; UUID filename under a non-executable static path |
| CSRF | Cross-site form | Origin allowlist + mandatory `x-nexora-client` header + SameSite cookie |
| Duplicate money | Double tap / retry | `(tenant_id, operation_id)` idempotency with request hash; unique constraints on sale/refund document numbers |
| Offline fraud | Queued card sale | Offline is cash-only and opt-in per tenant; sync verifies open shift, prices, stock policy and idempotency |
| Secret leakage | Frontend bundle | Only public build-time config in web; DB/session secrets server-side; `.env` and `.db-credential` gitignored |
| Supply chain | npm install scripts | Locked install, minimal dependencies; review new packages |

## Implemented controls

- scrypt password hashing (`N=16384,r=8,p=1`), unique lower(email), timing-equal
  dummy verification for unknown accounts.
- Session tokens stored as SHA-256; cookie cleared on expiry; logout revokes.
- Login rate limit keyed by IP + email; global API limit.
- Helmet-style headers: nosniff, DENY framing, referrer policy, permissions
  policy, HSTS in production, API CSP `default-src 'none'`.
- Zod validation with bounds on quantities, money, dates, UUIDs, enums; no
  unknown field passthrough into SQL.
- RLS with `FORCE`; `SET LOCAL` scoped to the request transaction; platform admin
  read path is explicit and audited.
- Append-only triggers on inventory/cash/loyalty/payment-event/audit tables;
  purge requires an explicit `app.allow_purge` set only by the seed/offboarding
  path.
- Sale and sale-item immutability triggers, refund caps in service and DB.
- Audit on login, product create/update/archive, stock adjust/count, transfer,
  PO transitions, receiving, refund, void, shift open/close/cash, settings,
  role changes, customer anonymisation, platform tenant changes.
- PII minimisation: customer consent + anonymise endpoint; demo uses fictional
  data only; logs contain identifiers, not card data or customer PII.
- Customer-facing display receives only line names, quantities, prices and
  totals over a same-origin channel; it never receives customer phone/email or
  cost data.
- Image uploads: MIME allowlist, magic-byte verification, size limit, random
  UUID filenames, no SVG/HTML, served with a static handler and no execution.
- Secrets never committed; demo password is a public demo credential and the
  platform refuses it in production seed guidance.

## Known gaps / production requirements

1. **Rate limiting is in-process.** With more than one API instance, move to
   Redis (or a gateway) before scaling horizontally.
2. **Session store is PostgreSQL.** Fine for v1; Redis is the scale path.
3. **No provider webhooks yet.** Card/QR confirmation is a staff attestation
   with a reference. A licensed PSP must supply signed webhooks/polling and
   settlement files before accepting automated QR/card payments.
4. **No CSP for the SPA** in this repo (Vite dev server). Set a nonce/hash-based
   CSP at the reverse proxy in production.
5. **Backups/DR** are documented and drilled locally (`docs/OPERATIONS.md`);
   production needs PITR, offsite immutable copies and restore drills. The dump
   requires a dedicated `BYPASSRLS` backup role because FORCE RLS blocks the
   table owner.
6. **No penetration test or WAF.** Run an external review before go-live.
7. **Email verification/password reset** are not implemented; admin resets
   passwords. Add email delivery + signed reset tokens for production.
8. **Receipt/tax legal review** is required before issuing tax invoices.
9. **Dependency audit** should run in CI (`npm audit --omit=dev`), with an
   allowlist for accepted advisories.
10. **File uploads** are not accepted; product images are URLs only. If uploads
    are added, validate content type, size, and serve from a separate origin.

## Verification performed

- `npm test`: money/VAT/property tests, real-Postgres checkout, idempotent
  replay, refund caps, stock/cash reconciliation, RLS isolation, permission
  denial, shift close.
- `npx playwright test`: cash sale, receipt detail, language switch, mobile,
  keyboard-only POS, offline queue + sync, platform console.
- Manual browser review at 1440×900 and 390×844, light and dark.

## Reporting a vulnerability

Do not open a public issue. Contact the repository owner privately with the
affected endpoint, reproduction steps, and impact. Do not include real customer
data in reports.
