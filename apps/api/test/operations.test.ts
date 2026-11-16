import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, runMigrations, type Db } from '@nexora/db';
import { createApp } from '../src/app';
import type { Config } from '../src/config';
import { setLogLevel } from '../src/logger';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is required');

const config: Config = {
  nodeEnv: 'test',
  isProd: false,
  databaseUrl: TEST_URL,
  sessionSecret: 'test-secret-that-is-long-enough-for-hmac-111',
  port: 0,
  webOrigin: 'http://localhost:5173',
  webOrigins: ['http://localhost:5173'],
  logLevel: 'error',
};

type Agent = ReturnType<typeof request.agent>;
const WEB = { 'x-nexora-client': 'web', origin: 'http://localhost:5173' };

let db: Db;
let app: ReturnType<typeof createApp>;
let agent: Agent;
let storeId: string;
let secondStoreId: string;
let tenantId: string;
let productA: { id: string; variantId: string };
let productB: { id: string; variantId: string };

function withStore(a: Agent, store: string) {
  return a.set(WEB).set('x-store-id', store);
}

async function createProduct(name: string, sku: string, price: number, cost: number) {
  const response = await withStore(agent, storeId)
    .post('/api/products')
    .send({
      name,
      sku,
      type: 'simple',
      priceSatang: price,
      costSatang: cost,
      trackInventory: true,
      reorderPoint: 5,
      status: 'active',
    });
  expect(response.status).toBe(201);
  return { id: response.body.data.id as string, variantId: response.body.data.variantId as string };
}

async function onHand(store: string, variantId: string): Promise<number> {
  const rows = await db.withTenant(tenantId, async (client) => {
    const result = await client.query<{ on_hand: number }>(
      `SELECT COALESCE(sum(qty_delta),0)::bigint AS on_hand FROM inventory_movements
       WHERE tenant_id=$1 AND store_id=$2 AND variant_id=$3`,
      [tenantId, store, variantId],
    );
    return Number(result.rows[0]?.on_hand ?? 0);
  });
  return rows;
}

beforeAll(async () => {
  setLogLevel('error');
  const reset = new pg.Client({ connectionString: TEST_URL });
  await reset.connect();
  await reset.query('DROP SCHEMA public CASCADE');
  await reset.query('CREATE SCHEMA public');
  await reset.end();
  await runMigrations(TEST_URL);
  db = createDb(TEST_URL, { max: 6, applicationName: 'nexora-operations-test' });
  app = createApp({ db, config });
  agent = request.agent(app);

  const registration = await agent
    .post('/api/auth/register')
    .set(WEB)
    .send({
      businessName: 'Operations Test Retail',
      ownerName: 'Ops Owner',
      email: 'owner-ops@test.nexora.local',
      password: 'TestPass!2026',
      storeName: 'Ops Store 1',
      currency: 'THB',
      timezone: 'Asia/Bangkok',
    });
  expect(registration.status).toBe(201);
  storeId = registration.body.data.store.id;
  tenantId = registration.body.data.tenant.id;

  productA = await createProduct('Operations Widget', 'OPS-001', 10_000, 6_000);
  productB = await createProduct('Operations Gadget', 'OPS-002', 20_000, 12_000);

  for (const variant of [productA.variantId, productB.variantId]) {
    const adjust = await withStore(agent, storeId)
      .post('/api/inventory/adjust')
      .send({
        operationId: randomUUID(),
        variantId: variant,
        direction: 'increase',
        qty: 50,
        reason: 'Operations test opening stock',
      });
    expect(adjust.status).toBe(200);
  }

  const shift = await withStore(agent, storeId)
    .post('/api/shifts/open')
    .send({ openingCashSatang: 100_000, terminalName: 'Ops counter' });
  expect(shift.status).toBe(201);
});

afterAll(async () => {
  await db.close();
});

