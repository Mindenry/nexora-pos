import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { Db } from '@nexora/db';
import {
  NexoraError,
  ROLE_DEFINITIONS,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '@nexora/shared';
import type { Config } from '../config';
import { resolveUserContext, type ResolvedContext } from '../http/auth';
import { requireEmployee } from '../http/auth';
import { ok } from '../http/respond';
import { writeAudit } from '../services/audit';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword, sha256 } from '../services/password';
import { SESSION_COOKIE, createSession, sessionCookieOptions } from '../services/session';
import type { SessionUser } from '../types';
interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  locale: 'th' | 'en';
  is_platform_admin: boolean;
  tenant_id: string | null;
  status: string;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return `${base || 'tenant'}-${randomBytes(3).toString('hex')}`;
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    locale: row.locale,
    isPlatformAdmin: row.is_platform_admin,
    tenantId: row.tenant_id,
  };
}

function mePayload(user: SessionUser, resolved: ResolvedContext) {
  return {
    user,
    tenant: resolved.tenant,
    employee: resolved.employee,
    business: resolved.business,
    store: resolved.store,
    stores: resolved.stores,
    permissions: [...resolved.permissions],
    roles: resolved.employee?.roleCodes ?? [],
  };
}

export function authRoutes(db: Db, config: Config, requireAuth: RequestHandler): Router {
  const router = Router();

  router.post('/register', async (req, res) => {
    const input = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const email = input.email.toLowerCase();

    const existing = await db.queryGlobal('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (existing.rowCount) throw new NexoraError('CONFLICT_DUPLICATE', { field: 'email' });

    const result = await db.transaction(async (client) => {
      const tenant = await client.query<{ id: string }>(
        `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'trial') RETURNING id`,
        [input.businessName, slugify(input.businessName)],
      );
      const tenantId = tenant.rows[0]!.id;

      const user = await client.query<UserRow>(
        `INSERT INTO users (tenant_id, email, password_hash, name, locale)
         VALUES ($1,$2,$3,$4,'th')
         RETURNING id, email, password_hash, name, locale, is_platform_admin, tenant_id, status`,
        [tenantId, email, passwordHash, input.ownerName],
      );
      const userRow = user.rows[0]!;

      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      const business = await client.query<{ id: string }>(
        `INSERT INTO businesses (tenant_id, name, currency, timezone)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [tenantId, input.businessName, input.currency, input.timezone],
      );
      const businessId = business.rows[0]!.id;

      const store = await client.query<{ id: string }>(
        `INSERT INTO stores (tenant_id, business_id, code, name, timezone, receipt_prefix)
         VALUES ($1,$2,'HQ',$3,$4,'R') RETURNING id`,
        [tenantId, businessId, input.storeName, input.timezone],
      );
      const storeId = store.rows[0]!.id;

      let ownerRoleId = '';
      for (const role of ROLE_DEFINITIONS) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO roles (tenant_id, code, name_th, name_en, scope, is_system)
           VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
          [tenantId, role.code, role.nameTh, role.nameEn, role.scope],
        );
        const roleId = inserted.rows[0]!.id;
        if (role.code === 'owner') ownerRoleId = roleId;
        if (role.permissions.length > 0) {
          await client.query(
            `INSERT INTO role_permissions (tenant_id, role_id, permission_code)
             SELECT $1, $2, unnest($3::text[])`,
            [tenantId, roleId, role.permissions],
          );
        }
      }

      const employee = await client.query<{ id: string }>(
        `INSERT INTO employees (tenant_id, user_id, display_name, phone, default_store_id, hired_at)
         VALUES ($1,$2,$3,$4,$5,CURRENT_DATE) RETURNING id`,
        [tenantId, userRow.id, input.ownerName, input.phone || '', storeId],
      );
      const employeeId = employee.rows[0]!.id;
      await client.query(
        `INSERT INTO employee_roles (tenant_id, employee_id, role_id) VALUES ($1,$2,$3)`,
        [tenantId, employeeId, ownerRoleId],
      );
      await client.query(
        `INSERT INTO employee_stores (tenant_id, employee_id, store_id) VALUES ($1,$2,$3)`,
        [tenantId, employeeId, storeId],
      );

      await client.query(
        `INSERT INTO payment_methods (tenant_id, store_id, code, name, type, requires_reference, opens_drawer, sort_order)
         VALUES
           ($1,$2,'cash','เงินสด','cash',false,true,10),
           ($1,$2,'transfer','โอนเงิน','transfer',true,false,20),
           ($1,$2,'card','บัตรเครดิต/เดบิต','card',true,false,30),
           ($1,$2,'qr','พร้อมเพย์ / QR','qr',true,false,40)`,
        [tenantId, storeId],
      );

      await client.query(
        `INSERT INTO units (tenant_id, code, name) VALUES
           ($1,'pcs','ชิ้น'), ($1,'box','กล่อง'), ($1,'pack','แพ็ค'), ($1,'kg','กิโลกรัม')`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO categories (tenant_id, name, sort_order) VALUES ($1,'ทั่วไป',0)`,
        [tenantId],
      );

      const plan = await client.query<{ id: string }>(
        `SELECT id FROM subscription_plans WHERE code = 'starter' LIMIT 1`,
      );
      if (plan.rows[0]) {
        await client.query(
          `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_end)
           VALUES ($1,$2,'trialing', now() + interval '14 days')`,
          [tenantId, plan.rows[0].id],
        );
      }

      await writeAudit(client, {
        tenantId,
        actorUserId: userRow.id,
        actorName: userRow.name,
        action: 'tenant.registered',
        entityType: 'tenant',
        entityId: tenantId,
        after: { businessName: input.businessName, storeName: input.storeName },
        correlationId: req.ctx?.correlationId ?? null,
      });

      await client.query(
        `INSERT INTO notifications (tenant_id, store_id, type, severity, title, body, link)
         VALUES ($1,$2,'welcome','info','ยินดีต้อนรับสู่ NEXORA POS','เริ่มตั้งค่าร้าน เพิ่มสินค้า และเปิดกะแรกของคุณ','/onboarding')`,
        [tenantId, storeId],
      );

      return { userRow, tenantId };
    });

    const session = await createSession(db, result.userRow.id, {
      remember: true,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(config.isProd, true));

    await db.queryGlobal('UPDATE users SET last_login_at = now() WHERE id = $1', [result.userRow.id]);
    const sessionUser = toSessionUser(result.userRow);
    const resolved = await resolveUserContext(db, sessionUser);
    res.status(201).json({ data: mePayload(sessionUser, resolved) });
  });

  router.post('/login', async (req, res) => {
    const input = loginSchema.parse(req.body);
    const email = input.email.toLowerCase();
    const found = await db.queryGlobal<UserRow>(
      `SELECT id, email, password_hash, name, locale, is_platform_admin, tenant_id, status
       FROM users WHERE lower(email) = $1`,
      [email],
    );
    const row = found.rows[0];
    const valid = await verifyPassword(input.password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!row || !valid) throw new NexoraError('AUTH_INVALID_CREDENTIALS');
    if (row.status !== 'active') throw new NexoraError('AUTH_PERMISSION_DENIED');

    if (row.tenant_id) {
      const tenant = await db.queryGlobal<{ status: string }>(
        'SELECT status FROM tenants WHERE id = $1',
        [row.tenant_id],
      );
      if (!tenant.rows[0] || tenant.rows[0].status === 'suspended') {
        throw new NexoraError('DOMAIN_SUBSCRIPTION_INACTIVE');
      }
    }

    const session = await createSession(db, row.id, {
      remember: input.remember,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(config.isProd, input.remember));

    await db.queryGlobal('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
    const actor = toSessionUser(row);
    if (row.tenant_id) {
      await db.withTenant(row.tenant_id, async (client) => {
        await writeAudit(client, {
          tenantId: row.tenant_id,
          actorUserId: row.id,
          actorName: row.name,
          action: 'auth.login',
          entityType: 'session',
          entityId: null,
          correlationId: req.ctx?.correlationId ?? null,
        });
      });
    } else {
      await db.queryGlobal(
        `INSERT INTO audit_logs (tenant_id, actor_user_id, actor_name, action, entity_type, correlation_id)
         VALUES (NULL,$1,$2,'auth.login','session',$3)`,
        [row.id, row.name, req.ctx?.correlationId ?? null],
      );
    }

    const resolved = await resolveUserContext(db, actor);
    ok(res, mePayload(actor, resolved));
  });

  router.post('/logout', async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      await db.queryGlobal(
        'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
        [sha256(token)],
      );
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    const ctx = req.ctx;
    ok(res, {
      user: ctx.user,
      tenant: ctx.tenant,
      employee: ctx.employee,
      business: ctx.business,
      store: ctx.store,
      stores: ctx.stores,
      permissions: [...ctx.permissions],
      roles: ctx.employee?.roleCodes ?? [],
    });
  });

  router.patch('/profile', requireAuth, requireEmployee, async (req, res) => {
    const input = updateProfileSchema.parse(req.body);
    const ctx = req.ctx;
    await db.queryGlobal(
      'UPDATE users SET name = $1, locale = $2, updated_at = now() WHERE id = $3',
      [input.name, input.locale, ctx.user.id],
    );
    await db.withTenant(ctx.user.tenantId!, async (client) => {
      await writeAudit(client, {
        tenantId: ctx.user.tenantId,
        actorUserId: ctx.user.id,
        actorName: input.name,
        action: 'user.profile_updated',
        entityType: 'user',
        entityId: ctx.user.id,
        after: input,
        correlationId: ctx.correlationId,
      });
    });
    ok(res, { id: ctx.user.id, name: input.name, locale: input.locale });
  });

  router.post('/password', requireAuth, requireEmployee, async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    const ctx = req.ctx;
    const row = await db.queryGlobal<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [ctx.user.id],
    );
    const valid = await verifyPassword(input.currentPassword, row.rows[0]?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!valid) throw new NexoraError('AUTH_INVALID_CREDENTIALS');
    const newHash = await hashPassword(input.newPassword);
    await db.queryGlobal('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
      newHash,
      ctx.user.id,
    ]);
    await db.queryGlobal(
      'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL',
      [ctx.user.id, ctx.sessionId],
    );
    await db.withTenant(ctx.user.tenantId!, async (client) => {
      await writeAudit(client, {
        tenantId: ctx.user.tenantId,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'user.password_changed',
        entityType: 'user',
        entityId: ctx.user.id,
        correlationId: ctx.correlationId,
      });
    });
    res.status(204).end();
  });

  return router;
}

