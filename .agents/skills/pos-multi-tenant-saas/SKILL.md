---
name: pos-multi-tenant-saas
description: >
  Designs multi-tenant POS SaaS: tenancy model choice, tenant-leading keys and RLS, provisioning and
  onboarding, per-tenant configuration (currency, tax, receipt templates, device policy), plans and
  entitlements, store-scoped RBAC, support impersonation, quotas, offboarding and per-tenant
  migration. Use for "multi-tenant", "tenant isolation", "one database per customer", "role
  permissions", "tenant config", หรือ "SaaS onboarding". Not for single-store POS logic
  (pos-domain-expert) or Thailand tax rules (pos-thailand-commerce).
---

# Multi-tenant POS SaaS

In a POS SaaS, a tenant is a merchant whose money, stock, staff and tax records share infrastructure
with competitors. Isolation is not a feature; it is the product's licence to operate. Design it
structurally so a single forgotten `WHERE` cannot leak data.

## When to use

- Choosing or changing the tenancy model for a POS platform.
- Adding tables, endpoints or background jobs that must be tenant-scoped.
- Provisioning merchants, stores, devices and the first users.
- Designing plans, entitlements, quotas or per-tenant configuration.
- Implementing roles, permissions and store-level scoping.
- Offboarding: export, retention, deletion.

**Not this skill:** domain rules for sales, stock, cash
(`pos-sales-checkout`, `pos-inventory-management`, `pos-shift-cash-management`); Thai tax content
(`pos-thailand-commerce`); backup mechanics (`pos-backup-recovery`).

## Tenancy models

| Model | Isolation | Cost | Migration pain | Use when |
| --- | --- | --- | --- | --- |
| Shared schema + `tenant_id` + RLS | Logical (strong if enforced) | Lowest | Single schema migration | Default for SMB POS SaaS |
| Schema per tenant | Stronger logical | Medium (many schemas) | N migrations per deploy | Dozens–hundreds of tenants, per-tenant extensions |
| Database per tenant | Strongest, blast-radius small | High ops | Per-tenant upgrade orchestration | Enterprise, regulated, franchise with residency needs |
| Hybrid (pool + silo for large) | Varies | Medium-high | Routing complexity | Mixed customer sizes |

Choose one and write it down. The expensive mistake is a half-migration between models.

For shared schema, the non-negotiables:

```sql
alter table sale enable row level security;
alter table sale force row level security;

create policy sale_tenant_isolation on sale
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- tenant-leading composite keys so indexes are tenant-local
alter table sale add constraint sale_pk primary key (tenant_id, sale_id);
create index sale_store_date_idx on sale (tenant_id, store_id, business_date);
```

The application sets `app.tenant_id` per request/transaction from the **verified credential**, never
from the request body. Background workers must set it per job. `FORCE ROW LEVEL SECURITY` matters
because the table owner bypasses RLS otherwise.

## Tenant-scoped identity and access

```text
user ──* membership ──* tenant
             │
             └─ role (owner | admin | store_manager | cashier | accountant | auditor | support)
                  │
                  └─ permissions (string set) + scope (tenant | store[] | none)
```

Rules:

- A user identity can belong to several tenants; the **session selects one active tenant**.
- Roles are templates; effective permissions are computed and stored on the membership for audit.
- Store scope is data, not UI: a `store_manager` query is filtered by `store_id IN (...)` at the
  data layer.
- Permissions are verbs on aggregates: `sales.create`, `sales.void`, `sales.refund`,
  `shift.close`, `shift.variance.approve`, `inventory.adjust`, `inventory.cost.read`,
  `payments.refund`, `reports.financial.read`, `settings.tax.write`, `users.manage`.
- Platform staff get **no** implicit tenant access. Support access is a time-boxed, consented,
  audited impersonation grant (`support.impersonate`) with a visible banner and a reason.
- Deny by default; adding a new endpoint requires declaring a permission.

## Request pipeline

```text
authn (session/JWT/device cert)
  → resolve tenant from credential/membership (never from body)
  → authorise permission + store scope
  → open transaction, SET LOCAL app.tenant_id = …
  → domain command (RLS now applies)
  → outbox + audit
  → commit
```

