---
name: pos-offline-sync-engine
description: >
  Designs the offline-first layer of a POS: local database, outbox queue, device registration and
  sequencing, push/pull sync protocol with cursors, idempotent replay, clock skew, conflict
  resolution per entity, catalog/price propagation, and sync observability. Use for "POS works
  offline", "sales not syncing", duplicate sales after reconnect, queue stuck, "sync conflict",
  ทำงานออฟไลน์, or multi-device consistency. Not for provider webhooks
  (pos-payment-reconciliation) or tenant isolation (pos-multi-tenant-saas).
---

# POS offline sync engine

A store's network is a rumour. The POS must keep selling during an outage, survive a power cut, and
reconcile every byte when connectivity returns — without duplicating a single sale or losing a single
movement. Offline support is not a cache; it is a distributed system with a small number of nodes and
a very expensive failure mode (real money, real stock, real tax receipts).

## When to use

- Building or debugging offline sale capture, queueing, retries or background sync.
- Sales duplicate, vanish, arrive out of order, or land on the wrong shift.
- Designing catalog/price/tax propagation to terminals.
- Handling device replacement, clock skew, or a device that has been offline for days.
- Choosing a conflict-resolution rule per entity.

**Not this skill:** payment provider confirmation and settlement
(`pos-payment-reconciliation`); cross-tenant access control (`pos-multi-tenant-saas`); backup and
restore of server data (`pos-backup-recovery`).

## Topology

```text
┌──────── device ────────┐         ┌──────── server ────────┐
│ SQLite (WAL)           │  push   │ ingest (validate,      │
│  ├ draft_sale          │ ──────▶ │  authorise, idempotent)│
│  ├ sale (local truth)  │         │  domain commands        │
│  ├ outbox (ordered)    │ ◀────── │  change log / cursors   │
│  ├ catalog cache       │  pull   │  per-device ack         │
│  └ sync_cursor         │         └────────────────────────┘
└────────────────────────┘
```

Rules:

1. The device is authoritative for **what the cashier did** (sale content, timestamps, local
   sequence). The server is authoritative for **money truth, stock truth and tenant policy**.
2. Every device-originated fact has a stable ID generated on the device (`operation_id`, UUIDv7) and
   is written locally *before* any network attempt.
3. The outbox is ordered, durable and transactional with the local state change.
4. Sync is pull + push, resumable, and safe to interrupt at any byte.
5. Nothing in the sync path may block the cashier's next sale.

## Local schema (minimum)

```sql
-- device-local SQLite
create table outbox (
  seq            integer primary key autoincrement,
  operation_id   text not null unique,
  entity_type    text not null,          -- sale | refund | stock_movement | shift | payment
  entity_id      text not null,
  payload        text not null,          -- canonical JSON, immutable
  payload_hash   text not null,
  state          text not null default 'pending'
                   check (state in ('pending','inflight','acked','rejected','conflict')),
  attempts       integer not null default 0,
  next_attempt_at text,
  last_error     text,
  created_at     text not null           -- device clock, ISO-8601 with offset
);

create table sync_state (
  key   text primary key,                -- 'pull_cursor', 'device_id', 'last_server_time'
  value text not null
);
```

Local sales must be readable and printable with no network. The printer path must not depend on the
server (`pos-hardware-integration`).

## Sync protocol

```text
loop every N seconds (and on reconnect / after each sale):
  1. HELLO   → device_id, app version, schema version, last_server_time, cursor
  2. PULL    → GET /sync/changes?cursor=…&limit=500
               returns ordered changes + next_cursor + server_time
  3. APPLY   → in a local transaction: upsert reference data, record cursor
  4. PUSH    → batch up to K outbox rows in seq order, each with operation_id + payload_hash
  5. RESULT  → per-item: acked | duplicate | rejected(code, detail) | conflict(detail)
  6. SETTLE  → mark acked (keep for audit N days), stop on rejected until resolved
  7. REPEAT  while more changes or more outbox rows
```

Protocol requirements:

- **Batching with per-item results.** One poison item must not block the whole queue; mark it
  `rejected`, surface it to the operator, continue with the rest.
- **Strict ordering per aggregate**, not necessarily globally. A refund must never arrive before its
  sale; a stock adjustment for a shift can be independent of another device's sales.
- **Ordered by `seq`**, retried with the same `operation_id` and identical payload. Any change to the
  payload for the same `operation_id` is a bug (server returns 409).
- **Server dedupe key**: `(tenant_id, operation_id)` unique, plus a natural key where one exists
  (e.g. `(tenant_id, store_id, receipt_no)`).
- **Cursor is opaque and monotonic** (server change sequence or `(updated_at, id)` tuple). Never a
  bare wall-clock timestamp: two rows can share a millisecond.
- **Idempotent pull**: applying the same change twice yields the same state.
- **Compression** for large catalog pulls; `ETag`/version to avoid re-sending unchanged catalogs.
- **Backpressure**: cap batch size and payload size; a 3-day-offline device must not send a 40 MB
  request that times out forever — chunk it and show progress.
- **Resumability**: an interrupted push re-sends the same batch; duplicates are expected and cheap.

