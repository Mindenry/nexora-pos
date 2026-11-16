import { createHash } from 'node:crypto';
import type { DbClient } from '@nexora/db';
import { NexoraError } from '@nexora/shared';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function requestHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export interface IdempotentResult<T> {
  data: T;
  replayed: boolean;
}

/**
 * Replay-safe command execution. The idempotency row lives in the same
 * transaction as the domain writes: a rollback leaves no half-record.
 */
export async function runIdempotent<T>(
  client: DbClient,
  params: { tenantId: string; operationId: string; scope: string; payload: unknown },
  fn: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  const hash = requestHash(params.payload);
  const inserted = await client.query(
    `INSERT INTO idempotency_keys (tenant_id, operation_id, scope, request_hash, status)
     VALUES ($1,$2,$3,$4,'processing')
     ON CONFLICT (tenant_id, operation_id) DO NOTHING
     RETURNING operation_id`,
    [params.tenantId, params.operationId, params.scope, hash],
  );

  if (inserted.rowCount === 0) {
    const existing = await client.query<{
      scope: string;
      request_hash: string;
      response: unknown;
      status: string;
    }>(
      `SELECT scope, request_hash, response, status
       FROM idempotency_keys
       WHERE tenant_id = $1 AND operation_id = $2
       FOR UPDATE`,
      [params.tenantId, params.operationId],
    );
    const row = existing.rows[0];
    if (!row) throw new NexoraError('CONFLICT_OPERATION_REUSED');
    if (row.request_hash !== hash || row.scope !== params.scope) {
      throw new NexoraError('CONFLICT_OPERATION_REUSED');
    }
    if (row.status === 'completed' && row.response) {
      return { data: row.response as T, replayed: true };
    }
    throw new NexoraError('CONFLICT_OPERATION_REUSED');
  }

  const data = await fn();
  await client.query(
    `UPDATE idempotency_keys
     SET response = $3::jsonb, status = 'completed'
     WHERE tenant_id = $1 AND operation_id = $2`,
    [params.tenantId, params.operationId, JSON.stringify(data)],
  );
  return { data, replayed: false };
}