Cache keys, object-storage paths, job payloads and search indexes all include `tenant_id`. A cache
key without a tenant is a data leak with extra steps.

## Provisioning workflow

1. **Create tenant**: legal name, tax ID, branch, address, currency (THB), timezone
   (`Asia/Bangkok`), locale, plan, data-residency choice.
2. **Seed configuration**: tax rates and effective dates, receipt template, rounding policy, price
   list, units, payment methods, document sequences, numbering blocks.
3. **Create first store** and locations (floor, backroom, damaged, in-transit).
4. **Create owner user** with a one-time invite; force MFA for owner/admin.
5. **Enrol devices** with one-time codes bound to store + device; issue device tokens.
6. **Import master data** (products, variants, barcodes, prices, opening stock) with an import
   report: accepted, rejected, warnings. Import is idempotent by external key.
7. **Rehearse a dry-run sale** in a sandbox store, then disable the sandbox.
8. **Record go-live**: opening stock movements, shift float, first receipt number.
9. **Emit provisioning events** and a checklist the onboarding team signs off.

Provisioning must be **transactional per step and resumable**. A half-provisioned tenant that can
take sales but has no document sequence is a legal incident.

## Configuration and versioning

Per-tenant, versioned by effective date — never a mutable global constant:

- tax rates and codes (with `effective_from`), rounding policy, service charge;
- currency and minor-unit exponent, locale, timezone;
- receipt/tax-invoice templates and legal footer text;
- discount limits, approval thresholds, refund windows;
- offline window, number-block size, payment methods, floor limits;
- feature flags tied to plan entitlements.

Sales snapshot the configuration they used. A config change must never alter a historical document.
Store config as rows with `(tenant_id, key, value, effective_from, version)`, and validate writes
against a schema per key. Do not let tenants write arbitrary JSON that the code trusts.

## Plans, entitlements and quotas

- **Entitlements** are named capabilities (`offline_mode`, `multi_store`, `e_tax_invoice`,
  `advanced_reports`, `api_access`), checked server-side at the action, not just hidden in the UI.
- **Quotas** are metered limits (stores, devices, users, monthly transactions, storage). Enforce with
  counters + a grace policy; never drop a completed sale because a quota was hit — block the *next*
  sale with a clear message, and always allow refunds and shift close.
- Downgrade path must be defined: what happens to stores above the new limit? Read-only for excess,
  not deletion.
- Billing events (`sale.completed` counts) flow through the same outbox, deduplicated.

## Isolation verification (this is the part teams skip)

Automated, per table and per endpoint:

1. **RLS coverage test**: enumerate all tenant-scoped tables from the catalog; assert RLS enabled,
   forced, and a policy exists. Fails CI when a new table lacks it.
2. **Cross-tenant read test**: for each entity type, create data in tenant A, authenticate as tenant
   B, attempt read/update/delete by ID → 404 (not 403, to avoid existence leaks).
3. **Query lint**: reject raw SQL without a tenant predicate on tenant-scoped tables (static check
   plus review).
4. **Job test**: enqueue a job for tenant A while context is B → job runs as A only.
5. **Cache test**: same key shape across tenants never returns the other tenant's data.
6. **Export/backup test**: a tenant export contains only that tenant's rows.
7. **Support access test**: expired impersonation grant is rejected and audited.

## Business rules

- Tenant suspension blocks new sales but allows refunds, shift close and data export.
- Deleting a tenant is a scheduled, reversible-for-N-days process: revoke access, export, retain
  financial records for the statutory period, then purge; never a hard `DELETE` on day one.
- Financial records are retained per jurisdiction even after contract termination (see
  `pos-thailand-commerce` for Thai retention expectations; confirm with counsel).
- A user removed from a tenant loses device access at next sync; open shifts must be closed or
  reassigned.
- Store closure keeps historical data; it does not delete shifts or sales.
- Tenant moves (sale of a business) require an explicit ownership-transfer flow, not a DB edit.

## Edge cases