## Clock skew and ordering

Device clocks drift, get set wrong, and change when staff "fix" them.

- `occurred_at` (device) is business-meaningful but **untrusted**; `received_at` (server) is trusted.
- Server rejects `occurred_at` more than a tolerance in the future (e.g. +10 min) by clamping and
  flagging, rather than failing the sale.
- Business date and shift attribution use `occurred_at` when plausible, else server time with a flag.
- Each device has a **monotonic local sequence** (`seq`) that is independent of the clock; use it for
  ordering within a device.
- Server returns `server_time` on every sync; devices compute an offset for display and for
  sanity-checking receipt timestamps, but never rewrite already-printed receipts.
- For cross-device ordering, use server receive order per aggregate, plus explicit timestamps for
  reporting only.

## Conflict resolution matrix

Choose per entity. Never apply one global rule.

| Entity | Strategy | Rationale |
| --- | --- | --- |
| Completed sale | Immutable append; server accepts once, dedupes | Money facts never merge |
| Refund | Append with cap check; reject if exceeds captured | Prevent over-refund |
| Stock movement | Append-only, no merge; negatives allowed by policy | Quantities are additive |
| Stock balance | Derived; server recomputes | Never sync a counter |
| Cash movement | Append-only, per shift | Cash is additive |
| Shift | Server-authoritative lifecycle; device may open offline and sync, close needs server ack or is provisional | Close is a server decision |
| Product/catalog | Server wins (last-writer on server) | Master data |
| Price/tax config | Server wins by version; device may keep an older version for open carts | Snapshot at sale |
| Customer profile | Field-level merge with `updated_at`; server wins on ties | Low risk |
| Loyalty points | Append-only ledger; server authoritative | Money-like |
| Settings | Server wins; device-only settings local | Policy |
| Draft cart | Device wins entirely | Never synced until completion |

If two devices legitimately change the same non-additive field, resolve deterministically, record the
loser in an audit record, and tell the user. "Last write wins" is acceptable only for non-financial,
non-audited metadata.

## Offline policy per capability

Define a table and put it in the product, not in a developer's head:

| Capability | Offline behaviour |
| --- | --- |
| Cash sale | Full support, completes locally, queued |
| Card present (EDC) | Only if the EDC supports store-and-forward **and** the merchant accepts the risk; floor limit enforced |
| QR/PromptPay | Do not confirm offline; create intent when online, else disable and say why |
| Refund to cash | Allowed within policy; queued |
| Refund to card/QR | Requires provider connectivity; queue the *request* only if the provider supports async |
| Stock lookup | From local cache, marked "as of &lt;time&gt;" when stale |
| Stock adjustment | Allowed with permission, queued |
| Shift open/close | Open locally; close requires server ack or becomes provisional |
| Receipt print | Always local |
| Tax invoice number | Allocated from a device-range lease, or blocked offline if legally required online |

Numbering offline: pre-allocate a receipt-number block per device (e.g. 5000 numbers) with expiry and
low-water alarms, so a device never invents a number the server will reject. Blocks are disjoint per
device, so the global sequence is unique; gaps are reported, not hidden.

## Conflict and recovery UX

The cashier is not a DBA. Every sync failure needs:

1. A plain-language state: "5 sales waiting to sync", "1 sale needs attention".
2. A resolution action: retry, print provisional receipt, call supervisor, or park.
3. A visible last-sync time, and an offline banner that is impossible to miss.
4. No modal that blocks selling unless money is genuinely at risk.
5. Logs exportable from the device for support, without PII.

## Workflow: implement or fix sync

1. **Map the data flow**: what is created on the device, what on the server, and which is
   authoritative for each field.
2. **Make local commits durable first** (WAL, outbox in the same transaction). No network call before
   the local commit.
3. **Implement the outbox** with `seq`, `operation_id`, immutable payload, attempts and state.
4. **Implement the server ingest** as an idempotent command handler: validate, authorise, dedupe, apply,
   append to the change log.
5. **Implement pull** with an opaque cursor and per-change IDs; make apply idempotent.
6. **Choose conflict rules per entity** from the matrix; write them in code as explicit policies.
7. **Add backoff, jitter, batching, chunking and a poison-item quarantine.**
8. **Surface state to the operator** (pending count, last sync, errors, resolution actions).
9. **Instrument**: queue depth, oldest pending age, ack latency, rejection reasons, per-device health.
10. **Test with chaos**: kill, flap, skew, duplicate, 10k backlog; assert convergence and no double
    effects.

## Business rules

- A sale is complete when the device says so (cash) — sync must not retroactively reject it. The
  server may flag it (`late`, `after_close`, `negative_stock`) but must accept the money fact.
- The server rejects only what would corrupt the books: duplicate `operation_id` with a different
  payload, unauthorised actor, tenant mismatch, or a refund exceeding the captured amount.
- If the server rejects a queued sale, the money is still real. Create an `unposted_sale` case,
  keep the local receipt valid, and require human resolution. Never delete the local record.
- Devices have a maximum offline window (configurable, e.g. 7 days); beyond it, force a sync and a
  supervisor acknowledgement before further trading, and warn about stale prices/tax.
