import { createHash, randomBytes } from 'node:crypto';
import type { DbClient } from '@nexora/db';
import {
  NexoraError,
  type PromptPayAccountInput,
  type PromptPayAccountUpdate,
  type PromptPayCancelInput,
  type PromptPayConfirmInput,
  type PromptPaySessionCreateInput,
} from '@nexora/shared';
import QRCode from 'qrcode';
import {
  buildPromptPayPayload,
  decodePromptPayPayload,
  validateIdentifier,
  type PromptPayIdentifierType,
} from '@nexora/promptpay';
import type { RequestContext } from '../types';
import { writeAudit } from './audit';
import { getProviderVerificationMode } from './payment-providers';
import { pricePosCart } from './pos-pricing';
import {
  decryptSecret,
  encryptSecret,
  hashIdentifier,
} from './promptpay-crypto';

const SESSION_TTL_SECONDS = 300;
const QR_OPTIONS = {
  errorCorrectionLevel: 'M' as const,
  margin: 4,
  width: 640,
  color: { dark: '#0f1513', light: '#ffffff' },
};

export interface PromptPayAccountDTO {
  id: string;
  identifierType: PromptPayIdentifierType;
  maskedIdentifier: string;
  displayName: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptPaySessionDTO {
  id: string;
  reference: string;
  status: 'pending' | 'paid' | 'cancelled' | 'expired' | 'failed' | 'refunded';
  amountSatang: number;
  currency: string;
  expiresAt: string;
  createdAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  failureReason: string;
  account: {
    id: string;
    displayName: string;
    identifierType: PromptPayIdentifierType;
    maskedIdentifier: string;
  };
  sale: { id: string; number: string } | null;
  verifiedBy: { id: string; name: string } | null;
  verification: {
    id: string;
    verificationMethod: string;
    reference: string;
    provider: string;
    verifiedAt: string;
    metadata: Record<string, unknown>;
  } | null;
  qr: { pngDataUrl: string; svg: string; payload?: string } | null;
  verificationMode: {
    mode: 'manual' | 'automatic';
    autoConfirm: boolean;
    displayName: string | null;
  };
  audit: Array<{
    id: string;
    action: string;
    actorName: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}

interface AccountRow {
  id: string;
  identifier_type: PromptPayIdentifierType;
  encrypted_identifier: string;
  identifier_hash: string;
  masked_identifier: string;
  display_name: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  deleted_at: string | Date | null;
}

interface SessionRow {
  id: string;
  tenant_id: string;
  store_id: string;
  account_id: string;
  operation_id: string;
  sale_id: string | null;
  reference: string;
  amount_satang: number;
  currency: string;
  payload_hash: string;
  payload_encrypted: string;
  status: PromptPaySessionDTO['status'];
  expires_at: string | Date;
  account_snapshot: Record<string, unknown>;
  created_by: string | null;
  verified_by: string | null;
  verified_at: string | Date | null;
  paid_at: string | Date | null;
  cancelled_at: string | Date | null;
  cancelled_by: string | null;
  failure_reason: string;
  created_at: string | Date;
  sale_number?: string | null;
  verifier_name?: string | null;
}

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function accountDto(row: AccountRow): PromptPayAccountDTO {
  return {
    id: row.id,
    identifierType: row.identifier_type,
    maskedIdentifier: row.masked_identifier,
    displayName: row.display_name,
    isDefault: row.is_default,
    isActive: row.is_active,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function snapshotAccount(row: SessionRow): PromptPaySessionDTO['account'] {
  const snapshot = row.account_snapshot as {
    id?: string;
    displayName?: string;
    identifierType?: PromptPayIdentifierType;
    maskedIdentifier?: string;
  };
  return {
    id: snapshot.id ?? row.account_id,
    displayName: snapshot.displayName ?? 'PromptPay',
    identifierType: snapshot.identifierType ?? 'mobile',
    maskedIdentifier: snapshot.maskedIdentifier ?? '••••',
  };
}

async function loadAccountRow(
  client: DbClient,
  tenantId: string,
  accountId: string,
): Promise<AccountRow> {
  const result = await client.query<AccountRow>(
    `SELECT * FROM promptpay_accounts
     WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenantId, accountId],
  );
  if (!result.rows[0]) throw new NexoraError('NOT_FOUND', { entity: 'promptpay_account' });
  return result.rows[0];
}

async function resolveReceivingAccount(
  client: DbClient,
  tenantId: string,
  accountId?: string,
): Promise<AccountRow> {
  if (accountId) {
    const account = await loadAccountRow(client, tenantId, accountId);
    if (!account.is_active) throw new NexoraError('DOMAIN_PROMPTPAY_NOT_CONFIGURED');
    return account;
  }
  const result = await client.query<AccountRow>(
    `SELECT * FROM promptpay_accounts
     WHERE tenant_id = $1 AND deleted_at IS NULL AND is_active
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`,
    [tenantId],
  );
  if (!result.rows[0]) throw new NexoraError('DOMAIN_PROMPTPAY_NOT_CONFIGURED');
  return result.rows[0];
}

export async function listPromptPayAccounts(
  client: DbClient,
  tenantId: string,
  includeInactive = false,
): Promise<PromptPayAccountDTO[]> {
  const result = await client.query<AccountRow>(
    `SELECT * FROM promptpay_accounts
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND ($2::boolean OR is_active)
     ORDER BY is_default DESC, created_at ASC`,
    [tenantId, includeInactive],
  );
  return result.rows.map(accountDto);
}

export async function createPromptPayAccount(
  client: DbClient,
  ctx: RequestContext,
  input: PromptPayAccountInput,
): Promise<PromptPayAccountDTO> {
  const tenantId = ctx.tenant!.id;
  const identifier = validateIdentifier(input.identifierType, input.identifier);
  if (!identifier.ok) {
    throw new NexoraError('DOMAIN_PROMPTPAY_IDENTIFIER_INVALID', {
      reason: identifier.reason,
      type: identifier.type,
    });
  }
  const hash = hashIdentifier(identifier.normalized);
  const duplicate = await client.query(
    `SELECT id FROM promptpay_accounts
     WHERE tenant_id = $1 AND identifier_hash = $2 AND deleted_at IS NULL`,
    [tenantId, hash],
  );
  if (duplicate.rows[0]) throw new NexoraError('CONFLICT_DUPLICATE', { entity: 'promptpay_account' });

  const count = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM promptpay_accounts
     WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId],
  );
  const isDefault = input.isDefault === true || count.rows[0]!.count === 0;

  if (isDefault) {
    await client.query(
      `UPDATE promptpay_accounts SET is_default = false
       WHERE tenant_id = $1 AND is_default AND deleted_at IS NULL`,
      [tenantId],
    );
  }

  const inserted = await client.query<AccountRow>(
    `INSERT INTO promptpay_accounts
      (tenant_id, identifier_type, encrypted_identifier, identifier_hash, masked_identifier,
       display_name, is_default, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      tenantId,
      identifier.type,
      encryptSecret(identifier.normalized),
      hash,
      identifier.masked,
      input.displayName.trim(),
      isDefault,
      input.isActive ?? true,
      ctx.user.id,
    ],
  );
  const account = inserted.rows[0]!;
  await writeAudit(client, {
    tenantId,
    storeId: ctx.store?.id ?? null,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.account_created',
    entityType: 'promptpay_account',
    entityId: account.id,
    after: {
      identifierType: account.identifier_type,
      maskedIdentifier: account.masked_identifier,
      displayName: account.display_name,
      isDefault: account.is_default,
      isActive: account.is_active,
    },
    correlationId: ctx.correlationId,
  });
  return accountDto(account);
}

export async function updatePromptPayAccount(
  client: DbClient,
  ctx: RequestContext,
  accountId: string,
  input: PromptPayAccountUpdate,
): Promise<PromptPayAccountDTO> {
  const tenantId = ctx.tenant!.id;
  const locked = await client.query<AccountRow>(
    `SELECT * FROM promptpay_accounts
     WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [tenantId, accountId],
  );
  const current = locked.rows[0];
  if (!current) throw new NexoraError('NOT_FOUND', { entity: 'promptpay_account' });

  let identifierType = current.identifier_type;
  let encrypted = current.encrypted_identifier;
  let hash = current.identifier_hash;
  let masked = current.masked_identifier;

  if (input.identifier !== undefined) {
    const type = input.identifierType ?? current.identifier_type;
    const identifier = validateIdentifier(type, input.identifier);
    if (!identifier.ok) {
      throw new NexoraError('DOMAIN_PROMPTPAY_IDENTIFIER_INVALID', {
        reason: identifier.reason,
        type: identifier.type,
      });
    }
    const nextHash = hashIdentifier(identifier.normalized);
    const duplicate = await client.query(
      `SELECT id FROM promptpay_accounts
       WHERE tenant_id = $1 AND identifier_hash = $2 AND id <> $3 AND deleted_at IS NULL`,
      [tenantId, nextHash, accountId],
    );
    if (duplicate.rows[0]) {
      throw new NexoraError('CONFLICT_DUPLICATE', { entity: 'promptpay_account' });
    }
    identifierType = identifier.type;
    encrypted = encryptSecret(identifier.normalized);
    hash = nextHash;
    masked = identifier.masked;
  }

  const isDefault = input.isDefault ?? current.is_default;
  const isActive = input.isActive ?? current.is_active;
  if (isDefault && !isActive) {
    throw new NexoraError('VALIDATION_FAILED', { field: 'isDefault', reason: 'inactive_default' });
  }
  if (isDefault) {
    await client.query(
      `UPDATE promptpay_accounts SET is_default = false
       WHERE tenant_id = $1 AND id <> $2 AND is_default AND deleted_at IS NULL`,
      [tenantId, accountId],
    );
  }

  const updated = await client.query<AccountRow>(
    `UPDATE promptpay_accounts
     SET identifier_type = $1, encrypted_identifier = $2, identifier_hash = $3,
         masked_identifier = $4, display_name = $5, is_default = $6, is_active = $7
     WHERE tenant_id = $8 AND id = $9
     RETURNING *`,
    [
      identifierType,
      encrypted,
      hash,
      masked,
      input.displayName?.trim() ?? current.display_name,
      isDefault,
      isActive,
      tenantId,
      accountId,
    ],
  );
  const account = updated.rows[0]!;
  await writeAudit(client, {
    tenantId,
    storeId: ctx.store?.id ?? null,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.account_updated',
    entityType: 'promptpay_account',
    entityId: account.id,
    before: {
      identifierType: current.identifier_type,
      maskedIdentifier: current.masked_identifier,
      displayName: current.display_name,
      isDefault: current.is_default,
      isActive: current.is_active,
    },
    after: {
      identifierType: account.identifier_type,
      maskedIdentifier: account.masked_identifier,
      displayName: account.display_name,
      isDefault: account.is_default,
      isActive: account.is_active,
    },
    correlationId: ctx.correlationId,
  });
  return accountDto(account);
}

export async function setDefaultPromptPayAccount(
  client: DbClient,
  ctx: RequestContext,
  accountId: string,
): Promise<PromptPayAccountDTO> {
  const tenantId = ctx.tenant!.id;
  const locked = await client.query<AccountRow>(
    `SELECT * FROM promptpay_accounts
     WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [tenantId, accountId],
  );
  const account = locked.rows[0];
  if (!account) throw new NexoraError('NOT_FOUND', { entity: 'promptpay_account' });
  if (!account.is_active) throw new NexoraError('VALIDATION_FAILED', { field: 'isActive' });

  await client.query(
    `UPDATE promptpay_accounts SET is_default = false
     WHERE tenant_id = $1 AND id <> $2 AND is_default AND deleted_at IS NULL`,
    [tenantId, accountId],
  );
  const updated = await client.query<AccountRow>(
    `UPDATE promptpay_accounts SET is_default = true
     WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, accountId],
  );
  await writeAudit(client, {
    tenantId,
    storeId: ctx.store?.id ?? null,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.account_default_changed',
    entityType: 'promptpay_account',
    entityId: accountId,
    after: { displayName: account.display_name, maskedIdentifier: account.masked_identifier },
    correlationId: ctx.correlationId,
  });
  return accountDto(updated.rows[0]!);
}

export async function deletePromptPayAccount(
  client: DbClient,
  ctx: RequestContext,
  accountId: string,
): Promise<void> {
  const tenantId = ctx.tenant!.id;
  const locked = await client.query<AccountRow>(
    `SELECT * FROM promptpay_accounts
     WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [tenantId, accountId],
  );
  const account = locked.rows[0];
  if (!account) throw new NexoraError('NOT_FOUND', { entity: 'promptpay_account' });

  await client.query(
    `UPDATE promptpay_accounts
     SET deleted_at = now(), is_active = false, is_default = false
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, accountId],
  );

  if (account.is_default) {
    const next = await client.query<{ id: string }>(
      `SELECT id FROM promptpay_accounts
       WHERE tenant_id = $1 AND deleted_at IS NULL AND is_active
       ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    );
    if (next.rows[0]) {
      await client.query(`UPDATE promptpay_accounts SET is_default = true WHERE id = $1`, [
        next.rows[0].id,
      ]);
    }
  }

  await writeAudit(client, {
    tenantId,
    storeId: ctx.store?.id ?? null,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.account_deleted',
    entityType: 'promptpay_account',
    entityId: accountId,
    before: {
      identifierType: account.identifier_type,
      maskedIdentifier: account.masked_identifier,
      displayName: account.display_name,
    },
    correlationId: ctx.correlationId,
  });
}

export interface StaticPromptPayQr {
  account: PromptPayAccountDTO;
  generatedAt: string;
  pngDataUrl: string;
  svg: string;
  payload?: string;
}

/**
 * A reusable QR with no amount. The payer types the amount in their banking
 * app. This deliberately has no session or expiry: it is not a payment record.
 */
export async function getStaticPromptPayQr(
  client: DbClient,
  ctx: RequestContext,
  accountId: string,
  options: { includePayload: boolean },
): Promise<StaticPromptPayQr> {
  const account = await loadAccountRow(client, ctx.tenant!.id, accountId);
  if (!account.is_active) throw new NexoraError('DOMAIN_PROMPTPAY_NOT_CONFIGURED');
  const identifier = validateIdentifier(
    account.identifier_type,
    decryptSecret(account.encrypted_identifier),
  );
  if (!identifier.ok) {
    throw new NexoraError('DOMAIN_PROMPTPAY_NOT_CONFIGURED', { reason: 'stored_identifier_invalid' });
  }
  const payload = buildPromptPayPayload({
    identifierType: account.identifier_type,
    identifier: identifier.normalized,
  });
  const rendered = await renderQr(payload);
  return {
    account: accountDto(account),
    generatedAt: new Date().toISOString(),
    ...rendered,
    ...(options.includePayload ? { payload } : {}),
  };
}

async function renderQr(payload: string): Promise<{ pngDataUrl: string; svg: string }> {
  const [pngDataUrl, svg] = await Promise.all([
    QRCode.toDataURL(payload, QR_OPTIONS),
    QRCode.toString(payload, { ...QR_OPTIONS, type: 'svg' }),
  ]);
  return { pngDataUrl, svg };
}

async function logSession(
  client: DbClient,
  tenantId: string,
  sessionId: string,
  action: string,
  actorId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO payment_audit_logs (tenant_id, payment_session_id, action, actor_id, metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, sessionId, action, actorId, JSON.stringify(metadata)],
  );
}

function payloadHash(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function newReference(): string {
  return `PP-${randomBytes(6).toString('hex').toUpperCase()}`;
}

async function uniqueReference(client: DbClient, tenantId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = newReference();
    const existing = await client.query(
      `SELECT 1 FROM payment_sessions WHERE tenant_id = $1 AND reference = $2`,
      [tenantId, reference],
    );
    if (!existing.rows[0]) return reference;
  }
  throw new NexoraError('INFRA_INTERNAL', { reason: 'reference_collision' });
}

function verifyPayloadIntegrity(row: SessionRow): string {
  const payload = decryptSecret(row.payload_encrypted);
  if (payloadHash(payload) !== row.payload_hash) {
    throw new NexoraError('INFRA_INTERNAL', { reason: 'promptpay_payload_integrity' });
  }
  return payload;
}

async function expireSessionIfNeeded(
  client: DbClient,
  tenantId: string,
  sessionId: string,
): Promise<boolean> {
  const expired = await client.query<{ id: string }>(
    `UPDATE payment_sessions
     SET status = 'expired'
     WHERE tenant_id = $1 AND id = $2 AND status = 'pending' AND expires_at <= now()
     RETURNING id`,
    [tenantId, sessionId],
  );
  if (expired.rowCount) {
    await logSession(client, tenantId, sessionId, 'expired', null, { automatic: true });
    return true;
  }
  return false;
}

async function loadSessionRow(
  client: DbClient,
  tenantId: string,
  sessionId: string,
  storeId: string,
  forUpdate = false,
): Promise<SessionRow> {
  const result = await client.query<SessionRow>(
    `SELECT ps.*, s.number AS sale_number, u.name AS verifier_name
     FROM payment_sessions ps
     LEFT JOIN sales s ON s.id = ps.sale_id
     LEFT JOIN users u ON u.id = ps.verified_by
     WHERE ps.tenant_id = $1 AND ps.id = $2 AND ps.store_id = $3
     ${forUpdate ? 'FOR UPDATE OF ps' : ''}`,
    [tenantId, sessionId, storeId],
  );
  if (!result.rows[0]) throw new NexoraError('NOT_FOUND', { entity: 'payment_session' });
  return result.rows[0];
}

async function sessionDto(
  client: DbClient,
  row: SessionRow,
  options: { includeQr: boolean; includePayload: boolean },
): Promise<PromptPaySessionDTO> {
  const transaction = await client.query<{
    id: string;
    verification_method: string;
    reference: string;
    provider: string;
    verified_at: string | Date;
    metadata: Record<string, unknown>;
  }>(
    `SELECT id, verification_method, reference, provider, verified_at, metadata
     FROM payment_transactions WHERE tenant_id = $1 AND payment_session_id = $2`,
    [row.tenant_id, row.id],
  );
  const audit = await client.query<{
    id: string;
    action: string;
    actor_name: string | null;
    metadata: Record<string, unknown>;
    created_at: string | Date;
  }>(
    `SELECT l.id, l.action, u.name AS actor_name, l.metadata, l.created_at
     FROM payment_audit_logs l
     LEFT JOIN users u ON u.id = l.actor_id
     WHERE l.tenant_id = $1 AND l.payment_session_id = $2
     ORDER BY l.created_at ASC`,
    [row.tenant_id, row.id],
  );

  let qr: PromptPaySessionDTO['qr'] = null;
  if (options.includeQr && row.status === 'pending') {
    const payload = verifyPayloadIntegrity(row);
    const rendered = await renderQr(payload);
    qr = { ...rendered, ...(options.includePayload ? { payload } : {}) };
  }

  const verificationMode = await getProviderVerificationMode(client, row.tenant_id);
  const t = transaction.rows[0];
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    amountSatang: Number(row.amount_satang),
    currency: row.currency,
    expiresAt: iso(row.expires_at)!,
    createdAt: iso(row.created_at)!,
    paidAt: iso(row.paid_at),
    cancelledAt: iso(row.cancelled_at),
    failureReason: row.failure_reason,
    account: snapshotAccount(row),
    sale: row.sale_id ? { id: row.sale_id, number: row.sale_number ?? '' } : null,
    verifiedBy:
      row.verified_by && row.verifier_name
        ? { id: row.verified_by, name: row.verifier_name }
        : null,
    verification: t
      ? {
          id: t.id,
          verificationMethod: t.verification_method,
          reference: t.reference,
          provider: t.provider,
          verifiedAt: iso(t.verified_at)!,
          metadata: t.metadata ?? {},
        }
      : null,
    qr,
    verificationMode,
    audit: audit.rows.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actorName: entry.actor_name,
      metadata: entry.metadata ?? {},
      createdAt: iso(entry.created_at)!,
    })),
  };
}

