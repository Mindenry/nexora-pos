# Verification log — 2026-11-16

All commands below were executed in this workspace. Failures found during the
runs were fixed before the final pass; this file records the final evidence.

## Static gates

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | ✅ all four workspaces, 0 errors |
| ESLint | `npm run lint` | ✅ 0 errors, 0 warnings |
| Production build | `npm run build` | ✅ API bundle + code-split SPA; main JS 370 kB (108 kB gzip) + lazy route chunks |
| Migration | `npm run db:migrate` | ✅ 7 migrations applied, checksums verified |

## Unit & integration

`npm test` → **4 files, 28 tests passed**:

- Integer money half-up, basis points, VAT from gross/net, largest-remainder
  allocation (including zero-weight totals).
- Pricing: tax-inclusive/exclusive reconciliation, line + order discounts,
  stackable coupon, exclusive coupon rejection, 300 randomised carts where line
  nets, tax and total reconcile exactly.
- Money input parsing (`1,234.50`, rounding, invalid input).
- Role defaults (owner all tenant permissions, no platform; cashier no product
  management or reports).
- **Real PostgreSQL integration** (`nexora_test`):
  - register tenant + owner + store, product creation, opening stock, shift open;
  - server repricing, cash checkout, receipt number, stock 10→8, drawer
    2,000→2,200 THB, payments sum = sale total;
  - replay of the same operation id returns the same sale and creates no second
    sale/stock/cash effect;
  - overselling blocked with no writes; payment mismatch rejected;
  - partial refund: amount 50%, restock, drawer reduced, refund cap enforced;
  - completed sale money update rejected by trigger (including after refund);
  - second tenant gets 0 products and 404 on another tenant's sale; direct SQL
    under the wrong tenant returns 0 rows (RLS);
  - cashier can sell but cannot create products or view reports;
  - shift close with counted cash = expected, variance 0 at 2,100 THB.
- **Operations integration** (separate clean schema):
  - purchase order draft → submitted → approved → partial receipt (stock +2) →
    full receipt (stock +5) → a third receipt is rejected with 409;
  - plan upgrade → second branch → transfer 4 units, dispatch reduces source,
    receive 3 then 1, destination +4, duplicate receipt rejected;
  - physical count of −3 writes a `stock_count` correction only for the variance;
  - 10% automatic promotion applies at quote and checkout, then void restores
    stock and marks the sale voided.

## End-to-end (real Chrome via Playwright)

`npx playwright test` → **7 passed (9–14s)**:

1. Login → POS → open shift → tap product → cash checkout → receipt number issued
   → new sale.
2. Sales list shows the completed sale and opens detail with items and payments.
3. Language switch TH → EN updates reports (“Gross sales”).
4. Mobile 390×844 dashboard and POS render.
5. Keyboard-only: F2 focuses search, Enter adds, F4 opens payment, Escape closes.
6. Offline: cash sale queue → reconnect → one POST `/pos/checkout` 201 → synced.
7. Platform admin console loads tenant overview.

Screenshots: `test-results/ui/*.png` (login, dashboard, products, inventory,
sales, shifts, reports, customers, purchasing, promotions, employees, settings,
POS, cart, checkout, dark mode, mobile, platform).

## Backup / restore drill

`pg_dump -Fc` with dedicated `nexora_backup` (BYPASSRLS) → `pg_restore` into
`nexora_restore_test`:

| Metric | Source | Restored |
| --- | --- | --- |
| sales | 341 | 341 |
| payments | 398 | 398 |
| inventory movements | 812 | 812 |
| sales total (satang) | 21,710,680 | 21,710,680 |
| payments total (satang) | 21,710,680 | 21,710,680 |

Money reconciles exactly after restore. `document_sequences` must be reconciled
against `max(number)` before accepting traffic post-restore (documented).

## Manual browser review

- 1440×900: dashboard trend after demo reseed distributes over 30 days; reports,
  products, purchasing, promotions, employees, settings, platform.
- 390×844: dashboard cards stack; store switcher hidden to keep the header usable;
  POS uses a two-column product grid and a bottom cart bar.
- Dark mode checked on dashboard.
- Found and fixed during review: compact currency formatting crash, demo history
  collapsed to today by device-clock clamp, toast covering the POS pay button,
  subscription read outside RLS (plan silently fell back to Starter), date
  serialisation on purchase orders.

## Not verified / requires external resources

- Real thermal printer, barcode scanner, cash drawer, scale, EDC.
- Licensed PromptPay/card provider webhooks, settlement and chargeback flow.
- External penetration test, WAF, PITR/offsite backup, load tests.
- Thai accountant/Revenue Department review of tax invoice fields.
