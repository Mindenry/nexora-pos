import { Router } from 'express';
import { z } from 'zod';
import {
  NexoraError,
  checkoutSchema,
  quoteSchema,
  uuidSchema,
} from '@nexora/shared';
import { requirePermission } from '../http/auth';
import { created, ok } from '../http/respond';
import { posCatalog } from '../services/catalog';
import { performCheckout, quoteForPos } from '../services/checkout';
import { onHandMap } from '../services/inventory';
import { loadActivePromotions } from '../services/promotions';
import { shiftSummary } from '../services/shifts';
import { getOpenShift } from '../services/shifts';

export function posRoutes(): Router {
  const router = Router();

  router.get('/pos/bootstrap', requirePermission('sales.create'), async (req, res) => {
    const ctx = req.ctx;
    const data = await ctx.withDb(async (client) => {
      const catalog = await posCatalog(client, ctx.tenant!.id, ctx.store!.id);
      const methods = await client.query(
        `SELECT code, name, type, requires_reference, opens_drawer, sort_order
         FROM payment_methods WHERE tenant_id=$1 AND store_id=$2 AND is_active
         ORDER BY sort_order, name`,
        [ctx.tenant!.id, ctx.store!.id],
      );
      const shift = await getOpenShift(client, ctx.tenant!.id, ctx.store!.id, ctx.employee!.id);
      const summary = shift ? await shiftSummary(client, ctx.tenant!.id, shift.id) : null;
      const promotions = await loadActivePromotions(client, ctx.tenant!.id);
      const held = await client.query(
        `SELECT id, label, cart, created_at FROM held_sales
         WHERE tenant_id=$1 AND store_id=$2 AND employee_id=$3 ORDER BY created_at DESC LIMIT 20`,
        [ctx.tenant!.id, ctx.store!.id, ctx.employee!.id],
      );
      return {
        catalog,
        paymentMethods: methods.rows.map((m: any) => ({
          code: m.code,
          name: m.name,
          type: m.type,
          requiresReference: m.requires_reference,
          opensDrawer: m.opens_drawer,
        })),
        shift: summary,
        promotions,
        heldSales: held.rows.map((h: any) => ({
          id: h.id,
          label: h.label,
          cart: h.cart,
          createdAt: h.created_at,
        })),
      };
    });

    ok(res, {
      serverTime: new Date().toISOString(),
      business: ctx.business,
      store: ctx.store,
      employee: ctx.employee,
      tenant: ctx.tenant,
      permissions: [...ctx.permissions],
      offline: {
        cashEnabled: Boolean(ctx.business?.offlineCashEnabled && ctx.tenant?.features.offline),
        catalogVersion: `${ctx.store?.id}:${data.catalog.products.length}`,
      },
      ...data,
    });
  });

  router.get('/pos/lookup', requirePermission('sales.create'), async (req, res) => {
    const ctx = req.ctx;
    const code = z.string().trim().min(1).max(120).parse(req.query.code);
    const rows = await ctx.withDb(async (client) => {
      const result = await client.query(
        `SELECT v.id AS variant_id, v.name AS variant_name, v.sku, v.barcode,
                v.price_satang, v.cost_satang, v.attributes,
                p.id AS product_id, p.name AS product_name, p.category_id, p.image_url,
                p.track_inventory, p.reorder_point,
                COALESCE(s.on_hand,0)::bigint AS on_hand
         FROM product_variants v
         JOIN products p ON p.id=v.product_id
         LEFT JOIN v_stock_on_hand s ON s.tenant_id=v.tenant_id AND s.store_id=$2 AND s.variant_id=v.id
         WHERE v.tenant_id=$1 AND v.status='active' AND p.status='active'
           AND (
             v.barcode = $3 OR v.sku = $3
             OR EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.variant_id=v.id AND pb.barcode=$3)
             OR p.name ILIKE '%' || $3 || '%'
           )
         ORDER BY CASE WHEN v.barcode = $3 OR v.sku = $3 THEN 0 ELSE 1 END, p.name
         LIMIT 20`,
        [ctx.tenant!.id, ctx.store!.id, code],
      );
      return result.rows;
    });
    ok(
      res,
      rows.map((r: any) => ({
        variantId: r.variant_id,
        variantName: r.variant_name,
        sku: r.sku,
        barcode: r.barcode,
        priceSatang: Number(r.price_satang),
        costSatang: Number(r.cost_satang),
        attributes: r.attributes,
        productId: r.product_id,
        productName: r.product_name,
        categoryId: r.category_id,
        imageUrl: r.image_url,
        trackInventory: r.track_inventory,
        reorderPoint: r.reorder_point,
        onHand: Number(r.on_hand),
      })),
    );
  });

  router.post('/pos/quote', requirePermission('sales.create'), async (req, res) => {
    const input = quoteSchema.parse(req.body);
    const ctx = req.ctx;
    const quote = await ctx.withDb((client) => quoteForPos(client, ctx, input));
    ok(res, quote);
  });

  router.post('/pos/checkout', requirePermission('sales.create'), async (req, res) => {
    const input = checkoutSchema.parse(req.body);
    const ctx = req.ctx;
    const result = await ctx.withDb((client) => performCheckout(client, ctx, input));
    created(res, result);
  });

  router.post('/pos/held', requirePermission('sales.create'), async (req, res) => {
    const input = z
      .object({
        label: z.string().trim().max(80).optional().default(''),
        cart: z.unknown(),
      })
      .parse(req.body);
    const serialized = JSON.stringify(input.cart ?? null);
    if (serialized.length > 200_000) throw new NexoraError('VALIDATION_FAILED', { field: 'cart' });
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const inserted = await client.query(
        `INSERT INTO held_sales (tenant_id, store_id, employee_id, label, cart, expires_at)
         VALUES ($1,$2,$3,$4,$5::jsonb, now() + interval '12 hours')
         RETURNING id, label, created_at`,
        [ctx.tenant!.id, ctx.store!.id, ctx.employee!.id, input.label, serialized],
      );
      return inserted.rows[0];
    });
    created(res, row);
  });

  router.delete('/pos/held/:id', requirePermission('sales.create'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    await ctx.withDb(async (client) => {
      const deleted = await client.query(
        `DELETE FROM held_sales WHERE tenant_id=$1 AND store_id=$2 AND employee_id=$3 AND id=$4`,
        [ctx.tenant!.id, ctx.store!.id, ctx.employee!.id, id],
      );
      if (!deleted.rowCount) throw new NexoraError('NOT_FOUND');
    });
    res.status(204).end();
  });

  router.post('/pos/stock-check', requirePermission('sales.create'), async (req, res) => {
    const input = z
      .object({ variantIds: z.array(uuidSchema).min(1).max(200) })
      .parse(req.body);
    const ctx = req.ctx;
    const stock = await ctx.withDb((client) =>
      onHandMap(client, ctx.tenant!.id, ctx.store!.id, input.variantIds),
    );
    ok(res, Object.fromEntries(stock));
  });

  return router;
}
