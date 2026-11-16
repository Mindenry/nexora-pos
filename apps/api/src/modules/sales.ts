import { Router } from 'express';
import { z } from 'zod';
import {
  NexoraError,
  dateStringSchema,
  listQuerySchema,
  presetRange,
  refundSchema,
  uuidSchema,
  voidSaleSchema,
} from '@nexora/shared';
import { requirePermission } from '../http/auth';
import { created, ok } from '../http/respond';
import { performRefund, voidSale } from '../services/refunds';
import { writeAudit } from '../services/audit';

const saleQuerySchema = listQuerySchema.extend({
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  status: z.enum(['completed', 'voided', 'partially_refunded', 'refunded']).optional(),
  employeeId: uuidSchema.optional(),
  customerId: uuidSchema.optional(),
});

export function salesRoutes(): Router {
  const router = Router();

  router.get('/sales', requirePermission('sales.read'), async (req, res) => {
    const ctx = req.ctx;
    const query = saleQuerySchema.parse(req.query);
    const range = presetRange('last30');
    const from = query.from ?? range.from;
    const to = query.to ?? range.to;
    const storeId = ctx.store?.id ?? null;
    if (!storeId) throw new NexoraError('AUTH_STORE_FORBIDDEN');
    const offset = (query.page - 1) * query.pageSize;
    const search = query.search?.trim() || null;

    const result = await ctx.withDb(async (client) => {
      const rows = await client.query(
        `SELECT s.id, s.number, s.status, s.business_date, s.occurred_at, s.total_satang,
                s.refunded_satang, s.item_count, s.change_satang,
                st.name AS store_name, e.display_name AS employee_name, c.name AS customer_name,
                (SELECT string_agg(DISTINCT p.method, ',') FROM payments p WHERE p.sale_id=s.id) AS methods
         FROM sales s
         JOIN stores st ON st.id=s.store_id
         JOIN employees e ON e.id=s.employee_id
         LEFT JOIN customers c ON c.id=s.customer_id
         WHERE s.tenant_id=$1 AND s.store_id=$2 AND s.business_date BETWEEN $3 AND $4
           AND ($5::text IS NULL OR s.status=$5)
           AND ($6::uuid IS NULL OR s.employee_id=$6)
           AND ($7::uuid IS NULL OR s.customer_id=$7)
           AND ($8::text IS NULL OR s.number ILIKE '%'||$8||'%' OR c.name ILIKE '%'||$8||'%')
         ORDER BY s.occurred_at DESC
         LIMIT $9 OFFSET $10`,
        [
          ctx.tenant!.id,
          storeId,
          from,
          to,
          query.status ?? null,
          query.employeeId ?? null,
          query.customerId ?? null,
          search,
          query.pageSize,
          offset,
        ],
      );
      const totals = await client.query<{
        count: number;
        gross: number;
        refunded: number;
        tax: number;
        discount: number;
      }>(
        `SELECT count(*)::bigint AS count,
                COALESCE(sum(s.total_satang),0)::bigint AS gross,
                COALESCE(sum(s.refunded_satang),0)::bigint AS refunded,
                COALESCE(sum(s.tax_satang),0)::bigint AS tax,
                COALESCE(sum(s.discount_satang),0)::bigint AS discount
         FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
         WHERE s.tenant_id=$1 AND s.store_id=$2 AND s.business_date BETWEEN $3 AND $4
           AND s.status <> 'voided'
           AND ($5::text IS NULL OR s.status=$5)
           AND ($6::uuid IS NULL OR s.employee_id=$6)
           AND ($7::uuid IS NULL OR s.customer_id=$7)
           AND ($8::text IS NULL OR s.number ILIKE '%'||$8||'%' OR c.name ILIKE '%'||$8||'%')`,
        [ctx.tenant!.id, storeId, from, to, query.status ?? null, query.employeeId ?? null, query.customerId ?? null, search],
      );
      const total = Number(totals.rows[0]?.count ?? 0);
      return { rows: rows.rows, total, totals: totals.rows[0]! };
    });

    ok(
      res,
      result.rows.map((r: any) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        businessDate: r.business_date,
        occurredAt: r.occurred_at,
        totalSatang: Number(r.total_satang),
        refundedSatang: Number(r.refunded_satang),
        itemCount: r.item_count,
        changeSatang: Number(r.change_satang),
        storeName: r.store_name,
        employeeName: r.employee_name,
        customerName: r.customer_name,
        methods: r.methods ? String(r.methods).split(',') : [],
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
        summary: {
          grossSalesSatang: Number(result.totals.gross),
          refundedSatang: Number(result.totals.refunded),
          taxSatang: Number(result.totals.tax),
          discountSatang: Number(result.totals.discount),
        },
        range: { from, to },
      },
    );
  });

  router.get('/sales/:id', requirePermission('sales.read'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    const data = await ctx.withDb(async (client) => {
      const sale = await client.query(
        `SELECT s.*, st.name AS store_name, st.address AS store_address, e.display_name AS employee_name,
                c.name AS customer_name, c.phone AS customer_phone
         FROM sales s
         JOIN stores st ON st.id=s.store_id
         JOIN employees e ON e.id=s.employee_id
         LEFT JOIN customers c ON c.id=s.customer_id
         WHERE s.tenant_id=$1 AND s.id=$2`,
        [ctx.tenant!.id, id],
      );
      const row = sale.rows[0];
      if (!row) throw new NexoraError('NOT_FOUND');
      if (!ctx.stores.some((s) => s.id === row.store_id)) throw new NexoraError('AUTH_STORE_FORBIDDEN');
      const items = await client.query(
        `SELECT id, product_name, variant_name, sku, qty, unit_price_satang, discount_satang,
                tax_satang, line_total_satang, refunded_qty
         FROM sale_items WHERE tenant_id=$1 AND sale_id=$2 ORDER BY created_at, id`,
        [ctx.tenant!.id, id],
      );
      const payments = await client.query(
        `SELECT id, method, method_name, status, amount_satang, tendered_satang, change_satang, reference, paid_at
         FROM payments WHERE tenant_id=$1 AND sale_id=$2 ORDER BY created_at`,
        [ctx.tenant!.id, id],
      );
      const refunds = await client.query(
        `SELECT id, number, amount_satang, tax_satang, reason, method, restock, created_at
         FROM refunds WHERE tenant_id=$1 AND sale_id=$2 ORDER BY created_at`,
        [ctx.tenant!.id, id],
      );
      return { sale: row, items: items.rows, payments: payments.rows, refunds: refunds.rows };
    });

    const s = data.sale as any;
    ok(res, {
      id: s.id,
      number: s.number,
      status: s.status,
      businessDate: s.business_date,
      occurredAt: s.occurred_at,
      createdAt: s.created_at,
      subtotalSatang: Number(s.subtotal_satang),
      discountSatang: Number(s.discount_satang),
      taxSatang: Number(s.tax_satang),
      totalSatang: Number(s.total_satang),
      costSatang: Number(s.cost_satang),
      refundedSatang: Number(s.refunded_satang),
      changeSatang: Number(s.change_satang),
      itemCount: s.item_count,
      pointsRedeemed: Number(s.points_redeemed ?? 0),
      pointsDiscountSatang: Number(s.points_discount_satang ?? 0),
      loyaltyPoints: Number(s.loyalty_points ?? 0),
      note: s.note,
      voidReason: s.void_reason,
      storeId: s.store_id,
      storeName: s.store_name,
      storeAddress: s.store_address,
      employeeName: s.employee_name,
      customerId: s.customer_id,
      customerName: s.customer_name,
      customerPhone: s.customer_phone,
      receipt: s.receipt_snapshot,
      items: data.items.map((i: any) => ({
        id: i.id,
        productName: i.product_name,
        variantName: i.variant_name,
        sku: i.sku,
        qty: i.qty,
        unitPriceSatang: Number(i.unit_price_satang),
        discountSatang: Number(i.discount_satang),
        taxSatang: Number(i.tax_satang),
        lineTotalSatang: Number(i.line_total_satang),
        refundedQty: i.refunded_qty,
        refundableQty: i.qty - i.refunded_qty,
      })),
      payments: data.payments.map((p: any) => ({
        id: p.id,
        method: p.method,
        methodName: p.method_name,
        status: p.status,
        amountSatang: Number(p.amount_satang),
        tenderedSatang: p.tendered_satang != null ? Number(p.tendered_satang) : null,
        changeSatang: Number(p.change_satang),
        reference: p.reference,
        paidAt: p.paid_at,
      })),
      refunds: data.refunds.map((r: any) => ({
        id: r.id,
        number: r.number,
        amountSatang: Number(r.amount_satang),
        taxSatang: Number(r.tax_satang),
        reason: r.reason,
        method: r.method,
        restock: r.restock,
        createdAt: r.created_at,
      })),
    });
  });

  router.get('/sales/:id/receipt', requirePermission('sales.read'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    const snapshot = await ctx.withDb(async (client) => {
      const sale = await client.query<{ store_id: string; receipt_snapshot: unknown }>(
        'SELECT store_id, receipt_snapshot FROM sales WHERE tenant_id=$1 AND id=$2',
        [ctx.tenant!.id, id],
      );
      if (!sale.rows[0]) throw new NexoraError('NOT_FOUND');
      if (!ctx.stores.some((s) => s.id === sale.rows[0]!.store_id)) throw new NexoraError('AUTH_STORE_FORBIDDEN');
      return sale.rows[0].receipt_snapshot;
    });
    ok(res, snapshot);
  });

  router.post('/sales/:id/reprint', requirePermission('sales.read'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    const snapshot = await ctx.withDb(async (client) => {
      const sale = await client.query<{
        store_id: string;
        number: string;
        receipt_snapshot: any;
      }>('SELECT store_id, number, receipt_snapshot FROM sales WHERE tenant_id=$1 AND id=$2', [
        ctx.tenant!.id,
        id,
      ]);
      const row = sale.rows[0];
      if (!row) throw new NexoraError('NOT_FOUND');
      if (!ctx.stores.some((s) => s.id === row.store_id)) throw new NexoraError('AUTH_STORE_FORBIDDEN');
      const snapshot = { ...row.receipt_snapshot, reprint: true, reprintedAt: new Date().toISOString() };
      await client.query(
        `INSERT INTO receipts (tenant_id, sale_id, number, type, snapshot, printed_count, created_by)
         VALUES ($1,$2,$3,'reprint',$4::jsonb,1,$5)`,
        [ctx.tenant!.id, id, row.number, JSON.stringify(snapshot), ctx.user.id],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        storeId: row.store_id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'receipt.reprinted',
        entityType: 'sale',
        entityId: id,
        after: { number: row.number },
        correlationId: ctx.correlationId,
      });
      return snapshot;
    });
    ok(res, snapshot);
  });

  router.post('/sales/:id/void', requirePermission('sales.cancel'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = voidSaleSchema.parse(req.body);
    const ctx = req.ctx;
    const result = await ctx.withDb((client) => voidSale(client, ctx, id, input));
    ok(res, result);
  });

  router.post('/refunds', requirePermission('refunds.create'), async (req, res) => {
    const input = refundSchema.parse(req.body);
    const ctx = req.ctx;
    const result = await ctx.withDb((client) => performRefund(client, ctx, input));
    created(res, result);
  });

  router.get('/refunds', requirePermission('refunds.create'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const storeId = ctx.store?.id ?? null;
    if (!storeId) throw new NexoraError('AUTH_STORE_FORBIDDEN');
    const offset = (query.page - 1) * query.pageSize;
    const result = await ctx.withDb(async (client) => {
      const rows = await client.query(
        `SELECT r.id, r.number, r.original_number, r.amount_satang, r.reason, r.method,
                r.restock, r.created_at, s.number AS sale_number, c.name AS customer_name,
                e.display_name AS employee_name
         FROM refunds r
         JOIN sales s ON s.id=r.sale_id
         LEFT JOIN customers c ON c.id=s.customer_id
         JOIN employees e ON e.id=r.created_by
         WHERE r.tenant_id=$1 AND r.store_id=$2
         ORDER BY r.created_at DESC LIMIT $3 OFFSET $4`,
        [ctx.tenant!.id, storeId, query.pageSize, offset],
      );
      const total = await client.query<{ count: number }>(
        'SELECT count(*)::bigint AS count FROM refunds WHERE tenant_id=$1 AND store_id=$2',
        [ctx.tenant!.id, storeId],
      );
      return { rows: rows.rows, total: Number(total.rows[0]?.count ?? 0) };
    });
    ok(
      res,
      result.rows.map((r: any) => ({
        id: r.id,
        number: r.number,
        originalNumber: r.original_number,
        saleNumber: r.sale_number,
        amountSatang: Number(r.amount_satang),
        reason: r.reason,
        method: r.method,
        restock: r.restock,
        createdAt: r.created_at,
        customerName: r.customer_name,
        employeeName: r.employee_name,
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
      },
    );
  });

  return router;
}
