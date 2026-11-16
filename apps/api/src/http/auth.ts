import type { Db, DbClient } from '@nexora/db';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { NexoraError } from '@nexora/shared';
import { SESSION_COOKIE } from '../services/session';
import { sha256 } from '../services/password';
import type {
  BusinessContext,
  EmployeeContext,
  RequestContext,
  SessionUser,
  StoreContext,
  TenantContext,
} from '../types';

interface SessionRow {
  session_id: string;
  expires_at: string;
  user_id: string;
  email: string;
  name: string;
  locale: 'th' | 'en';
  is_platform_admin: boolean;
  tenant_id: string | null;
  user_status: string;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: 'trial' | 'active' | 'suspended';
  onboarded_at: string | null;
  is_demo: boolean;
  subscription_status: string | null;
  plan_code: string | null;
  features: Record<string, boolean> | null;
  max_stores: number | null;
  max_employees: number | null;
}

interface EmployeeRow {
  id: string;
  display_name: string;
  default_store_id: string | null;
  status: string;
  role_codes: string[];
  tenant_scope: boolean;
}

interface BusinessRow {
  id: string;
  name: string;
  legal_name: string;
  tax_id: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  timezone: string;
  vat_rate_bp: number;
  prices_include_tax: boolean;
  receipt_prefix: string;
  receipt_footer: string;
  receipt_accent: string;
  receipt_logo_url: string;
  receipt_header_note: string;
  receipt_show_cashier: boolean;
  receipt_show_tax_id: boolean;
  receipt_paper_width: '80mm' | 'a4';
  loyalty_earn_per_baht: number;
  point_value_satang: number;
  loyalty_redemption_enabled: boolean;
  offline_cash_enabled: boolean;
  discount_limit_bp: number;
  allow_negative_stock: boolean;
}

interface StoreRow {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  timezone: string;
  tax_id: string;
  receipt_prefix: string;
  is_active: boolean;
}

export interface ResolvedContext {
  tenant: TenantContext | null;
  employee: EmployeeContext | null;
  business: BusinessContext | null;
  store: StoreContext | null;
  stores: StoreContext[];
  permissions: Set<string>;
}

function mapStore(row: StoreRow): StoreContext {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address,
    phone: row.phone,
    timezone: row.timezone,
    taxId: row.tax_id,
    receiptPrefix: row.receipt_prefix,
    isActive: row.is_active,
  };
}

