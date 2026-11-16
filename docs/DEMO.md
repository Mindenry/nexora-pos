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
5. **Sales** — open the newest receipt, refund one line, print the refund slip.
   Check the shift’s expected cash afterwards.
6. **Reports** — Sales / Profit / Tax / Inventory tabs; export CSV.
7. **Platform** — suspend a tenant (revokes sessions), change plan, inspect money
   integrity.

## Offline rehearsal

1. Log in as cashier and open a shift online.
2. In DevTools → Network → Offline.
3. The terminal shows an offline banner and only cash is accepted.
4. Ring a cash sale; it is stored in IndexedDB with a UUIDv7 operation id.
5. Go back online. The queue syncs automatically; the sale appears in Sales with
   the server-issued receipt number. Replaying never duplicates it.

## Useful manual checks

- Barcode `8850000000001` is the first seeded variant.
- Coupon `WELCOME50` (min ฿500) cannot stack on the 10%-over-฿1,000 promotion.
- Seeded shifts are closed so the POS prompts you to open one.
