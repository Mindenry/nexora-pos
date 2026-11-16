import type { DbClient } from '@nexora/db';

export interface AuditInput {
  tenantId: string | null;
  storeId?: string | null;
  actorUserId?: string | null;
  actorName?: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  correlationId?: string | null;
}

/** Append-only. Call inside the same transaction as the state change. */
export async function writeAudit(client: DbClient, input: AuditInput): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
      (tenant_id, store_id, actor_user_id, actor_name, action, entity_type, entity_id,
       before, after, reason, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
    [
      input.tenantId,
      input.storeId ?? null,
      input.actorUserId ?? null,
      input.actorName ?? '',
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.reason ?? null,
      input.correlationId ?? null,
    ],
  );
}