/** Onboarding uses the same auth context; kept here to avoid a second loader. */
export function onboardingRoutes(db: Db): Router {
  const router = Router();
  router.use(requireEmployee);

  router.get('/', async (req, res) => {
    const ctx = req.ctx;
    const state = await ctx.withDb(async (client) => {
      const counts = await client.query<{
        products: number;
        employees: number;
        stores: number;
        payment_methods: number;
        categories: number;
        sales: number;
      }>(
        `SELECT
          (SELECT count(*)::bigint FROM products WHERE tenant_id = $1 AND status <> 'archived') AS products,
          (SELECT count(*)::bigint FROM employees WHERE tenant_id = $1 AND status = 'active') AS employees,
          (SELECT count(*)::bigint FROM stores WHERE tenant_id = $1 AND is_active) AS stores,
          (SELECT count(*)::bigint FROM payment_methods WHERE tenant_id = $1 AND is_active) AS payment_methods,
          (SELECT count(*)::bigint FROM categories WHERE tenant_id = $1) AS categories,
          (SELECT count(*)::bigint FROM sales WHERE tenant_id = $1) AS sales`,
        [ctx.tenant!.id],
      );
      const row = counts.rows[0]!;
      return {
        products: Number(row.products),
        employees: Number(row.employees),
        stores: Number(row.stores),
        paymentMethods: Number(row.payment_methods),
        categories: Number(row.categories),
        sales: Number(row.sales),
      };
    });

    const steps = [
      { key: 'business', done: Boolean(ctx.business?.name) },
      { key: 'tax', done: ctx.business ? ctx.business.vatRateBp >= 0 : false },
      { key: 'store', done: state.stores >= 1 },
      { key: 'products', done: state.products >= 1 },
      { key: 'employees', done: state.employees >= 1 },
      { key: 'payments', done: state.paymentMethods >= 1 },
      { key: 'pos', done: state.sales >= 1 },
    ];
    ok(res, {
      completed: Boolean(ctx.tenant?.onboardedAt),
      steps,
      counts: state,
    });
  });

  router.post('/complete', async (req, res) => {
    const ctx = req.ctx;
    if (!ctx.permissions.has('settings.manage')) throw new NexoraError('AUTH_PERMISSION_DENIED');
    await db.queryGlobal(
      'UPDATE tenants SET onboarded_at = COALESCE(onboarded_at, now()), status = CASE WHEN status = $2 THEN $3 ELSE status END WHERE id = $1',
      [ctx.tenant!.id, 'trial', 'active'],
    );
    await ctx.withDb(async (client) => {
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'tenant.onboarding_completed',
        entityType: 'tenant',
        entityId: ctx.tenant!.id,
        correlationId: ctx.correlationId,
      });
    });
    ok(res, { completed: true });
  });

  return router;
}