export async function resolveUserContext(
  db: Db,
  user: SessionUser,
  storeIdHeader?: string,
): Promise<ResolvedContext> {
  const empty: ResolvedContext = {
    tenant: null,
    employee: null,
    business: null,
    store: null,
    stores: [],
    permissions: new Set(),
  };
  if (!user.tenantId) return empty;

  const tenantRow = await db.withTenant(user.tenantId, async (client) =>
    client.query<TenantRow>(
      `SELECT t.id, t.name, t.slug, t.status, t.onboarded_at, t.is_demo,
              s.status AS subscription_status,
              p.code AS plan_code, p.features,
              p.max_stores, p.max_employees
       FROM tenants t
       LEFT JOIN subscriptions s ON s.tenant_id = t.id
       LEFT JOIN subscription_plans p ON p.id = s.plan_id
       WHERE t.id = $1`,
      [user.tenantId],
    ),
  );
  const row = tenantRow.rows[0];
  if (!row) throw new NexoraError('AUTH_REQUIRED');
  if (row.status === 'suspended') throw new NexoraError('DOMAIN_SUBSCRIPTION_INACTIVE');

  const overrides = await db.withTenant(user.tenantId, async (client) =>
    client.query<{ feature_key: string; enabled: boolean }>(
      'SELECT feature_key, enabled FROM tenant_features WHERE tenant_id = $1',
      [user.tenantId],
    ),
  );
  const features: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(row.features ?? {})) features[key] = Boolean(value);
  for (const item of overrides.rows) features[item.feature_key] = item.enabled;

  const details = await db.withTenant(user.tenantId, async (client) => {
    const employee = await client.query<EmployeeRow>(
      `SELECT e.id, e.display_name, e.default_store_id, e.status,
              COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS role_codes,
              COALESCE(bool_or(r.scope = 'tenant'), false) AS tenant_scope
       FROM employees e
       LEFT JOIN employee_roles er ON er.employee_id = e.id AND er.tenant_id = e.tenant_id
       LEFT JOIN roles r ON r.id = er.role_id AND r.tenant_id = e.tenant_id
       WHERE e.user_id = $1 AND e.tenant_id = $2 AND e.status = 'active'
       GROUP BY e.id`,
      [user.id, user.tenantId],
    );
    const emp = employee.rows[0];
    if (!emp) {
      return {
        employee: null,
        permissions: new Set<string>(),
        businesses: [] as BusinessRow[],
        stores: [] as StoreRow[],
      };
    }

    const perms = await client.query<{ permission_code: string }>(
      `SELECT DISTINCT rp.permission_code
       FROM employee_roles er
       JOIN role_permissions rp ON rp.role_id = er.role_id AND rp.tenant_id = $2
       WHERE er.employee_id = $1`,
      [emp.id, user.tenantId],
    );

    const business = await client.query<BusinessRow>(
      `SELECT id, name, legal_name, tax_id, address, phone, email, currency, timezone,
              vat_rate_bp, prices_include_tax, receipt_prefix, receipt_footer,
              receipt_accent, receipt_logo_url, receipt_header_note,
              receipt_show_cashier, receipt_show_tax_id, receipt_paper_width,
              loyalty_earn_per_baht, point_value_satang, loyalty_redemption_enabled,
              offline_cash_enabled, discount_limit_bp, allow_negative_stock
       FROM businesses WHERE tenant_id = $1`,
      [user.tenantId],
    );

    const stores = await client.query<StoreRow>(
      `SELECT s.id, s.code, s.name, s.address, s.phone, s.timezone, s.tax_id, s.receipt_prefix, s.is_active
       FROM stores s
       WHERE s.tenant_id = $1
         AND (
           $2::boolean = true
           OR EXISTS (SELECT 1 FROM employee_stores es WHERE es.store_id = s.id AND es.employee_id = $3)
         )
       ORDER BY s.name`,
      [user.tenantId, emp.tenant_scope, emp.id],
    );

    return {
      employee: emp,
      permissions: new Set(perms.rows.map((r) => r.permission_code)),
      businesses: business.rows,
      stores: stores.rows,
    };
  });

  const tenant: TenantContext = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    onboardedAt: row.onboarded_at,
    isDemo: row.is_demo,
    planCode: row.plan_code ?? 'starter',
    subscriptionStatus: row.subscription_status ?? 'trialing',
    features,
    maxStores: row.max_stores ?? 1,
    maxEmployees: row.max_employees ?? 5,
  };

  const businessRow = details.businesses[0];
  const business: BusinessContext | null = businessRow
    ? {
        id: businessRow.id,
        name: businessRow.name,
        legalName: businessRow.legal_name,
        taxId: businessRow.tax_id,
        address: businessRow.address,
        phone: businessRow.phone,
        email: businessRow.email,
        currency: businessRow.currency,
        timezone: businessRow.timezone,
        vatRateBp: businessRow.vat_rate_bp,
        pricesIncludeTax: businessRow.prices_include_tax,
        receiptPrefix: businessRow.receipt_prefix,
        receiptFooter: businessRow.receipt_footer,
        receiptAccent: businessRow.receipt_accent,
        receiptLogoUrl: businessRow.receipt_logo_url,
        receiptHeaderNote: businessRow.receipt_header_note,
        receiptShowCashier: businessRow.receipt_show_cashier,
        receiptShowTaxId: businessRow.receipt_show_tax_id,
        receiptPaperWidth: businessRow.receipt_paper_width,
        loyaltyEarnPerBaht: businessRow.loyalty_earn_per_baht,
        pointValueSatang: businessRow.point_value_satang,
        loyaltyRedemptionEnabled: businessRow.loyalty_redemption_enabled,
        offlineCashEnabled: businessRow.offline_cash_enabled,
        discountLimitBp: businessRow.discount_limit_bp,
        allowNegativeStock: businessRow.allow_negative_stock,
      }
    : null;

  const stores = details.stores.map(mapStore);
  const empRow = details.employee;
  const employee: EmployeeContext | null = empRow
    ? {
        id: empRow.id,
        displayName: empRow.display_name,
        defaultStoreId: empRow.default_store_id,
        roleCodes: empRow.role_codes,
        tenantScope: empRow.tenant_scope,
        storeIds: stores.map((s) => s.id),
      }
    : null;

  let store: StoreContext | null = null;
  if (storeIdHeader) {
    store = stores.find((s) => s.id === storeIdHeader) ?? null;
    if (!store) throw new NexoraError('AUTH_STORE_FORBIDDEN');
  } else if (employee) {
    store =
      stores.find((s) => s.id === employee.defaultStoreId) ??
      stores[0] ??
      null;
  }

  return {
    tenant,
    employee,
    business,
    store,
    stores,
    permissions: details.permissions,
  };
}

