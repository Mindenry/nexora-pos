import { Router } from 'express';
import { z } from 'zod';
import {
  NexoraError,
  listQuerySchema,
  promotionInputSchema,
  uuidSchema,
} from '@nexora/shared';
import { requirePermission } from '../http/auth';
import { created, ok } from '../http/respond';
import { writeAudit } from '../services/audit';

function mapPromotion(row: any) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    kind: row.kind,
    valueBp: row.value_bp,
    valueSatang: row.value_satang != null ? Number(row.value_satang) : null,
    targetIds: row.target_ids,
    minSubtotalSatang: Number(row.min_subtotal_satang),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    usageLimit: row.usage_limit,
    usedCount: row.used_count,
    stackable: row.stackable,
    priority: row.priority,
    isActive: row.is_active,
    couponEnabled: row.coupon_enabled,
    createdAt: row.created_at,
  };
}

export function promotionRoutes(): Router {
  const router = Router();

  router.get('/promotions', requirePermission('promotions.manage'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const rows = await ctx.withDb((client) =>
      client.query(
        `SELECT * FROM promotions WHERE tenant_id=$1
         ORDER BY is_active DESC, priority DESC, created_at DESC LIMIT $2 OFFSET $3`,
        [ctx.tenant!.id, query.pageSize, (query.page - 1) * query.pageSize],
      ),
    );
    const total = await ctx.withDb((client) =>
      client.query<{ count: number }>('SELECT count(*)::bigint AS count FROM promotions WHERE tenant_id=$1', [
        ctx.tenant!.id,
      ]),
    );
    ok(
      res,
      rows.rows.map(mapPromotion),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(total.rows[0]?.count ?? 0),
        totalPages: Math.max(1, Math.ceil(Number(total.rows[0]?.count ?? 0) / query.pageSize)),
      },
    );
  });

  router.post('/promotions', requirePermission('promotions.manage'), async (req, res) => {
    const input = promotionInputSchema.parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const inserted = await client.query(
        `INSERT INTO promotions
          (tenant_id, name, code, kind, value_bp, value_satang, target_ids, min_subtotal_satang,
           starts_at, ends_at, usage_limit, stackable, priority, is_active, coupon_enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          ctx.tenant!.id,
          input.name,
          input.code || null,
          input.kind,
          input.valueBp ?? null,
          input.valueSatang ?? null,
          input.targetIds,
          input.minSubtotalSatang,
          input.startsAt || null,
          input.endsAt || null,
          input.usageLimit ?? null,
          input.stackable,
          input.priority,
          input.isActive,
          input.couponEnabled,
        ],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'promotion.created',
        entityType: 'promotion',
        entityId: inserted.rows[0]!.id,
        after: { name: input.name, kind: input.kind, code: input.code },
        correlationId: ctx.correlationId,
      });
      return inserted.rows[0];
    });
    created(res, mapPromotion(row));
  });

  router.put('/promotions/:id', requirePermission('promotions.manage'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = promotionInputSchema.parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const before = await client.query('SELECT * FROM promotions WHERE tenant_id=$1 AND id=$2', [
        ctx.tenant!.id,
        id,
      ]);
      if (!before.rows[0]) throw new NexoraError('NOT_FOUND');
      const updated = await client.query(
        `UPDATE promotions SET name=$1, code=$2, kind=$3, value_bp=$4, value_satang=$5,
           target_ids=$6::uuid[], min_subtotal_satang=$7, starts_at=$8, ends_at=$9,
           usage_limit=$10, stackable=$11, priority=$12, is_active=$13, coupon_enabled=$14,
           updated_at=now()
         WHERE tenant_id=$15 AND id=$16 RETURNING *`,
        [
          input.name,
          input.code || null,
          input.kind,
          input.valueBp ?? null,
          input.valueSatang ?? null,
          input.targetIds,
          input.minSubtotalSatang,
          input.startsAt || null,
          input.endsAt || null,
          input.usageLimit ?? null,
          input.stackable,
          input.priority,
          input.isActive,
          input.couponEnabled,
          ctx.tenant!.id,
          id,
        ],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'promotion.updated',
        entityType: 'promotion',
        entityId: id,
        before: mapPromotion(before.rows[0]),
        after: { name: input.name, isActive: input.isActive },
        correlationId: ctx.correlationId,
      });
      return updated.rows[0];
    });
    ok(res, mapPromotion(row));
  });

  router.post('/promotions/:id/toggle', requirePermission('promotions.manage'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = z.object({ isActive: z.boolean() }).parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const updated = await client.query(
        `UPDATE promotions SET is_active=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3 RETURNING *`,
        [input.isActive, ctx.tenant!.id, id],
      );
      if (!updated.rowCount) throw new NexoraError('NOT_FOUND');
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'promotion.toggled',
        entityType: 'promotion',
        entityId: id,
        after: { isActive: input.isActive },
        correlationId: ctx.correlationId,
      });
      return updated.rows[0];
    });
    ok(res, mapPromotion(row));
  });

  return router;
}
