import { Router } from 'express';
import { z } from 'zod';
import {
  NexoraError,
  customerInputSchema,
  listQuerySchema,
  uuidSchema,
} from '@nexora/shared';
import { requirePermission } from '../http/auth';
import { created, ok } from '../http/respond';
import { writeAudit } from '../services/audit';

export function customerRoutes(): Router {
  const router = Router();

  router.get('/customers', requirePermission('customers.read'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const search = query.search?.trim() || null;
    const offset = (query.page - 1) * query.pageSize;
    const result = await ctx.withDb(async (client) => {
      const rows = await client.query(
        `SELECT c.id, c.code, c.name, c.phone, c.email, c.tier, c.total_spent_satang,
                c.last_purchase_at, c.consent_marketing, c.created_at,
                COALESCE((SELECT sum(points_delta) FROM loyalty_ledger l WHERE l.customer_id=c.id),0)::bigint AS points
         FROM customers c
         WHERE c.tenant_id=$1
           AND ($2::text IS NULL OR c.name ILIKE '%'||$2||'%' OR c.phone ILIKE '%'||$2||'%'
                OR c.email ILIKE '%'||$2||'%' OR c.code ILIKE '%'||$2||'%')
         ORDER BY c.created_at DESC LIMIT $3 OFFSET $4`,
        [ctx.tenant!.id, search, query.pageSize, offset],
      );
      const total = await client.query<{ count: number }>(
        `SELECT count(*)::bigint AS count FROM customers WHERE tenant_id=$1
         AND ($2::text IS NULL OR name ILIKE '%'||$2||'%' OR phone ILIKE '%'||$2||'%'
              OR email ILIKE '%'||$2||'%' OR code ILIKE '%'||$2||'%')`,
        [ctx.tenant!.id, search],
      );
      const pointsLiability = await client.query<{ liability: number }>(
        `SELECT COALESCE(sum(points_delta),0)::bigint AS liability FROM loyalty_ledger WHERE tenant_id=$1`,
        [ctx.tenant!.id],
      );
      return {
        rows: rows.rows,
        total: Number(total.rows[0]?.count ?? 0),
        pointsLiability: Number(pointsLiability.rows[0]?.liability ?? 0),
      };
    });
    ok(
      res,
      result.rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        phone: r.phone,
        email: r.email,
        tier: r.tier,
        totalSpentSatang: Number(r.total_spent_satang),
        lastPurchaseAt: r.last_purchase_at,
        consentMarketing: r.consent_marketing,
        points: Number(r.points),
        createdAt: r.created_at,
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
        pointsLiability: result.pointsLiability,
      },
    );
  });

  router.post('/customers', requirePermission('customers.manage'), async (req, res) => {
    const input = customerInputSchema.parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const sequence = await client.query<{ next_number: number }>(
        'SELECT next_document_number($1,$2,$3,$4) AS next_number',
        [ctx.tenant!.id, ctx.store!.id, 'customer', ''],
      );
      const code = `CUS-${String(Number(sequence.rows[0]?.next_number ?? 1)).padStart(5, '0')}`;
      const inserted = await client.query(
        `INSERT INTO customers
          (tenant_id, code, name, phone, email, address, tax_id, birthday, consent_marketing, consent_at, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, code, name`,
        [
          ctx.tenant!.id,
          code,
          input.name,
          input.phone || null,
          input.email || null,
          input.address || '',
          input.taxId || '',
          input.birthday || null,
          input.consentMarketing,
          input.consentMarketing ? new Date().toISOString() : null,
          input.notes || '',
        ],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        storeId: ctx.store?.id ?? null,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'customer.created',
        entityType: 'customer',
        entityId: inserted.rows[0]!.id,
        after: { name: input.name, consentMarketing: input.consentMarketing },
        correlationId: ctx.correlationId,
      });
      return inserted.rows[0];
    });
    created(res, row);
  });

  router.get('/customers/:id', requirePermission('customers.read'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    const data = await ctx.withDb(async (client) => {
      const customer = await client.query(
        `SELECT c.*, COALESCE((SELECT sum(points_delta) FROM loyalty_ledger l WHERE l.customer_id=c.id),0)::bigint AS points
         FROM customers c WHERE c.tenant_id=$1 AND c.id=$2`,
        [ctx.tenant!.id, id],
      );
      if (!customer.rows[0]) throw new NexoraError('NOT_FOUND');
      const ledger = await client.query(
        `SELECT id, points_delta, type, reason, sale_id, created_at FROM loyalty_ledger
         WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 50`,
        [ctx.tenant!.id, id],
      );
      const sales = await client.query(
        `SELECT id, number, status, business_date, occurred_at, total_satang
         FROM sales WHERE tenant_id=$1 AND customer_id=$2 ORDER BY occurred_at DESC LIMIT 20`,
        [ctx.tenant!.id, id],
      );
      return { customer: customer.rows[0], ledger: ledger.rows, sales: sales.rows };
    });
    const c = data.customer as any;
    ok(res, {
      id: c.id,
      code: c.code,
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
      taxId: c.tax_id,
      birthday: c.birthday,
      tier: c.tier,
      points: Number(c.points),
      totalSpentSatang: Number(c.total_spent_satang),
      lastPurchaseAt: c.last_purchase_at,
      consentMarketing: c.consent_marketing,
      consentAt: c.consent_at,
      notes: c.notes,
      createdAt: c.created_at,
      loyaltyLedger: data.ledger.map((l: any) => ({
        id: l.id,
        pointsDelta: l.points_delta,
        type: l.type,
        reason: l.reason,
        saleId: l.sale_id,
        createdAt: l.created_at,
      })),
      sales: data.sales.map((s: any) => ({
        id: s.id,
        number: s.number,
        status: s.status,
        businessDate: s.business_date,
        occurredAt: s.occurred_at,
        totalSatang: Number(s.total_satang),
      })),
    });
  });

  router.patch('/customers/:id', requirePermission('customers.manage'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = customerInputSchema.partial().parse(req.body);
    const ctx = req.ctx;
    await ctx.withDb(async (client) => {
      const before = await client.query('SELECT * FROM customers WHERE tenant_id=$1 AND id=$2', [ctx.tenant!.id, id]);
      if (!before.rows[0]) throw new NexoraError('NOT_FOUND');
      const prev = before.rows[0] as any;
      const consentChanged = input.consentMarketing !== undefined && input.consentMarketing !== prev.consent_marketing;
      await client.query(
        `UPDATE customers SET
           name=COALESCE($1,name), phone=COALESCE($2,phone), email=COALESCE($3,email),
           address=COALESCE($4,address), tax_id=COALESCE($5,tax_id), birthday=COALESCE($6,birthday),
           consent_marketing=COALESCE($7,consent_marketing),
           consent_at = CASE WHEN $8::boolean THEN now() WHEN $7::boolean = false THEN NULL ELSE consent_at END,
           notes=COALESCE($9,notes), updated_at=now()
         WHERE tenant_id=$10 AND id=$11`,
        [
          input.name ?? null,
          input.phone ?? null,
          input.email ?? null,
          input.address ?? null,
          input.taxId ?? null,
          input.birthday || null,
          input.consentMarketing ?? null,
          consentChanged,
          input.notes ?? null,
          ctx.tenant!.id,
          id,
        ],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        storeId: ctx.store?.id ?? null,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: id,
        before: { name: prev.name, consentMarketing: prev.consent_marketing },
        after: input,
        correlationId: ctx.correlationId,
      });
    });
    ok(res, { id });
  });

  router.post('/customers/:id/points', requirePermission('customers.manage'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = z
      .object({
        pointsDelta: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0),
        reason: z.string().trim().min(3).max(200),
      })
      .parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const customer = await client.query('SELECT id FROM customers WHERE tenant_id=$1 AND id=$2', [
        ctx.tenant!.id,
        id,
      ]);
      if (!customer.rowCount) throw new NexoraError('NOT_FOUND');
      const inserted = await client.query(
        `INSERT INTO loyalty_ledger (tenant_id, customer_id, points_delta, type, reason)
         VALUES ($1,$2,$3,'adjust',$4) RETURNING id`,
        [ctx.tenant!.id, id, input.pointsDelta, input.reason],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'customer.points_adjusted',
        entityType: 'customer',
        entityId: id,
        after: input,
        correlationId: ctx.correlationId,
      });
      return inserted.rows[0];
    });
    created(res, row);
  });

  router.post('/customers/:id/anonymize', requirePermission('settings.manage'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    const reason = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    await ctx.withDb(async (client) => {
      const updated = await client.query(
        `UPDATE customers SET name='ลูกค้าปิดข้อมูล (PDPA)', phone=NULL, email=NULL, address='',
           tax_id='', birthday=NULL, consent_marketing=false, consent_at=NULL, notes='',
           updated_at=now()
         WHERE tenant_id=$1 AND id=$2 RETURNING code`,
        [ctx.tenant!.id, id],
      );
      if (!updated.rowCount) throw new NexoraError('NOT_FOUND');
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'customer.anonymized',
        entityType: 'customer',
        entityId: id,
        reason: reason.reason,
        correlationId: ctx.correlationId,
      });
    });
    res.status(204).end();
  });

  return router;
}
