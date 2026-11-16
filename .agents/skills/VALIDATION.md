# Validation report

| Field | Value |
| --- | --- |
| Date | 2026-11-16 |
| Scope | `.agents/skills/` — 12 POS skills + 4 pack documents |
| Validator | `scripts/validate-pos-skills.py` (PyYAML 6.0.3, Python 3.15.2) |
| Second pass | `scripts/check-pack-graph.py` (independent YAML/reference parse) |
| Result | **12/12 skills present, 0 errors, 0 warnings** |
| Baseline | 68 globally installed skills at `~/.agents/skills`, 0 `pos-*` IDs, 0 collisions |

Nothing outside this pack was created, modified or deleted. The pre-change inventory of global
skills (path + SHA-256 + size) is stored in `.pos-baseline/global-skills-before.json`.

## 1. Structural checks

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Folder count matches the 12 required names | PASS | `skills: 12/12` |
| 2 | `SKILL.md` exists in every skill folder | PASS | 12 files parsed |
| 3 | Frontmatter starts at byte 0, valid YAML mapping | PASS | PyYAML `safe_load` on all 12 |
| 4 | `name` present, string, equals folder name | PASS | 12/12 exact match |
| 5 | `name` is lowercase kebab-case, 1–64 chars | PASS | regex `^[a-z0-9]+(-[a-z0-9]+)*$` |
| 6 | `description` present, non-empty, trigger-oriented | PASS | all contain purpose + "Not for …" |
| 7 | Description length within metadata budget | PASS | all < 1,400 chars (no warnings) |
| 8 | Descriptions unique | PASS | max Jaccard 0.256 (threshold 0.60) |
| 9 | Required sections present | PASS | 9/9 sections in every skill |
| 10 | Cross-skill references resolve to real IDs | PASS | 0 unknown IDs |
| 11 | Every skill referenced by at least one peer | PASS | min inbound = 3 (`pos-customer-loyalty`) |
| 12 | No ID collision with global skills | PASS | 68 global IDs, intersection empty |
| 13 | UTF-8 without BOM, LF endings | PASS | binary check |
| 14 | Balanced fenced code blocks | PASS | fence count even in all 12 |
| 15 | No placeholders (TODO/TBD/FIXME/XXX) | PASS | 0 matches |
| 16 | Line budget (progressive disclosure) | PASS | 235–325 body lines; limit 500 |
| 17 | H1 title unique per skill | PASS | 12 distinct titles |
| 18 | Live discovery by OpenCode | PASS | all 12 advertised in-session after creation |

`description` collision note: the highest overlap is `pos-payment-reconciliation` ↔
`pos-sales-checkout` at 0.256 — expected, since both discuss tenders, but each names the other in its
"Not for" clause so routing stays unambiguous.

## 2. Per-skill metrics

Body line counts exclude frontmatter; word counts are body tokens.

| Skill | Body lines | Words | Outbound refs |
| --- | ---: | ---: | ---: |
| `pos-domain-expert` | 325 | 2,865 | 11 |
| `pos-sales-checkout` | 325 | 2,293 | 8 |
| `pos-inventory-management` | 239 | 1,898 | 6 |
| `pos-payment-reconciliation` | 312 | 2,258 | 6 |
| `pos-shift-cash-management` | 256 | 1,993 | 7 |
| `pos-offline-sync-engine` | 285 | 2,329 | 8 |
| `pos-multi-tenant-saas` | 235 | 1,772 | 8 |
| `pos-thailand-commerce` | 308 | 2,603 | 7 |
| `pos-customer-loyalty` | 248 | 1,997 | 6 |
| `pos-profit-intelligence` | 248 | 1,976 | 8 |
| `pos-hardware-integration` | 299 | 2,417 | 8 |
| `pos-backup-recovery` | 288 | 2,377 | 6 |
| **Total** | **3,368** | **26,778** | — |

Reference graph (outbound / inbound) confirmed all twelve are connected; no orphans.

## 3. Content consistency review

Beyond linting, the formulas, state machines and lifecycles were read across skills and checked
against each other. Eight defects were found and fixed during the build:

| # | Defect | Where | Fix |
| --- | --- | --- | --- |
| 1 | `INV-01` said `Σ tenders = total`, contradicting cash overpayment/change | `pos-domain-expert` | Restated as `Σ tender.applied = grand_total`, change kept on the tender |
| 2 | `INV-02` added tax on top of a tax-inclusive net (double counting) | `pos-domain-expert` | Replaced with `Σ line.net + service + rounding = grand_total` |
| 3 | Line gross used `unit_price * qty` while the schema used `qty_milli` | `pos-sales-checkout` | Unified to `round(unit_price * qty_milli / 1000)` |
| 4 | Tender type had no `appliedAmount`, so the completion gate could overpay | `pos-sales-checkout` | Added `appliedAmount`/`changeAmount`; gate sums applied |
| 5 | Shift ownership was "server-owned" in sync but "open locally" in shifts | `pos-offline-sync-engine` | Aligned: server-authoritative, offline open allowed, provisional close |
| 6 | `refund_damaged` had an ambiguous `0 / +` direction | `pos-inventory-management` | Fixed to `+ into damaged` |
| 7 | VAT helper defined an unused rounding function and no exclusive-rate helper | `pos-thailand-commerce` | Replaced with tested inclusive/exclusive integer functions |
| 8 | Payment amount to provider described as "tender amount", not applied | `pos-payment-reconciliation` | Corrected to `tender.appliedAmount` |
| 9 | Shift expected-cash used "cash sales confirmed" (includes change) | `pos-shift-cash-management` | Corrected to `cash_sales_applied` (net of change) |

