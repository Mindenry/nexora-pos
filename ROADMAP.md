# NEXORA POS — Roadmap

Status legend: ✅ done and verified · 🟡 implemented, some verification pending ·
⬜ deferred (documented in `docs/ARCHITECTURE.md` §10)

## MILESTONE 0 — Discovery & planning ✅
- [x] Inspected workspace; preserved existing `.agents/skills` POS pack and baseline
- [x] Environment: Node 26, npm 11, PostgreSQL 18, Chrome, network
- [x] Stack decision and ADRs (`docs/DECISIONS.md`)
- [x] Domain model, invariants, permissions (`docs/DOMAIN.md`)
- [x] Database provisioning (`nexora` role, dev/test databases, RLS)
- [x] Architecture and honest limits (`docs/ARCHITECTURE.md`)
- [x] Repository baseline commit

## MILESTONE 1 — Project foundation ✅
- [x] npm workspaces: `apps/web`, `apps/api`, `packages/shared`, `packages/db`
- [x] Strict TypeScript, Vite, Tailwind 4, ESLint, Vitest, Playwright
- [x] Env loading, structured logs, correlation ids, consistent error envelope
- [x] Migration runner with checksums, advisory lock and rollback
- [x] `.env.example`, `.gitignore`, demo/ops/security docs

## MILESTONE 2 — Design system & application shell ✅
- [x] Light/dark tokens, Inter + IBM Plex Sans Thai, tabular numerals
- [x] Owned primitives: buttons, fields, tables, dialog, drawer, toast, tabs,
      empty/loading/error states, pagination, money input
- [x] Sidebar, header, store switcher, command palette (Ctrl/Cmd+K),
      notifications, user menu, mobile navigation
- [x] Responsive layouts verified at 1440×900 and 390×844
- [x] Reduced motion, focus rings, native labels, dialog focus trap

## MILESTONE 3 — Auth, tenancy, onboarding ✅
- [x] Register → tenant + business + store + roles + payment methods atomically
- [x] scrypt passwords, opaque sessions, login rate limit, logout, password change
- [x] RBAC catalogue, role defaults, API permission middleware, store scope
- [x] Onboarding checklist computed from real data
- [x] RLS isolation tested (another tenant gets 404/0 rows)

## MILESTONE 4 — Products & inventory ✅
- [x] Product CRUD, variants, barcodes, categories, brands, units
- [x] Product images: real uploads (signature-checked) + designed category artwork
- [x] CSV import/export, duplicate SKU/barcode constraints, archive
- [x] Movement-based stock (no editable balance), adjustments with reasons
- [x] Transfers with dispatch/receive and over-receipt protection
- [x] Stock counts producing `stock_count` corrections
- [x] Low-stock alerts
- [ ] Weighted/loose goods (deferred, integer qty)
- [ ] FIFO / moving-average costing (standard cost snapshot used)

## MILESTONE 5 — POS & checkout ✅
- [x] Barcode/SKU/name lookup, category rail, touch product grid, cart
- [x] Variants, quantities, line/order discounts, coupon, customer
- [x] Server-authoritative repricing, VAT inclusive/exclusive, exact allocation
- [x] Idempotent checkout with cash, split and manual-confirmed tenders
- [x] Receipt snapshot, print/reprint, held sales
- [x] Sales history/detail, void with permission and audit
- [x] Keyboard flow (F2 search, F4 pay, Escape) verified in Playwright
- [x] Offline cash queue + automatic idempotent sync verified in Playwright
- [x] Customer-facing second display (real-time cart, total, paid/change)
- [x] Loyalty points redemption with receipt/ledger/refund reversal
- [ ] Automated PromptPay/card provider (staff attestation only)

## MILESTONE 6 — Finance & operations ✅
- [x] Shifts: open, cash in/out, safe drop, expected vs counted, variance, Z summary
- [x] Refunds (partial/full) linked to sale lines, restock, tender caps
- [x] Suppliers, purchase orders, submit/approve, partial receiving, close
- [x] Supplier payment records
- [x] Audit trail for money/stock/permission operations
- [ ] Purchase returns and supplier credit notes (deferred)
- [ ] Provider settlement import / chargebacks (deferred)

## MILESTONE 7 — Customers & promotions ✅
- [x] Customer directory/profile/history, consent, PDPA anonymisation
- [x] Loyalty ledger, tiers, points liability, redeem at POS with refund/void restoration
- [x] Promotions: order/product/category %, fixed amount, coupons, min spend,
      time windows, usage limits, priority and explicit stacking rules
- [ ] Buy-X-get-Y / bundles (schema-ready, not exposed)

## MILESTONE 8 — Reports & analytics ✅
- [x] Dashboard KPIs from SQL, trend, top products, low stock, branches
- [x] Sales, category, payment, employee breakdowns
- [x] Profit with COGS snapshot and margin, tax summary
- [x] Inventory valuation and reorder list
- [x] Date presets/custom range, CSV export
- [ ] Warehouse/read-model caching (not needed at v1 volume)

## MILESTONE 9 — SaaS & offline ✅
- [x] Plans, subscriptions, store/employee limits, feature flags
- [x] Suspension revokes sessions; platform admin console
- [x] Platform overview, tenant detail, plan change, plan definition editor,
      audit, health/integrity
- [x] IndexedDB catalog cache + outbox, replay, failure display, manual retry
- [ ] Billing/invoicing integration for subscriptions (deferred)

## MILESTONE 10 — Hardening & release 🟡
- [x] Threat model and security controls (`docs/SECURITY.md`)
- [x] Unit/property/integration tests: 30 passing
- [x] E2E: 10 journeys passing on real Chrome (incl. offline, customer display,
      keyboard, loyalty redemption, 1024×768 cashier layout)
- [x] Typecheck, lint and production build clean
- [x] Browser visual review light/dark, desktop/mobile
- [x] Backup + restore drill with money reconciliation
- [x] Deployment, runbooks, production checklist (`docs/OPERATIONS.md`)
- [ ] External penetration test
- [ ] Real receipt printer/scanner/cash-drawer hardware test
- [ ] PITR/offsite backup in a real production environment
- [ ] Load/performance benchmarks at target volume

## Known deferred scope
Weighted goods, FIFO costing, purchase returns, provider settlement import,
chargebacks, e-Tax submission, BXGY/bundles, customer CSV import, custom role
builder, durable worker queue, multi-currency, email verification/password reset.
None are presented in the UI as working features; each is listed with rationale in
`docs/ARCHITECTURE.md` §10, `docs/DOMAIN.md` §8 and `docs/SECURITY.md`.
