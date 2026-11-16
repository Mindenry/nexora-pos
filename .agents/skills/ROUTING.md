# Skill routing guide

How to choose the right POS skill quickly, what to load when a problem spans several skills, and how
to avoid loading the wrong one.

## Routing model

OpenCode sees only each skill's ID, name and description until it loads one. Routing is therefore
driven by the **trigger words and the "Not for …" clause** in the description. Three ways to route:

1. **Automatic** — describe the task and let the metadata decide.
2. **Explicit** — `@pos-sales-checkout` (or the `skill` tool with the ID) when you know the scope.
3. **Anchored** — load `pos-domain-expert` first when the problem is cross-cutting, then the
   specialist.

Load at most two or three skills for one task. More than that usually means the task is not yet
scoped; split it.

## Route by task

| Task | Primary | Then |
| --- | --- | --- |
| Design a new POS module or review an existing one | `pos-domain-expert` | specialist by concern |
| Checkout flow, cart, pricing, discounts | `pos-sales-checkout` | `pos-thailand-commerce` for VAT |
| Sale total, tax line or rounding mismatch | `pos-sales-checkout` | `pos-thailand-commerce` |
| Receipt content, reprint, document numbering | `pos-sales-checkout` | `pos-thailand-commerce` |
| Void, refund, exchange, partial return | `pos-sales-checkout` | `pos-payment-reconciliation` |
| Stock levels, movements, adjustments | `pos-inventory-management` | `pos-domain-expert` |
| Stocktake or cycle count | `pos-inventory-management` | `pos-shift-cash-management` if cash impact |
| Costing, COGS, landed cost | `pos-inventory-management` | `pos-profit-intelligence` |
| Transfers between stores | `pos-inventory-management` | `pos-offline-sync-engine` |
| Payment stuck, paid-but-not-completed | `pos-payment-reconciliation` | `pos-sales-checkout` |
| QR / PromptPay confirmation | `pos-payment-reconciliation` | `pos-thailand-commerce` |
| Webhook signature or duplicate events | `pos-payment-reconciliation` | — |
| Settlement, fees, chargebacks | `pos-payment-reconciliation` | `pos-profit-intelligence` |
| Open/close shift, float, drawer count | `pos-shift-cash-management` | `pos-payment-reconciliation` |
| Z-report or variance approval | `pos-shift-cash-management` | `pos-thailand-commerce` |
| Offline sale or sync backlog | `pos-offline-sync-engine` | `pos-sales-checkout` |
| Duplicate sales after reconnect | `pos-offline-sync-engine` | `pos-sales-checkout` |
| Conflict resolution / clock skew | `pos-offline-sync-engine` | `pos-domain-expert` |
| Tenant isolation, RLS, onboarding | `pos-multi-tenant-saas` | `pos-backup-recovery` |
| Roles, permissions, store scope | `pos-multi-tenant-saas` | `pos-domain-expert` |
| Plans, entitlements, quotas | `pos-multi-tenant-saas` | `pos-profit-intelligence` |
| VAT 7%, tax invoice, credit note | `pos-thailand-commerce` | `pos-sales-checkout` |
| e-Tax Invoice integration | `pos-thailand-commerce` | `pos-payment-reconciliation` |
| PDPA / consent at the till | `pos-thailand-commerce` | `pos-customer-loyalty` |
| Members, points, tiers | `pos-customer-loyalty` | `pos-sales-checkout` |
| Coupons, vouchers, gift cards | `pos-customer-loyalty` | `pos-payment-reconciliation` |
| Points liability or promo ROI | `pos-profit-intelligence` | `pos-customer-loyalty` |
| Margin, best sellers, basket analysis | `pos-profit-intelligence` | `pos-inventory-management` |
| Shrinkage or stock accuracy reporting | `pos-profit-intelligence` | `pos-inventory-management` |
| Printer, scanner, drawer, scale, EDC | `pos-hardware-integration` | `pos-thailand-commerce` |
| Backup schedule, restore, DR | `pos-backup-recovery` | `pos-multi-tenant-saas` |
| Ransomware response | `pos-backup-recovery` | `pos-domain-expert` |

## Route by symptom

