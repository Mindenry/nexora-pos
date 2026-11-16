---
name: pos-backup-recovery
description: >
  Designs POS backup and disaster recovery: RPO/RTO by tier, PostgreSQL PITR and base backups, object
  storage and document retention, device local-data protection, secret recovery, per-tenant restore,
  immutable/offsite copies, and restore drills with verification. Use for "backup strategy",
  "restore the database", ransomware, deleted sales, disaster recovery plan, or "how much data can we
  lose". Not for routine schema migrations (pos-multi-tenant-saas) or data model design
  (pos-domain-expert).
---

# POS backup & recovery

A backup you have never restored is a rumour. In a POS, the recovery target is not "the server is
up" — it is "we can prove which sales, receipts, stock movements and cash movements exist, and we can
trade again without reusing a document number".

## When to use

- Designing backup schedules, retention, offsite/immutable copies or DR tiers.
- A restore is needed: DB loss, bad migration, accidental delete, ransomware, region outage.
- Defining RPO/RTO for checkout, reporting and documents.
- Protecting device-local data and unsynced offline sales.
- Preparing audit evidence of recoverability.

**Not this skill:** application-level migrations belong in your own migration runbook; tenant
isolation design is `pos-multi-tenant-saas`; routine operational monitoring is out of scope.

## Define the targets first

Write these down with the business owner, per system, and test them.

| Tier | System | RPO | RTO | Notes |
| --- | --- | --- | --- | --- |
| 0 | Sale/stock/cash OLTP database | ≤ 5 min | ≤ 1 h | PITR, cross-region copy |
| 0 | Payment event log / webhook inbox | ≤ 5 min | ≤ 1 h | Must not lose provider events |
| 1 | Receipt & e-tax document store | ≤ 15 min | ≤ 4 h | Immutable objects, legal retention |
| 1 | Tenant config, sequences, templates | ≤ 5 min | ≤ 1 h | Losing sequences breaks numbering |
| 1 | Device local DB / outbox | ≤ 1 sale | ≤ 4 h | Device may be the only copy |
| 2 | Analytics warehouse | ≤ 24 h | ≤ 24 h | Rebuildable from OLTP |
| 2 | Logs/metrics | ≤ 1 h | ≤ 8 h | Forensic value |
| 3 | Dev/test | best effort | 3 days | Never restore prod into dev unmasked |

RPO (recovery point objective) = how much data you can lose. RTO (recovery time objective) = how long
until trading resumes. "Zero data loss" is a budget decision; state it honestly.

**Degraded mode matters more than the database**: if the server is down, can stores keep selling cash
offline? If yes, RTO for the server is hours; if no, it is minutes. Design the offline path as part of
DR, not as an afterthought (`pos-offline-sync-engine`).

## What must be backed up

| Asset | Method | Retention | Verification |
| --- | --- | --- | --- |
| PostgreSQL cluster | Base backup + WAL archive → PITR | 35–90 days PITR, monthly for 12 months | Monthly restore + query checks |
| Logical per-tenant dump | `pg_dump` filtered by tenant | Per contract | Restore into scratch, row counts |
| Object storage (receipts, e-tax XML, exports) | Versioning + replication + object lock | Statutory period | Sample object hash check |
| Tenant config & sequences | Included in DB; also exportable JSON | Same as DB | Diff after restore |
| Secrets/keys | Secret manager backup, sealed offline copy | Long-lived, dual control | Break-glass drill |
| Device local DB | Encrypted export on shift close or daily; cloud outbox | Until synced + 90 days | Restore on spare device |
| Printer templates / assets | Version-controlled repo | Forever | Build reproduces render |
| Infrastructure as code | Git + registry | Forever | Rebuild staging from scratch |
| Runbooks & contacts | Wiki + printed copy | Current | Quarterly review |

Not backed up (deliberately): session tokens, caches, temp files, and anything reproducible. Say so
explicitly so nobody assumes coverage.

## Backup architecture