| Case | Handling |
| --- | --- |
| User belongs to two tenants | Active tenant in session; every request re-derives it; switching re-issues the token |
| Device token from tenant A used against tenant B host | Reject at edge; alert |
| Tenant changes tax rate mid-day | Effective-dated config; sales snapshot; no retroactive change |
| Duplicate provisioning request | Idempotency key per tenant creation; return existing |
| Import with duplicate barcodes | Report per row; do not partially apply a row |
| Tenant exceeds device quota | Block new enrolment, keep existing devices working |
| Support impersonation forgotten | Auto-expire, banner, audit, notify tenant admin |
| Cross-tenant IDOR attempt | 404 + security event, never 403 with details |
| Tenant asks for a custom field | Configuration with validation, not a schema fork |
| Large tenant degrades others | Per-tenant rate limits and query budgets; noisy-neighbour alarms |

## Security

- Tenant ID comes from the credential; never trust `X-Tenant-Id` headers alone.
- RLS `FORCE` + a least-privilege app role that is not the table owner.
- Encrypt at rest; per-tenant KMS keys if the contract requires it; document key rotation.
- Secrets per tenant (payment credentials) in a secret manager under `tenant/{id}/...`, never in
  config rows.
- Audit log includes tenant, actor, impersonator, IP, user agent, before/after, reason.
- PII minimisation and PDPA duties (see `pos-thailand-commerce`): lawful basis, access/correction,
  deletion within legal limits, breach notification readiness.
- Rate limit per tenant and per device; lock out credential stuffing without harming the till.
- Data export is authorised, watermarked, logged and expiring.

## Error handling

| Code | HTTP | Meaning |
| --- | --- | --- |
| `TENANT_NOT_FOUND` | 404 | Unknown or not visible to the caller |
| `TENANT_SUSPENDED` | 403 | Billing/legal hold; refunds still allowed |
| `TENANT_SCOPE_FORBIDDEN` | 403 | Right permission, wrong store |
| `TENANT_QUOTA_EXCEEDED` | 409 | Limit reached; action-specific message |
| `TENANT_CONFIG_INVALID` | 422 | Config write failed schema validation |
| `TENANT_IMPERSONATION_EXPIRED` | 401 | Re-request support access |
| `TENANT_MIGRATION_IN_PROGRESS` | 503 | Retry-After; do not split writes |

Errors must not reveal whether data exists in another tenant. Log the real reason server-side with a
correlation ID.

## Testing requirements

- RLS coverage and policy tests in CI (fail on a new unscoped table).
- IDOR suite across every entity and verb, including nested resources and file downloads.
- Provisioning: idempotent, resumable, and complete (assert sequences, config, owner, store).
- Entitlement enforcement server-side for each gated action, including direct API calls.
- Quota boundary tests; refund/shift-close always allowed.
- Impersonation: grant, expire, revoke, audit trail completeness.
- Tenant export/erase: completeness and legal-retention exceptions.
- Performance: RLS query plans use `(tenant_id, …)` indexes; no full scans on 10M-row tables.
- Restore drill: restore one tenant's data without touching others (`pos-backup-recovery`).

## Anti-patterns

- Filtering by tenant only in the application layer, with no RLS or schema isolation.
- Taking `tenant_id` from the request payload.
- A shared cache/queue/storage bucket without tenant prefixes.
- Global sequences shared across tenants where document numbering must be per store.
- Hard-coding tax rates or receipt templates per deployment.
- Platform admin "god mode" without impersonation records.
- One tenant's heavy report starving checkout for everyone.
- Schema forks per customer ("just add a column for this merchant").
- Deleting a tenant immediately on churn, destroying statutory records.
- Feature flags enforced only in the UI.

## Cross-skill references

Domain invariants: `pos-domain-expert`. Device auth and offline policy:
`pos-offline-sync-engine`. Config used by sales and receipts: `pos-sales-checkout`. Thai legal
retention and tax config: `pos-thailand-commerce`. Financial reporting scoping:
`pos-profit-intelligence`. Backup and per-tenant restore: `pos-backup-recovery`. Audit chain:
`pos-domain-expert` AUDIT-01.