export async function createPromptPaySession(
  client: DbClient,
  ctx: RequestContext,
  input: PromptPaySessionCreateInput,
  options: { includePayload: boolean },
): Promise<PromptPaySessionDTO> {
  const tenantId = ctx.tenant!.id;
  const store = ctx.store!;

  const priced = await pricePosCart(client, ctx, { ...input, offline: false });
  const total = priced.quote.totalSatang;
  const amountSatang = input.amountSatang ?? total;
  if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0 || amountSatang > total) {
    throw new NexoraError('VALIDATION_FAILED', { field: 'amountSatang', total });
  }

  const account = await resolveReceivingAccount(client, tenantId, input.accountId);

  await client.query(
    `UPDATE payment_sessions SET status = 'expired'
     WHERE tenant_id = $1 AND operation_id = $2 AND status = 'pending' AND expires_at <= now()`,
    [tenantId, input.operationId],
  );

  const existing = await client.query<SessionRow>(
    `SELECT ps.*, s.number AS sale_number, u.name AS verifier_name
     FROM payment_sessions ps
     LEFT JOIN sales s ON s.id = ps.sale_id
     LEFT JOIN users u ON u.id = ps.verified_by
     WHERE ps.tenant_id = $1 AND ps.operation_id = $2 AND ps.status = 'pending'
     FOR UPDATE OF ps`,
    [tenantId, input.operationId],
  );
  const pending = existing.rows[0];
  if (pending) {
    if (Number(pending.amount_satang) === amountSatang && pending.account_id === account.id) {
      return sessionDto(client, pending, {
        includeQr: true,
        includePayload: options.includePayload,
      });
    }
    await client.query(
      `UPDATE payment_sessions SET status = 'cancelled', cancelled_at = now(), cancelled_by = $1,
         failure_reason = 'replaced'
       WHERE tenant_id = $2 AND id = $3`,
      [ctx.user.id, tenantId, pending.id],
    );
    await logSession(client, tenantId, pending.id, 'replaced', ctx.user.id, {
      reason: 'amount_or_account_changed',
    });
  }

  const reference = await uniqueReference(client, tenantId);
  const identifier = validateIdentifier(
    account.identifier_type,
    decryptSecret(account.encrypted_identifier),
  );
  if (!identifier.ok) {
    throw new NexoraError('DOMAIN_PROMPTPAY_NOT_CONFIGURED', { reason: 'stored_identifier_invalid' });
  }
  const payload = buildPromptPayPayload({
    identifierType: account.identifier_type,
    identifier: identifier.normalized,
    amountSatang,
    referenceLabel: reference,
  });
  const expiresInSeconds = input.expiresInSeconds ?? SESSION_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  const inserted = await client.query<SessionRow>(
    `INSERT INTO payment_sessions
      (tenant_id, store_id, account_id, operation_id, reference, amount_satang, currency,
       payload_hash, payload_encrypted, status, expires_at, account_snapshot, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'THB',$7,$8,'pending',$9,$10::jsonb,$11)
     RETURNING *`,
    [
      tenantId,
      store.id,
      account.id,
      input.operationId,
      reference,
      amountSatang,
      payloadHash(payload),
      encryptSecret(payload),
      expiresAt,
      JSON.stringify({
        id: account.id,
        displayName: account.display_name,
        identifierType: account.identifier_type,
        maskedIdentifier: account.masked_identifier,
      }),
      ctx.user.id,
    ],
  );
  const row = inserted.rows[0]!;
  await logSession(client, tenantId, row.id, 'created', ctx.user.id, {
    amountSatang,
    reference,
    expiresAt: expiresAt.toISOString(),
    accountDisplayName: account.display_name,
    identifierType: account.identifier_type,
  });
  await writeAudit(client, {
    tenantId,
    storeId: store.id,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.session_created',
    entityType: 'payment_session',
    entityId: row.id,
    after: { reference, amountSatang, status: 'pending', accountId: account.id },
    correlationId: ctx.correlationId,
  });

  return sessionDto(client, row, {
    includeQr: true,
    includePayload: options.includePayload,
  });
}

