# POS Domain Skills Pack

A production-oriented knowledge pack for building, reviewing and operating a point-of-sale system
with OpenCode. Twelve focused skills cover the money path, the stock path, the cash drawer, offline
operation, multi-tenant isolation, Thai tax and receipts, loyalty, analytics, peripherals and
disaster recovery.

These are **engineering skills**, not legal or tax advice. Thai VAT and receipt rules must be
confirmed with the Revenue Department and a Thai accountant before go-live; see
`pos-thailand-commerce`.

## What is in the pack

```text
.agents/skills/
├── README.md                    ← this file
├── ARCHITECTURE.md              ← boundaries, contracts, ownership
├── ROUTING.md                   ← task/symptom → skill routing guide
├── VALIDATION.md                ← what was checked, with results
├── FILE-MANIFEST.md             ← every file created, with hashes
├── pos-domain-expert/           ← anchor: language, invariants, contracts
├── pos-sales-checkout/
├── pos-inventory-management/
├── pos-payment-reconciliation/
├── pos-shift-cash-management/
├── pos-offline-sync-engine/
├── pos-multi-tenant-saas/
├── pos-thailand-commerce/
├── pos-customer-loyalty/
├── pos-profit-intelligence/
├── pos-hardware-integration/
└── pos-backup-recovery/
```

Supporting tooling lives outside the skill source so it is never mistaken for a skill:

```text
scripts/validate-pos-skills.py   ← structural + consistency validator
.pos-baseline/                   ← pre-change inventory and validation output
```

## Requirements

- OpenCode with skill support (skills are advertised by `name` + `description` and loaded by ID).
- Python 3.10+ with PyYAML only if you want to run the validator. The skills themselves have no
  runtime dependency; code samples are illustrative TypeScript/SQL, not installable packages.

## Discovery and installation

OpenCode searches these project sources from the current directory up to the project root:

| Scope | Source |
| --- | --- |
| Project | `.opencode/skills/` |
| Project compatibility | `.claude/skills/`, `.agents/skills/` |
| Global | `~/.config/opencode/skills/` |
| Global compatibility | `~/.claude/skills/`, `~/.agents/skills/` |

This pack uses `.agents/skills/`, so it is discovered automatically when OpenCode runs anywhere
inside this repository. The skill ID is the **folder name** (for example `pos-sales-checkout`); the
frontmatter `name` is kept identical for portability.

To use the pack across all projects, copy (do not move) the twelve folders into
`~/.config/opencode/skills/` or `~/.agents/skills/`:

```powershell
Copy-Item -Recurse .agents\skills\pos-* "$env:USERPROFILE\.config\opencode\skills\"
```

To share with a team from another location or an HTTP catalog, add a `skills` entry to
`opencode.json`:

```jsonc
{
  "skills": ["./.agents/skills"]
}
```

Do not install two copies of the same ID. OpenCode resolves by ID and the later source wins, which
makes behaviour dependent on load order.

## How to invoke

**Automatic.** Describe the task; the model sees each skill's metadata and loads the relevant one:

```text
Our checkout total is off by 1 satang on baskets with a 10% order discount.
The drawer is short 120 baht after a shift with two card refunds.
Customers scan a PromptPay QR, the app marks the sale paid, but the money never arrives.
```

**Explicit.** Load a skill by ID when you know exactly what you need:

```text
@pos-payment-reconciliation review our webhook handler for duplicate captures
@pos-thailand-commerce check these receipt fields against the current requirements
```

**Chained.** Start broad, then go deep:

```text
Use pos-domain-expert to frame the change, then pos-offline-sync-engine for the queue design.
```

The anchor skill (`pos-domain-expert`) holds the shared contracts and a routing table. Specialist
skills are standalone: each restates the rules it needs, so loading one is sufficient for its scope.

## Skill catalog

| Skill | Owns | Load it for |
| --- | --- | --- |
| `pos-domain-expert` | Language, invariants, contracts, routing | Any POS task; cross-cutting design review |
| `pos-sales-checkout` | Cart, pricing, discounts, totals, sale lifecycle, receipt snapshot, void/refund | "Total is wrong", duplicate sale, split tender, part refund |
| `pos-inventory-management` | Stock ledger, costing, transfers, stocktake, BOM, lots | "Stock is wrong", overselling, shrinkage, COGS source |
| `pos-payment-reconciliation` | Payment lifecycle, webhooks, QR confirmation, settlement, chargebacks | Stuck payment, paid-but-not-completed, settlement mismatch |
| `pos-shift-cash-management` | Float, cash movements, X/Z reports, variance, handover | Close shift, drawer short/over, Z-report |
| `pos-offline-sync-engine` | Local DB, outbox, cursors, conflicts, clock skew | Offline sales, duplicates after reconnect, queue stuck |
| `pos-multi-tenant-saas` | Tenancy, RLS, provisioning, config, RBAC, plans | Isolation, tenant onboarding, roles, tenant settings |
| `pos-thailand-commerce` | VAT 7%, receipt/tax invoice, PromptPay boundaries, PDPA | Thai receipt fields, VAT math, e-Tax, QR rules |
| `pos-customer-loyalty` | Members, points ledger, tiers, coupons, consent | Points missing, redemption, tiers, coupon abuse |
| `pos-profit-intelligence` | COGS, margin, basket, ABC, promo ROI, metric contracts | Margin report, best sellers, "profit is down" |
| `pos-hardware-integration` | Scanner, printer, drawer, scale, EDC, kiosk | Printer/Thai text failures, barcode issues, device setup |
| `pos-backup-recovery` | RPO/RTO, PITR, restore, DR drills, device data | Backup design, restore, ransomware, DR plan |

