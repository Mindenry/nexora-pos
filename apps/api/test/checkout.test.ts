import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, runMigrations, type Db } from '@nexora/db';
import { createApp } from '../src/app';
import type { Config } from '../src/config';
import { setLogLevel } from '../src/logger';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is required for integration tests');

const config: Config = {
  nodeEnv: 'test',
  isProd: false,
  databaseUrl: TEST_URL,
  sessionSecret: 'test-secret-that-is-long-enough-for-hmac-000',
  port: 0,
  webOrigin: 'http://localhost:5173',
  logLevel: 'error',
};

type Agent = ReturnType<typeof request.agent>;

const WEB = { 'x-nexora-client': 'web', origin: 'http://localhost:5173' };

let db: Db;
let app: ReturnType<typeof createApp>;
let owner: Agent;
let storeId: string;
let tenantId: string;
let variantId: string;
let productId: string;
let saleId: string;
let saleNumber: string;
let saleItemId: string;
let lineTotal: number;
let saleTotal: number;

const ownerAgent = () => request.agent(app);

function withStore(agent: Agent, store: string) {
  return agent.set(WEB).set('x-store-id', store);
}

beforeAll(async () => {
  setLogLevel('error');
  const reset = new pg.Client({ connectionString: TEST_URL });
  await reset.connect();
  await reset.query('DROP SCHEMA public CASCADE');
  await reset.query('CREATE SCHEMA public');
  await reset.end();
  await runMigrations(TEST_URL);
  db = createDb(TEST_URL, { max: 8, applicationName: 'nexora-test' });
  app = createApp({ db, config });
  owner = ownerAgent();

  const registration = await owner
    .post('/api/auth/register')
    .set(WEB)
    .send({
      businessName: 'Test Retail A',
      ownerName: 'Owner A',
      email: 'owner-a@test.nexora.local',
      password: 'TestPass!2026',
      storeName: 'Store A',
      phone: '080-000-0000',
      currency: 'THB',
      timezone: 'Asia/Bangkok',
    });
  expect(registration.status).toBe(201);
  storeId = registration.body.data.store.id;
  tenantId = registration.body.data.tenant.id;

  const product = await withStore(owner, storeId)
    .post('/api/products')
    .send({
      name: 'Test Coffee',
      sku: 'TEST-COF-1',
      barcode: '8859999999991',
      type: 'simple',
      priceSatang: 10_000,
      costSatang: 6_000,
      trackInventory: true,
      reorderPoint: 3,
      status: 'active',
    });
  expect(product.status).toBe(201);
  productId = product.body.data.id;
  variantId = product.body.data.variantId;

  const adjust = await withStore(owner, storeId)
    .post('/api/inventory/adjust')
    .send({
      operationId: randomUUID(),
      variantId,
      direction: 'increase',
      qty: 10,
      reason: 'Opening stock for test',
    });
  expect(adjust.status).toBe(200);
  expect(adjust.body.data.onHand).toBe(10);

  const shift = await withStore(owner, storeId)
    .post('/api/shifts/open')
    .send({ openingCashSatang: 200_000, terminalName: 'Test counter' });
  expect(shift.status).toBe(201);
});

afterAll(async () => {
  await db.close();
});

