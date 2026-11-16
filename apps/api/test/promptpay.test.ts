import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, runMigrations, type Db } from '@nexora/db';
import { decodePromptPayPayload } from '@nexora/promptpay';
import { createApp } from '../src/app';
import type { Config } from '../src/config';
import { setLogLevel } from '../src/logger';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is required');

const config: Config = {
  nodeEnv: 'test',
  isProd: false,
  databaseUrl: TEST_URL,
  sessionSecret: 'test-secret-that-is-long-enough-for-hmac-222',
  port: 0,
  webOrigin: 'http://localhost:5173',
  logLevel: 'error',
};

type Agent = ReturnType<typeof request.agent>;
const WEB = { 'x-nexora-client': 'web', origin: 'http://localhost:5173' };

let db: Db;
let app: ReturnType<typeof createApp>;
let agent: Agent;
let accountant: Agent;
let storeId: string;
let tenantId: string;
let variantId: string;
let accountId: string;
let secondAccountId: string;

function withStore(a: Agent, store: string) {
  return a.set(WEB).set('x-store-id', store);
}

async function createAccount(
  a: Agent,
  body: Record<string, unknown>,
): Promise<{ id: string; maskedIdentifier: string; displayName: string }> {
  const response = await withStore(a, storeId).post('/api/promptpay/accounts').send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data;
}

