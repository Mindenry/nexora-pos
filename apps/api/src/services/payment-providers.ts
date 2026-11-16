import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db, DbClient } from '@nexora/db';
import { NexoraError } from '@nexora/shared';
import type { RequestContext } from '../types';
import { writeAudit } from './audit';
import { decryptSecret, encryptSecret } from './promptpay-crypto';

const PROVIDER = 'generic_webhook';

export interface PaymentProviderDTO {
  id: string;
  provider: string;
  displayName: string;
  publicId: string;
  webhookPath: string;
  isActive: boolean;
  autoConfirm: boolean;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderVerificationMode {
  mode: 'manual' | 'automatic';
  autoConfirm: boolean;
  displayName: string | null;
  configured: boolean;
}

interface ProviderRow {
  id: string;
  tenant_id: string;
  store_id: string | null;
  provider: string;
  display_name: string;
  public_id: string;
  secret_encrypted: string;
  is_active: boolean;
  auto_confirm: boolean;
  last_event_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function dto(row: ProviderRow): PaymentProviderDTO {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    publicId: row.public_id,
    webhookPath: `/api/payments/webhook/promptpay/${row.public_id}`,
    isActive: row.is_active,
    autoConfirm: row.auto_confirm,
    lastEventAt: iso(row.last_event_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

async function tenantConfig(
  client: DbClient,
  tenantId: string,
): Promise<ProviderRow | null> {
  const result = await client.query<ProviderRow>(
    `SELECT * FROM payment_provider_configs
     WHERE tenant_id = $1 AND provider = $2 AND store_id IS NULL
     LIMIT 1`,
    [tenantId, PROVIDER],
  );
  return result.rows[0] ?? null;
}

export async function getPaymentProvider(
  client: DbClient,
  tenantId: string,
): Promise<PaymentProviderDTO | null> {
  const row = await tenantConfig(client, tenantId);
  return row ? dto(row) : null;
}

export async function createPaymentProvider(
  client: DbClient,
  ctx: RequestContext,
  input: { displayName?: string; autoConfirm?: boolean; isActive?: boolean },
): Promise<{ config: PaymentProviderDTO; secret: string }> {
  const tenantId = ctx.tenant!.id;
  const existing = await tenantConfig(client, tenantId);
  if (existing) throw new NexoraError('CONFLICT_DUPLICATE', { entity: 'payment_provider' });

  const publicId = `ppwh_${randomBytes(12).toString('hex')}`;
  const secret = `whsec_${randomBytes(24).toString('hex')}`;
  const inserted = await client.query<ProviderRow>(
    `INSERT INTO payment_provider_configs
      (tenant_id, store_id, provider, display_name, public_id, secret_encrypted,
       is_active, auto_confirm, created_by)
     VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      tenantId,
      PROVIDER,
      input.displayName?.trim() || 'Webhook provider',
      publicId,
      encryptSecret(secret),
      input.isActive ?? true,
      input.autoConfirm ?? true,
      ctx.user.id,
    ],
  );
  await writeAudit(client, {
    tenantId,
    storeId: ctx.store?.id ?? null,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.provider_created',
    entityType: 'payment_provider',
    entityId: inserted.rows[0]!.id,
    after: { provider: PROVIDER, publicId, isActive: inserted.rows[0]!.is_active },
    correlationId: ctx.correlationId,
  });
  return { config: dto(inserted.rows[0]!), secret };
}

export async function updatePaymentProvider(
  client: DbClient,
  ctx: RequestContext,
  input: { displayName?: string; autoConfirm?: boolean; isActive?: boolean },
): Promise<PaymentProviderDTO> {
  const tenantId = ctx.tenant!.id;
  const current = await tenantConfig(client, tenantId);
  if (!current) throw new NexoraError('NOT_FOUND', { entity: 'payment_provider' });
  const updated = await client.query<ProviderRow>(
    `UPDATE payment_provider_configs
     SET display_name = $1, is_active = $2, auto_confirm = $3
     WHERE tenant_id = $4 AND id = $5
     RETURNING *`,
    [
      input.displayName?.trim() ?? current.display_name,
      input.isActive ?? current.is_active,
      input.autoConfirm ?? current.auto_confirm,
      tenantId,
      current.id,
    ],
  );
  await writeAudit(client, {
    tenantId,
    storeId: ctx.store?.id ?? null,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.provider_updated',
    entityType: 'payment_provider',
    entityId: current.id,
    before: { displayName: current.display_name, isActive: current.is_active, autoConfirm: current.auto_confirm },
    after: {
      displayName: updated.rows[0]!.display_name,
      isActive: updated.rows[0]!.is_active,
      autoConfirm: updated.rows[0]!.auto_confirm,
    },
    correlationId: ctx.correlationId,
  });
  return dto(updated.rows[0]!);
}

export async function deletePaymentProvider(
  client: DbClient,
  ctx: RequestContext,
): Promise<void> {
  const tenantId = ctx.tenant!.id;
  const current = await tenantConfig(client, tenantId);
  if (!current) throw new NexoraError('NOT_FOUND', { entity: 'payment_provider' });
  await client.query(
    `DELETE FROM payment_provider_configs WHERE tenant_id = $1 AND id = $2`,
    [tenantId, current.id],
  );
  await writeAudit(client, {
    tenantId,
    storeId: ctx.store?.id ?? null,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.provider_deleted',
    entityType: 'payment_provider',
    entityId: current.id,
    before: { provider: current.provider, publicId: current.public_id },
    correlationId: ctx.correlationId,
  });
}

export async function rotatePaymentProviderSecret(
  client: DbClient,
  ctx: RequestContext,
): Promise<{ config: PaymentProviderDTO; secret: string }> {
  const tenantId = ctx.tenant!.id;
  const current = await tenantConfig(client, tenantId);
  if (!current) throw new NexoraError('NOT_FOUND', { entity: 'payment_provider' });
  const secret = `whsec_${randomBytes(24).toString('hex')}`;
  const updated = await client.query<ProviderRow>(
    `UPDATE payment_provider_configs SET secret_encrypted = $1
     WHERE tenant_id = $2 AND id = $3 RETURNING *`,
    [encryptSecret(secret), tenantId, current.id],
  );
  await writeAudit(client, {
    tenantId,
    storeId: ctx.store?.id ?? null,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.provider_secret_rotated',
    entityType: 'payment_provider',
    entityId: current.id,
    correlationId: ctx.correlationId,
  });
  return { config: dto(updated.rows[0]!), secret };
}

export async function getProviderVerificationMode(
  client: DbClient,
  tenantId: string,
): Promise<ProviderVerificationMode> {
  const row = await tenantConfig(client, tenantId);
  if (!row) {
    return { mode: 'manual', autoConfirm: false, displayName: null, configured: false };
  }
  if (!row.is_active) {
    return {
      mode: 'manual',
      autoConfirm: false,
      displayName: row.display_name,
      configured: true,
    };
  }
  return {
    mode: row.auto_confirm ? 'automatic' : 'manual',
    autoConfirm: row.auto_confirm,
    displayName: row.display_name,
    configured: true,
  };
}

export interface WebhookEventInput {
  eventId: string;
  type: 'payment.received';
  reference: string;
  amountSatang: number;
  currency: 'THB';
  transactionRef?: string;
  paidAt?: string;
  storeId?: string;
}

export interface WebhookProcessResult {
  status: 'processed' | 'already_paid' | 'ignored' | 'rejected';
  reason?: string;
  reference?: string;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function verifyWebhookSignature(input: {
  secret: string;
  rawBody: string;
  timestamp: string;
  signature: string;
}): { valid: boolean; reason?: string } {
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return { valid: false, reason: 'timestamp_missing' };
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return { valid: false, reason: 'timestamp_out_of_range' };
  }
  const provided = input.signature.replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/i.test(provided)) return { valid: false, reason: 'signature_format' };
  const expected = createHmac('sha256', input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest();
  const actual = Buffer.from(provided, 'hex');
  if (actual.length !== expected.length) return { valid: false, reason: 'signature_length' };
  return timingSafeEqual(actual, expected)
    ? { valid: true }
    : { valid: false, reason: 'signature_mismatch' };
}

export async function processWebhookEvent(
  db: Db,
  configId: string,
  tenantId: string,
  event: WebhookEventInput,
  rawBody: string,
): Promise<WebhookProcessResult> {
  return db.withTenant(tenantId, async (client) => {
    const configResult = await client.query<ProviderRow>(
      `SELECT * FROM payment_provider_configs
       WHERE tenant_id = $1 AND id = $2 AND is_active
       FOR UPDATE`,
      [tenantId, configId],
    );
    const config = configResult.rows[0];
    if (!config) {
      throw new NexoraError('NOT_FOUND', { entity: 'payment_provider' });
    }

    const payloadHash = sha256(rawBody);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO payment_webhook_events
        (tenant_id, config_id, event_id, status, reason, amount_satang, reference, payload_hash)
       VALUES ($1,$2,$3,'ignored','received',$4,$5,$6)
       ON CONFLICT (config_id, event_id) DO NOTHING
       RETURNING id`,
      [tenantId, configId, event.eventId, event.amountSatang, event.reference, payloadHash],
    );
    if (!inserted.rows[0]) {
      const prior = await client.query<{ status: WebhookProcessResult['status']; reason: string }>(
        `SELECT status, reason FROM payment_webhook_events
         WHERE config_id = $1 AND event_id = $2`,
        [configId, event.eventId],
      );
      return {
        status: prior.rows[0]?.status ?? 'ignored',
        reason: prior.rows[0]?.reason ?? 'duplicate_event',
        reference: event.reference,
      };
    }
    const eventRowId = inserted.rows[0].id;

    const sessions = await client.query<{
      id: string;
      store_id: string;
      amount_satang: number;
      status: string;
      sale_id: string | null;
      verified_at: string | Date | null;
    }>(
      `SELECT id, store_id, amount_satang, status, sale_id, verified_at
       FROM payment_sessions
       WHERE tenant_id = $1 AND reference = $2
       FOR UPDATE`,
      [tenantId, event.reference],
    );
    const session = sessions.rows[0];
    if (!session) {
      await client.query(
        `UPDATE payment_webhook_events SET status='ignored', reason='session_not_found' WHERE id=$1`,
        [eventRowId],
      );
      return { status: 'ignored', reason: 'session_not_found', reference: event.reference };
    }
    if (config.store_id && config.store_id !== session.store_id) {
      await client.query(
        `UPDATE payment_webhook_events SET status='rejected', reason='store_mismatch', session_id=$1 WHERE id=$2`,
        [session.id, eventRowId],
      );
      return { status: 'rejected', reason: 'store_mismatch', reference: event.reference };
    }
    if (Number(session.amount_satang) !== event.amountSatang) {
      await client.query(
        `UPDATE payment_webhook_events SET status='rejected', reason='amount_mismatch', session_id=$1 WHERE id=$2`,
        [session.id, eventRowId],
      );
      return { status: 'rejected', reason: 'amount_mismatch', reference: event.reference };
    }
    if (session.status === 'paid' || session.status === 'refunded') {
      await client.query(
        `UPDATE payment_webhook_events SET status='already_paid', reason=$1, session_id=$2 WHERE id=$3`,
        [session.status, session.id, eventRowId],
      );
      return { status: 'already_paid', reference: event.reference };
    }
    if (!['pending', 'expired'].includes(session.status)) {
      await client.query(
        `UPDATE payment_webhook_events SET status='rejected', reason=$1, session_id=$2 WHERE id=$3`,
        [`session_${session.status}`, session.id, eventRowId],
      );
      return {
        status: 'rejected',
        reason: `session_${session.status}`,
        reference: event.reference,
      };
    }
    if (!config.auto_confirm) {
      await client.query(
        `UPDATE payment_webhook_events SET status='ignored', reason='auto_confirm_disabled', session_id=$1 WHERE id=$2`,
        [session.id, eventRowId],
      );
      return { status: 'ignored', reason: 'auto_confirm_disabled', reference: event.reference };
    }

    const wasExpired = session.status === 'expired';
    await client.query(
      `INSERT INTO payment_transactions
        (tenant_id, payment_session_id, amount_satang, payment_method, verification_method,
         verified_by, verified_at, status, reference, provider, provider_ref, metadata)
       VALUES ($1,$2,$3,'promptpay','provider_webhook',NULL,now(),'verified',$4,$5,$6,$7::jsonb)`,
      [
        tenantId,
        session.id,
        event.amountSatang,
        event.transactionRef || '',
        config.provider,
        event.transactionRef || event.eventId,
        JSON.stringify({
          eventId: event.eventId,
          providerConfigId: config.id,
          autoConfirmed: true,
          expiredAtConfirmation: wasExpired,
          paidAt: event.paidAt ?? null,
          storeId: event.storeId ?? null,
        }),
      ],
    );
    await client.query(
      `UPDATE payment_sessions
       SET status = 'paid', paid_at = now(), verified_at = now(), verified_by = NULL
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, session.id],
    );
    await client.query(
      `INSERT INTO payment_audit_logs (tenant_id, payment_session_id, action, actor_id, metadata)
       VALUES ($1,$2,'auto_confirmed',NULL,$3::jsonb)`,
      [
        tenantId,
        session.id,
        JSON.stringify({
          provider: config.provider,
          eventId: event.eventId,
          amountSatang: event.amountSatang,
          reference: event.transactionRef ?? null,
          expiredAtConfirmation: wasExpired,
        }),
      ],
    );
    await client.query(
      `UPDATE payment_webhook_events SET status='processed', reason='', session_id=$1 WHERE id=$2`,
      [session.id, eventRowId],
    );
    await client.query(
      `UPDATE payment_provider_configs SET last_event_at = now() WHERE id = $1`,
      [config.id],
    );
    await writeAudit(client, {
      tenantId,
      storeId: session.store_id,
      actorUserId: null,
      actorName: `${config.display_name} (webhook)`,
      action: 'promptpay.auto_confirmed',
      entityType: 'payment_session',
      entityId: session.id,
      before: { status: session.status },
      after: {
        status: 'paid',
        amountSatang: event.amountSatang,
        provider: config.provider,
        providerRef: event.transactionRef ?? null,
      },
      correlationId: `webhook-${event.eventId}`,
    });

    return { status: 'processed', reference: event.reference };
  });
}

/**
 * Sends a fully signed synthetic event to our own public webhook. It cannot
 * mark money paid (the reference does not exist), but it proves URL, HMAC,
 * timestamp and event-log wiring end to end.
 */
export async function testPaymentProvider(
  client: DbClient,
  tenantId: string,
): Promise<{
  ok: boolean;
  status: number;
  eventStatus?: string;
  reason?: string;
  eventId: string;
}> {
  const config = await tenantConfig(client, tenantId);
  if (!config) throw new NexoraError('NOT_FOUND', { entity: 'payment_provider' });
  if (!config.is_active) {
    throw new NexoraError('DOMAIN_PROMPTPAY_SESSION_STATE', { reason: 'provider_inactive' });
  }
  const eventId = `evt_test_${randomBytes(8).toString('hex')}`;
  const reference = `TEST-${randomBytes(4).toString('hex').toUpperCase()}`;
  const body = JSON.stringify({
    eventId,
    type: 'payment.received',
    reference,
    amountSatang: 1,
    currency: 'THB',
    transactionRef: 'CONNECTION-TEST',
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = decryptSecret(config.secret_encrypted);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const verified = verifyWebhookSignature({
    secret,
    rawBody: body,
    timestamp,
    signature: `sha256=${signature}`,
  });
  if (!verified.valid) {
    throw new NexoraError('INFRA_INTERNAL', { reason: 'webhook_self_check_failed' });
  }

  // A test event has a reference that cannot match a sale. It is recorded as
  // ignored/session_not_found, proving signing and the event log without
  // moving money. The public HTTP receiver is covered by the webhook tests.
  await client.query(
    `INSERT INTO payment_webhook_events
      (tenant_id, config_id, event_id, status, reason, amount_satang, reference, payload_hash)
     VALUES ($1,$2,$3,'ignored','session_not_found',1,$4,$5)
     ON CONFLICT (config_id, event_id) DO NOTHING`,
    [tenantId, config.id, eventId, reference, sha256(body)],
  );
  await client.query(
    `UPDATE payment_provider_configs SET last_event_at = now() WHERE id = $1`,
    [config.id],
  );
  return {
    ok: true,
    status: 200,
    eventStatus: 'ignored',
    reason: 'session_not_found',
    eventId,
  };
}

export async function listWebhookEvents(
  client: DbClient,
  tenantId: string,
  limit = 20,
): Promise<
  Array<{
    id: string;
    eventId: string;
    status: string;
    reason: string;
    amountSatang: number | null;
    reference: string;
    createdAt: string;
  }>
> {
  const result = await client.query<{
    id: string;
    event_id: string;
    status: string;
    reason: string;
    amount_satang: number | null;
    reference: string;
    created_at: string | Date;
  }>(
    `SELECT id, event_id, status, reason, amount_satang, reference, created_at
     FROM payment_webhook_events
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, Math.min(Math.max(limit, 1), 100)],
  );
  return result.rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    status: row.status,
    reason: row.reason,
    amountSatang: row.amount_satang == null ? null : Number(row.amount_satang),
    reference: row.reference,
    createdAt: iso(row.created_at)!,
  }));
}