describe('POS checkout', () => {
  it('prices on the server and completes a sale in one transaction', async () => {
    const quote = await withStore(owner, storeId)
      .post('/api/pos/quote')
      .send({ items: [{ variantId, qty: 2 }] });
    expect(quote.status).toBe(200);
    expect(quote.body.data.totalSatang).toBe(20_000);
    expect(quote.body.data.taxSatang).toBe(1_308);

    saleTotal = quote.body.data.totalSatang;
    const operationId = randomUUID();
    const payload = {
      operationId,
      items: [{ variantId, qty: 2 }],
      payments: [{ method: 'cash', amountSatang: saleTotal, tenderedSatang: 50_000 }],
    };

    const first = await withStore(owner, storeId).post('/api/pos/checkout').send(payload);
    expect(first.status).toBe(201);
    expect(first.body.data.totalSatang).toBe(20_000);
    expect(first.body.data.changeSatang).toBe(30_000);
    expect(first.body.data.number).toMatch(/^R-\d{8}-\d{5}$/);
    saleId = first.body.data.saleId;
    saleNumber = first.body.data.number;
    saleItemId = first.body.data.receipt.items[0].saleItemId;
    lineTotal = first.body.data.receipt.items[0].totalSatang;

    // Replaying the same operation id returns the same sale and changes nothing.
    const replay = await withStore(owner, storeId).post('/api/pos/checkout').send(payload);
    expect(replay.status).toBe(201);
    expect(replay.body.data.saleId).toBe(saleId);
    expect(replay.body.data.number).toBe(saleNumber);
    expect(replay.body.data.replayed).toBe(true);

    const sales = await withStore(owner, storeId).get('/api/sales');
    expect(sales.body.meta.total).toBe(1);

    const stock = await withStore(owner, storeId).get('/api/inventory/overview?search=TEST-COF-1');
    expect(stock.body.data[0].onHand).toBe(8);

    const shift = await withStore(owner, storeId).get('/api/shifts/current');
    expect(shift.body.data.expectedCashSatang).toBe(220_000);
    expect(shift.body.data.salesCount).toBe(1);

    const sums = await db.withTenant(tenantId, async (client) => {
      const row = await client.query<{ sale_total: number; payment_total: number; movements: number }>(
        `SELECT (SELECT sum(total_satang)::bigint FROM sales WHERE id=$1) AS sale_total,
                (SELECT sum(amount_satang)::bigint FROM payments WHERE sale_id=$1) AS payment_total,
                (SELECT COALESCE(sum(qty_delta),0)::bigint FROM inventory_movements
                  WHERE reference_type='sale' AND reference_id=$1) AS movements`,
        [saleId],
      );
      return row.rows[0]!;
    });
    expect(Number(sums.sale_total)).toBe(Number(sums.payment_total));
    expect(Number(sums.movements)).toBe(-2);
  });

  it('blocks a sale that exceeds stock and writes nothing', async () => {
    const quote = await withStore(owner, storeId)
      .post('/api/pos/quote')
      .send({ items: [{ variantId, qty: 999 }] });
    const response = await withStore(owner, storeId)
      .post('/api/pos/checkout')
      .send({
        operationId: randomUUID(),
        items: [{ variantId, qty: 999 }],
        payments: [{ method: 'cash', amountSatang: quote.body.data.totalSatang }],
      });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('DOMAIN_INSUFFICIENT_STOCK');
    const sales = await withStore(owner, storeId).get('/api/sales');
    expect(sales.body.meta.total).toBe(1);
  });

  it('rejects a payment total that does not equal the order total', async () => {
    const response = await withStore(owner, storeId)
      .post('/api/pos/checkout')
      .send({
        operationId: randomUUID(),
        items: [{ variantId, qty: 1 }],
        payments: [{ method: 'cash', amountSatang: 1 }],
      });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('DOMAIN_PAYMENT_MISMATCH');
  });

  it('refunds a partial quantity, restocks and caps the refund', async () => {
    const refund = await withStore(owner, storeId)
      .post('/api/refunds')
      .send({
        operationId: randomUUID(),
        saleId,
        items: [{ saleItemId, qty: 1 }],
        reason: 'Integration test partial refund',
        restock: true,
      });
    expect(refund.status).toBe(201);
    expect(refund.body.data.totalSatang).toBe(lineTotal / 2);
    expect(refund.body.data.method).toBe('cash');

    const sale = await withStore(owner, storeId).get(`/api/sales/${saleId}`);
    expect(sale.body.data.status).toBe('partially_refunded');
    expect(sale.body.data.refundedSatang).toBe(lineTotal / 2);
    expect(sale.body.data.items[0].refundedQty).toBe(1);

    const stock = await withStore(owner, storeId).get('/api/inventory/overview?search=TEST-COF-1');
    expect(stock.body.data[0].onHand).toBe(9);

    const over = await withStore(owner, storeId)
      .post('/api/refunds')
      .send({
        operationId: randomUUID(),
        saleId,
        items: [{ saleItemId, qty: 99 }],
        reason: 'Too many',
        restock: true,
      });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('DOMAIN_REFUND_EXCEEDS');

    const shift = await withStore(owner, storeId).get('/api/shifts/current');
    expect(shift.body.data.expectedCashSatang).toBe(210_000);
  });

  it('keeps completed sale money immutable', async () => {
    await expect(
      db.withTenant(tenantId, async (client) => {
        await client.query('UPDATE sales SET total_satang = total_satang + 1 WHERE id=$1', [saleId]);
      }),
    ).rejects.toThrow(/SALE_IMMUTABLE/);
  });
});

