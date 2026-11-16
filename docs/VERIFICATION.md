# Verification log — 2026-11-16

All commands below were executed in this workspace. Failures found during the
runs were fixed before the final pass; this file records the final evidence.

## Static gates

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | ✅ all four workspaces, 0 errors |
| ESLint | `npm run lint` | ✅ 0 errors, 0 warnings |
| Production build | `npm run build` | ✅ API bundle + code-split SPA; main JS 373 kB (109 kB gzip) + lazy route chunks |
| Migration | `npm run db:migrate` | ✅ 7 migrations applied, checksums verified |

## Unit & integration

`npm test` → **4 files, 30 tests passed**:

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
    stock and marks the sale voided;
  - loyalty earn then redeem: 2 points earned on ฿200, 2 points redeemed for
    ฿2, balance and ledger reconcile, over-redemption rejected;
  - product image upload accepts a real PNG, serves it from `/uploads`, and
    rejects a spoofed signature with 422.

## End-to-end (real Chrome via Playwright)

`npx playwright test` → **17 passed (44s)**:

1. iPad Pro 11" touch (1194×834): tap product → keypad quantity 4 → touch pay →
   receipt issued → new sale.
2. iPad layout keeps cart, mute, customer display and fullscreen reachable.
3. iPad favourite star shows the quick strip and survives reload.
4. iPad denomination cash counter totals ฿2,300.00 and exposes **พิมพ์ X**.
5. Keyboard-wedge scanner types `8850000000001` outside an input and adds the
   product without focusing search.
6. Stock count scan `8850000000013` starts the counted quantity at 1.
7. Purchase order approve → scan `8850000000006` → receive footer ฿9.00.
8. Login → POS → open shift → tap product → cash checkout → receipt number issued
   → new sale.
9. Sales list shows the completed sale and opens detail with items and payments.
10. Language switch TH → EN updates reports (“Gross sales”).
11. Mobile 390×844 dashboard and POS render.
12. Keyboard-only: F2 focuses search, Enter adds, F4 opens payment, Escape closes.
13. Offline: cash sale queue → reconnect → one POST `/pos/checkout` 201 → synced.
14. Customer display: second window mirrors cart, then shows paid total and thank-you.
15. 1024×768 cashier layout keeps product grid, cart, display and fullscreen controls.
16. Loyalty: attach a customer, redeem points, receipt shows used/earned points.
17. Platform admin console loads tenant overview.

iPad visual captures: `test-results/visual/pos-ipad-landscape.png`,
`shift-cashcount-ipad.png`, `pos-ipad-portrait.png`.

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

- 1440×900 and 1366×768: dashboard rail with period comparison, reports,
  products, purchasing, promotions, employees, settings, platform.
- 1024×768 cashier: POS 3-column grid, cart, shift, customer-display and
  fullscreen controls; no header overflow.
- 768×1024 tablet: app header reduces to menu/title/search/notifications/user;
  POS wraps categories, keeps a 3-column grid and bottom cart bar.
- 390×844: dashboard cards stack; store switcher hidden to keep the header usable;
  POS uses a two-column product grid and a bottom cart bar.
- iPad Pro 11" landscape (1194×834, touch): 3-column product grid, favourites
  strip, cart sidebar, 36–48 px controls, no overlap of stock badge and star.
- iPad Pro 11" portrait (1024×1366, touch): 3-column grid with cart sidebar and
  a 2-row category rail; shift modal fits without scrolling the footer.
- iPad manifest, icons, safe-area padding and 16 px touch inputs verified; the
  app installs to the Home Screen and opens at `/pos` in standalone mode.
- 1920×1080: dashboard content stays capped and readable.
- Customer display checked at 1280×800 and 1024×768 (idle + cart).
- Dark mode checked on dashboard.
- Found and fixed during review: compact currency formatting crash, demo history
  collapsed to today by device-clock clamp, toast covering the POS pay button,
  subscription read outside RLS (plan silently fell back to Starter), date
  serialisation on purchase orders, receipt double-counting promotion discounts,
  header overflow at 768/1024, and a stale Vite module after rapid edits.

## Not verified / requires external resources

- Real thermal printer, barcode scanner, cash drawer, scale, EDC.
- Licensed PromptPay/card provider webhooks, settlement and chargeback flow.
- External penetration test, WAF, PITR/offsite backup, load tests.
- Thai accountant/Revenue Department review of tax invoice fields.