```text
primary DB ──WAL──▶ archive bucket (versioned, object-lock, cross-region)
     │                     │
     ├── nightly base ─────┤
     └── logical dumps ────┘
                           ▼
              isolated restore account (no prod credentials)
                    │  monthly automated restore + assertions
                    ▼
              report: RPO met? RTO measured? checks passed?
```

Principles:

- **3-2-1-1-0**: 3 copies, 2 media, 1 offsite, 1 immutable/offline, 0 errors on verification.
- **Encrypt** at rest and in transit; keys are backed up separately with dual control. An encrypted
  backup whose key is lost is data loss.
- **Immutability / object lock** for the retention window: ransomware encrypts what it can reach.
- **Separate credentials**: the backup writer cannot delete or shorten retention; the restore account
  cannot be used from the production network.
- **Cross-region** for tier 0; cross-account for blast-radius isolation.
- **Time-sync** all servers; WAL timestamps and business dates depend on it.
- **Monitor the backups**, not just the database: alert on missed WAL, failed base backup, retention
  deletion anomalies, and restore-test failure.

## PostgreSQL PITR specifics

```bash
# base backup (physical, streaming)
pg_basebackup -D /backup/base/$(date +%F) -Ft -z -P -X stream -c fast

# archive WAL
archive_mode = on
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'
archive_timeout = 60

# recovery target
restore_command = 'cp /archive/%f %p'
recovery_target_time = '2026-11-16 10:42:00+07'
recovery_target_action = 'promote'
```

Rules:

- Test **point-in-time** restores at boundaries: just before a bad migration, mid-day, across a
  business-date boundary.
- A PITR restore produces a **new cluster**; never overwrite the damaged one until forensics is done.
- After restore, **reconcile document sequences**: the last issued receipt number may be ahead of the
  restored database (because devices hold leased blocks). Reissue must not reuse a number. Store a
  sequence high-water mark outside the DB (or in a append-only ledger) and take the max.
- Reconcile money and stock invariants (`pos-domain-expert` INV-01…INV-12) immediately after restore;
  a restore that is 5 minutes old is also 5 minutes behind on provider webhooks — replay them from the
  inbox/retention window.
- Reset replication slots, vacuum/analyze, and verify extensions are installed at the same versions.

## Per-tenant restore (shared schema)

This is the hard one and must be designed before it is needed.

Options, in order of preference:

1. **Point-in-time clone to a scratch environment**, then extract the tenant's rows with SQL and
   apply them as a compensating import into production. Never restore the whole DB over production
   for one tenant.
2. **Logical export per tenant** on a schedule (filtered `pg_dump` or `COPY` by `tenant_id`), so a
   tenant can be reconstructed without a cluster restore.
3. **Partition by tenant** (or schema-per-tenant) to make physical restore feasible.
4. **Compensating replay**: if the loss is rows deleted in production, prefer re-creating them from
   events/audit rather than a restore, to avoid rolling back other tenants.

Document the semantics: what does "restore tenant X to 10:00" mean for sales that arrived at 10:05?
Usually: restore to a **new** tenant/version or as an audited import, not a rollback of live data.

## Workflow: design backups for a POS stack

1. **Inventory the assets and their owners.** Database, object store, sequences, secrets, device
   data, IaC, templates, runbooks. Mark what is reproducible.
2. **Agree RPO/RTO per tier with the business**, including the offline-trading question. Write it in
   the contract language the customer sees.
3. **Choose mechanisms per asset**: PITR for OLTP, versioning + object lock for documents, encrypted
   export for device data, sealed copy for keys.
4. **Separate the blast radius**: different account/project, different credentials, immutable window,
   cross-region for tier 0.
5. **Automate verification**: restore into an isolated account on a schedule, assert invariants,
   measure duration, publish the result.
6. **Write the runbook** for each DR scenario with named roles, decision points and communication.
7. **Rehearse** quarterly, record actual RPO/RTO, and fix the gap rather than the document.
8. **Review retention and deletion** against legal obligations and customer contracts every year.

## Error handling

Backup and restore failures are incidents, not warnings.