export function createAuthMiddleware(db: Db) {
  return async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) throw new NexoraError('AUTH_REQUIRED');

    const sessionResult = await db.queryGlobal<SessionRow>(
      `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.email, u.name, u.locale,
              u.is_platform_admin, u.tenant_id, u.status AS user_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [sha256(token)],
    );
    const row = sessionResult.rows[0];
    if (!row) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      throw new NexoraError('AUTH_SESSION_EXPIRED');
    }
    if (row.user_status !== 'active') throw new NexoraError('AUTH_PERMISSION_DENIED');

    const user: SessionUser = {
      id: row.user_id,
      email: row.email,
      name: row.name,
      locale: row.locale,
      isPlatformAdmin: row.is_platform_admin,
      tenantId: row.tenant_id,
    };

    const storeHeader = typeof req.headers['x-store-id'] === 'string' ? req.headers['x-store-id'] : undefined;
    const resolved = await resolveUserContext(db, user, storeHeader);
    const correlationId = String(req.headers['x-request-id'] ?? '');

    const ctx: RequestContext = {
      correlationId,
      sessionId: row.session_id,
      user,
      employee: resolved.employee,
      tenant: resolved.tenant,
      business: resolved.business,
      store: resolved.store,
      stores: resolved.stores,
      permissions: resolved.permissions,
      withDb: async (fn) => {
        if (!user.tenantId) throw new NexoraError('AUTH_PERMISSION_DENIED');
        return db.withTenant(user.tenantId, fn);
      },
      withPlatform: async (fn) => {
        if (!user.isPlatformAdmin) throw new NexoraError('AUTH_PERMISSION_DENIED');
        return db.withPlatformAdmin(fn);
      },
    };
    req.ctx = ctx;

    void db
      .queryGlobal(
        `UPDATE sessions SET last_seen_at = now()
         WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'`,
        [row.session_id],
      )
      .catch(() => undefined);

    next();
  };
}

export function requirePermission(code: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.ctx?.permissions.has(code)) throw new NexoraError('AUTH_PERMISSION_DENIED');
    next();
  };
}

export function requireEmployee(req: Request, _res: Response, next: NextFunction): void {
  if (!req.ctx?.employee) throw new NexoraError('AUTH_PERMISSION_DENIED');
  next();
}

export function requireStore(req: Request, _res: Response, next: NextFunction): void {
  if (!req.ctx?.store) throw new NexoraError('AUTH_STORE_FORBIDDEN');
  next();
}

export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.ctx?.user.isPlatformAdmin) throw new NexoraError('AUTH_PERMISSION_DENIED');
  next();
}

export function assertStoreAccess(ctx: RequestContext, storeId: string): StoreContext {
  const store = ctx.stores.find((s) => s.id === storeId);
  if (!store) throw new NexoraError('AUTH_STORE_FORBIDDEN');
  return store;
}

export async function countStores(client: DbClient, tenantId: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    'SELECT count(*)::bigint AS count FROM stores WHERE tenant_id = $1 AND is_active',
    [tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}
