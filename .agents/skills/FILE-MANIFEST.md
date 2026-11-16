# File manifest

Everything created by this task, with size, line count and SHA-256. No pre-existing file was
modified or deleted. `FILE-MANIFEST.md` itself is excluded because a file cannot contain its own
hash.

## Skill files (`.agents/skills/`)

| Path | Purpose | Bytes | Lines | SHA-256 |
| --- | --- | ---: | ---: | --- |
| `pos-domain-expert/SKILL.md` | Anchor: language, invariants, contracts, routing | 21,995 | 335 | `dfc25d5a1abc33699620e68a01927ca67aad174e5bd36f498e0ff67c2956edc0` |
| `pos-sales-checkout/SKILL.md` | Cart, pricing, totals, sale lifecycle, void/refund | 17,892 | 334 | `8d8d2991caef8b5e8385819ce76375c37f5e3d7365b55adc2dc7cefdb781d81b` |
| `pos-inventory-management/SKILL.md` | Stock ledger, costing, transfers, stocktake, BOM | 14,006 | 248 | `a929a479509e1415c867906046bb9cedff7365222a3e3421b1adefa575dd686c` |
| `pos-payment-reconciliation/SKILL.md` | Payment lifecycle, webhooks, settlement, chargebacks | 17,229 | 321 | `832d85643d57be3fafdf5e1b6e18ad099b4763d4c5ad9bfb8b3e0fcff58f5176` |
| `pos-shift-cash-management/SKILL.md` | Shift, float, cash movements, X/Z, variance | 14,397 | 265 | `fd957a0220c490e1d120ea34cd42be6556ec0d62402bf89b3f6d778aa9b0b63f` |
| `pos-offline-sync-engine/SKILL.md` | Local DB, outbox, sync protocol, conflicts | 16,880 | 294 | `3013a46ceaee2a30cd8d0b5d28fd4972805fea7fd6d02919ec2a0e6fe5fdef10` |
| `pos-multi-tenant-saas/SKILL.md` | Tenancy, RLS, provisioning, config, RBAC | 13,087 | 244 | `4cb54699fa2bef3a043181c059d79bd8158255ab1be142d4fe9c18a7418cae98` |
| `pos-thailand-commerce/SKILL.md` | VAT, Thai documents, PromptPay, PDPA | 18,598 | 317 | `d2028f87615ea2b859710c6b7b047faafcb99662c46eb4c4a64c2fb7c1bcaa48` |
| `pos-customer-loyalty/SKILL.md` | Members, points ledger, tiers, coupons, consent | 14,573 | 256 | `78b4a6807a5cd82f35a32f026daee9d0e7c49636c325a732f5c39af06fdd26dc` |
| `pos-profit-intelligence/SKILL.md` | COGS, margin, basket, ABC, metric contracts | 14,115 | 257 | `0643d9b56b11ad63538fac51a8e73c3b745bb352ff0c92cd1cf49eb7c3b68608` |
| `pos-hardware-integration/SKILL.md` | Scanner, ESC/POS printer, drawer, scale, EDC | 16,894 | 308 | `3d625651edd146019af1b8128ed4e7c3e204559c775caa06365beeb7f5baed69` |
| `pos-backup-recovery/SKILL.md` | RPO/RTO, PITR, restore, DR drills | 17,152 | 297 | `50122a0b99e9439f68ee84a2c3d61803d39e7b748d599196b0335d4c22e02b00` |
| `README.md` | Usage, install, catalog, conventions, troubleshooting | 11,022 | 218 | `4d33b78b4b956d0b76a079dfdf9f607660e7309a4b6d0c1c7278c63bf0a3195d` |
| `ARCHITECTURE.md` | Boundaries, capability/ownership matrices, contracts | 14,229 | 233 | `73a1d8e3195bb8278d142de8b93ca7fb93fc74a27639590696e9d374b42239fd` |
| `ROUTING.md` | Task/symptom routing, disambiguation, playbooks | 13,639 | 217 | `54aac0e43e06319c33df951b2206376b7d98c870713333053e5f0c1faa5d506d` |
| `VALIDATION.md` | Checks, results, defects fixed, limits, sign-off | 9,762 | 163 | `2468d6427a4e76b51f32e7f0e692c9d22bd8a6443fdc2c095d49b901df4bb6bc` |

## Supporting files (outside the skill source)

| Path | Purpose | Bytes | Lines | SHA-256 |
| --- | --- | ---: | ---: | --- |
| `scripts/validate-pos-skills.py` | Structural/consistency validator, non-zero exit on error | 11,554 | 311 | `e79063965a7f185a5a448af24115ab02d3ea5881c333ec035ab3f07c71666683` |
| `scripts/check-pack-graph.py` | Independent YAML, H1 and reference-graph check | 1,990 | 47 | `db77e50a979f0e7cdfa51e2458d7e453c7d39845b62cd091f6c626116571ef80` |
| `scripts/final-check.py` | Pre-delivery link, encoding and metadata check | 1,469 | 37 | `75ce363bc57c2c57e49c479ebbac4e65eb434e64c8de70d41ace8e091e47eea1` |
| `.pos-baseline/global-skills-before.json` | Pre-change inventory of 68 global skills | 17,402 | 410 | `6e2f7ca186ee928395357e46db1d317621c7082f867c12235c3d8d55ac32ae48` |
| `.pos-baseline/validation-report.json` | Machine-readable result of the final validation run | 37,729 | 894 | `548fca1587d83dfb96e490f147451574017f2880454f91b79cb0d3da27040ac0` |

## Totals

- Files created: **21** (16 in `.agents/skills/`, 3 scripts, 2 baseline artifacts)
- Pre-existing files modified: **0**
- Pre-existing files deleted: **0**
- Skill body content: **26,778 words** across 12 skills

## Change log

| Date | Change |
| --- | --- |
| 2026-11-16 | Initial pack: 12 skills, README, architecture, routing, validation, validator, baseline |