async function createSession(
  a: Agent,
  operationId: string,
  qty = 1,
): Promise<{ id: string; reference: string; payload: string; amountSatang: number }> {
  const response = await withStore(a, storeId).post('/api/promptpay/sessions').send({
    operationId,
    items: [{ variantId, qty }],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return {
    id: response.body.data.id,
    reference: response.body.data.reference,
    payload: response.body.data.qr.payload,
    amountSatang: response.body.data.amountSatang,
  };
}

beforeAll(async () => {
  setLogLevel('error');
  const reset = new pg.Client({ connectionString: TEST_URL });
  await reset.connect();
  await reset.query('DROP SCHEMA public CASCADE');
  await reset.query('CREATE SCHEMA public');
  await reset.end();
  await runMigrations(TEST_URL);
  db = createDb(TEST_URL, { max: 6, applicationName: 'nexora-promptpay-test' });
  app = createApp({ db, config });
  agent = request.agent(app);

  const registration = await agent
    .post('/api/auth/register')
    .set(WEB)
    .send({
      businessName: 'PromptPay Test Retail',
      ownerName: 'PromptPay Owner',
      email: 'owner-pp@test.nexora.local',
      password: 'TestPass!2026',
      storeName: 'PromptPay Store',
      currency: 'THB',
      timezone: 'Asia/Bangkok',
    });
  expect(registration.status).toBe(201);
  storeId = registration.body.data.store.id;
  tenantId = registration.body.data.tenant.id;

  const product = await withStore(agent, storeId)
    .post('/api/products')
    .send({
      name: 'PromptPay Test Item',
      sku: 'PP-001',
      type: 'simple',
      priceSatang: 10_000,
      costSatang: 6_000,
      trackInventory: true,
      reorderPoint: 5,
      status: 'active',
    });
  expect(product.status).toBe(201);
  variantId = product.body.data.variantId;

  const adjust = await withStore(agent, storeId)
    .post('/api/inventory/adjust')
    .send({
      operationId: randomUUID(),
      variantId,
      direction: 'increase',
      qty: 100,
      reason: 'PromptPay test opening stock',
    });
  expect(adjust.status).toBe(200);

  const shift = await withStore(agent, storeId)
    .post('/api/shifts/open')
    .send({ openingCashSatang: 100_000, terminalName: 'PromptPay counter' });
  expect(shift.status).toBe(201);

  const employee = await withStore(agent, storeId)
    .post('/api/employees')
    .send({
      name: 'PromptPay Accountant',
      email: 'accountant-pp@test.nexora.local',
      password: 'TestPass!2026',
      roleCode: 'accountant',
      storeIds: [storeId],
    });
  expect(employee.status).toBe(201);
  accountant = request.agent(app);
  const login = await accountant
    .post('/api/auth/login')
    .set(WEB)
    .send({ email: 'accountant-pp@test.nexora.local', password: 'TestPass!2026' });
  expect(login.status).toBe(200);
});

afterAll(async () => {
  await db.close();
});

describe('PromptPay account management', () => {
  it('creates a masked mobile account without returning or storing plaintext', async () => {
    const account = await createAccount(agent, {
      identifierType: 'mobile',
      identifier: '+66 81-234-5678',
      displayName: 'Counter PromptPay',
      isDefault: true,
    });
    accountId = account.id;
    expect(account.maskedIdentifier).toBe('081-•••-5678');
    expect(JSON.stringify(account)).not.toContain('0812345678');

    const row = await db.withTenant(tenantId, (client) =>
      client.query<{ encrypted_identifier: string; identifier_hash: string }>(
        'SELECT encrypted_identifier, identifier_hash FROM promptpay_accounts WHERE id=$1',
        [accountId],
      ),
    );
    expect(row.rows[0]!.encrypted_identifier).not.toContain('0812345678');
    expect(row.rows[0]!.encrypted_identifier.startsWith('v1:')).toBe(true);
    expect(row.rows[0]!.identifier_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects invalid national IDs and duplicate identifiers', async () => {
    const invalid = await withStore(agent, storeId).post('/api/promptpay/accounts').send({
      identifierType: 'national_id',
      identifier: '1101700230709',
      displayName: 'Bad ID',
    });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('DOMAIN_PROMPTPAY_IDENTIFIER_INVALID');

    const duplicate = await withStore(agent, storeId).post('/api/promptpay/accounts').send({
      identifierType: 'mobile',
      identifier: '0812345678',
      displayName: 'Duplicate',
    });
    expect(duplicate.status).toBe(409);
  });

  it('creates a second account, changes the default and updates labels', async () => {
    const second = await createAccount(agent, {
      identifierType: 'national_id',
      identifier: '1-1001-12345-67-8',
      displayName: 'Back office PromptPay',
    });
    secondAccountId = second.id;
    expect(second.maskedIdentifier).toMatch(/^X-XXXX-XXXXX-XX-\d$/);

    const setDefault = await withStore(agent, storeId).post(
      `/api/promptpay/accounts/${secondAccountId}/default`,
    );
    expect(setDefault.status).toBe(200);
    expect(setDefault.body.data.isDefault).toBe(true);

    const list = await withStore(agent, storeId).get('/api/promptpay/accounts');
    expect(list.status).toBe(200);
    const first = list.body.data.find((row: { id: string }) => row.id === accountId);
    expect(first.isDefault).toBe(false);

    const renamed = await withStore(agent, storeId)
      .patch(`/api/promptpay/accounts/${secondAccountId}`)
      .send({ displayName: 'Back office (primary)' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.displayName).toBe('Back office (primary)');
  });

  it('enforces read/manage permissions', async () => {
    const read = await withStore(accountant, storeId).get('/api/promptpay/accounts');
    expect(read.status).toBe(200);
    expect(JSON.stringify(read.body)).not.toContain('1101700230708');

    const denied = await withStore(accountant, storeId)
      .post('/api/promptpay/accounts')
      .send({
        identifierType: 'mobile',
        identifier: '0899999999',
        displayName: 'Not allowed',
      });
    expect(denied.status).toBe(403);
  });

  it('deletes an account and promotes a remaining default', async () => {
    const removed = await withStore(agent, storeId).delete(
      `/api/promptpay/accounts/${secondAccountId}`,
    );
    expect(removed.status).toBe(204);
    const list = await withStore(agent, storeId).get('/api/promptpay/accounts');
    expect(list.body.data.every((row: { id: string }) => row.id !== secondAccountId)).toBe(true);
    expect(list.body.data[0].isDefault).toBe(true);
  });
});

describe('static PromptPay QR', () => {
  it('generates a reusable no-amount QR for an active account', async () => {
    const response = await withStore(agent, storeId).get(
      `/api/promptpay/accounts/${accountId}/static-qr`,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.pngDataUrl).toMatch(/^data:image\/png;base64,/);
    const decoded = decodePromptPayPayload(response.body.data.payload);
    expect(decoded.amountSatang).toBeNull();
    expect(decoded.pointOfInitiation).toBe('static');
    expect(decoded.identifierValue).toBe('0066812345678');
    expect(JSON.stringify(response.body.data)).not.toContain('0812345678');
  });
});

describe('PromptPay sessions and manual verification', () => {
  it('creates a standards-compliant QR from the authoritative cart total', async () => {
    const operationId = randomUUID();
    const session = await createSession(agent, operationId);
    expect(session.amountSatang).toBe(10_000);
    expect(session.payload).toBeTruthy();

    const decoded = decodePromptPayPayload(session.payload);
    expect(decoded.crcValid).toBe(true);
    expect(decoded.identifierType).toBe('mobile');
    expect(decoded.identifierValue).toBe('0066812345678');
    expect(decoded.amountSatang).toBe(10_000);
    expect(decoded.referenceLabel).toBe(session.reference);

    const fetched = await withStore(agent, storeId).get(
      `/api/promptpay/sessions/${session.id}`,
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.reference).toBe(session.reference);
    expect(fetched.body.data.qr.pngDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(fetched.body.data.qr.svg).toContain('<svg');
    expect(fetched.body.data.status).toBe('pending');
  });

  it('rejects a wrong received amount, then verifies once and records the actor', async () => {
    const session = await createSession(agent, randomUUID());
    const wrong = await withStore(agent, storeId)
      .post(`/api/promptpay/sessions/${session.id}/confirm`)
      .send({ receivedAmountSatang: 9_999 });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('DOMAIN_PROMPTPAY_AMOUNT_MISMATCH');

    const confirmed = await withStore(agent, storeId)
      .post(`/api/promptpay/sessions/${session.id}/confirm`)
      .send({ receivedAmountSatang: 10_000, reference: 'SLIP-TEST-001' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.meta.alreadyVerified).toBe(false);
    expect(confirmed.body.data.status).toBe('paid');
    expect(confirmed.body.data.verification.verificationMethod).toBe('manual');
    expect(confirmed.body.data.verifiedBy.name).toBe('PromptPay Owner');
    expect(confirmed.body.data.verification.reference).toBe('SLIP-TEST-001');

    const again = await withStore(agent, storeId)
      .post(`/api/promptpay/sessions/${session.id}/confirm`)
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.meta.alreadyVerified).toBe(true);

    const transactions = await db.withTenant(tenantId, (client) =>
      client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM payment_transactions WHERE payment_session_id=$1',
        [session.id],
      ),
    );
    expect(transactions.rows[0]!.count).toBe(1);
  });

  it('completes exactly one sale with a verified session and blocks reuse', async () => {
    const operationId = randomUUID();
    const session = await createSession(agent, operationId);
    await withStore(agent, storeId)
      .post(`/api/promptpay/sessions/${session.id}/confirm`)
      .send({ reference: 'SLIP-TEST-002' })
      .expect(200);

    const body = {
      operationId,
      items: [{ variantId, qty: 1 }],
      payments: [
        {
          method: 'promptpay',
          amountSatang: 10_000,
          reference: session.reference,
          promptpaySessionId: session.id,
        },
      ],
      occurredAt: new Date().toISOString(),
      offline: false,
    };
    const checkout = await withStore(agent, storeId).post('/api/pos/checkout').send(body);
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(201);
    const saleId = checkout.body.data.saleId;

    const link = await db.withTenant(tenantId, (client) =>
      client.query<{ sale_id: string; status: string }>(
        'SELECT sale_id, status FROM payment_sessions WHERE id=$1',
        [session.id],
      ),
    );
    expect(link.rows[0]!.sale_id).toBe(saleId);
    expect(link.rows[0]!.status).toBe('paid');

    const replayed = await withStore(agent, storeId).post('/api/pos/checkout').send(body);
    expect(replayed.status).toBe(201);
    expect(replayed.body.data.saleId).toBe(saleId);
    expect(replayed.body.data.replayed).toBe(true);

    const reuse = await withStore(agent, storeId)
      .post('/api/pos/checkout')
      .send({
        ...body,
        operationId: randomUUID(),
      });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe('DOMAIN_PROMPTPAY_ALREADY_LINKED');
  });

  it('refuses checkout before staff verification', async () => {
    const operationId = randomUUID();
    const session = await createSession(agent, operationId);
    const checkout = await withStore(agent, storeId)
      .post('/api/pos/checkout')
      .send({
        operationId,
        items: [{ variantId, qty: 1 }],
        payments: [
          {
            method: 'promptpay',
            amountSatang: 10_000,
            reference: session.reference,
            promptpaySessionId: session.id,
          },
        ],
        occurredAt: new Date().toISOString(),
        offline: false,
      });
    expect(checkout.status).toBe(409);
    expect(checkout.body.error.code).toBe('DOMAIN_PROMPTPAY_NOT_PAID');
  });

  it('cancels a pending session and refuses confirmation afterwards', async () => {
    const session = await createSession(agent, randomUUID());
    const cancelled = await withStore(agent, storeId)
      .post(`/api/promptpay/sessions/${session.id}/cancel`)
      .send({ reason: 'Customer changed method' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('cancelled');

    const confirm = await withStore(agent, storeId)
      .post(`/api/promptpay/sessions/${session.id}/confirm`)
      .send({});
    expect(confirm.status).toBe(409);
    expect(confirm.body.error.code).toBe('DOMAIN_PROMPTPAY_SESSION_STATE');
  });

  it('expires a QR, blocks normal confirmation and allows an audited override', async () => {
    const session = await createSession(agent, randomUUID());
    await db.withTenant(tenantId, (client) =>
      client.query(
        `UPDATE payment_sessions SET expires_at = now() - interval '1 minute' WHERE id=$1`,
        [session.id],
      ),
    );
    const fetched = await withStore(agent, storeId).get(
      `/api/promptpay/sessions/${session.id}`,
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.status).toBe('expired');
    expect(fetched.body.data.qr).toBeNull();

    const blocked = await withStore(agent, storeId)
      .post(`/api/promptpay/sessions/${session.id}/confirm`)
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DOMAIN_PROMPTPAY_EXPIRED');

    const override = await withStore(agent, storeId)
      .post(`/api/promptpay/sessions/${session.id}/confirm`)
      .send({ overrideExpired: true, note: 'Money arrived late, checked statement' });
    expect(override.status).toBe(200);
    expect(override.body.data.status).toBe('paid');
    expect(override.body.data.verification.metadata.expiredOverride).toBe(true);
  });

  it('serializes concurrent confirmations into one transaction', async () => {
    const session = await createSession(agent, randomUUID());
    const [a, b] = await Promise.all([
      withStore(agent, storeId).post(`/api/promptpay/sessions/${session.id}/confirm`).send({}),
      withStore(agent, storeId).post(`/api/promptpay/sessions/${session.id}/confirm`).send({}),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.meta.alreadyVerified, b.body.meta.alreadyVerified].sort()).toEqual([
      false,
      true,
    ]);
    const transactions = await db.withTenant(tenantId, (client) =>
      client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM payment_transactions WHERE payment_session_id=$1',
        [session.id],
      ),
    );
    expect(transactions.rows[0]!.count).toBe(1);
  });

  it('keeps another tenant from reading the session', async () => {
    const session = await createSession(agent, randomUUID());
    const other = request.agent(app);
    const registration = await other
      .post('/api/auth/register')
      .set(WEB)
      .send({
        businessName: 'Other Tenant',
        ownerName: 'Other Owner',
        email: 'owner-other@test.nexora.local',
        password: 'TestPass!2026',
        storeName: 'Other Store',
        currency: 'THB',
        timezone: 'Asia/Bangkok',
      });
    expect(registration.status).toBe(201);
    const otherStoreId = registration.body.data.store.id;
    const response = await other
      .set(WEB)
      .set('x-store-id', otherStoreId)
      .get(`/api/promptpay/sessions/${session.id}`);
    expect(response.status).toBe(404);
  });
});

describe('PromptPay tender availability', () => {
  it('is present in the POS bootstrap and supports history filters', async () => {
    const bootstrap = await withStore(agent, storeId).get('/api/pos/bootstrap');
    expect(bootstrap.status).toBe(200);
    expect(
      bootstrap.body.data.paymentMethods.some(
        (method: { code: string }) => method.code === 'promptpay',
      ),
    ).toBe(true);

    const history = await withStore(agent, storeId).get(
      '/api/promptpay/sessions?status=paid&pageSize=10',
    );
    expect(history.status).toBe(200);
    expect(history.body.meta.summary.paidCount).toBeGreaterThan(0);
    expect(history.body.data.every((row: { status: string }) => row.status === 'paid')).toBe(true);
  });
});
