# NEXORA POS — API Reference

Base path `/api`. JSON envelope:

```json
{ "data": { }, "meta": { "page": 1, "total": 42 } }
```

Errors:

```json
{ "error": {
  "code": "DOMAIN_SHIFT_NOT_OPEN",
  "message": "ยังไม่ได้เปิดกะ...",
  "messageTh": "…", "messageEn": "…",
  "details": { }, "correlationId": "…", "retryable": false
} }
```

Authentication is a `nexora_session` httpOnly cookie. Every mutation must send
`x-nexora-client: web`; the Origin must match `WEB_ORIGIN`. Store-scoped calls
send `x-store-id`; the session tenant can never be overridden by the client.
All mutating commands take `operationId` (UUID) for idempotent replay.

## Auth

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | public | Creates tenant + business + first store + owner roles |
| POST | `/auth/login` | public | scrypt verify, rate limited |
| POST | `/auth/logout` | public | revokes session |
| GET | `/auth/me` | session | user, tenant, employee, business, stores, permissions |
| PATCH | `/auth/profile` | employee | name + locale |
| POST | `/auth/password` | employee | revokes other sessions |

## Onboarding, people, stores

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/onboarding` | employee |
| POST | `/onboarding/complete` | settings.manage |
| GET | `/employees` | employees.manage |
| POST | `/employees` | employees.manage |
| PATCH | `/employees/:id` | employees.manage |
| GET | `/roles` | employees.manage |
| GET | `/permissions` | employees.manage |
| GET | `/stores` | employee |
| POST | `/stores` | settings.manage |
| PATCH | `/stores/:id` | settings.manage |

## Catalogue

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/products` | products.read |
| POST | `/products` | products.create |
| GET | `/products/:id` | products.read |
| PUT | `/products/:id` | products.update |
| POST | `/products/:id/archive` | products.delete |
| GET | `/products/export.csv` | products.read |
| POST | `/products/import` | products.create |
| POST | `/variants/:id/barcodes` | products.update |
| GET/POST | `/categories`, `/brands`, `/units` | products.read / create |

## Inventory

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/inventory/overview` | inventory.read | on-hand from ledger, value, low stock |
| GET | `/inventory/movements` | inventory.read | append-only ledger |
| POST | `/inventory/adjust` | inventory.adjust | idempotent, reason required |
| GET | `/transfers` | inventory.read | |
| GET | `/transfers/:id` | inventory.read | |
| POST | `/transfers` | inventory.transfer | draft from current store |
| POST | `/transfers/:id/dispatch` | inventory.transfer | stock-out movements |
| POST | `/transfers/:id/receive` | inventory.transfer | partial, no over-receipt |
| POST | `/inventory/counts` | inventory.count | writes `stock_count` corrections |

## POS & checkout

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/pos/bootstrap` | sales.create | catalog snapshot, settings, methods, shift, held, promotions |
| GET | `/pos/lookup?code=` | sales.create | barcode / SKU / name |
| POST | `/pos/quote` | sales.create | preview only; server reprices at checkout |
| POST | `/pos/checkout` | sales.create | idempotent sale + payment + stock + cash + receipt |
| POST | `/pos/held` | sales.create | park a cart |
| DELETE | `/pos/held/:id` | sales.create | |
| POST | `/pos/stock-check` | sales.create | authoritative on-hand for cart variants |

## Sales, refunds, shifts

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/sales` | sales.read |
| GET | `/sales/:id` | sales.read |
| GET | `/sales/:id/receipt` | sales.read |
| POST | `/sales/:id/reprint` | sales.read |
| POST | `/sales/:id/void` | sales.cancel |
| POST | `/refunds` | refunds.create |
| GET | `/refunds` | refunds.create |
| GET | `/shifts/current` | shifts.read |
| GET | `/shifts` | shifts.read |
| GET | `/shifts/:id` | shifts.read |
| POST | `/shifts/open` | shifts.open |
| POST | `/shifts/close` | shifts.close |
| POST | `/shifts/cash-movements` | shifts.cash |

## Purchasing & suppliers

| Method | Path | Permission |
| --- | --- | --- |
| GET/POST | `/suppliers` | purchasing.read / suppliers.manage |
| PATCH | `/suppliers/:id` | suppliers.manage |
| GET/POST | `/purchase-orders` | purchasing.read / purchasing.manage |
| GET | `/purchase-orders/:id` | purchasing.read |
| POST | `/purchase-orders/:id/submit` | purchasing.manage |
| POST | `/purchase-orders/:id/approve` | purchasing.approve |
| POST | `/purchase-orders/:id/receive` | purchasing.manage |
| POST | `/purchase-orders/:id/close` | purchasing.approve |
| POST | `/purchase-orders/:id/payments` | purchasing.manage |

## Customers, loyalty, promotions

| Method | Path | Permission |
| --- | --- | --- |
| GET/POST | `/customers` | customers.read / customers.manage |
| GET/PATCH | `/customers/:id` | customers.read / customers.manage |
| POST | `/customers/:id/points` | customers.manage |
| POST | `/customers/:id/anonymize` | settings.manage |
| GET/POST | `/promotions` | promotions.manage |
| PUT | `/promotions/:id` | promotions.manage |
| POST | `/promotions/:id/toggle` | promotions.manage |

## Reporting

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/reports/dashboard` | reports.view |
| GET | `/reports/sales` | reports.view |
| GET | `/reports/profit` | reports.view |
| GET | `/reports/tax` | reports.view |
| GET | `/reports/inventory` | reports.view |
| GET | `/reports/sales/export.csv` | reports.export |

Query: `from=YYYY-MM-DD&to=YYYY-MM-DD&preset=today|last7|last30|this_month`.
All aggregates are computed from `sales`, `sale_items`, `payments`, `refunds` and
`inventory_movements`. COGS uses the cost snapshot on the sale line.

## Settings, notifications, audit

| Method | Path | Permission |
| --- | --- | --- |
| GET/PUT | `/settings/business` | settings.manage |
| GET/PUT | `/settings/payment-methods` | settings.manage |
| GET | `/audit-logs` | audit.view |
| GET | `/notifications` | authenticated |
| POST | `/notifications/:id/read` | authenticated |
| POST | `/notifications/read-all` | authenticated |

## Platform (separate admin)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/platform/overview` | tenants, usage, GMV, plans |
| GET | `/platform/tenants` | search + pagination |
| GET/PATCH | `/platform/tenants/:id` | status, plan, feature overrides |
| GET/POST | `/platform/plans` | |
| GET | `/platform/audit` | cross-tenant audit |
| GET | `/platform/health` | DB size, migrations, money integrity |

## Idempotency contract

`operationId` is stored per tenant with a hash of the canonical payload and the
response snapshot. A replay with the same payload returns the same response
(`replayed: true`); the same id with a different payload returns
`409 CONFLICT_OPERATION_REUSED`. The idempotency row commits atomically with the
sale, refund or movement.

## Errors worth handling in the UI

`DOMAIN_SHIFT_NOT_OPEN`, `DOMAIN_INSUFFICIENT_STOCK`, `DOMAIN_PAYMENT_MISMATCH`,
`DOMAIN_REFUND_EXCEEDS`, `DOMAIN_SALE_IMMUTABLE`, `DOMAIN_TRANSFER_STATE`,
`DOMAIN_PURCHASE_STATE`, `AUTH_PERMISSION_DENIED`, `AUTH_STORE_FORBIDDEN`,
`CONFLICT_OPERATION_REUSED`, `AUTH_RATE_LIMITED`, `INFRA_DB_UNAVAILABLE`.
Each carries a user-safe Thai and English message.