| What the user says | Load | Why not the obvious alternative |
| --- | --- | --- |
| "The total is off by one satang" | `pos-sales-checkout` | Not `pos-thailand-commerce` unless the VAT math itself is wrong |
| "VAT doesn't match the tax invoice" | `pos-thailand-commerce` | The document rules, not the cart, are at fault |
| "It says paid but no money arrived" | `pos-payment-reconciliation` | Confirmation is provider-side |
| "The drawer is short" | `pos-shift-cash-management` | First check card refunds via `pos-payment-reconciliation` |
| "Stock says 3, shelf says 0" | `pos-inventory-management` | Ledger and counts, not sales |
| "We sold the same unit twice" | `pos-inventory-management` | Negative-stock policy; sales already completed |
| "Sales duplicated after Wi-Fi came back" | `pos-offline-sync-engine` | Idempotency and queue, not payment |
| "Customer got points twice" | `pos-customer-loyalty` | Accrual idempotency |
| "Another store can see our data" | `pos-multi-tenant-saas` | Isolation, not reporting |
| "Receipt prints ??? for Thai" | `pos-hardware-integration` | Code page / raster, not translation |
| "Barcode scans the wrong item" | `pos-hardware-integration` | Symbology/GS1, not catalog |
| "We restored and now receipt numbers repeat" | `pos-backup-recovery` | Sequence high-water reconciliation |
| "Profit dropped but prices didn't" | `pos-profit-intelligence` | COGS source, mix or returns |
| "Shift can't close" | `pos-shift-cash-management` | Pending payments may be the cause |

## Decision tree

```text
Is the question about money that moved (or failed to move)?
├── Yes → Is it about whether the money is confirmed/settled?
│          ├── Yes → pos-payment-reconciliation
│          └── No  → Is it the sale content/price/tax/receipt? → pos-sales-checkout (+ pos-thailand-commerce)
└── No  → Is it about physical stock?
          ├── Yes → pos-inventory-management
          └── No  → Is it about the drawer/shift cash? → pos-shift-cash-management
                    Is it about the device/network/hardware?
                    ├── Network/queue → pos-offline-sync-engine
                    └── Peripheral → pos-hardware-integration
                    Is it about who can see/do what? → pos-multi-tenant-saas
                    Is it about a metric/report? → pos-profit-intelligence
                    Is it about a member/points/coupon? → pos-customer-loyalty
                    Is it about recovering data? → pos-backup-recovery
                    Otherwise → pos-domain-expert
```

## Disambiguation

These pairs overlap in wording; the boundary is deliberate.

| Pair | Boundary |
| --- | --- |
| `pos-sales-checkout` vs `pos-payment-reconciliation` | Sales owns the cart, totals, tender **gating** and refund documents. Payments owns provider intent, confirmation, capture, settlement, chargebacks. |
| `pos-payment-reconciliation` vs `pos-thailand-commerce` | Payments owns the money signal. Thailand owns what the document must say and how VAT is computed. A QR is generated in payments and described/filed under Thailand rules. |
| `pos-sales-checkout` vs `pos-thailand-commerce` | Sales computes generic totals with a tax code. Thailand supplies the 7% math, inclusive/exclusive convention, rounding and legal fields. |
| `pos-inventory-management` vs `pos-profit-intelligence` | Inventory records movements and freezes cost. Profit defines margin/COGS metrics and fact tables. Profit never posts stock. |
| `pos-shift-cash-management` vs `pos-payment-reconciliation` | Shift owns cash physically in the drawer and the Z-report. Payments owns card/QR confirmation and settlement batches. Shift close must check payment state, not confirm it. |
| `pos-offline-sync-engine` vs `pos-payment-reconciliation` | Sync transports facts and resolves conflicts. Payments decides whether a tender is confirmed; sync never marks it paid. |
| `pos-multi-tenant-saas` vs `pos-backup-recovery` | SaaS owns isolation and provisioning. DR owns copies, restores and per-tenant extraction mechanics. |
| `pos-customer-loyalty` vs `pos-profit-intelligence` | Loyalty owns the points ledger and programme rules. Profit values the liability and measures campaign ROI. |

## Playbooks

### 1. New store go-live

1. `pos-multi-tenant-saas` — tenant, store, roles, config, device enrolment.
2. `pos-thailand-commerce` — VAT registration status, document types, templates, numbering.
3. `pos-hardware-integration` — printer/scanner/drawer/EDC, Thai print test.
4. `pos-offline-sync-engine` — device registration, number block, offline policy.
5. `pos-inventory-management` — opening stock as one `initial_load` movement.
6. `pos-shift-cash-management` — float, first Z-report rehearsal.
7. `pos-backup-recovery` — go-live backup and restore evidence.

### 2. Add PromptPay

1. `pos-payment-reconciliation` — intent, QR, webhook/poll, refunds, settlement.
2. `pos-thailand-commerce` — QR payload constraints, receipt wording, VAT treatment.
3. `pos-sales-checkout` — tender gating, pending sale UX.
4. `pos-shift-cash-management` — close rules for pending QR.
5. `pos-hardware-integration` — customer-facing screen and print.

