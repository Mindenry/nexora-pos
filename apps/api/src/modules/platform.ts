import { Router } from 'express';
import type { Db } from '@nexora/db';
import {
  NexoraError,
  listQuerySchema,
  planInputSchema,
  platformTenantUpdateSchema,
  uuidSchema,
} from '@nexora/shared';
import { requirePlatformAdmin } from '../http/auth';
import { created, ok } from '../http/respond';
import { writeAudit } from '../services/audit';

export function platformRoutes(db: Db): Router {
  const router = Router();
  router.use(requirePlatformAdmin);

  router.get('/platform/overview', async (_req, res) => {
    const tenants = await db.queryGlobal<{ total: number; active: number; trial: number; suspended: number }>(
      `SELECT count(*)::bigint AS total,
              count(*) FILTER (WHERE status='active')::bigint AS active,
              count(*) FILTER (WHERE status='trial')::bigint AS trial,
              count(*) FILTER (WHERE status='suspended')::bigint AS suspended
       FROM tenants`,
    );
    const usage = await db.withPlatformAdmin(async (client) => {
      const counts = await client.query<{ users: number; employees: number; stores: number; sales: number }>(
        `SELECT
           (SELECT count(*)::bigint FROM users WHERE tenant_id IS NOT NULL) AS users,
           (SELECT count(*)::bigint FROM employees) AS employees,
           (SELECT count(*)::bigint FROM stores WHERE is_active) AS stores,
           (SELECT count(*)::bigint FROM sales) AS sales`,
      );
      const revenue = await client.query<{ gmv: number }>(
        `SELECT COALESCE(sum(total_satang),0)::bigint AS gmv FROM sales
         WHERE status <> 'voided' AND business_date >= CURRENT_DATE - 29`,
      );
      return { ...counts.rows[0]!, gmv: Number(revenue.rows[0]?.gmv ?? 0) };
    });
    const plans = await db.queryGlobal(
      'SELECT code, name, price_satang, max_stores, max_employees FROM subscription_plans WHERE is_active ORDER BY price_satang',
    );
    ok(res, {
      tenants: {
        total: Number(tenants.rows[0]?.total ?? 0),
        active: Number(tenants.rows[0]?.active ?? 0),
        trial: Number(tenants.rows[0]?.trial ?? 0),
        suspended: Number(tenants.rows[0]?.suspended ?? 0),
      },
      usage: {
        users: Number(usage.users),
        employees: Number(usage.employees),
        stores: Number(usage.stores),
        sales: Number(usage.sales),
        gmv30dSatang: usage.gmv,
      },
      plans: plans.rows.map((p: any) => ({
        code: p.code,
        name: p.name,
        priceSatang: Number(p.price_satang),
        maxStores: p.max_stores,
        maxEmployees: p.max_employees,
      })),
    });
  });

  router.get('/platform/tenants', async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const search = query.search?.trim() || null;
    const data = await db.withPlatformAdmin(async (client) => {
      const rows = await client.query(
        `SELECT t.id, t.name, t.slug, t.status, t.created_at, t.onboarded_at,
                sp.code AS plan_code, sp.name AS plan_name, s.status AS subscription_status,
                (SELECT count(*)::bigint FROM stores st WHERE st.tenant_id=t.id AND st.is_active) AS store_count,
                (SELECT count(*)::bigint FROM employees e WHERE e.tenant_id=t.id) AS employee_count,
                (SELECT count(*)::bigint FROM sales sa WHERE sa.tenant_id=t.id AND sa.status <> 'voided'
                  AND sa.business_date >= CURRENT_DATE - 29) AS sales_30d,
                (SELECT COALESCE(sum(sa.total_satang),0)::bigint FROM sales sa WHERE sa.tenant_id=t.id
                  AND sa.status <> 'voided' AND sa.business_date >= CURRENT_DATE - 29) AS gmv_30d
         FROM tenants t
         LEFT JOIN subscriptions s ON s.tenant_id=t.id
         LEFT JOIN subscription_plans sp ON sp.id=s.plan_id
         WHERE ($1::text IS NULL OR t.name ILIKE '%'||$1||'%' OR t.slug ILIKE '%'||$1||'%')
         ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`,
        [search, query.pageSize, (query.page - 1) * query.pageSize],
      );
      const total = await client.query<{ count: number }>(
        'SELECT count(*)::bigint AS count FROM tenants WHERE ($1::text IS NULL OR name ILIKE \'%\'||$1||\'%\' OR slug ILIKE \'%\'||$1||\'%\')',
        [search],
      );
      return { rows: rows.rows, total: Number(total.rows[0]?.count ?? 0) };
    });
    ok(
      res,
      data.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        planCode: r.plan_code,
        planName: r.plan_name,
        subscriptionStatus: r.subscription_status,
        storeCount: Number(r.store_count),
        employeeCount: Number(r.employee_count),
        sales30d: Number(r.sales_30d),
        gmv30dSatang: Number(r.gmv_30d),
        createdAt: r.created_at,
        onboardedAt: r.onboarded_at,
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: data.total,
        totalPages: Math.max(1, Math.ceil(data.total / query.pageSize)),
      },
    );
  });

  router.get('/platform/tenants/:id', async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const data = await db.withPlatformAdmin(async (client) => {
      const tenant = await client.query(
        `SELECT t.*, sp.code AS plan_code, sp.name AS plan_name, sp.price_satang, s.status AS subscription_status,
                s.current_period_end
         FROM tenants t
         LEFT JOIN subscriptions s ON s.tenant_id=t.id
         LEFT JOIN subscription_plans sp ON sp.id=s.plan_id
         WHERE t.id=$1`,
        [id],
      );
      if (!tenant.rows[0]) throw new NexoraError('NOT_FOUND');
      const stores = await client.query(
        `SELECT id, code, name, is_active,
                (SELECT COALESCE(sum(m.qty_delta),0)::bigint FROM inventory_movements m WHERE m.store_id=s.id) AS stock_units
         FROM stores s WHERE tenant_id=$1 ORDER BY name`,
        [id],
      );
      const employees = await client.query(
        `SELECT e.id, e.display_name, u.email, e.status,
                (SELECT r.code FROM employee_roles er JOIN roles r ON r.id=er.role_id WHERE er.employee_id=e.id LIMIT 1) AS role
         FROM employees e JOIN users u ON u.id=e.user_id WHERE e.tenant_id=$1 ORDER BY e.display_name`,
        [id],
      );
      const sales = await client.query(
        `SELECT business_date::text AS date, count(*)::bigint AS orders, COALESCE(sum(total_satang),0)::bigint AS total
         FROM sales WHERE tenant_id=$1 AND status <> 'voided' AND business_date >= CURRENT_DATE - 13
         GROUP BY business_date ORDER BY business_date`,
        [id],
      );
      return { tenant: tenant.rows[0], stores: stores.rows, employees: employees.rows, sales: sales.rows };
    });
    const t = data.tenant as any;
    ok(res, {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      planCode: t.plan_code,
      planName: t.plan_name,
      subscriptionStatus: t.subscription_status,
      currentPeriodEnd: t.current_period_end,
      createdAt: t.created_at,
      onboardedAt: t.onboarded_at,
      stores: data.stores.map((s: any) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        isActive: s.is_active,
        stockUnits: Number(s.stock_units),
      })),
      employees: data.employees.map((e: any) => ({
        id: e.id,
        name: e.display_name,
        email: e.email,
        status: e.status,
        role: e.role,
      })),
      sales: data.sales.map((s: any) => ({ date: s.date, orders: Number(s.orders), totalSatang: Number(s.total) })),
    });
  });

  router.patch('/platform/tenants/:id', async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = platformTenantUpdateSchema.parse(req.body);
    const ctx = req.ctx;

    await db.transaction(async (client) => {
      const tenant = await client.query<{ name: string; status: string }>(
        'SELECT name, status FROM tenants WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!tenant.rows[0]) throw new NexoraError('NOT_FOUND');
      if (input.status) {
        await client.query('UPDATE tenants SET status=$1, updated_at=now() WHERE id=$2', [input.status, id]);
        if (input.status === 'suspended') {
          await client.query(
            `UPDATE sessions SET revoked_at=now()
             WHERE user_id IN (SELECT id FROM users WHERE tenant_id=$1) AND revoked_at IS NULL`,
            [id],
          );
        }
      }
      if (input.planCode) {
        const plan = await client.query<{ id: string; max_stores: number; max_employees: number }>(
          'SELECT id, max_stores, max_employees FROM subscription_plans WHERE code=$1 AND is_active',
          [input.planCode],
        );
        if (!plan.rows[0]) throw new NexoraError('NOT_FOUND', { entity: 'plan' });
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [id]);
        const existing = await client.query('SELECT 1 FROM subscriptions WHERE tenant_id=$1', [id]);
        if (existing.rowCount) {
          await client.query(
            `UPDATE subscriptions SET plan_id=$1, status='active',
               current_period_start=now(), current_period_end=now() + interval '1 month', updated_at=now()
             WHERE tenant_id=$2`,
            [plan.rows[0].id, id],
          );
        } else {
          await client.query(
            `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_end)
             VALUES ($1,$2,'active', now() + interval '1 month')`,
            [id, plan.rows[0].id],
          );
        }
      }
      if (input.featureOverrides) {
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [id]);
        for (const [key, enabled] of Object.entries(input.featureOverrides)) {
          await client.query(
            `INSERT INTO tenant_features (tenant_id, feature_key, enabled) VALUES ($1,$2,$3)
             ON CONFLICT (tenant_id, feature_key) DO UPDATE SET enabled=EXCLUDED.enabled`,
            [id, key, enabled],
          );
        }
      }
      await client.query(`SELECT set_config('app.tenant_id', '', true)`);
      await client.query(`SELECT set_config('app.platform_admin', 'on', true)`);
      await writeAudit(client, {
        tenantId: id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'platform.tenant_updated',
        entityType: 'tenant',
        entityId: id,
        before: tenant.rows[0],
        after: input,
        correlationId: ctx.correlationId,
      });
    });

    ok(res, { id });
  });

  router.get('/platform/plans', async (_req, res) => {
    const rows = await db.queryGlobal(
      `SELECT id, code, name, price_satang, interval, features, max_stores, max_employees, is_active, created_at
       FROM subscription_plans ORDER BY price_satang`,
    );
    ok(
      res,
      rows.rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        priceSatang: Number(r.price_satang),
        interval: r.interval,
        features: r.features,
        maxStores: r.max_stores,
        maxEmployees: r.max_employees,
        isActive: r.is_active,
        createdAt: r.created_at,
      })),
    );
  });

  router.post('/platform/plans', async (req, res) => {
    const input = planInputSchema.parse(req.body);
    const row = await db.queryGlobal(
      `INSERT INTO subscription_plans (code, name, price_satang, interval, features, max_stores, max_employees, is_active)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING id, code, name`,
      [
        input.code,
        input.name,
        input.priceSatang,
        input.interval,
        JSON.stringify(input.features),
        input.maxStores,
        input.maxEmployees,
        input.isActive,
      ],
    );
    created(res, row.rows[0]);
  });

  router.get('/platform/audit', async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const rows = await db.withPlatformAdmin((client) =>
      client.query(
        `SELECT a.id, a.tenant_id, t.name AS tenant_name, a.actor_name, a.action,
                a.entity_type, a.entity_id, a.reason, a.created_at
         FROM audit_logs a LEFT JOIN tenants t ON t.id=a.tenant_id
         ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
        [query.pageSize, (query.page - 1) * query.pageSize],
      ),
    );
    const total = await db.withPlatformAdmin((client) =>
      client.query<{ count: number }>('SELECT count(*)::bigint AS count FROM audit_logs'),
    );
    ok(
      res,
      rows.rows.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        actorName: r.actor_name,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        reason: r.reason,
        createdAt: r.created_at,
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(total.rows[0]?.count ?? 0),
        totalPages: Math.max(1, Math.ceil(Number(total.rows[0]?.count ?? 0) / query.pageSize)),
      },
    );
  });

  router.get('/platform/health', async (_req, res) => {
    const dbSize = await db.queryGlobal<{ size: string; connections: number }>(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
              (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections`,
    );
    const migrations = await db.queryGlobal<{ version: string; applied_at: string }>(
      'SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 5',
    );
    const integrity = await db.withPlatformAdmin(async (client) => {
      const checks = await client.query<{ sales_total: number; payment_total: number; stock_rows: number }>(
        `SELECT
           (SELECT COALESCE(sum(total_satang),0)::bigint FROM sales WHERE status <> 'voided') AS sales_total,
           (SELECT COALESCE(sum(p.amount_satang),0)::bigint FROM payments p JOIN sales s ON s.id=p.sale_id
             WHERE s.status <> 'voided' AND p.status IN ('paid','partially_refunded','refunded')) AS payment_total,
           (SELECT count(*)::bigint FROM inventory_movements) AS stock_rows`,
      );
      return checks.rows[0]!;
    });
    ok(res, {
      database: {
        size: dbSize.rows[0]?.size,
        connections: Number(dbSize.rows[0]?.connections ?? 0),
      },
      migrations: migrations.rows,
      integrity: {
        salesTotalSatang: Number(integrity.sales_total),
        paymentsTotalSatang: Number(integrity.payment_total),
        ledgerRows: Number(integrity.stock_rows),
        paymentMatchesSales: Number(integrity.sales_total) === Number(integrity.payment_total),
      },
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  return router;
}