export async function getPromptPaySession(
  client: DbClient,
  ctx: RequestContext,
  sessionId: string,
  options: { includePayload: boolean },
): Promise<PromptPaySessionDTO> {
  const tenantId = ctx.tenant!.id;
  if (!ctx.store) throw new NexoraError('AUTH_STORE_FORBIDDEN');
  await expireSessionIfNeeded(client, tenantId, sessionId);
  const row = await loadSessionRow(client, tenantId, sessionId, ctx.store.id);
  return sessionDto(client, row, {
    includeQr: row.status === 'pending',
    includePayload: options.includePayload,
  });
}

export async function regeneratePromptPaySession(
  client: DbClient,
  ctx: RequestContext,
  sessionId: string,
  options: { includePayload: boolean },
): Promise<PromptPaySessionDTO> {
  const tenantId = ctx.tenant!.id;
  const store = ctx.store!;
  const row = await loadSessionRow(client, tenantId, sessionId, store.id, true);
  if (!['pending', 'expired'].includes(row.status)) {
    throw new NexoraError('DOMAIN_PROMPTPAY_SESSION_STATE', { status: row.status });
  }

  const currentPayload = verifyPayloadIntegrity(row);
  const decoded = decodePromptPayPayload(currentPayload);
  const identifier =
    decoded.identifierType === 'mobile' && decoded.identifierValue.startsWith('0066')
      ? `0${decoded.identifierValue.slice(4)}`
      : decoded.identifierValue;
  const reference = await uniqueReference(client, tenantId);
  const payload = buildPromptPayPayload({
    identifierType: decoded.identifierType,
    identifier,
    amountSatang: Number(row.amount_satang),
    referenceLabel: reference,
  });
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  const updated = await client.query<SessionRow>(
    `UPDATE payment_sessions
     SET reference = $1, payload_hash = $2, payload_encrypted = $3,
         status = 'pending', expires_at = $4, cancelled_at = NULL, cancelled_by = NULL
     WHERE tenant_id = $5 AND id = $6
     RETURNING *`,
    [reference, payloadHash(payload), encryptSecret(payload), expiresAt, tenantId, sessionId],
  );
  await logSession(client, tenantId, sessionId, 'qr_regenerated', ctx.user.id, {
    previousReference: row.reference,
    reference,
    expiresAt: expiresAt.toISOString(),
  });
  await writeAudit(client, {
    tenantId,
    storeId: store.id,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.session_regenerated',
    entityType: 'payment_session',
    entityId: sessionId,
    before: { reference: row.reference, status: row.status },
    after: { reference, status: 'pending' },
    correlationId: ctx.correlationId,
  });
  return sessionDto(client, updated.rows[0]!, {
    includeQr: true,
    includePayload: options.includePayload,
  });
}