Full routing by task and by symptom: [ROUTING.md](ROUTING.md).

## Shared contracts

Every skill assumes these. They are defined in `pos-domain-expert` and repeated where needed.

| Contract | Rule |
| --- | --- |
| Money | Integer minor units (satang), ISO currency, one rounding boundary |
| Time | UTC storage, store timezone for `business_date`, device clock untrusted |
| Idempotency | Client `operation_id` on every retryable mutation, unique per tenant |
| Ledger | Append-only stock, cash, points, payment events and audit |
| State | Explicit state machines; illegal transitions fail with a domain code |
| Audit | Actor, device, before/after, reason, correlation ID on sensitive actions |
| Tenancy | `tenant_id` in every key, query and policy, enforced in the database |

## Composition patterns

**New store go-live.** `pos-multi-tenant-saas` (tenant, store, RBAC) → `pos-thailand-commerce`
(tax/receipt config) → `pos-hardware-integration` (devices) → `pos-offline-sync-engine` (device
enrolment, number blocks) → `pos-shift-cash-management` (opening float) → `pos-inventory-management`
(initial load).

**Add a payment method.** `pos-payment-reconciliation` (lifecycle, webhook, settlement) →
`pos-sales-checkout` (tender gating, refunds) → `pos-thailand-commerce` (QR/document boundaries) →
`pos-shift-cash-management` (close rules) → `pos-profit-intelligence` (fees in margin).

**Offline incident.** `pos-offline-sync-engine` (queue, conflicts, ordering) →
`pos-sales-checkout` (sale facts) → `pos-payment-reconciliation` (unknown payment outcomes) →
`pos-shift-cash-management` (late sales vs closed shift).

**Month-end close.** `pos-shift-cash-management` (Z-reports, variance) →
`pos-payment-reconciliation` (settlement) → `pos-inventory-management` (COGS subledger) →
`pos-profit-intelligence` (metrics and reconciliation) → `pos-backup-recovery` (retention evidence).

**Security review.** `pos-multi-tenant-saas` (isolation, RBAC) → `pos-domain-expert` (audit,
idempotency) → `pos-payment-reconciliation` (PCI, webhooks) → `pos-hardware-integration` (device
trust) → `pos-thailand-commerce` (PII/PDPA).

## Conventions for extending the pack

- One folder per skill, folder name = frontmatter `name`, lowercase kebab-case, `pos-` prefix.
- `description` must say **what it does, when to trigger, and what it is not for**. Keep it under
  ~1,200 characters; it is the only thing always in context.
- Required sections: when to use, workflow, business rules, edge cases, security, error handling,
  testing requirements, anti-patterns, cross-skill references.
- Keep `SKILL.md` under ~500 lines. Put long reference material in `references/` beside it and point
  to it from the body.
- State invariants with IDs (`INV-01`) and contracts with IDs (`MONEY-01`) when they are shared.
- Cross-reference other skills by exact ID; never reference a skill that is not in the pack.
- Prefer concrete schemas, formulas and state machines over prose.
- Never add a rule that contradicts `pos-domain-expert`; change the anchor first, then the
  specialists.

## Validation

```powershell
python scripts/validate-pos-skills.py --root .agents/skills
```

Checks: folder/name match, YAML syntax, kebab-case IDs, description length and uniqueness,
required sections, cross-skill references, code-fence balance, placeholders, trailing whitespace,
line/word counts, and collisions with globally installed skills. Exit code is non-zero on any error.

Latest result and the full check list: [VALIDATION.md](VALIDATION.md).

## Maintenance

- Review the Thai content at every annual VAT/rate review and whenever the Revenue Department
  changes receipt or e-tax requirements. The date of the last review is recorded in
  `VALIDATION.md`.
- Re-run the validator after any edit; a broken frontmatter silently removes a skill from discovery.
- Bump a `version` note in `FILE-MANIFEST.md` when behaviour changes, and record what changed.
- Keep the pack free of customer-specific constants. Rates, thresholds and store names are
  configuration in the product, not text in a skill.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Skill not advertised | Missing `description`, wrong folder depth, hidden directory | Check path is `.agents/skills/<id>/SKILL.md` |
| Wrong skill loads | Overlapping description | Tighten the trigger and "Not for" clause |
| A skill ID changed meaning | Another source defines the same ID | Remove the duplicate; later source wins |
| `skill` tool not found | Not exposed in the harness | Invoke by mentioning `@<skill-id>` |
| Validator fails on YAML | Tabs, unquoted `:` in a plain scalar, bad indent | Use folded `>` scalars for descriptions |

## Scope and limitations

- The pack is engine- and vendor-neutral. Provider names appear only as categories; confirm SDK and
  API details against the current documentation.
- Thai legal statements are engineering summaries with explicit caveats, not filings advice.
- Code samples are patterns to adapt, not libraries. They assume PostgreSQL and TypeScript but the
  rules apply to any stack.
- Nothing in this pack replaces a security review, a penetration test, or an accountant's sign-off.