describe('tenant isolation and permissions', () => {
  let otherAgent: Agent;
  let otherStore: string;

  it('registers a second tenant with its own store', async () => {
    otherAgent = ownerAgent();
    const registration = await otherAgent
      .post('/api/auth/register')
      .set(WEB)
      .send({
        businessName: 'Test Retail B',
        ownerName: 'Owner B',
        email: 'owner-b@test.nexora.local',
        password: 'TestPass!2026',
        storeName: 'Store B',
        currency: 'THB',
        timezone: 'Asia/Bangkok',
      });
    expect(registration.status).toBe(201);
    otherStore = registration.body.data.store.id;

    const products = await withStore(otherAgent, otherStore).get('/api/products');
    expect(products.body.meta.total).toBe(0);
  });

  it('cannot read another tenant sale by id', async () => {
    const response = await withStore(otherAgent, otherStore).get(`/api/sales/${saleId}`);
    expect(response.status).toBe(404);
  });

  it('enforces RLS even when tenant scoping is attempted in SQL', async () => {
    const rows = await db.withTenant(
      (await otherAgent.get('/api/auth/me').set(WEB)).body.data.tenant.id,
      async (client) => {
        const result = await client.query('SELECT id FROM products WHERE id=$1', [productId]);
        return result.rowCount;
      },
    );
    expect(rows).toBe(0);
  });

  it('does not let a cashier create products or view reports', async () => {
    const created = await withStore(owner, storeId)
      .post('/api/employees')
      .send({
        name: 'Cashier Test',
        email: 'cashier@test.nexora.local',
        password: 'CashierPass!2026',
        roleCode: 'cashier',
        storeIds: [storeId],
      });
    expect(created.status).toBe(201);

    const cashier = request.agent(app);
    const login = await cashier
      .post('/api/auth/login')
      .set(WEB)
      .send({ email: 'cashier@test.nexora.local', password: 'CashierPass!2026' });
    expect(login.status).toBe(200);
    expect(login.body.data.permissions).toContain('sales.create');
    expect(login.body.data.permissions).not.toContain('products.create');

    const denied = await withStore(cashier, storeId)
      .post('/api/products')
      .send({
        name: 'Forbidden product',
        type: 'simple',
        priceSatang: 1000,
        costSatang: 500,
        status: 'active',
      });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('AUTH_PERMISSION_DENIED');

    const reports = await withStore(cashier, storeId).get('/api/reports/dashboard');
    expect(reports.status).toBe(403);
  });
});

describe('shift reconciliation', () => {
  it('closes with an exact variance when the drawer matches', async () => {
    const current = await withStore(owner, storeId).get('/api/shifts/current');
    const expected = current.body.data.expectedCashSatang;
    const closed = await withStore(owner, storeId)
      .post('/api/shifts/close')
      .send({ countedCashSatang: expected, note: 'Counted by test' });
    expect(closed.status).toBe(200);
    expect(closed.body.data.shift.status).toBe('closed');
    expect(closed.body.data.varianceSatang).toBe(0);
    expect(closed.body.data.expectedCashSatang).toBe(210_000);
  });
});
