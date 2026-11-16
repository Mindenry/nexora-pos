import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  NexoraError,
  businessDateOf,
  listQuerySchema,
  purchaseOrderSchema,
  receivePurchaseSchema,
  supplierInputSchema,
  supplierPaymentSchema,
  uuidSchema,
} from '@nexora/shared';
import { z } from 'zod';
import { requirePermission } from '../http/auth';
import { created, ok } from '../http/respond';
import { writeAudit } from '../services/audit';
import { appendMovement } from '../services/inventory';
import { runIdempotent } from '../services/idempotency';
import { allocateDocumentNumber } from '../services/numbering';

const operationSchema = z.object({ operationId: uuidSchema });
const isoDate = (value: unknown): string | null => (value ? String(value).slice(0, 10) : null);

export function purchasingRoutes(): Router {
  const router = Router();

  router.get('/suppliers', requirePermission('purchasing.read'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const search = query.search?.trim() || null;
    const offset = (query.page - 1) * query.pageSize;
    const result = await ctx.withDb(async (client) => {
      const rows = await client.query(
        `SELECT s.id, s.code, s.name, s.contact_name, s.phone, s.email, s.address, s.tax_id,
                s.notes, s.status, s.created_at,
                (SELECT count(*)::bigint FROM purchase_orders po WHERE po.supplier_id=s.id) AS po_count,
                (SELECT COALESCE(sum(po.total_satang),0)::bigint FROM purchase_orders po
                  WHERE po.supplier_id=s.id AND po.status IN ('received','closed','partially_received')) AS purchase_total
         FROM suppliers s
         WHERE s.tenant_id=$1 AND ($2::text IS NULL OR s.name ILIKE '%'||$2||'%' OR s.code ILIKE '%'||$2||'%')
         ORDER BY s.name LIMIT $3 OFFSET $4`,
        [ctx.tenant!.id, search, query.pageSize, offset],
      );
      const total = await client.query<{ count: number }>(
        `SELECT count(*)::bigint AS count FROM suppliers WHERE tenant_id=$1
         AND ($2::text IS NULL OR name ILIKE '%'||$2||'%' OR code ILIKE '%'||$2||'%')`,
        [ctx.tenant!.id, search],
      );
      return { rows: rows.rows, total: Number(total.rows[0]?.count ?? 0) };
    });
    ok(
      res,
      result.rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        contactName: r.contact_name,
        phone: r.phone,
        email: r.email,
        address: r.address,
        taxId: r.tax_id,
        notes: r.notes,
        status: r.status,
        poCount: Number(r.po_count),
        purchaseTotalSatang: Number(r.purchase_total),
        createdAt: r.created_at,
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
      },
    );
  });

  router.post('/suppliers', requirePermission('suppliers.manage'), async (req, res) => {
    const input = supplierInputSchema.parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const inserted = await client.query(
        `INSERT INTO suppliers (tenant_id, code, name, contact_name, phone, email, address, tax_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, name, code`,
        [
          ctx.tenant!.id,
          input.code || null,
          input.name,
          input.contactName || '',
          input.phone || '',
          input.email || '',
          input.address || '',
          input.taxId || '',
          input.notes || '',
        ],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: inserted.rows[0]!.id,
        after: { name: input.name },
        correlationId: ctx.correlationId,
      });
      return inserted.rows[0];
    });
    created(res, row);
  });

  router.patch('/suppliers/:id', requirePermission('suppliers.manage'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = supplierInputSchema.partial().parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const updated = await client.query(
        `UPDATE suppliers SET
           name = COALESCE($1, name), code = COALESCE($2, code),
           contact_name = COALESCE($3, contact_name), phone = COALESCE($4, phone),
           email = COALESCE($5, email), address = COALESCE($6, address),
           tax_id = COALESCE($7, tax_id), notes = COALESCE($8, notes), updated_at=now()
         WHERE tenant_id=$9 AND id=$10 RETURNING id`,
        [
          input.name ?? null,
          input.code || null,
          input.contactName ?? null,
          input.phone ?? null,
          input.email ?? null,
          input.address ?? null,
          input.taxId ?? null,
          input.notes ?? null,
          ctx.tenant!.id,
          id,
        ],
      );
      if (!updated.rowCount) throw new NexoraError('NOT_FOUND');
      return { id };
    });
    ok(res, row);
  });

  router.get('/purchase-orders', requirePermission('purchasing.read'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const storeId = ctx.store?.id ?? null;
    if (!storeId) throw new NexoraError('AUTH_STORE_FORBIDDEN');
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const offset = (query.page - 1) * query.pageSize;
    const result = await ctx.withDb(async (client) => {
      const rows = await client.query(
        `SELECT po.id, po.number, po.status, po.order_date, po.expected_date, po.total_satang,
                po.created_at, po.approved_at, s.name AS supplier_name,
                (SELECT COALESCE(sum(qty_ordered),0)::bigint FROM purchase_order_items i WHERE i.purchase_order_id=po.id) AS total_qty
         FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
         WHERE po.tenant_id=$1 AND po.store_id=$2 AND ($3::text IS NULL OR po.status=$3)
         ORDER BY po.created_at DESC LIMIT $4 OFFSET $5`,
        [ctx.tenant!.id, storeId, status, query.pageSize, offset],
      );
      const total = await client.query<{ count: number }>(
        `SELECT count(*)::bigint AS count FROM purchase_orders
         WHERE tenant_id=$1 AND store_id=$2 AND ($3::text IS NULL OR status=$3)`,
        [ctx.tenant!.id, storeId, status],
      );
      return { rows: rows.rows, total: Number(total.rows[0]?.count ?? 0) };
    });
    ok(
      res,
      result.rows.map((r: any) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        orderDate: isoDate(r.order_date),
        expectedDate: isoDate(r.expected_date),
        totalSatang: Number(r.total_satang),
        totalQty: Number(r.total_qty),
        supplierName: r.supplier_name,
        createdAt: r.created_at,
        approvedAt: r.approved_at,
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
      },
    );
  });

  router.get('/purchase-orders/:id', requirePermission('purchasing.read'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    const data = await ctx.withDb(async (client) => {
      const po = await client.query(
        `SELECT po.*, s.name AS supplier_name, s.phone AS supplier_phone, s.email AS supplier_email
         FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
         WHERE po.tenant_id=$1 AND po.id=$2`,
        [ctx.tenant!.id, id],
      );
      const row = po.rows[0];
      if (!row) throw new NexoraError('NOT_FOUND');
      const items = await client.query(
        `SELECT id, variant_id, name_snapshot, sku_snapshot, qty_ordered, qty_received, unit_cost_satang, line_total_satang
         FROM purchase_order_items WHERE tenant_id=$1 AND purchase_order_id=$2`,
        [ctx.tenant!.id, id],
      );
      const receipts = await client.query(
        `SELECT id, number, received_at, note FROM goods_receipts
         WHERE tenant_id=$1 AND purchase_order_id=$2 ORDER BY received_at`,
        [ctx.tenant!.id, id],
      );
      return { po: row, items: items.rows, receipts: receipts.rows };
    });
    const po = data.po as any;
    ok(res, {
      id: po.id,
      number: po.number,
      status: po.status,
      orderDate: isoDate(po.order_date),
      expectedDate: isoDate(po.expected_date),
      notes: po.notes,
      subtotalSatang: Number(po.subtotal_satang),
      taxSatang: Number(po.tax_satang),
      totalSatang: Number(po.total_satang),
      supplierName: po.supplier_name,
      supplierPhone: po.supplier_phone,
      supplierEmail: po.supplier_email,
      createdAt: po.created_at,
      approvedAt: po.approved_at,
      items: data.items.map((i: any) => ({
        id: i.id,
        variantId: i.variant_id,
        name: i.name_snapshot,
        sku: i.sku_snapshot,
        qtyOrdered: i.qty_ordered,
        qtyReceived: i.qty_received,
        unitCostSatang: Number(i.unit_cost_satang),
        lineTotalSatang: Number(i.line_total_satang),
      })),
      receipts: data.receipts.map((r: any) => ({
        id: r.id,
        number: r.number,
        receivedAt: r.received_at,
        note: r.note,
      })),
    });
  });

  router.post('/purchase-orders', requirePermission('purchasing.manage'), async (req, res) => {
    const input = purchaseOrderSchema.parse(req.body);
    const ctx = req.ctx;
    const result = await ctx.withDb(async (client) => {
      const data = await runIdempotent(
        client,
        { tenantId: ctx.tenant!.id, operationId: input.operationId, scope: 'purchase.create', payload: input },
        async () => {
          const supplier = await client.query('SELECT id FROM suppliers WHERE tenant_id=$1 AND id=$2', [
            ctx.tenant!.id,
            input.supplierId,
          ]);
          if (!supplier.rowCount) throw new NexoraError('NOT_FOUND', { entity: 'supplier' });
          const ids = input.items.map((i) => i.variantId);
          const variants = await client.query<{
            id: string;
            name: string;
            sku: string | null;
            product_name: string;
          }>(
            `SELECT v.id, v.name, v.sku, p.name AS product_name
             FROM product_variants v JOIN products p ON p.id=v.product_id
             WHERE v.tenant_id=$1 AND v.id = ANY($2::uuid[])`,
            [ctx.tenant!.id, ids],
          );
          if (variants.rowCount !== new Set(ids).size) throw new NexoraError('NOT_FOUND', { entity: 'variant' });
          const variantMap = new Map(variants.rows.map((v) => [v.id, v]));
          const subtotal = input.items.reduce((sum, i) => sum + i.qty * i.unitCostSatang, 0);
          const number = await allocateDocumentNumber(client, {
            tenantId: ctx.tenant!.id,
            storeId: ctx.store!.id,
            docType: 'purchase',
            period: businessDateOf(new Date(), ctx.store!.timezone).slice(0, 7),
            prefix: 'PO',
          });
          const po = await client.query<{ id: string }>(
            `INSERT INTO purchase_orders
              (tenant_id, store_id, supplier_id, number, status, expected_date, notes,
               subtotal_satang, tax_satang, total_satang, created_by)
             VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,0,$7,$8) RETURNING id`,
            [
              ctx.tenant!.id,
              ctx.store!.id,
              input.supplierId,
              number,
              input.expectedDate ?? null,
              input.notes || '',
              subtotal,
              ctx.user.id,
            ],
          );
          const poId = po.rows[0]!.id;
          for (const item of input.items) {
            const variant = variantMap.get(item.variantId)!;
            await client.query(
              `INSERT INTO purchase_order_items
                (tenant_id, purchase_order_id, variant_id, name_snapshot, sku_snapshot,
                 qty_ordered, unit_cost_satang, line_total_satang)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [
                ctx.tenant!.id,
                poId,
                item.variantId,
                `${variant.product_name} · ${variant.name}`,
                variant.sku ?? '',
                item.qty,
                item.unitCostSatang,
                item.qty * item.unitCostSatang,
              ],
            );
          }
          await writeAudit(client, {
            tenantId: ctx.tenant!.id,
            storeId: ctx.store!.id,
            actorUserId: ctx.user.id,
            actorName: ctx.user.name,
            action: 'purchase_order.created',
            entityType: 'purchase_order',
            entityId: poId,
            after: { number, subtotalSatang: subtotal, items: input.items.length },
            correlationId: ctx.correlationId,
          });
          return { id: poId, number, status: 'draft', totalSatang: subtotal };
        },
      );
      return data.data;
    });
    created(res, result);
  });

  const transition = (
    from: string[],
    to: string,
    action: string,
    updateSql: string,
    paramsForUpdate: (ctxUser: string) => unknown[],
  ) =>
    async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const input = operationSchema.parse(req.body);
      const ctx = req.ctx;
      const result = await ctx.withDb(async (client) => {
        const data = await runIdempotent(
          client,
          { tenantId: ctx.tenant!.id, operationId: input.operationId, scope: `purchase.${action}`, payload: { id } },
          async () => {
            const po = await client.query<{ id: string; status: string; number: string; store_id: string }>(
              'SELECT id, status, number, store_id FROM purchase_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
              [ctx.tenant!.id, id],
            );
            const row = po.rows[0];
            if (!row) throw new NexoraError('NOT_FOUND');
            if (row.store_id !== ctx.store!.id) throw new NexoraError('AUTH_STORE_FORBIDDEN');
            if (!from.includes(row.status)) throw new NexoraError('DOMAIN_PURCHASE_STATE');
            await client.query(
              `UPDATE purchase_orders SET status=$1, updated_at=now()${updateSql} WHERE id=$2`,
              [to, id, ...paramsForUpdate(ctx.user.id)],
            );
            await writeAudit(client, {
              tenantId: ctx.tenant!.id,
              storeId: ctx.store!.id,
              actorUserId: ctx.user.id,
              actorName: ctx.user.name,
              action: `purchase_order.${action}`,
              entityType: 'purchase_order',
              entityId: id,
              before: { status: row.status },
              after: { status: to, number: row.number },
              correlationId: ctx.correlationId,
            });
            return { id, number: row.number, status: to };
          },
        );
        return data.data;
      });
      ok(res, result);
    };

  router.post(
    '/purchase-orders/:id/submit',
    requirePermission('purchasing.manage'),
    transition(['draft'], 'submitted', 'submitted', ', submitted_by = $3::uuid', (userId) => [userId]),
  );
  router.post(
    '/purchase-orders/:id/approve',
    requirePermission('purchasing.approve'),
    transition(
      ['submitted'],
      'approved',
      'approved',
      ', approved_by = $3::uuid, approved_at = now()',
      (userId) => [userId],
    ),
  );
  router.post(
    '/purchase-orders/:id/close',
    requirePermission('purchasing.approve'),
    transition(['received'], 'closed', 'closed', ', closed_at = now()', () => []),
  );

  router.post('/purchase-orders/:id/receive', requirePermission('purchasing.manage'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = receivePurchaseSchema.parse(req.body);
    const ctx = req.ctx;
    const result = await ctx.withDb(async (client) => {
      const data = await runIdempotent(
        client,
        { tenantId: ctx.tenant!.id, operationId: input.operationId, scope: 'purchase.receive', payload: { id, items: input.items } },
        async () => {
          const po = await client.query<{ id: string; status: string; number: string; store_id: string }>(
            'SELECT id, status, number, store_id FROM purchase_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
            [ctx.tenant!.id, id],
          );
          const row = po.rows[0];
          if (!row) throw new NexoraError('NOT_FOUND');
          if (row.store_id !== ctx.store!.id) throw new NexoraError('AUTH_STORE_FORBIDDEN');
          if (!['approved', 'partially_received'].includes(row.status)) {
            throw new NexoraError('DOMAIN_PURCHASE_STATE');
          }
          const receiptNumber = await allocateDocumentNumber(client, {
            tenantId: ctx.tenant!.id,
            storeId: ctx.store!.id,
            docType: 'goods_receipt',
            period: businessDateOf(new Date(), ctx.store!.timezone),
            prefix: 'GR',
          });
          const receipt = await client.query<{ id: string }>(
            `INSERT INTO goods_receipts
              (tenant_id, purchase_order_id, store_id, number, received_by, note)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [ctx.tenant!.id, id, ctx.store!.id, receiptNumber, ctx.user.id, input.note || ''],
          );
          const receiptId = receipt.rows[0]!.id;
          for (const item of input.items) {
            const line = await client.query<{
              id: string;
              qty_ordered: number;
              qty_received: number;
              variant_id: string;
              unit_cost_satang: number;
            }>(
              `SELECT id, qty_ordered, qty_received, variant_id, unit_cost_satang
               FROM purchase_order_items WHERE tenant_id=$1 AND id=$2 AND purchase_order_id=$3 FOR UPDATE`,
              [ctx.tenant!.id, item.poItemId, id],
            );
            const lineRow = line.rows[0];
            if (!lineRow) throw new NexoraError('NOT_FOUND');
            if (item.qty > lineRow.qty_ordered - lineRow.qty_received) {
              throw new NexoraError('DOMAIN_RECEIVE_EXCEEDS');
            }
            const unitCost = item.unitCostSatang ?? Number(lineRow.unit_cost_satang);
            await client.query(
              `INSERT INTO goods_receipt_items
                (tenant_id, goods_receipt_id, po_item_id, variant_id, qty, unit_cost_satang)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [ctx.tenant!.id, receiptId, item.poItemId, lineRow.variant_id, item.qty, unitCost],
            );
            await appendMovement(client, {
              tenantId: ctx.tenant!.id,
              storeId: ctx.store!.id,
              variantId: lineRow.variant_id,
              type: 'purchase_receipt',
              qtyDelta: item.qty,
              unitCostSatang: unitCost,
              referenceType: 'goods_receipt',
              referenceId: receiptId,
              createdBy: ctx.user.id,
            });
            await client.query(
              'UPDATE purchase_order_items SET qty_received = qty_received + $1 WHERE id=$2',
              [item.qty, item.poItemId],
            );
            await client.query('UPDATE product_variants SET cost_satang=$1, updated_at=now() WHERE id=$2', [
              unitCost,
              lineRow.variant_id,
            ]);
          }
          const remaining = await client.query<{ remaining: number }>(
            `SELECT COALESCE(sum(qty_ordered - qty_received),0)::bigint AS remaining
             FROM purchase_order_items WHERE purchase_order_id=$1`,
            [id],
          );
          const done = Number(remaining.rows[0]?.remaining ?? 0) === 0;
          await client.query('UPDATE purchase_orders SET status=$1, updated_at=now() WHERE id=$2', [
            done ? 'received' : 'partially_received',
            id,
          ]);
          await writeAudit(client, {
            tenantId: ctx.tenant!.id,
            storeId: ctx.store!.id,
            actorUserId: ctx.user.id,
            actorName: ctx.user.name,
            action: 'purchase_order.received',
            entityType: 'purchase_order',
            entityId: id,
            after: { receiptNumber, lines: input.items.length, done },
            correlationId: ctx.correlationId,
          });
          return { id, status: done ? 'received' : 'partially_received', receiptNumber, receiptId };
        },
      );
      return data.data;
    });
    created(res, result);
  });

  router.post('/purchase-orders/:id/payments', requirePermission('purchasing.manage'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = supplierPaymentSchema.parse(req.body);
    const ctx = req.ctx;
    const result = await ctx.withDb(async (client) => {
      const data = await runIdempotent(
        client,
        { tenantId: ctx.tenant!.id, operationId: input.operationId, scope: 'purchase.payment', payload: { id, ...input } },
        async () => {
          const po = await client.query<{ supplier_id: string }>(
            'SELECT supplier_id FROM purchase_orders WHERE tenant_id=$1 AND id=$2',
            [ctx.tenant!.id, id],
          );
          if (!po.rows[0]) throw new NexoraError('NOT_FOUND');
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO supplier_payments
              (tenant_id, supplier_id, purchase_order_id, amount_satang, method, reference, paid_at, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()),$8) RETURNING id`,
            [
              ctx.tenant!.id,
              po.rows[0].supplier_id,
              id,
              input.amountSatang,
              input.method,
              input.reference || '',
              input.paidAt ?? null,
              ctx.user.id,
            ],
          );
          await writeAudit(client, {
            tenantId: ctx.tenant!.id,
            storeId: ctx.store!.id,
            actorUserId: ctx.user.id,
            actorName: ctx.user.name,
            action: 'supplier.payment_recorded',
            entityType: 'purchase_order',
            entityId: id,
            after: { amountSatang: input.amountSatang, method: input.method },
            correlationId: ctx.correlationId,
          });
          return { id: inserted.rows[0]!.id, amountSatang: input.amountSatang };
        },
      );
      return data.data;
    });
    created(res, result);
  });

  return router;
}