### 3. Investigate a duplicated-sale report

1. `pos-offline-sync-engine` — outbox, `operation_id`, retries, cursor.
2. `pos-sales-checkout` — uniqueness constraint, response replay, completion guard.
3. `pos-payment-reconciliation` — was the card/QR charged twice or only recorded twice?
4. `pos-shift-cash-management` — impact on the Z-report and drawer.
5. `pos-backup-recovery` — only if data must be reconstructed.

### 4. Month-end close

1. `pos-shift-cash-management` — all shifts closed, variances approved.
2. `pos-payment-reconciliation` — settlement matched, exceptions owned.
3. `pos-inventory-management` — movements reconcile to the subledger.
4. `pos-profit-intelligence` — revenue/VAT/COGS reconciliation to accounting.
5. `pos-thailand-commerce` — filing documents and retention.
6. `pos-backup-recovery` — evidence retained, restore still verified.

### 5. Security review

1. `pos-multi-tenant-saas` — isolation, RBAC, impersonation, secrets.
2. `pos-domain-expert` — audit, idempotency, input validation.
3. `pos-payment-reconciliation` — PCI scope, webhook verification.
4. `pos-hardware-integration` — device allowlist, escape injection.
5. `pos-thailand-commerce` — PII/PDPA handling and retention.
6. `pos-backup-recovery` — backup access, immutability, key custody.

### 6. Design review of a pull request

1. `pos-domain-expert` — which aggregate, which invariant, which transaction boundary.
2. Owner skill — the specific rules for that aggregate.
3. Adjacent skill only if the change crosses a boundary (e.g. sale → stock).

## Negative routing

Do **not** load a POS skill for:

- generic e-commerce carts with no store, shift, offline or receipt requirements;
- marketing copy, branding or visual design;
- cloud infrastructure unrelated to POS data (use the platform's own guidance);
- HR/payroll, general accounting software, or e-invoicing for non-retail businesses;
- game UI, mobile app styling, or unrelated frontend work.

If the task is "build a website for a restaurant", that is a web task. If it is "the restaurant's POS
cannot close a shift", that is `pos-shift-cash-management`.

## Multi-skill loading rules

1. **Anchor wins on conflict.** If a specialist contradicts `pos-domain-expert`, follow the anchor
   and report the contradiction so the specialist can be fixed.
2. **Owner writes, consumer reads.** Only the owning skill may define a rule for its aggregate.
3. **Transport is not truth.** `pos-offline-sync-engine` moves facts; it never decides money state.
4. **Legal beats convenience.** `pos-thailand-commerce` constraints on documents override UX
   preferences.
5. **Stop at three.** Beyond three skills, write a short design note first and route from that.

## Coverage check

Every required POS engineering area maps to at least one primary skill and one verification skill.

| Requirement | Primary | Verified by |
| --- | --- | --- |
| Transaction integrity | `pos-domain-expert` | `pos-sales-checkout`, `pos-inventory-management` |
| Idempotency | `pos-domain-expert` | `pos-offline-sync-engine`, `pos-payment-reconciliation` |
| Inventory ledger | `pos-inventory-management` | `pos-profit-intelligence` |
| Payment lifecycle | `pos-payment-reconciliation` | `pos-sales-checkout` |
| Refund and void | `pos-sales-checkout` | `pos-payment-reconciliation`, `pos-thailand-commerce` |
| Cash reconciliation | `pos-shift-cash-management` | `pos-payment-reconciliation` |
| Offline queue and sync | `pos-offline-sync-engine` | `pos-sales-checkout` |
| Conflict resolution | `pos-offline-sync-engine` | `pos-domain-expert` |
| Multi-tenant isolation | `pos-multi-tenant-saas` | `pos-backup-recovery` |
| Role-based access control | `pos-multi-tenant-saas` | `pos-domain-expert` |
| Audit logging | `pos-domain-expert` | all owners |
| Thai VAT and receipts | `pos-thailand-commerce` | `pos-sales-checkout` |
| PromptPay boundaries | `pos-payment-reconciliation` | `pos-thailand-commerce` |
| Barcode/printer integration | `pos-hardware-integration` | `pos-sales-checkout` |
| Backup and DR | `pos-backup-recovery` | `pos-multi-tenant-saas` |

## When to stop and ask a human

Route to a person, not a skill, when:

- the answer depends on the merchant's VAT registration or a specific tax ruling;
- a provider contract (settlement timing, chargeback liability, refund window) is unknown;
- the decision changes a legal document already issued;
- a restore would lose data that has not been quantified;
- the request is to bypass an approval, idempotency key, or audit record.

State the assumption, the risk, and what evidence is needed.