describe('product image upload', () => {
  it('accepts a real PNG and rejects a file with the wrong signature', async () => {
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8X8WQAAAABJRU5ErkJggg==';
    const uploaded = await withStore(agent, storeId)
      .post('/api/uploads/product-image')
      .send({ mimeType: 'image/png', dataBase64: png });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.url).toMatch(/^\/uploads\/.+\.png$/);

    const served = await agent.get(uploaded.body.data.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');

    const spoofed = await withStore(agent, storeId)
      .post('/api/uploads/product-image')
      .send({ mimeType: 'image/png', dataBase64: Buffer.from('not a png at all').toString('base64') });
    expect(spoofed.status).toBe(422);
    expect(spoofed.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('purchasing and receiving', () => {
  it('runs draft → submit → approve → partial receive → full receive', async () => {
    const supplier = await withStore(agent, storeId)
      .post('/api/suppliers')
      .send({ name: 'Ops Supplier', phone: '02-000-0000', email: 'supplier@test.nexora.local' });
    expect(supplier.status).toBe(201);
    const supplierId = supplier.body.data.id;

    const po = await withStore(agent, storeId)
      .post('/api/purchase-orders')
      .send({
        operationId: randomUUID(),
        supplierId,
        items: [{ variantId: productA.variantId, qty: 5, unitCostSatang: 5_500 }],
      });
    expect(po.status).toBe(201);
    const poId = po.body.data.id as string;

    const submit = await withStore(agent, storeId)
      .post(`/api/purchase-orders/${poId}/submit`)
      .send({ operationId: randomUUID() });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe('submitted');

    const approve = await withStore(agent, storeId)
      .post(`/api/purchase-orders/${poId}/approve`)
      .send({ operationId: randomUUID() });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('approved');

    const detail = await withStore(agent, storeId).get(`/api/purchase-orders/${poId}`);
    const itemId = detail.body.data.items[0].id;

    const partial = await withStore(agent, storeId)
      .post(`/api/purchase-orders/${poId}/receive`)
      .send({
        operationId: randomUUID(),
        items: [{ poItemId: itemId, qty: 2, unitCostSatang: 5_500 }],
      });
    expect(partial.status).toBe(201);
    expect(partial.body.data.status).toBe('partially_received');
    expect(await onHand(storeId, productA.variantId)).toBe(52);

    const rest = await withStore(agent, storeId)
      .post(`/api/purchase-orders/${poId}/receive`)
      .send({
        operationId: randomUUID(),
        items: [{ poItemId: itemId, qty: 3, unitCostSatang: 5_500 }],
      });
    expect(rest.status).toBe(201);
    expect(rest.body.data.status).toBe('received');
    expect(await onHand(storeId, productA.variantId)).toBe(55);

    const again = await withStore(agent, storeId)
      .post(`/api/purchase-orders/${poId}/receive`)
      .send({
        operationId: randomUUID(),
        items: [{ poItemId: itemId, qty: 1 }],
      });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DOMAIN_PURCHASE_STATE');
  });
});

describe('stock transfers', () => {
  it('moves stock between branches and refuses a second receipt', async () => {
    await db.withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE subscriptions SET plan_id=(SELECT id FROM subscription_plans WHERE code='growth') WHERE tenant_id=$1`,
        [tenantId],
      );
    });

    const store = await withStore(agent, storeId)
      .post('/api/stores')
      .send({ name: 'Ops Store 2', code: 'OPS2', timezone: 'Asia/Bangkok', receiptPrefix: 'R' });
    expect(store.status).toBe(201);
    secondStoreId = store.body.data.id;

    const beforeSource = await onHand(storeId, productA.variantId);
    const transfer = await withStore(agent, storeId)
      .post('/api/transfers')
      .send({
        operationId: randomUUID(),
        toStoreId: secondStoreId,
        items: [{ variantId: productA.variantId, qty: 4 }],
        note: 'Test transfer',
      });
    expect(transfer.status).toBe(201);
    const transferId = transfer.body.data.id as string;

    const dispatch = await withStore(agent, storeId)
      .post(`/api/transfers/${transferId}/dispatch`)
      .send({ operationId: randomUUID() });
    expect(dispatch.status).toBe(200);
    expect(await onHand(storeId, productA.variantId)).toBe(beforeSource - 4);

    const detail = await withStore(agent, secondStoreId).get(`/api/transfers/${transferId}`);
    const itemId = detail.body.data.items[0].id;

    const receive3 = await withStore(agent, secondStoreId)
      .post(`/api/transfers/${transferId}/receive`)
      .send({ operationId: randomUUID(), items: [{ transferItemId: itemId, qty: 3 }] });
    expect(receive3.status).toBe(200);
    expect(receive3.body.data.status).toBe('dispatched');

    const receive1 = await withStore(agent, secondStoreId)
      .post(`/api/transfers/${transferId}/receive`)
      .send({ operationId: randomUUID(), items: [{ transferItemId: itemId, qty: 1 }] });
    expect(receive1.status).toBe(200);
    expect(receive1.body.data.status).toBe('received');
    expect(await onHand(secondStoreId, productA.variantId)).toBe(4);

    const duplicate = await withStore(agent, secondStoreId)
      .post(`/api/transfers/${transferId}/receive`)
      .send({ operationId: randomUUID(), items: [{ transferItemId: itemId, qty: 1 }] });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.data).toBeUndefined();
  });
});

describe('stock count and promotions', () => {
  it('adjusts only the variance from a physical count', async () => {
    const before = await onHand(storeId, productB.variantId);
    const count = await withStore(agent, storeId)
      .post('/api/inventory/counts')
      .send({
        operationId: randomUUID(),
        note: 'Cycle count test',
        items: [{ variantId: productB.variantId, countedQty: before - 3 }],
      });
    expect(count.status).toBe(200);
    expect(count.body.data.variances[0].difference).toBe(-3);
    expect(await onHand(storeId, productB.variantId)).toBe(before - 3);
  });

  it('earns and redeems loyalty points as a checkout discount', async () => {
    const customer = await withStore(agent, storeId)
      .post('/api/customers')
      .send({ name: 'Loyalty Tester', phone: '089-000-0001', consentMarketing: true });
    expect(customer.status).toBe(201);
    const customerId = customer.body.data.id;

    const first = await withStore(agent, storeId)
      .post('/api/pos/checkout')
      .send({
        operationId: randomUUID(),
        items: [{ variantId: productB.variantId, qty: 1 }],
        customerId,
        payments: [{ method: 'cash', amountSatang: 20_000 }],
      });
    expect(first.status).toBe(201);
    expect(first.body.data.loyaltyPoints).toBe(2);
    expect(first.body.data.totalSatang).toBe(20_000);

    const profile = await withStore(agent, storeId).get(`/api/customers/${customerId}`);
    expect(profile.body.data.points).toBe(2);

    const second = await withStore(agent, storeId)
      .post('/api/pos/checkout')
      .send({
        operationId: randomUUID(),
        items: [{ variantId: productB.variantId, qty: 1 }],
        customerId,
        redeemPoints: 2,
        payments: [{ method: 'cash', amountSatang: 19_800 }],
      });
    expect(second.status).toBe(201);
    expect(second.body.data.pointsRedeemed).toBe(2);
    expect(second.body.data.pointsDiscountSatang).toBe(200);
    expect(second.body.data.totalSatang).toBe(19_800);
    expect(second.body.data.receipt.pointsRedeemed).toBe(2);
    expect(second.body.data.loyaltyPoints).toBe(1);

    const after = await withStore(agent, storeId).get(`/api/customers/${customerId}`);
    expect(after.body.data.points).toBe(1);

    const tooMany = await withStore(agent, storeId)
      .post('/api/pos/checkout')
      .send({
        operationId: randomUUID(),
        items: [{ variantId: productB.variantId, qty: 1 }],
        customerId,
        redeemPoints: 999,
        payments: [{ method: 'cash', amountSatang: 20_000 }],
      });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('DOMAIN_POINTS_INSUFFICIENT');
  });

  it('applies an automatic promotion, then voids and restores stock', async () => {
    const promotion = await withStore(agent, storeId)
      .post('/api/promotions')
      .send({
        name: 'Ops 10%',
        kind: 'order_percent',
        valueBp: 1000,
        minSubtotalSatang: 0,
        targetIds: [],
        stackable: false,
        priority: 10,
        isActive: true,
        couponEnabled: false,
      });
    expect(promotion.status).toBe(201);

    const quote = await withStore(agent, storeId)
      .post('/api/pos/quote')
      .send({ items: [{ variantId: productB.variantId, qty: 1 }] });
    expect(quote.status).toBe(200);
    expect(quote.body.data.totalSatang).toBe(18_000);
    expect(quote.body.data.appliedPromotions).toHaveLength(1);

    const before = await onHand(storeId, productB.variantId);
    const checkout = await withStore(agent, storeId)
      .post('/api/pos/checkout')
      .send({
        operationId: randomUUID(),
        items: [{ variantId: productB.variantId, qty: 1 }],
        payments: [{ method: 'cash', amountSatang: 18_000 }],
      });
    expect(checkout.status).toBe(201);
    expect(await onHand(storeId, productB.variantId)).toBe(before - 1);

    const voided = await withStore(agent, storeId)
      .post(`/api/sales/${checkout.body.data.saleId}/void`)
      .send({ operationId: randomUUID(), reason: 'Integration test void' });
    expect(voided.status).toBe(200);
    expect(voided.body.data.status).toBe('voided');
    expect(await onHand(storeId, productB.variantId)).toBe(before);
  });
});
