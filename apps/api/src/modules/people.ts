import { Router } from 'express';
import {
  NexoraError,
  employeeInputSchema,
  employeeUpdateSchema,
  listQuerySchema,
  storeInputSchema,
  uuidSchema,
} from '@nexora/shared';
import type { DbClient } from '@nexora/db';
import { requirePermission } from '../http/auth';
import { created, ok } from '../http/respond';
import { writeAudit } from '../services/audit';
import { hashPassword } from '../services/password';

async function assertEmployeeLimit(
  client: DbClient,
  tenantId: string,
  maxEmployees: number,
): Promise<void> {
  const count = await client.query<{ count: number }>(
    `SELECT count(*)::bigint AS count FROM employees WHERE tenant_id=$1 AND status='active'`,
    [tenantId],
  );
  if (Number(count.rows[0]?.count ?? 0) >= maxEmployees) {
    throw new NexoraError('DOMAIN_SUBSCRIPTION_INACTIVE', { reason: 'employee_limit', maxEmployees });
  }
}

async function ownerCount(client: DbClient, tenantId: string, excludeEmployeeId?: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(DISTINCT e.id)::bigint AS count
     FROM employees e
     JOIN employee_roles er ON er.employee_id=e.id
     JOIN roles r ON r.id=er.role_id
     WHERE e.tenant_id=$1 AND e.status='active' AND r.code='owner'
       AND ($2::uuid IS NULL OR e.id <> $2)`,
    [tenantId, excludeEmployeeId ?? null],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export function peopleRoutes(): Router {
  const router = Router();

  router.get('/roles', requirePermission('employees.manage'), async (req, res) => {
    const ctx = req.ctx;
    const rows = await ctx.withDb((client) =>
      client.query(
        `SELECT r.id, r.code, r.name_th, r.name_en, r.scope, r.is_system,
                COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
                  FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id
         WHERE r.tenant_id=$1 GROUP BY r.id ORDER BY r.code`,
        [ctx.tenant!.id],
      ),
    );
    ok(
      res,
      rows.rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        nameTh: r.name_th,
        nameEn: r.name_en,
        scope: r.scope,
        isSystem: r.is_system,
        permissions: r.permissions,
      })),
    );
  });

  router.get('/employees', requirePermission('employees.manage'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const search = query.search?.trim() || null;
    const rows = await ctx.withDb((client) =>
      client.query(
        `SELECT e.id, e.employee_code, e.display_name, e.phone, e.status, e.hired_at,
                e.default_store_id, u.email, u.last_login_at,
                r.code AS role_code, r.name_th AS role_name_th, r.name_en AS role_name_en,
                COALESCE(array_agg(DISTINCT es.store_id) FILTER (WHERE es.store_id IS NOT NULL), '{}') AS store_ids,
                COALESCE(array_agg(DISTINCT st.name) FILTER (WHERE st.name IS NOT NULL), '{}') AS store_names
         FROM employees e
         JOIN users u ON u.id=e.user_id
         LEFT JOIN employee_roles er ON er.employee_id=e.id
         LEFT JOIN roles r ON r.id=er.role_id
         LEFT JOIN employee_stores es ON es.employee_id=e.id
         LEFT JOIN stores st ON st.id=es.store_id
         WHERE e.tenant_id=$1
           AND ($2::text IS NULL OR e.display_name ILIKE '%'||$2||'%' OR u.email ILIKE '%'||$2||'%')
         GROUP BY e.id, u.email, u.last_login_at, r.code, r.name_th, r.name_en
         ORDER BY e.created_at DESC LIMIT $3 OFFSET $4`,
        [ctx.tenant!.id, search, query.pageSize, (query.page - 1) * query.pageSize],
      ),
    );
    const total = await ctx.withDb((client) =>
      client.query<{ count: number }>(
        `SELECT count(*)::bigint AS count FROM employees e JOIN users u ON u.id=e.user_id
         WHERE e.tenant_id=$1 AND ($2::text IS NULL OR e.display_name ILIKE '%'||$2||'%' OR u.email ILIKE '%'||$2||'%')`,
        [ctx.tenant!.id, search],
      ),
    );
    ok(
      res,
      rows.rows.map((r: any) => ({
        id: r.id,
        employeeCode: r.employee_code,
        name: r.display_name,
        phone: r.phone,
        status: r.status,
        email: r.email,
        roleCode: r.role_code,
        roleNameTh: r.role_name_th,
        roleNameEn: r.role_name_en,
        storeIds: r.store_ids,
        storeNames: r.store_names,
        defaultStoreId: r.default_store_id,
        hiredAt: r.hired_at,
        lastLoginAt: r.last_login_at,
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(total.rows[0]?.count ?? 0),
        totalPages: Math.max(1, Math.ceil(Number(total.rows[0]?.count ?? 0) / query.pageSize)),
        limits: { maxEmployees: ctx.tenant!.maxEmployees },
      },
    );
  });

  router.post('/employees', requirePermission('employees.manage'), async (req, res) => {
    const input = employeeInputSchema.parse(req.body);
    if (!input.password) throw new NexoraError('VALIDATION_FAILED', { field: 'password' });
    const ctx = req.ctx;
    const passwordHash = await hashPassword(input.password);
    const row = await ctx.withDb(async (client) => {
      await assertEmployeeLimit(client, ctx.tenant!.id, ctx.tenant!.maxEmployees);
      const existing = await client.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [input.email]);
      if (existing.rowCount) throw new NexoraError('CONFLICT_DUPLICATE', { field: 'email' });
      const stores = await client.query<{ id: string }>(
        'SELECT id FROM stores WHERE tenant_id=$1 AND id = ANY($2::uuid[])',
        [ctx.tenant!.id, input.storeIds],
      );
      if (stores.rowCount !== new Set(input.storeIds).size) throw new NexoraError('AUTH_STORE_FORBIDDEN');
      const role = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE tenant_id=$1 AND code=$2 AND code <> 'owner'`,
        [ctx.tenant!.id, input.roleCode],
      );
      if (!role.rows[0]) throw new NexoraError('NOT_FOUND', { entity: 'role' });

      const user = await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, password_hash, name, locale)
         VALUES ($1,$2,$3,$4,'th') RETURNING id`,
        [ctx.tenant!.id, input.email, passwordHash, input.name],
      );
      const employee = await client.query<{ id: string }>(
        `INSERT INTO employees (tenant_id, user_id, employee_code, display_name, phone, default_store_id, hired_at)
         VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE) RETURNING id`,
        [
          ctx.tenant!.id,
          user.rows[0]!.id,
          input.employeeCode || '',
          input.name,
          input.phone || '',
          input.storeIds[0]!,
        ],
      );
      const employeeId = employee.rows[0]!.id;
      await client.query('INSERT INTO employee_roles (tenant_id, employee_id, role_id) VALUES ($1,$2,$3)', [
        ctx.tenant!.id,
        employeeId,
        role.rows[0].id,
      ]);
      for (const storeId of input.storeIds) {
        await client.query('INSERT INTO employee_stores (tenant_id, employee_id, store_id) VALUES ($1,$2,$3)', [
          ctx.tenant!.id,
          employeeId,
          storeId,
        ]);
      }
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'employee.created',
        entityType: 'employee',
        entityId: employeeId,
        after: { name: input.name, email: input.email, roleCode: input.roleCode, storeIds: input.storeIds },
        correlationId: ctx.correlationId,
      });
      return { id: employeeId, name: input.name, email: input.email };
    });
    created(res, row);
  });

  router.patch('/employees/:id', requirePermission('employees.manage'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = employeeUpdateSchema.parse(req.body);
    const ctx = req.ctx;
    const newHash = input.newPassword ? await hashPassword(input.newPassword) : null;
    await ctx.withDb(async (client) => {
      const before = await client.query(
        `SELECT e.id, e.status, u.id AS user_id, u.status AS user_status,
                (SELECT r.code FROM employee_roles er JOIN roles r ON r.id=er.role_id
                 WHERE er.employee_id=e.id LIMIT 1) AS role_code
         FROM employees e JOIN users u ON u.id=e.user_id
         WHERE e.tenant_id=$1 AND e.id=$2`,
        [ctx.tenant!.id, id],
      );
      const row = before.rows[0] as any;
      if (!row) throw new NexoraError('NOT_FOUND');
      if (id === ctx.employee!.id && input.status === 'suspended') {
        throw new NexoraError('VALIDATION_FAILED', { reason: 'cannot_suspend_self' });
      }
      const losingOwner =
        row.role_code === 'owner' && input.roleCode !== undefined && input.roleCode !== 'owner';
      const suspendingOwner = row.role_code === 'owner' && input.status === 'suspended';
      if ((losingOwner || suspendingOwner) && (await ownerCount(client, ctx.tenant!.id, id)) === 0) {
        throw new NexoraError('DOMAIN_LAST_OWNER');
      }
      if (input.roleCode) {
        const role = await client.query<{ id: string }>(
          'SELECT id FROM roles WHERE tenant_id=$1 AND code=$2',
          [ctx.tenant!.id, input.roleCode],
        );
        if (!role.rows[0]) throw new NexoraError('NOT_FOUND', { entity: 'role' });
        await client.query('DELETE FROM employee_roles WHERE employee_id=$1', [id]);
        await client.query('INSERT INTO employee_roles (tenant_id, employee_id, role_id) VALUES ($1,$2,$3)', [
          ctx.tenant!.id,
          id,
          role.rows[0].id,
        ]);
      }
      if (input.storeIds) {
        const stores = await client.query<{ id: string }>(
          'SELECT id FROM stores WHERE tenant_id=$1 AND id = ANY($2::uuid[])',
          [ctx.tenant!.id, input.storeIds],
        );
        if (stores.rowCount !== new Set(input.storeIds).size) throw new NexoraError('AUTH_STORE_FORBIDDEN');
        await client.query('DELETE FROM employee_stores WHERE employee_id=$1', [id]);
        for (const storeId of input.storeIds) {
          await client.query('INSERT INTO employee_stores (tenant_id, employee_id, store_id) VALUES ($1,$2,$3)', [
            ctx.tenant!.id,
            id,
            storeId,
          ]);
        }
      }
      await client.query(
        `UPDATE employees SET
           display_name=COALESCE($1,display_name), phone=COALESCE($2,phone),
           status=COALESCE($3,status),
           default_store_id = COALESCE($6::uuid, default_store_id),
           updated_at=now()
         WHERE tenant_id=$4 AND id=$5`,
        [
          input.name ?? null,
          input.phone ?? null,
          input.status ?? null,
          ctx.tenant!.id,
          id,
          input.storeIds?.[0] ?? null,
        ],
      );
      if (input.status) {
        await client.query('UPDATE users SET status=$1, updated_at=now() WHERE id=$2', [
          input.status,
          row.user_id,
        ]);
      }
      if (newHash) {
        await client.query('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [
          newHash,
          row.user_id,
        ]);
        await client.query(
          `UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
          [row.user_id],
        );
      }
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'employee.updated',
        entityType: 'employee',
        entityId: id,
        before: { status: row.status, roleCode: row.role_code },
        after: { roleCode: input.roleCode, status: input.status, name: input.name },
        correlationId: ctx.correlationId,
      });
    });
    ok(res, { id });
  });

  router.get('/stores', async (req, res) => {
    const ctx = req.ctx;
    const rows = await ctx.withDb((client) =>
      client.query(
        `SELECT s.id, s.code, s.name, s.address, s.phone, s.timezone, s.tax_id, s.receipt_prefix,
                s.is_active, s.created_at,
                (SELECT count(*)::bigint FROM employee_stores es WHERE es.store_id=s.id) AS employee_count,
                (SELECT count(*)::bigint FROM sales sa WHERE sa.store_id=s.id AND sa.status <> 'voided') AS sales_count
         FROM stores s WHERE s.tenant_id=$1 ORDER BY s.name`,
        [ctx.tenant!.id],
      ),
    );
    ok(
      res,
      rows.rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        address: r.address,
        phone: r.phone,
        timezone: r.timezone,
        taxId: r.tax_id,
        receiptPrefix: r.receipt_prefix,
        isActive: r.is_active,
        employeeCount: Number(r.employee_count),
        salesCount: Number(r.sales_count),
        createdAt: r.created_at,
      })),
      { limits: { maxStores: ctx.tenant!.maxStores } },
    );
  });

  router.post('/stores', requirePermission('settings.manage'), async (req, res) => {
    const input = storeInputSchema.parse(req.body);
    const ctx = req.ctx;
    const row = await ctx.withDb(async (client) => {
      const count = await client.query<{ count: number }>(
        'SELECT count(*)::bigint AS count FROM stores WHERE tenant_id=$1 AND is_active',
        [ctx.tenant!.id],
      );
      if (Number(count.rows[0]?.count ?? 0) >= ctx.tenant!.maxStores) {
        throw new NexoraError('DOMAIN_SUBSCRIPTION_INACTIVE', {
          reason: 'store_limit',
          maxStores: ctx.tenant!.maxStores,
        });
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO stores (tenant_id, business_id, code, name, address, phone, timezone, tax_id, receipt_prefix, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          ctx.tenant!.id,
          ctx.business!.id,
          input.code,
          input.name,
          input.address || '',
          input.phone || '',
          input.timezone,
          input.taxId || '',
          input.receiptPrefix,
          input.isActive,
        ],
      );
      const storeId = inserted.rows[0]!.id;
      await client.query(
        `INSERT INTO payment_methods (tenant_id, store_id, code, name, type, requires_reference, opens_drawer, sort_order)
         VALUES
           ($1,$2,'cash','เงินสด','cash',false,true,10),
           ($1,$2,'transfer','โอนเงิน','transfer',true,false,20),
           ($1,$2,'card','บัตรเครดิต/เดบิต','card',true,false,30),
           ($1,$2,'qr','พร้อมเพย์ / QR','qr',true,false,40)`,
        [ctx.tenant!.id, storeId],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'store.created',
        entityType: 'store',
        entityId: storeId,
        after: input,
        correlationId: ctx.correlationId,
      });
      return { id: storeId, code: input.code, name: input.name };
    });
    created(res, row);
  });

  router.patch('/stores/:id', requirePermission('settings.manage'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const input = storeInputSchema.partial().parse(req.body);
    const ctx = req.ctx;
    await ctx.withDb(async (client) => {
      const updated = await client.query(
        `UPDATE stores SET
           name=COALESCE($1,name), code=COALESCE($2,code), address=COALESCE($3,address),
           phone=COALESCE($4,phone), timezone=COALESCE($5,timezone), tax_id=COALESCE($6,tax_id),
           receipt_prefix=COALESCE($7,receipt_prefix), is_active=COALESCE($8,is_active), updated_at=now()
         WHERE tenant_id=$9 AND id=$10 RETURNING id`,
        [
          input.name ?? null,
          input.code ?? null,
          input.address ?? null,
          input.phone ?? null,
          input.timezone ?? null,
          input.taxId ?? null,
          input.receiptPrefix ?? null,
          input.isActive ?? null,
          ctx.tenant!.id,
          id,
        ],
      );
      if (!updated.rowCount) throw new NexoraError('NOT_FOUND');
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'store.updated',
        entityType: 'store',
        entityId: id,
        after: input,
        correlationId: ctx.correlationId,
      });
    });
    ok(res, { id });
  });

  router.get('/permissions', requirePermission('employees.manage'), async (req, res) => {
    const ctx = req.ctx;
    const rows = await ctx.withDb((client) =>
      client.query('SELECT code, module, label_th, label_en FROM permissions ORDER BY module, code'),
    );
    ok(
      res,
      rows.rows.map((r: any) => ({
        code: r.code,
        module: r.module,
        labelTh: r.label_th,
        labelEn: r.label_en,
      })),
    );
  });

  return router;
}

export { ownerCount, assertEmployeeLimit };
