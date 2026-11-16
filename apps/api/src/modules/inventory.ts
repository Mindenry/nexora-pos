import { Router } from 'express';
import { z } from 'zod';
import {
  NexoraError,
  businessDateOf,
  listQuerySchema,
  stockAdjustSchema,
  stockCountSchema,
  transferSchema,
  receiveTransferSchema,
  uuidSchema,
} from '@nexora/shared';
import { requirePermission, assertStoreAccess } from '../http/auth';
import { created, ok } from '../http/respond';
import { writeAudit } from '../services/audit';
import { appendMovement, onHandMap } from '../services/inventory';
import { allocateDocumentNumber } from '../services/numbering';
import { runIdempotent } from '../services/idempotency';

const operationSchema = z.object({ operationId: uuidSchema });

export function inventoryRoutes(): Router {
  const router = Router();

  router.get('/inventory/overview', requirePermission('inventory.read'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const storeId = ctx.store?.id ?? null;
    if (!storeId) throw new NexoraError('AUTH_STORE_FORBIDDEN');
    const search = query.search?.trim() || null;
    const lowOnly = req.query.lowStock === 'true';
    const offset = (query.page - 1) * query.pageSize;

    const result = await ctx.withDb(async (client) => {
      const rows = await client.query(
        `WITH base AS (
           SELECT v.id AS variant_id, v.name AS variant_name, v.sku, v.barcode,
                  p.id AS product_id, p.name AS product_name, p.reorder_point, p.track_inventory,
                  c.name AS category_name, v.cost_satang, v.price_satang,
                  COALESCE(s.on_hand, 0)::bigint AS on_hand
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN v_stock_on_hand s
             ON s.tenant_id = v.tenant_id AND s.store_id = $2 AND s.variant_id = v.id
           WHERE v.tenant_id = $1 AND v.status = 'active' AND p.status = 'active'
             AND ($3::text IS NULL OR p.name ILIKE '%' || $3 || '%' OR v.sku ILIKE '%' || $3 || '%' OR v.barcode = $3)
         )
         SELECT *, count(*) OVER() AS total_count
         FROM base
         WHERE ($4::boolean IS NOT TRUE OR (track_inventory AND on_hand <= reorder_point))
         ORDER BY on_hand ASC, product_name
         LIMIT $5 OFFSET $6`,
        [ctx.tenant!.id, storeId, search, lowOnly, query.pageSize, offset],
      );
      const totals = await client.query<{
        total_value: number;
        total_units: number;
        low_count: number;
      }>(
        `SELECT COALESCE(sum(CASE WHEN p.track_inventory THEN COALESCE(s.on_hand,0) * v.cost_satang ELSE 0 END),0)::bigint AS total_value,
                COALESCE(sum(CASE WHEN p.track_inventory THEN COALESCE(s.on_hand,0) ELSE 0 END),0)::bigint AS total_units,
                COUNT(*) FILTER (WHERE p.track_inventory AND COALESCE(s.on_hand,0) <= p.reorder_point)::bigint AS low_count
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         LEFT JOIN v_stock_on_hand s ON s.tenant_id=v.tenant_id AND s.store_id=$2 AND s.variant_id=v.id
         WHERE v.tenant_id=$1 AND v.status='active' AND p.status='active'`,
        [ctx.tenant!.id, storeId],
      );
      return { rows: rows.rows, totals: totals.rows[0]!, total: Number(rows.rows[0]?.total_count ?? 0) };
    });

    ok(
      res,
      result.rows.map((r: any) => ({
        variantId: r.variant_id,
        variantName: r.variant_name,
        sku: r.sku,
        barcode: r.barcode,
        productId: r.product_id,
        productName: r.product_name,
        categoryName: r.category_name,
        trackInventory: r.track_inventory,
        reorderPoint: r.reorder_point,
        costSatang: Number(r.cost_satang),
        priceSatang: Number(r.price_satang),
        onHand: Number(r.on_hand),
        stockValueSatang: Number(r.on_hand) * Number(r.cost_satang),
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
        summary: {
          totalValueSatang: Number(result.totals.total_value),
          totalUnits: Number(result.totals.total_units),
          lowStockCount: Number(result.totals.low_count),
        },
      },
    );
  });

  router.get('/inventory/movements', requirePermission('inventory.read'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const storeId = ctx.store?.id ?? null;
    if (!storeId) throw new NexoraError('AUTH_STORE_FORBIDDEN');
    const variantId = typeof req.query.variantId === 'string' ? req.query.variantId : null;
    const type = typeof req.query.type === 'string' ? req.query.type : null;
    const offset = (query.page - 1) * query.pageSize;

    const result = await ctx.withDb(async (client) => {
      const rows = await client.query(
        `SELECT m.id, m.type, m.qty_delta, m.unit_cost_satang, m.reason, m.reference_type,
                m.reference_id, m.created_at,
                p.name AS product_name, v.name AS variant_name, v.sku,
                u.name AS actor_name
         FROM inventory_movements m
         JOIN product_variants v ON v.id = m.variant_id
         JOIN products p ON p.id = v.product_id
         LEFT JOIN users u ON u.id = m.created_by
         WHERE m.tenant_id = $1 AND m.store_id = $2
           AND ($3::uuid IS NULL OR m.variant_id = $3)
           AND ($4::text IS NULL OR m.type = $4)
         ORDER BY m.created_at DESC
         LIMIT $5 OFFSET $6`,
        [ctx.tenant!.id, storeId, variantId, type, query.pageSize, offset],
      );
      const total = await client.query<{ count: number }>(
        `SELECT count(*)::bigint AS count FROM inventory_movements m
         WHERE m.tenant_id=$1 AND m.store_id=$2 AND ($3::uuid IS NULL OR m.variant_id=$3)
           AND ($4::text IS NULL OR m.type=$4)`,
        [ctx.tenant!.id, storeId, variantId, type],
      );
      return { rows: rows.rows, total: Number(total.rows[0]?.count ?? 0) };
    });

    ok(
      res,
      result.rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        qtyDelta: Number(r.qty_delta),
        unitCostSatang: Number(r.unit_cost_satang),
        reason: r.reason,
        referenceType: r.reference_type,
        referenceId: r.reference_id,
        createdAt: r.created_at,
        productName: r.product_name,
        variantName: r.variant_name,
        sku: r.sku,
        actorName: r.actor_name,
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
      },
    );
  });

  router.post('/inventory/adjust', requirePermission('inventory.adjust'), async (req, res) => {
    const input = stockAdjustSchema.parse(req.body);
    const ctx = req.ctx;
    const storeId = ctx.store!.id;
    const result = await ctx.withDb(async (client) => {
      const variant = await client.query<{ id: string; cost_satang: number; name: string }>(
        'SELECT id, cost_satang, name FROM product_variants WHERE tenant_id=$1 AND id=$2',
        [ctx.tenant!.id, input.variantId],
      );
      if (!variant.rows[0]) throw new NexoraError('NOT_FOUND');
      const data = await runIdempotent(
        client,
        { tenantId: ctx.tenant!.id, operationId: input.operationId, scope: 'inventory.adjust', payload: input },
        async () => {
          const qtyDelta = input.direction === 'increase' ? input.qty : -input.qty;
          await appendMovement(client, {
            tenantId: ctx.tenant!.id,
            storeId,
            variantId: input.variantId,
            type: input.direction === 'increase' ? 'adjustment_increase' : 'adjustment_decrease',
            qtyDelta,
            unitCostSatang: Number(variant.rows[0]!.cost_satang),
            reason: input.reason,
            createdBy: ctx.user.id,
          });
          const onHand = await client.query<{ on_hand: number }>(
            `SELECT COALESCE(sum(qty_delta),0)::bigint AS on_hand FROM inventory_movements
             WHERE tenant_id=$1 AND store_id=$2 AND variant_id=$3`,
            [ctx.tenant!.id, storeId, input.variantId],
          );
          await writeAudit(client, {
            tenantId: ctx.tenant!.id,
            storeId,
            actorUserId: ctx.user.id,
            actorName: ctx.user.name,
            action: 'inventory.adjusted',
            entityType: 'product_variant',
            entityId: input.variantId,
            after: { qtyDelta, reason: input.reason },
            correlationId: ctx.correlationId,
          });
          return { variantId: input.variantId, qtyDelta, onHand: Number(onHand.rows[0]?.on_hand ?? 0) };
        },
      );
      return data.data;
    });
    ok(res, result);
  });

  router.get('/transfers', requirePermission('inventory.read'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const storeId = ctx.store?.id ?? null;
    const offset = (query.page - 1) * query.pageSize;
    const result = await ctx.withDb(async (client) => {
      const rows = await client.query(
        `SELECT t.id, t.number, t.status, t.note, t.created_at, t.dispatched_at, t.received_at,
                sf.name AS from_store, st.name AS to_store,
                (SELECT COALESCE(sum(i.qty),0)::bigint FROM stock_transfer_items i WHERE i.transfer_id=t.id) AS total_qty
         FROM stock_transfers t
         JOIN stores sf ON sf.id=t.from_store_id
         JOIN stores st ON st.id=t.to_store_id
         WHERE t.tenant_id=$1 AND ($2::uuid IS NULL OR t.from_store_id=$2 OR t.to_store_id=$2)
         ORDER BY t.created_at DESC LIMIT $3 OFFSET $4`,
        [ctx.tenant!.id, storeId, query.pageSize, offset],
      );
      const total = await client.query<{ count: number }>(
        `SELECT count(*)::bigint AS count FROM stock_transfers
         WHERE tenant_id=$1 AND ($2::uuid IS NULL OR from_store_id=$2 OR to_store_id=$2)`,
        [ctx.tenant!.id, storeId],
      );
      return { rows: rows.rows, total: Number(total.rows[0]?.count ?? 0) };
    });
    ok(
      res,
      result.rows.map((r: any) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        note: r.note,
        fromStore: r.from_store,
        toStore: r.to_store,
        totalQty: Number(r.total_qty),
        createdAt: r.created_at,
        dispatchedAt: r.dispatched_at,
        receivedAt: r.received_at,
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
      },
    );
  });

  router.get('/transfers/:id', requirePermission('inventory.read'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    const data = await ctx.withDb(async (client) => {
      const transfer = await client.query(
        `SELECT t.*, sf.name AS from_store, st.name AS to_store
         FROM stock_transfers t JOIN stores sf ON sf.id=t.from_store_id JOIN stores st ON st.id=t.to_store_id
         WHERE t.tenant_id=$1 AND t.id=$2`,
        [ctx.tenant!.id, id],
      );
      if (!transfer.rows[0]) throw new NexoraError('NOT_FOUND');
      const items = await client.query(
        `SELECT i.id, i.variant_id, i.qty, i.received_qty, p.name AS product_name, v.name AS variant_name, v.sku
         FROM stock_transfer_items i
         JOIN product_variants v ON v.id=i.variant_id
         JOIN products p ON p.id=v.product_id
         WHERE i.tenant_id=$1 AND i.transfer_id=$2 ORDER BY p.name`,
        [ctx.tenant!.id, id],
      );
      return { transfer: transfer.rows[0], items: items.rows };
    });
    const t = data.transfer as any;
    ok(res, {
      id: t.id,
      number: t.number,
      status: t.status,
      note: t.note,
      fromStoreId: t.from_store_id,
      toStoreId: t.to_store_id,
      fromStore: t.from_store,
      toStore: t.to_store,
      createdAt: t.created_at,
      dispatchedAt: t.dispatched_at,
      receivedAt: t.received_at,
      items: data.items.map((i: any) => ({
        id: i.id,
        variantId: i.variant_id,
        qty: i.qty,
        receivedQty: i.received_qty,
        productName: i.product_name,
        variantName: i.variant_name,
        sku: i.sku,
      })),
    });
  });

  router.post('/transfers', requirePermission('inventory.transfer'), async (req, res) => {
    const input = transferSchema.parse(req.body);
    const ctx = req.ctx;
    const fromStore = ctx.store!;
    const toStore = assertStoreAccess(ctx, input.toStoreId);
    if (fromStore.id === toStore.id) throw new NexoraError('VALIDATION_FAILED', { field: 'toStoreId' });

    const transfer = await ctx.withDb(async (client) => {
      const data = await runIdempotent(
        client,
        { tenantId: ctx.tenant!.id, operationId: input.operationId, scope: 'inventory.transfer.create', payload: input },
        async () => {
          const variants = await client.query<{ id: string }>(
            'SELECT id FROM product_variants WHERE tenant_id=$1 AND id = ANY($2::uuid[])',
            [ctx.tenant!.id, input.items.map((i) => i.variantId)],
          );
          if (variants.rowCount !== new Set(input.items.map((i) => i.variantId)).size) {
            throw new NexoraError('NOT_FOUND', { entity: 'variant' });
          }
          const number = await allocateDocumentNumber(client, {
            tenantId: ctx.tenant!.id,
            storeId: fromStore.id,
            docType: 'transfer',
            period: businessDateOf(new Date(), fromStore.timezone),
            prefix: 'TR',
          });
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO stock_transfers
              (tenant_id, from_store_id, to_store_id, number, status, note, created_by)
             VALUES ($1,$2,$3,$4,'draft',$5,$6) RETURNING id`,
            [ctx.tenant!.id, fromStore.id, toStore.id, number, input.note || '', ctx.user.id],
          );
          const transferId = inserted.rows[0]!.id;
          for (const item of input.items) {
            await client.query(
              `INSERT INTO stock_transfer_items (tenant_id, transfer_id, variant_id, qty)
               VALUES ($1,$2,$3,$4)`,
              [ctx.tenant!.id, transferId, item.variantId, item.qty],
            );
          }
          await writeAudit(client, {
            tenantId: ctx.tenant!.id,
            storeId: fromStore.id,
            actorUserId: ctx.user.id,
            actorName: ctx.user.name,
            action: 'transfer.created',
            entityType: 'stock_transfer',
            entityId: transferId,
            after: { number, from: fromStore.id, to: toStore.id, items: input.items.length },
            correlationId: ctx.correlationId,
          });
          return { id: transferId, number, status: 'draft' };
        },
      );
      return data.data;
    });
    created(res, transfer);
  });

  router.post('/transfers/:id/dispatch', requirePermission('inventory.transfer'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = operationSchema.parse(req.body);
    const ctx = req.ctx;
    const storeId = ctx.store!.id;
    const result = await ctx.withDb(async (client) => {
      const data = await runIdempotent(
        client,
        { tenantId: ctx.tenant!.id, operationId: input.operationId, scope: 'inventory.transfer.dispatch', payload: { id } },
        async () => {
          const transfer = await client.query<{
            id: string;
            status: string;
            from_store_id: string;
            number: string;
          }>(
            'SELECT id, status, from_store_id, number FROM stock_transfers WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
            [ctx.tenant!.id, id],
          );
          const row = transfer.rows[0];
          if (!row) throw new NexoraError('NOT_FOUND');
          if (row.status !== 'draft') throw new NexoraError('DOMAIN_TRANSFER_STATE');
          if (row.from_store_id !== storeId) throw new NexoraError('AUTH_STORE_FORBIDDEN');

          const items = await client.query<{ variant_id: string; qty: number; cost_satang: number }>(
            `SELECT i.variant_id, i.qty, v.cost_satang
             FROM stock_transfer_items i JOIN product_variants v ON v.id=i.variant_id
             WHERE i.transfer_id=$1`,
            [id],
          );
          const stock = await onHandMap(client, ctx.tenant!.id, storeId, items.rows.map((i) => i.variant_id));
          for (const item of items.rows) {
            if ((stock.get(item.variant_id) ?? 0) < item.qty) {
              throw new NexoraError('DOMAIN_INSUFFICIENT_STOCK', { variantId: item.variant_id });
            }
          }
          for (const item of items.rows) {
            await appendMovement(client, {
              tenantId: ctx.tenant!.id,
              storeId,
              variantId: item.variant_id,
              type: 'transfer_out',
              qtyDelta: -item.qty,
              unitCostSatang: Number(item.cost_satang),
              referenceType: 'stock_transfer',
              referenceId: id,
              createdBy: ctx.user.id,
            });
          }
          await client.query(
            `UPDATE stock_transfers SET status='dispatched', dispatched_by=$1, dispatched_at=now()
             WHERE id=$2`,
            [ctx.user.id, id],
          );
          await writeAudit(client, {
            tenantId: ctx.tenant!.id,
            storeId,
            actorUserId: ctx.user.id,
            actorName: ctx.user.name,
            action: 'transfer.dispatched',
            entityType: 'stock_transfer',
            entityId: id,
            after: { number: row.number },
            correlationId: ctx.correlationId,
          });
          return { id, status: 'dispatched' };
        },
      );
      return data.data;
    });
    ok(res, result);
  });

  router.post('/transfers/:id/receive', requirePermission('inventory.transfer'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = receiveTransferSchema.parse(req.body);
    const ctx = req.ctx;
    const storeId = ctx.store!.id;
    const result = await ctx.withDb(async (client) => {
      const data = await runIdempotent(
        client,
        { tenantId: ctx.tenant!.id, operationId: input.operationId, scope: 'inventory.transfer.receive', payload: { id, items: input.items } },
        async () => {
          const transfer = await client.query<{ id: string; status: string; to_store_id: string; number: string }>(
            'SELECT id, status, to_store_id, number FROM stock_transfers WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
            [ctx.tenant!.id, id],
          );
          const row = transfer.rows[0];
          if (!row) throw new NexoraError('NOT_FOUND');
          if (row.status !== 'dispatched') throw new NexoraError('DOMAIN_TRANSFER_STATE');
          if (row.to_store_id !== storeId) throw new NexoraError('AUTH_STORE_FORBIDDEN');

          for (const item of input.items) {
            const line = await client.query<{
              id: string;
              qty: number;
              received_qty: number;
              variant_id: string;
              cost_satang: number;
            }>(
              `SELECT i.id, i.qty, i.received_qty, i.variant_id, v.cost_satang
               FROM stock_transfer_items i JOIN product_variants v ON v.id=i.variant_id
               WHERE i.transfer_id=$1 AND i.id=$2 FOR UPDATE`,
              [id, item.transferItemId],
            );
            const lineRow = line.rows[0];
            if (!lineRow) throw new NexoraError('NOT_FOUND');
            if (item.qty > lineRow.qty - lineRow.received_qty) {
              throw new NexoraError('DOMAIN_REFUND_EXCEEDS', { reason: 'receive_qty' });
            }
            await appendMovement(client, {
              tenantId: ctx.tenant!.id,
              storeId,
              variantId: lineRow.variant_id,
              type: 'transfer_in',
              qtyDelta: item.qty,
              unitCostSatang: Number(lineRow.cost_satang),
              referenceType: 'stock_transfer',
              referenceId: id,
              createdBy: ctx.user.id,
            });
            await client.query(
              'UPDATE stock_transfer_items SET received_qty = received_qty + $1 WHERE id=$2',
              [item.qty, item.transferItemId],
            );
          }

          const remaining = await client.query<{ remaining: number }>(
            `SELECT COALESCE(sum(qty - received_qty),0)::bigint AS remaining
             FROM stock_transfer_items WHERE transfer_id=$1`,
            [id],
          );
          const done = Number(remaining.rows[0]?.remaining ?? 0) === 0;
          await client.query(
            `UPDATE stock_transfers SET status=$1, received_by=$2, received_at=now() WHERE id=$3`,
            [done ? 'received' : 'dispatched', ctx.user.id, id],
          );
          await writeAudit(client, {
            tenantId: ctx.tenant!.id,
            storeId,
            actorUserId: ctx.user.id,
            actorName: ctx.user.name,
            action: 'transfer.received',
            entityType: 'stock_transfer',
            entityId: id,
            after: { number: row.number, done },
            correlationId: ctx.correlationId,
          });
          return { id, status: done ? 'received' : 'dispatched' };
        },
      );
      return data.data;
    });
    ok(res, result);
  });

  router.post('/inventory/counts', requirePermission('inventory.count'), async (req, res) => {
    const input = stockCountSchema.parse(req.body);
    const ctx = req.ctx;
    const storeId = ctx.store!.id;
    const result = await ctx.withDb(async (client) => {
      const data = await runIdempotent(
        client,
        { tenantId: ctx.tenant!.id, operationId: input.operationId, scope: 'inventory.count', payload: input },
        async () => {
          const ids = input.items.map((i) => i.variantId);
          const variants = await client.query<{ id: string; cost_satang: number; name: string; sku: string | null }>(
            'SELECT id, cost_satang, name, sku FROM product_variants WHERE tenant_id=$1 AND id = ANY($2::uuid[])',
            [ctx.tenant!.id, ids],
          );
          if (variants.rowCount !== new Set(ids).size) throw new NexoraError('NOT_FOUND');
          const costs = new Map(variants.rows.map((v) => [v.id, Number(v.cost_satang)]));
          const current = await onHandMap(client, ctx.tenant!.id, storeId, ids);
          const variances: Array<{ variantId: string; systemQty: number; countedQty: number; difference: number }> = [];
          for (const item of input.items) {
            const systemQty = current.get(item.variantId) ?? 0;
            const difference = item.countedQty - systemQty;
            if (difference !== 0) {
              await appendMovement(client, {
                tenantId: ctx.tenant!.id,
                storeId,
                variantId: item.variantId,
                type: 'stock_count',
                qtyDelta: difference,
                unitCostSatang: costs.get(item.variantId) ?? 0,
                reason: input.note || 'Stock count correction',
                createdBy: ctx.user.id,
              });
            }
            variances.push({
              variantId: item.variantId,
              systemQty,
              countedQty: item.countedQty,
              difference,
            });
          }
          await writeAudit(client, {
            tenantId: ctx.tenant!.id,
            storeId,
            actorUserId: ctx.user.id,
            actorName: ctx.user.name,
            action: 'inventory.counted',
            entityType: 'stock_count',
            after: { items: input.items.length, adjusted: variances.filter((v) => v.difference !== 0).length },
            correlationId: ctx.correlationId,
          });
          return { variances };
        },
      );
      return data.data;
    });
    ok(res, result);
  });

  return router;
}
