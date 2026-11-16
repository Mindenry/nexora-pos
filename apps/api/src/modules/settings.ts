import { Router } from 'express';
import { z } from 'zod';
import {
  NexoraError,
  businessSettingsSchema,
  listQuerySchema,
  paymentMethodInputSchema,
} from '@nexora/shared';
import { requirePermission } from '../http/auth';
import { ok } from '../http/respond';
import { writeAudit } from '../services/audit';

export function settingsRoutes(): Router {
  const router = Router();

  router.get('/settings/business', requirePermission('settings.manage'), async (req, res) => {
    const ctx = req.ctx;
    ok(res, { business: ctx.business, store: ctx.store, tenant: ctx.tenant });
  });

  router.put('/settings/business', requirePermission('settings.manage'), async (req, res) => {
    const input = businessSettingsSchema.parse(req.body);
    const ctx = req.ctx;
    const business = ctx.business!;
    const updated = await ctx.withDb(async (client) => {
      const result = await client.query(
        `UPDATE businesses SET
           name=COALESCE($1,name), legal_name=COALESCE($2,legal_name), tax_id=COALESCE($3,tax_id),
           address=COALESCE($4,address), phone=COALESCE($5,phone), email=COALESCE($6,email),
           currency=COALESCE($7,currency), timezone=COALESCE($8,timezone),
           vat_rate_bp=COALESCE($9,vat_rate_bp), prices_include_tax=COALESCE($10,prices_include_tax),
           receipt_footer=COALESCE($11,receipt_footer), receipt_prefix=COALESCE($12,receipt_prefix),
           loyalty_earn_per_baht=COALESCE($13,loyalty_earn_per_baht),
           offline_cash_enabled=COALESCE($14,offline_cash_enabled),
           discount_limit_bp=COALESCE($15,discount_limit_bp), updated_at=now()
         WHERE tenant_id=$16 AND id=$17
         RETURNING *`,
        [
          input.name ?? null,
          input.legalName ?? null,
          input.taxId ?? null,
          input.address ?? null,
          input.phone ?? null,
          input.email ?? null,
          input.currency ?? null,
          input.timezone ?? null,
          input.vatRateBp ?? null,
          input.pricesIncludeTax ?? null,
          input.receiptFooter ?? null,
          input.receiptPrefix ?? null,
          input.loyaltyEarnPerBaht ?? null,
          input.offlineCashEnabled ?? null,
          input.discountLimitBp ?? null,
          ctx.tenant!.id,
          business.id,
        ],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'settings.business_updated',
        entityType: 'business',
        entityId: business.id,
        before: {
          name: business.name,
          vatRateBp: business.vatRateBp,
          pricesIncludeTax: business.pricesIncludeTax,
          offlineCashEnabled: business.offlineCashEnabled,
        },
        after: input,
        correlationId: ctx.correlationId,
      });
      return result.rows[0];
    });
    ok(res, updated);
  });

  router.get('/settings/payment-methods', requirePermission('settings.manage'), async (req, res) => {
    const ctx = req.ctx;
    const rows = await ctx.withDb((client) =>
      client.query(
        `SELECT id, code, name, type, requires_reference, opens_drawer, is_active, sort_order
         FROM payment_methods WHERE tenant_id=$1 AND store_id=$2 ORDER BY sort_order, name`,
        [ctx.tenant!.id, ctx.store!.id],
      ),
    );
    ok(
      res,
      rows.rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        requiresReference: r.requires_reference,
        opensDrawer: r.opens_drawer,
        isActive: r.is_active,
        sortOrder: r.sort_order,
      })),
    );
  });

  router.put('/settings/payment-methods', requirePermission('settings.manage'), async (req, res) => {
    const input = z
      .object({ methods: z.array(paymentMethodInputSchema).min(1).max(20) })
      .parse(req.body);
    const ctx = req.ctx;
    const codes = new Set<string>();
    for (const method of input.methods) {
      if (codes.has(method.code)) throw new NexoraError('VALIDATION_FAILED', { field: 'methods.code' });
      codes.add(method.code);
    }
    const result = await ctx.withDb(async (client) => {
      for (const method of input.methods) {
        await client.query(
          `INSERT INTO payment_methods
            (tenant_id, store_id, code, name, type, requires_reference, opens_drawer, is_active, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, store_id, code) DO UPDATE SET
             name=EXCLUDED.name, type=EXCLUDED.type,
             requires_reference=EXCLUDED.requires_reference, opens_drawer=EXCLUDED.opens_drawer,
             is_active=EXCLUDED.is_active, sort_order=EXCLUDED.sort_order`,
          [
            ctx.tenant!.id,
            ctx.store!.id,
            method.code,
            method.name,
            method.type,
            method.requiresReference,
            method.opensDrawer,
            method.isActive,
            method.sortOrder,
          ],
        );
      }
      await client.query(
        `UPDATE payment_methods SET is_active=false
         WHERE tenant_id=$1 AND store_id=$2 AND code <> ALL($3::text[])`,
        [ctx.tenant!.id, ctx.store!.id, [...codes]],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        storeId: ctx.store!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'settings.payment_methods_updated',
        entityType: 'store',
        entityId: ctx.store!.id,
        after: { codes: [...codes] },
        correlationId: ctx.correlationId,
      });
      return { codes: [...codes] };
    });
    ok(res, result);
  });

  router.get('/audit-logs', requirePermission('audit.view'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const action = typeof req.query.action === 'string' ? req.query.action : null;
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : null;
    const storeId = ctx.store?.id ?? null;
    const offset = (query.page - 1) * query.pageSize;
    const result = await ctx.withDb(async (client) => {
      const rows = await client.query(
        `SELECT id, actor_name, action, entity_type, entity_id, before, after, reason,
                correlation_id, created_at
         FROM audit_logs
         WHERE tenant_id=$1 AND ($2::uuid IS NULL OR store_id=$2 OR store_id IS NULL)
           AND ($3::text IS NULL OR action ILIKE $3 || '%')
           AND ($4::text IS NULL OR entity_type=$4)
         ORDER BY created_at DESC LIMIT $5 OFFSET $6`,
        [ctx.tenant!.id, storeId, action, entityType, query.pageSize, offset],
      );
      const total = await client.query<{ count: number }>(
        `SELECT count(*)::bigint AS count FROM audit_logs
         WHERE tenant_id=$1 AND ($2::uuid IS NULL OR store_id=$2 OR store_id IS NULL)
           AND ($3::text IS NULL OR action ILIKE $3 || '%')
           AND ($4::text IS NULL OR entity_type=$4)`,
        [ctx.tenant!.id, storeId, action, entityType],
      );
      return { rows: rows.rows, total: Number(total.rows[0]?.count ?? 0) };
    });
    ok(
      res,
      result.rows.map((r: any) => ({
        id: r.id,
        actorName: r.actor_name,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        before: r.before,
        after: r.after,
        reason: r.reason,
        correlationId: r.correlation_id,
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

  return router;
}

export function notificationRoutes(): Router {
  const router = Router();

  router.get('/notifications', async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const unreadOnly = req.query.unread === 'true';
    const rows = await ctx.withDb((client) =>
      client.query(
        `SELECT id, type, severity, title, body, link, read_at, created_at
         FROM notifications WHERE tenant_id=$1
           AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
         ORDER BY created_at DESC LIMIT $3`,
        [ctx.tenant!.id, unreadOnly, query.pageSize],
      ),
    );
    const unread = await ctx.withDb((client) =>
      client.query<{ count: number }>(
        'SELECT count(*)::bigint AS count FROM notifications WHERE tenant_id=$1 AND read_at IS NULL',
        [ctx.tenant!.id],
      ),
    );
    ok(
      res,
      rows.rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        severity: r.severity,
        title: r.title,
        body: r.body,
        link: r.link,
        readAt: r.read_at,
        createdAt: r.created_at,
      })),
      { unreadCount: Number(unread.rows[0]?.count ?? 0) },
    );
  });

  router.post('/notifications/:id/read', async (req, res) => {
    const ctx = req.ctx;
    const id = z.string().uuid().parse(req.params.id);
    await ctx.withDb((client) =>
      client.query(
        'UPDATE notifications SET read_at=now() WHERE tenant_id=$1 AND id=$2 AND read_at IS NULL',
        [ctx.tenant!.id, id],
      ),
    );
    res.status(204).end();
  });

  router.post('/notifications/read-all', async (req, res) => {
    const ctx = req.ctx;
    await ctx.withDb((client) =>
      client.query('UPDATE notifications SET read_at=now() WHERE tenant_id=$1 AND read_at IS NULL', [
        ctx.tenant!.id,
      ]),
    );
    res.status(204).end();
  });

  return router;
}