Cross-checked formulas that now agree:

- `vatFromInclusive(10,620, 700) = 695`, `base = 9,925`, matches the worked example in
  `pos-sales-checkout`.
- `Σ line.net + service + rounding = grand_total` (domain) matches the totals algorithm (sales).
- Refund caps exist in both sales (quantity/amount) and payments (captured amount).
- `business_date` is fixed at completion everywhere it is mentioned.
- Receipt numbers are never reused after void, device swap or restore (sales, offline, backup).

## 4. Requirement coverage

| Requirement | Primary skill | Concrete evidence in the body |
| --- | --- | --- |
| Transaction integrity | `pos-domain-expert` | Command pipeline, transaction boundary, INV-01/02/03 |
| Idempotency | `pos-domain-expert` | IDEM-01 + `idempotency_keys` table + replay tests |
| Inventory ledger | `pos-inventory-management` | Movement table, reason codes, balance projection |
| Payment lifecycle | `pos-payment-reconciliation` | State machine, provider port, settlement matching |
| Refund and void | `pos-sales-checkout` | Comparison table, caps, credit note link |
| Cash reconciliation | `pos-shift-cash-management` | Expected-cash formula, blind count, variance policy |
| Offline queue and sync | `pos-offline-sync-engine` | Outbox schema, protocol loop, number blocks |
| Conflict resolution | `pos-offline-sync-engine` | Per-entity conflict matrix |
| Multi-tenant data isolation | `pos-multi-tenant-saas` | RLS SQL, tenant-leading keys, IDOR test suite |
| Role-based access control | `pos-multi-tenant-saas` | Membership model, permission strings, store scope |
| Audit logging | `pos-domain-expert` | AUDIT-01 in anchor; per-module audit requirements |
| Thai VAT and receipts | `pos-thailand-commerce` | 7% math, document types, required fields, caveat |
| PromptPay integration boundaries | `pos-payment-reconciliation` | "What is not proof of payment" table + QR rules |
| Barcode and receipt printer | `pos-hardware-integration` | HID/GS1 parsing, ESC/POS, CP874/raster Thai |
| Backup and disaster recovery | `pos-backup-recovery` | RPO/RTO table, PITR, runbook, drills |

Explicit requirement "never assume QR generation confirms payment" appears in three independent
places: the proof-signal table (`pos-payment-reconciliation`), the PromptPay table
(`pos-thailand-commerce`), and the anti-pattern list of both skills.

## 5. Standalone audit

Each skill was read as if it were the only one loaded:

- The money, time, idempotency, ledger, state, audit and tenancy rules it depends on are restated in
  its own body, not left as "see sibling".
- Cross-skill sections are references for depth, not prerequisites; no workflow step requires opening
  another file.
- Every skill contains its own workflow, business rules, edge cases, security, error handling,
  testing requirements and anti-patterns.
- No skill assumes a specific vendor, cloud, framework or file layout.

## 6. What was not verified

Honest limits of this validation:

- **No application code exists in this repository**, so no unit/integration tests were executed. The
  test requirements are specifications for the implementing codebase, not passing test runs.
- **No database, payment sandbox, printer or scanner was exercised.** SQL and TypeScript samples were
  reviewed for correctness, not compiled.
- **No legal or tax review.** Thai rates, thresholds, document content and e-tax deadlines are
  engineering summaries with explicit "confirm with the RD/accountant" caveats. They were accurate to
  published rules as understood on 2026-11-16 and must be re-checked before filing or go-live.
- **No security penetration test.** The security sections enumerate controls and tests to implement.
- **Description routing was checked statistically, not with a live routing benchmark.** Live
  discovery succeeded, but trigger precision should be tuned from real usage.

## 7. Reproduce

```powershell
python scripts/validate-pos-skills.py --root .agents/skills --json .pos-baseline/validation-report.json
python scripts/check-pack-graph.py
```

Expected: exit code 0, `skills: 12/12 errors: 0 warnings: 0`, and no unknown or missing references.
The machine-readable result of the last run is `.pos-baseline/validation-report.json`.

## 8. Sign-off

| Gate | Status |
| --- | --- |
| All 12 skills exist with valid metadata | PASS |
| Descriptions unique and disambiguated | PASS |
| Required sections present | PASS |
| Cross-references resolve | PASS |
| Arithmetic and lifecycle consistency | PASS (9 defects fixed) |
| No existing skills modified | PASS (baseline hashes recorded) |
| Live discovery in OpenCode | PASS |
| Legal/tax accuracy | **Not signed off** — requires accountant review |
| Runtime behaviour | **Not applicable** — no application code in repo |