export type ConfirmPromptPayResult =
  | { status: 'expired' }
  | { status: 'paid'; session: PromptPaySessionDTO; alreadyVerified: boolean };

export async function confirmPromptPaySession(
  client: DbClient,
  ctx: RequestContext,
  sessionId: string,
  input: PromptPayConfirmInput,
): Promise<ConfirmPromptPayResult> {
  const tenantId = ctx.tenant!.id;
  const store = ctx.store!;
  const row = await loadSessionRow(client, tenantId, sessionId, store.id, true);

  if (row.status === 'paid') {
    return {
      status: 'paid',
      alreadyVerified: true,
      session: await sessionDto(client, row, { includeQr: false, includePayload: false }),
    };
  }
  if (!['pending', 'expired'].includes(row.status)) {
    throw new NexoraError('DOMAIN_PROMPTPAY_SESSION_STATE', { status: row.status });
  }

  const expired = new Date(row.expires_at).getTime() <= Date.now();
  if ((row.status === 'expired' || expired) && !input.overrideExpired) {
    if (row.status === 'pending') {
      await client.query(
        `UPDATE payment_sessions SET status = 'expired' WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sessionId],
      );
      await logSession(client, tenantId, sessionId, 'expired', null, { automatic: true });
      await writeAudit(client, {
        tenantId,
        storeId: store.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'promptpay.session_expired',
        entityType: 'payment_session',
        entityId: sessionId,
        correlationId: ctx.correlationId,
      });
    }
    return { status: 'expired' };
  }

  const received = input.receivedAmountSatang ?? Number(row.amount_satang);
  if (received !== Number(row.amount_satang)) {
    throw new NexoraError('DOMAIN_PROMPTPAY_AMOUNT_MISMATCH', {
      expected: Number(row.amount_satang),
      received,
    });
  }

  const metadata: Record<string, unknown> = {
    note: input.note || null,
    expiredOverride: input.overrideExpired === true && (expired || row.status === 'expired'),
    previousStatus: row.status,
    receivedAmountSatang: received,
  };
  await client.query(
    `INSERT INTO payment_transactions
      (tenant_id, payment_session_id, amount_satang, payment_method, verification_method,
       verified_by, verified_at, status, reference, provider, metadata)
     VALUES ($1,$2,$3,'promptpay','manual',$4,now(),'verified',$5,'manual',$6::jsonb)`,
    [
      tenantId,
      sessionId,
      Number(row.amount_satang),
      ctx.user.id,
      input.reference || '',
      JSON.stringify(metadata),
    ],
  );
  await client.query(
    `UPDATE payment_sessions
     SET status = 'paid', paid_at = now(), verified_by = $1, verified_at = now()
     WHERE tenant_id = $2 AND id = $3`,
    [ctx.user.id, tenantId, sessionId],
  );
  await logSession(client, tenantId, sessionId, 'confirmed', ctx.user.id, {
    amountSatang: Number(row.amount_satang),
    reference: input.reference || null,
    overrideExpired: metadata.expiredOverride,
  });
  await writeAudit(client, {
    tenantId,
    storeId: store.id,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.session_confirmed',
    entityType: 'payment_session',
    entityId: sessionId,
    before: { status: row.status },
    after: {
      status: 'paid',
      amountSatang: Number(row.amount_satang),
      reference: input.reference || null,
      overrideExpired: metadata.expiredOverride,
    },
    correlationId: ctx.correlationId,
  });

  const paidRow = await loadSessionRow(client, tenantId, sessionId, store.id);
  return {
    status: 'paid',
    alreadyVerified: false,
    session: await sessionDto(client, paidRow, {
      includeQr: false,
      includePayload: false,
    }),
  };
}

export async function cancelPromptPaySession(
  client: DbClient,
  ctx: RequestContext,
  sessionId: string,
  input: PromptPayCancelInput,
): Promise<PromptPaySessionDTO> {
  const tenantId = ctx.tenant!.id;
  const store = ctx.store!;
  const row = await loadSessionRow(client, tenantId, sessionId, store.id, true);
  if (row.status === 'paid' || row.status === 'refunded') {
    throw new NexoraError('DOMAIN_PROMPTPAY_SESSION_STATE', { status: row.status });
  }
  if (row.status === 'cancelled') {
    return sessionDto(client, row, { includeQr: false, includePayload: false });
  }
  const updated = await client.query<SessionRow>(
    `UPDATE payment_sessions
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = $1, failure_reason = $2
     WHERE tenant_id = $3 AND id = $4
     RETURNING *`,
    [ctx.user.id, input.reason || '', tenantId, sessionId],
  );
  await logSession(client, tenantId, sessionId, 'cancelled', ctx.user.id, {
    reason: input.reason || null,
    previousStatus: row.status,
  });
  await writeAudit(client, {
    tenantId,
    storeId: store.id,
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: 'promptpay.session_cancelled',
    entityType: 'payment_session',
    entityId: sessionId,
    before: { status: row.status },
    after: { status: 'cancelled', reason: input.reason || null },
    correlationId: ctx.correlationId,
  });
  return sessionDto(client, updated.rows[0]!, { includeQr: false, includePayload: false });
}

export interface PromptPaySessionListRow {
  id: string;
  reference: string;
  status: PromptPaySessionDTO['status'];
  amountSatang: number;
  currency: string;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  accountName: string;
  identifierType: PromptPayIdentifierType;
  maskedIdentifier: string;
  saleId: string | null;
  saleNumber: string | null;
  verifierName: string | null;
}

export async function listPromptPaySessions(
  client: DbClient,
  ctx: RequestContext,
  query: {
    page: number;
    pageSize: number;
    status?: PromptPaySessionDTO['status'];
    search?: string;
    from?: string;
    to?: string;
    review?: boolean;
  },
): Promise<{
  rows: PromptPaySessionListRow[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    summary: {
      count: number;
      paidCount: number;
      paidSatang: number;
      pendingCount: number;
      reviewCount: number;
    };
  };
}> {
  const tenantId = ctx.tenant!.id;
  if (!ctx.store) throw new NexoraError('AUTH_STORE_FORBIDDEN');
  const offset = (query.page - 1) * query.pageSize;
  const search = query.search?.trim() || null;
  const params = [
    tenantId,
    ctx.store.id,
    query.status ?? null,
    query.from ?? null,
    query.to ?? null,
    search,
    query.review ?? false,
    query.pageSize,
    offset,
  ];
  const where = `ps.tenant_id = $1 AND ps.store_id = $2
    AND ($3::text IS NULL OR ps.status = $3)
    AND ($4::date IS NULL OR ps.created_at >= $4::date)
    AND ($5::date IS NULL OR ps.created_at < ($5::date + 1))
    AND ($6::text IS NULL OR ps.reference ILIKE '%'||$6||'%' OR s.number ILIKE '%'||$6||'%')
    AND ($7::boolean IS NOT TRUE OR (ps.status = 'paid' AND ps.sale_id IS NULL))`;

  const rows = await client.query<{
    id: string;
    reference: string;
    status: PromptPaySessionDTO['status'];
    amount_satang: number;
    currency: string;
    created_at: string | Date;
    expires_at: string | Date;
    paid_at: string | Date | null;
    account_name: string;
    identifier_type: PromptPayIdentifierType;
    masked_identifier: string;
    sale_id: string | null;
    sale_number: string | null;
    verifier_name: string | null;
  }>(
    `SELECT ps.id, ps.reference, ps.status, ps.amount_satang, ps.currency,
            ps.created_at, ps.expires_at, ps.paid_at,
            COALESCE(ps.account_snapshot->>'displayName', a.display_name, 'PromptPay') AS account_name,
            COALESCE(ps.account_snapshot->>'identifierType', a.identifier_type, 'mobile') AS identifier_type,
            COALESCE(ps.account_snapshot->>'maskedIdentifier', a.masked_identifier, '••••') AS masked_identifier,
            ps.sale_id, s.number AS sale_number, u.name AS verifier_name
     FROM payment_sessions ps
     LEFT JOIN promptpay_accounts a ON a.id = ps.account_id
     LEFT JOIN sales s ON s.id = ps.sale_id
     LEFT JOIN users u ON u.id = ps.verified_by
     WHERE ${where}
     ORDER BY ps.created_at DESC
     LIMIT $8 OFFSET $9`,
    params,
  );

  const totals = await client.query<{
    count: number;
    paid_count: number;
    paid_satang: number;
    pending_count: number;
    review_count: number;
  }>(
    `SELECT count(*)::int AS count,
            count(*) FILTER (WHERE ps.status = 'paid')::int AS paid_count,
            COALESCE(sum(ps.amount_satang) FILTER (WHERE ps.status = 'paid'), 0)::bigint AS paid_satang,
            count(*) FILTER (WHERE ps.status = 'pending')::int AS pending_count,
            count(*) FILTER (WHERE ps.status = 'paid' AND ps.sale_id IS NULL)::int AS review_count
     FROM payment_sessions ps
     LEFT JOIN sales s ON s.id = ps.sale_id
     WHERE ${where}`,
    params.slice(0, 7),
  );
  const summary = totals.rows[0]!;
  const total = Number(summary.count);
  return {
    rows: rows.rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      status: row.status,
      amountSatang: Number(row.amount_satang),
      currency: row.currency,
      createdAt: iso(row.created_at)!,
      expiresAt: iso(row.expires_at)!,
      paidAt: iso(row.paid_at),
      accountName: row.account_name,
      identifierType: row.identifier_type,
      maskedIdentifier: row.masked_identifier,
      saleId: row.sale_id,
      saleNumber: row.sale_number,
      verifierName: row.verifier_name,
    })),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      summary: {
        count: total,
        paidCount: Number(summary.paid_count),
        paidSatang: Number(summary.paid_satang),
        pendingCount: Number(summary.pending_count),
        reviewCount: Number(summary.review_count),
      },
    },
  };
}
