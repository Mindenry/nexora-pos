# NEXORA POS — Operations

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string, app role with table ownership |
| `SESSION_SECRET` | yes | ≥32 chars, unique per environment |
| `API_PORT` | no | default 4000 |
| `WEB_ORIGIN` | yes | exact SPA origin for CSRF origin check |
| `NODE_ENV` | no | `development`, `test`, `production` |
| `LOG_LEVEL` | no | `debug`, `info`, `warn`, `error` |
| `UPLOAD_DIR` | no | persistent directory for uploaded product images; default `./uploads` under the API working directory |

The API loads the nearest `.env` walking up from its working directory. In
production prefer the platform secret manager; never bake secrets into the web
build.

## Local services

- API: `npm run dev:api` → `http://127.0.0.1:4000/api/health`
- Web: `npm run dev:web` → `http://localhost:5173` (proxies `/api`)
- PostgreSQL: the project uses a dedicated `nexora` role and `nexora_dev` /
  `nexora_test` databases. Migrations are idempotent and checksummed.

## Commands

| Command | Use |
| --- | --- |
| `npm run db:migrate` | Apply pending migrations (advisory-locked) |
| `npm run db:seed` | Rebuild the demo tenant via the real checkout engine |
| `npm run db:reset` | Drop public schema, migrate, seed (dev only, destructive) |
| `npm run build` | Bundle API + SPA |
| `npm run typecheck` / `npm run lint` | Quality gates |
| `npm test` | Unit + real-Postgres integration tests |
| `npm run test:e2e` | Playwright critical journeys (requires seed) |

## Deployment shape (v1)

Same-origin deployment is required for cookies (`SameSite=Lax`):

```
browser ── HTTPS ── reverse proxy ── /api → node dist/index.js (API :4000)
                                  ├── /uploads → API static images
                                  └── /    → static apps/web/dist
```

1. Build (`npm run build`).
2. Run migrations once per release (`npm run db:migrate`).
3. Start API with production env; keep 1+ instances behind the proxy.
4. Serve the SPA with cache-busting hashed assets; `index.html` no-cache.
5. Set HSTS, a strict CSP for the SPA, TLS 1.2+, and a request body limit at the
   proxy as well as in the API.
6. Health check `/api/health`; alert on non-200 and on `INFRA_DB_UNAVAILABLE`.
7. Do not horizontally scale until rate limiting and sessions move to Redis.

## Backup and restore

RPO/RTO for the demo: RPO 24h, RTO < 1h. Production target: PITR with WAL
archiving (RPO ≤ 5 min), daily base backups, 30-day retention, one immutable
offsite copy.

### Logical backup

`FORCE ROW LEVEL SECURITY` applies even to the table owner, so `pg_dump` needs a
dedicated role with `BYPASSRLS`. The project provisions `nexora_backup` for this
and grants `SELECT` on all current and future tables/sequences:

```sql
-- run as a superuser once
CREATE ROLE nexora_backup LOGIN BYPASSRLS PASSWORD '…';
GRANT CONNECT ON DATABASE nexora_dev TO nexora_backup;
GRANT USAGE ON SCHEMA public TO nexora_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO nexora_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO nexora_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE nexora IN SCHEMA public
  GRANT SELECT ON TABLES TO nexora_backup;
```

```powershell
$env:PGPASSWORD = (Get-Content .db-credential-backup -Raw).Trim()
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U nexora_backup -h 127.0.0.1 -p 5432 `
  -Fc -f "backups\nexora-$(Get-Date -Format yyyyMMdd-HHmm).dump" nexora_dev
```

### Restore drill (performed 2026-11-16)

```powershell
createdb -U nexora -h 127.0.0.1 -p 5432 nexora_restore_test
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -U nexora -h 127.0.0.1 -p 5432 `
  --no-owner --no-privileges -d nexora_restore_test backups\nexora-drill.dump
```

Verify after restore (RLS hides rows without a tenant context):

```sql
SELECT set_config('app.tenant_id', '<tenant-uuid>', false);
SELECT count(*) FROM sales;
SELECT count(*) FROM sale_items;
SELECT count(*) FROM inventory_movements;
SELECT sum(total_satang) FROM sales WHERE status <> 'voided';
SELECT sum(amount_satang) FROM payments p JOIN sales s ON s.id=p.sale_id
  WHERE s.status <> 'voided' AND p.status IN ('paid','partially_refunded','refunded');
```

Result of the drill: source and restored database both returned **341 sales,
398 payments, 812 inventory movements, sales total 21,710,680 satang and paid
total 21,710,680 satang**. Sales and payments reconcile exactly after restore.

After a restore, reconcile `document_sequences` high-water marks before accepting
sales (compare `max(number)` per store to `next_number`) so receipt numbers never
repeat. Do not reuse numbers. If the restore target is a different database,
grant the backup role on that database or restore as the application owner.

### Product image storage

Uploaded images live outside PostgreSQL in `UPLOAD_DIR`. Back them up with the
database using the same schedule:

```powershell
Compress-Archive -Path uploads\* -DestinationPath backups\uploads-$(Get-Date -Format yyyyMMdd).zip
```

Restore the archive to the same `UPLOAD_DIR` path so `/uploads/...` references
continue to resolve. Images are content-addressed by UUID filenames; a missing
image degrades to the product initial, but the sale/receipt is unaffected.



## Incident runbooks

### Duplicate sale after retry

1. Search `idempotency_keys` for the operation id and confirm one response.
2. If two sales exist, the second was created with a different operation id:
   refund the duplicate with a reason, keep both audit records.
3. Do not delete sales. `sales` rows are immutable by trigger.

### Stock drift

1. Open Inventory → Movements filtered by variant.
2. Sum `qty_delta` for the store; compare with the physical count.
3. Record a stock count; the correction is a new `stock_count` movement.

### Drawer variance

1. Check refunds and cash in/out for the shift before assuming theft.
2. Close with the real counted cash; variance is stored and notified.
3. Investigate card/QR tenders; they do not affect drawer cash.

### Offline queue stuck

1. Open POS → Sync. Read the per-item error.
2. `DOMAIN_SHIFT_NOT_OPEN` means the local shift was closed server-side; reopen a
   shift, then retry — the operation id still guarantees one sale.
3. `DOMAIN_INSUFFICIENT_STOCK` means the server policy blocks the replay; correct
   stock with an audited adjustment or refund the local cash sale deliberately.
4. Never edit IndexedDB or delete the queue without recording the cash sale in
   the incident log.

### Database restore

1. Stop API traffic.
2. Restore to a new database, run invariant queries, then switch `DATABASE_URL`.
3. Reconcile sequences and re-check sales/payment totals.
4. Replay any payment provider webhooks that arrived during the outage.

## Production go-live checklist

- [ ] Real secrets in a secret manager; `.env` absent from the server image
- [ ] TLS + strict SPA CSP + HSTS at the proxy
- [ ] PITR enabled and a restore drill signed off
- [ ] Redis for sessions/rate limits before >1 API instance
- [ ] Licensed payment provider with signed webhook + settlement import
- [ ] Thai accountant review of receipt / tax invoice fields and VAT rounding
- [ ] PDPA records, consent text, retention job, DPO contact
- [ ] Dependency audit and external penetration test
- [ ] Monitoring: API latency/error, DB connections, disk, failed sync queue
- [ ] Receipt printer/scanner tested on the real hardware and code page
- [ ] Staff training: open/close shift, refunds, offline queue