| Code | Meaning | Action |
| --- | --- | --- |
| `BACKUP_WAL_GAP` | Archive missing a segment | Alert immediately; take a fresh base backup; assess RPO breach |
| `BACKUP_BASE_FAILED` | Base backup failed | Retry, page on-call, do not let retention delete the last good copy |
| `BACKUP_RESTORE_TEST_FAILED` | Verification restore failed | Freeze retention deletion, escalate, treat as no-backup |
| `BACKUP_KEY_UNAVAILABLE` | Cannot decrypt | Break-glass key process; audit |
| `BACKUP_RETENTION_BLOCKED` | Legal hold | Do not delete; record hold ID |
| `RESTORE_TARGET_INVALID` | Bad timestamp/LSN | Confirm target with incident commander |
| `RESTORE_SEQUENCE_CONFLICT` | Document numbers ahead of restored DB | Reconcile high-water mark before trading |
| `RESTORE_INVARIANT_FAILED` | Money/stock do not reconcile | Do not resume trading; investigate |
| `RESTORE_SCOPE_VIOLATION` | Cross-tenant data in a tenant restore | Stop, purge, security incident |

Never mark a backup "healthy" from job exit status alone. Health is a successful restore with passed
assertions.

## Device-side data

The register may hold the only copy of the last hour of sales.

- Write to a transactional local DB (SQLite WAL) and commit before printing.
- Encrypt at rest; back up the DB encrypted to the cloud on a schedule and before any update/wipe.
- Preserve the **outbox** separately from the DB snapshot; a restored DB with an empty outbox can
  duplicate or lose pushes.
- On device replacement: drain outbox → export → verify server receipt → revoke token → wipe.
- A stolen device is a data breach: remote revoke, remote wipe, and rotate any device-held keys.
- Define how long unsynced data may live only on a device (offline window) and alert when exceeded.

## Restore runbook (tier 0)

1. **Declare** an incident, name an incident commander, start a timeline log.
2. **Stop writes** to the damaged system (or isolate it) to prevent divergence.
3. **Choose the target**: last known good time, or the point before the damaging event. Record why.
4. **Provision** a clean cluster/instance from IaC; do not reuse the suspect host.
5. **Restore** base backup + WAL to the target; promote; verify version/extensions.
6. **Point the app** at the new instance via config/DNS; keep the old one read-only for forensics.
7. **Reconcile**:
   - counts: sales, payments, movements, shifts, receipts by business date;
   - invariants: `Σ tenders = total`, `on_hand = Σ movements`, shift cash;
   - sequences: receipt numbers vs highest issued anywhere;
   - external: replay provider webhooks after the restore point from the inbox;
   - documents: sample 20 receipts render byte-identically from snapshots.
8. **Resume trading** in a controlled order: back office → stores → online channels; watch error
   rates and sync backlog.
9. **Reconcile the gap**: sales completed offline during the outage are pushed; duplicates rejected by
   `operation_id`; anything rejected goes to human review.
10. **Post-incident**: publish actual RPO/RTO, what was lost, what changed, and update this runbook.

Practice this quarterly. Measure the time; a runbook nobody has executed is fiction.

## DR scenarios

| Scenario | Impact | Play |
| --- | --- | --- |
| DB corruption / bad migration | Writes fail | PITR to before migration, forward-fix, replay events |
| Accidental mass delete (app bug) | Missing rows | PITR clone + extract, or event replay; audit the bug |
| Ransomware | Encrypted primary + reachable backups | Restore from immutable/offline copy, rebuild hosts, rotate credentials |
| Region/provider outage | Unavailable | Fail over to secondary region; devices keep selling offline |
| Object storage loss | Receipts/e-tax docs missing | Restore from versioned replica; re-render from snapshots where legal |
| Device theft/loss | Local data exposure, unsynced sales | Remote wipe, revoke, reconstruct from server/outbox |
| Secret manager loss | Cannot decrypt/connect | Break-glass sealed key, rotate everything |
| Payment provider outage | No card/QR | Cash-only mode, queue, communicate |
| Clock/sequence corruption | Duplicate receipt numbers | Freeze issuance, reconcile high-water marks, renumber only unissued |