- A device that is wiped or replaced must first push its outbox; if impossible, mark the device
  `retired_with_pending` and export before disposal.
- Catalog changes never invalidate a completed sale; open carts can be repriced only explicitly.
- Tax-rate changes apply from an effective time and are snapshotted per sale.

## Edge cases

| Case | Handling |
| --- | --- |
| Network flaps mid-push | Same batch retried; server dedupes by `operation_id` |
| Device crashes after local commit, before sync | Outbox survives in SQLite WAL; resume on boot |
| Two devices, same receipt number | Impossible if blocks are leased; if it happens, reject with `DUPLICATE_RECEIPT_NO` and investigate |
| Server rejects one item in a 200-item batch | Others ack; the item is quarantined and surfaced |
| Device offline for 30 days | Cap at policy window; on reconnect, chunked push, catalog full refresh |
| Clock set 2 years ahead | Clamp `occurred_at`, flag, continue; do not corrupt business dates |
| User reinstalls the app | Local data gone — require export/backup first; server cannot recreate unsynced cash sales |
| Sync runs while the cashier is mid-cart | Never mutate the open cart; apply reference data to new carts only |
| Tax rate changed while offline | Use the rate effective at `occurred_at` from the local config; server flags if it disagrees |
| Duplicate delivery of the same server change | Idempotent apply by change ID |

## Security

- Device enrolment: one-time code → device certificate or long-lived token bound to
  `(tenant_id, store_id, device_id)`. Revocation is immediate server-side.
- All traffic TLS; pin the server certificate if the threat model includes hostile store networks.
- Local DB encrypted at rest (SQLCipher or OS keystore); key in secure storage, not in a config file.
- Payloads signed or MAC'd with the device key to prevent tampering with queued amounts.
- Never sync secrets, provider keys, full customer PII or full card data to a device.
- Authorisation is re-checked server-side; a queued command carries the actor but not the authority.
- Replay protection: `operation_id` uniqueness plus a timestamp window for stale batches.
- Wipe remote command: revoke, then wipe local DB after confirming outbox state.

## Error handling

| Code | Retry | Device action |
| --- | --- | --- |
| `SYNC_OFFLINE` | yes (backoff) | Show banner, keep selling |
| `SYNC_AUTH_EXPIRED` | re-auth | Prompt for login, do not drop queue |
| `SYNC_SCHEMA_UNSUPPORTED` | no | Block sync, require app update, keep selling cash |
| `SYNC_PAYLOAD_TOO_LARGE` | split | Chunk automatically |
| `SYNC_DUPLICATE_OPERATION` | no | Treat as success, use server response |
| `SYNC_OPERATION_CONFLICT` | no | Quarantine, escalate |
| `SYNC_REJECTED_DOMAIN` | no | Quarantine with reason, notify supervisor |
| `SYNC_CURSOR_EXPIRED` | full resync | Re-pull reference data |
| `SYNC_SERVER_BUSY` | yes (jittered) | Backoff, do not spin |

Backoff: exponential with full jitter, cap ~5 minutes, reset on success. Never retry a `4xx`
domain rejection automatically.

## Testing requirements

- **Offline E2E**: disable network, complete 20 sales + 2 refunds + a stock adjustment, restart the
  device, restore network, assert exactly-once effects server-side.
- **Duplicate replay**: send the same batch 5 times concurrently → one effect per operation.
- **Poison batch**: one invalid item must not block the other 199.
- **Crash injection**: kill the process between local commit, push, ack, and pull-apply; assert
  convergence every time.
- **Clock skew**: device set ±2 years, ±10 minutes; business date, ordering and receipts stay sane.
- **Cursor**: gap-free pull under concurrent server writes; no missed or duplicated changes.
- **Long-offline**: 10k queued operations, chunking, memory ceiling, progress UI.
- **Number block**: exhaustion and expiry alarms; no cross-device collision.
- **Isolation**: a device token from tenant A cannot push into tenant B.
- **Property test**: after any interleaving, server state = fold of accepted operations in order.

## Anti-patterns

- Blocking the sale on network I/O, then retrying with a new ID.
- Syncing the cart before completion.
- A global `last_write_wins` on money or stock.
- Queueing in memory or `localStorage` instead of a transactional local DB.
- Timestamps as cursors.
- Deriving stock balances on the device and treating them as truth.
- Rejecting a completed cash sale because the shift closed — quarantining money facts.
- One giant request for the whole backlog.
- Silent retry loops with no operator-visible state.
- Reusing a receipt-number range across devices.
- Storing provider secrets on the device to "make QR work offline".

## Cross-skill references

Idempotency, money and time contracts: `pos-domain-expert`. Sale facts and completion:
`pos-sales-checkout`. Ledger merging: `pos-inventory-management`. Payment boundaries offline:
`pos-payment-reconciliation`. Shift attribution for late sales: `pos-shift-cash-management`. Tenant
and device auth: `pos-multi-tenant-saas`. Device-side printing and scanners:
`pos-hardware-integration`. Backup of the device DB: `pos-backup-recovery`.
