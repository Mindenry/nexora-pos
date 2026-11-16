# Demo environment

> All demo data is fictional. `tenants.is_demo = true` and the UI shows a
> **ข้อมูลเดโม / Demo data** badge. Never use demo figures for accounting.

## Reset and seed

```powershell
npm run db:migrate
npm run db:seed
```

The seed deletes only tenants whose slug starts with `nexora-demo` and the
platform demo admin, then rebuilds the demo through the **real checkout
service**. It creates ~340 sales across 30 days, 18 refunds, 75 variants, two
branches, suppliers, purchase orders, three promotions and a dozen customers.
Running it again is safe and deterministic (seeded RNG).

## Logins

| Role | Email | Password |
| --- | --- | --- |
| Business owner | `owner@demo.nexora.local` | `NexoraDemo!2026` |
| Store manager | `manager@demo.nexora.local` | `NexoraDemo!2026` |
| Cashier — Siam | `cashier1@demo.nexora.local` | `NexoraDemo!2026` |
| Cashier — Thonglor | `cashier2@demo.nexora.local` | `NexoraDemo!2026` |
| Inventory | `inventory@demo.nexora.local` | `NexoraDemo!2026` |
| Accountant | `accountant@demo.nexora.local` | `NexoraDemo!2026` |
| Platform admin | `admin@nexora.local` | `NexoraAdmin!2026` |

The platform admin has no tenant and lands on `/platform`.

## Six-minute tour

1. **Overview** — 30-day sales, margin, payment mix, branch performance. Read the
   demo warning; all figures are real transactions from this database.
2. **Products** — 60 products, 75 variants, categories, reorder points. Open one
   and edit; archived products stay in sales history.
3. **Inventory** — on-hand is `sum(qty_delta)`. Adjust one item with a reason,
   then open Movements and see the appended ledger row.
4. **POS** — open a shift, scan `8850000000001` or tap a product, pay cash.
   The receipt number, stock deduction, cash movement and audit row are one
   transaction. Press `F2` to focus search, `F4` to pay.
5. **Customer display** — press the monitor icon in the POS header. It opens a
   second window for the customer showing the live cart, total and change. On a
   real counter, drag it to the second screen and press fullscreen.
6. **Loyalty** — attach a customer, press “ใช้คะแนน”; points convert at the
   configured satang value and the receipt shows points used and earned.
7. **Images** — edit a product, upload a real photo (PNG/JPEG/WebP) or pick one
   of the built-in category artworks. The POS and customer display use it.
8. **Sales** — open the newest receipt, refund one line, print the refund slip.
   Check the shift’s expected cash afterwards.
9. **Reports** — Sales / Profit / Tax / Inventory tabs; export CSV.
10. **Platform** — suspend a tenant (revokes sessions), change plan, edit plan
    definitions, inspect money integrity.

## iPad Pro / touch counter

1. Open the web app in Safari on the iPad, sign in, then **Share → Add to Home
   Screen**; the installed app launches at `/pos` in standalone mode.
2. Landscape (1194×834) shows three product columns plus the cart; portrait
   (1024×1366) keeps the cart beside the grid. Controls are 36–56 px, and touch
   inputs use 16 px text so Safari does not zoom on focus.
3. Tap a product, tap the quantity number in the cart, then use the large keypad
   to enter a quantity (capped by available stock).
4. Star a product to pin it to **รายการโปรด**. The strip survives reloads and is
   the fastest way to ring repeat items; with no favourites it shows recent
   sales instead.
5. Use the speaker icon to mute scan/sale beeps; touch devices also vibrate when
   supported.
6. A USB/Bluetooth scanner in HID mode with an Enter suffix works without
   focusing the search box: scan anywhere on the terminal.
7. Open the shift chip, count the drawer by denomination, and press **พิมพ์ X**
   for an 80 mm shift summary. Closing the shift prints the Z version.

## Offline rehearsal

1. Log in as cashier and open a shift online.
2. In DevTools → Network → Offline.
3. The terminal shows an offline banner and only cash is accepted.
4. Ring a cash sale; it is stored in IndexedDB with a UUIDv7 operation id.
5. Go back online. The queue syncs automatically; the sale appears in Sales with
   the server-issued receipt number. Replaying never duplicates it.

## Useful manual checks

- Barcode `8850000000001` is the first seeded variant.
- Inventory → **ตรวจนับสต๊อก** → scan `8850000000013`; the first scan starts the
  counted quantity at 1 and later scans increment it.
- Purchasing → open `PO-DEMO-002` → approve → scan `8850000000006`; one unit is
  added to the receive quantity and the footer total updates to ฿9.00.
- Shift panel → count 2×฿1,000 and 3×฿100; the helper totals ฿2,300.00 and copies
  it into counted cash. **พิมพ์ X** opens the 80 mm report.
- Coupon `WELCOME50` (min ฿500) cannot stack on the 10%-over-฿1,000 promotion.
- Seeded shifts are closed so the POS prompts you to open one.