Each scenario needs a named owner, a decision authority, and a customer-communication template.

## Business rules

- Financial records are retained for the statutory period even after a tenant leaves; deletion is
  scheduled, not immediate (`pos-thailand-commerce` for Thai retention; confirm with counsel).
- Restores never reuse a receipt/tax-invoice number; a gap is documented, not hidden.
- A restore is not complete until reconciliations pass; "database is up" is not recovery.
- Backups containing personal data follow the same access and deletion rules as production.
- Test restores use masked or synthetic data; never restore production PII into a developer laptop.
- Every restore is audited: who, when, target time, reason, verification evidence.
- RPO/RTO commitments in customer contracts must match tested reality; if not, renegotiate or invest.

## Edge cases

| Case | Handling |
| --- | --- |
| Restore target falls during a shift | Shift stays open; sales after target replay from devices; Z-report reconciles |
| Restore loses a payment webhook | Replay from provider inbox by event ID; idempotent |
| Device numbers ahead of restored sequence | Take max(high-water, restored) and record the gap |
| Backup encrypted, key version rotated | Key ring keeps old versions; test decryption |
| Partial object-storage restore | Verify by manifest + hashes; never assume folder copy is complete |
| Restore into a different region | Check data residency obligations before moving PII |
| Tenant asks to be deleted, then restored | Deletion is scheduled; within the window, restore from backup; after, no |
| Backup job "succeeded" but WAL gap | Alert on `pg_stat_archiver` failures and gap detection |
| Long restore exceeds RTO | Communicate, extend offline trading, escalate; post-mortem |

## Security

- Encrypt backups (AES-256 or provider equivalent); separate key custody from backup custody.
- Immutable retention with legal hold; the app role cannot delete backups.
- Restore credentials are break-glass, MFA-protected, and audited; no standing admin access.
- Verify backup integrity with checksums and periodic full restore, not just job status.
- Scan restore environments for secrets/PII leakage before use.
- Protect the runbook itself: it lists systems and contacts, so treat it as sensitive but keep an
  offline copy.
- Supplier/cloud exit plan: can you export everything in a usable format? Test it annually.

## Testing requirements

- **Monthly automated restore** of tier 0 to an isolated account, with assertions: row counts by
  table, money/stock invariants, sequence high-water, sample receipt re-render, and measured RTO.
- **Quarterly full DR exercise** including DNS switch, app boot, device sync backlog, and provider
  webhook replay.
- **PITR boundary tests**: ±1 second around a known transaction; across midnight and month end.
- **Per-tenant restore** drill: extract one tenant, import to scratch, verify isolation and totals.
- **Ransomware simulation**: delete/encrypt primary and reachable copies; restore only from immutable.
- **Key-loss drill**: restore with a rotated key version.
- **Device restore**: restore a local DB + outbox on a spare device, push, verify exactly-once.
- **Retention**: verify deletions happen on schedule and legal holds block them.

Record the evidence: date, operator, target time, duration, checks passed, issues found.

## Anti-patterns

- Backups on the same host/account/region as production only.
- Never testing restores, or testing only "does it start".
- Backing up the database but not sequences, config, secrets or object storage.
- Restoring over production to fix one tenant.
- Reusing receipt numbers after a restore.
- Treating replication as a backup (it replicates deletes and corruption).
- Storing backup encryption keys with the backups.
- Relying on device data with no export path.
- Declaring RTO without measuring an actual restore.
- Keeping years of PII because "backups are forever".

## Cross-skill references

Invariants to verify after restore: `pos-domain-expert`. Document numbering and legal retention:
`pos-thailand-commerce`. Device outbox and offline window: `pos-offline-sync-engine`. Tenant export
and offboarding: `pos-multi-tenant-saas`. Payment event replay: `pos-payment-reconciliation`. Shift
and Z-report reconciliation after restore: `pos-shift-cash-management`.
