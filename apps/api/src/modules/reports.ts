import { Router } from 'express';
import { z } from 'zod';
import {
  NexoraError,
  dateStringSchema,
  presetRange,
  type DatePreset,
} from '@nexora/shared';
import { requirePermission } from '../http/auth';
import { csv, ok } from '../http/respond';
import {
  inventoryReport,
  profitReport,
  salesReport,
  taxReport,
  type ReportScope,
} from '../services/reports';

const presetSchema = z
  .enum(['today', 'yesterday', 'last7', 'last30', 'this_month', 'custom'])
  .optional();

function cleanCsv(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportRoutes(): Router {
  const router = Router();

  function scope(req: any, defaultPreset: DatePreset): ReportScope {
    const ctx = req.ctx;
    const store = ctx.store;
    if (!store) throw new NexoraError('AUTH_STORE_FORBIDDEN');
    const preset = presetSchema.parse(req.query.preset);
    let from: string;
    let to: string;
    if (req.query.from || req.query.to) {
      from = dateStringSchema.parse(req.query.from);
      to = dateStringSchema.parse(req.query.to);
    } else {
      const range = presetRange(preset ?? defaultPreset, new Date(), store.timezone);
      from = range.from;
      to = range.to;
    }
    if (from > to) throw new NexoraError('VALIDATION_FAILED', { field: 'from' });
    return {
      tenantId: ctx.tenant.id,
      storeId: store.id,
      from,
      to,
      accessibleStoreIds: ctx.stores.map((s: { id: string }) => s.id),
    };
  }

  router.get('/reports/dashboard', requirePermission('reports.view'), async (req, res) => {
    const ctx = req.ctx;
    const reportScope = scope(req, 'last7');
    const data = await ctx.withDb((client) => salesReport(client, reportScope));
    ok(res, {
      ...data,
      range: { from: reportScope.from, to: reportScope.to },
      store: ctx.store,
    });
  });

  router.get('/reports/sales', requirePermission('reports.view'), async (req, res) => {
    const ctx = req.ctx;
    const reportScope = scope(req, 'last30');
    const data = await ctx.withDb((client) => salesReport(client, reportScope));
    ok(res, { ...data, range: { from: reportScope.from, to: reportScope.to } });
  });

  router.get('/reports/profit', requirePermission('reports.view'), async (req, res) => {
    const ctx = req.ctx;
    const reportScope = scope(req, 'last30');
    const data = await ctx.withDb((client) => profitReport(client, reportScope));
    ok(res, { ...data, range: { from: reportScope.from, to: reportScope.to } });
  });

  router.get('/reports/tax', requirePermission('reports.view'), async (req, res) => {
    const ctx = req.ctx;
    const reportScope = scope(req, 'this_month');
    const data = await ctx.withDb((client) => taxReport(client, reportScope));
    ok(res, { ...data, range: { from: reportScope.from, to: reportScope.to } });
  });

  router.get('/reports/inventory', requirePermission('reports.view'), async (req, res) => {
    const ctx = req.ctx;
    const reportScope = scope(req, 'today');
    const data = await ctx.withDb((client) => inventoryReport(client, reportScope));
    ok(res, data);
  });

  router.get('/reports/sales/export.csv', requirePermission('reports.export'), async (req, res) => {
    const ctx = req.ctx;
    const reportScope = scope(req, 'last30');
    const rows = await ctx.withDb((client) =>
      client.query(
        `SELECT s.number, s.business_date, s.occurred_at, s.status,
                e.display_name AS cashier, COALESCE(c.name,'') AS customer,
                s.subtotal_satang, s.discount_satang, s.tax_satang, s.total_satang,
                s.refunded_satang,
                (SELECT string_agg(DISTINCT p.method, '|') FROM payments p WHERE p.sale_id=s.id) AS methods
         FROM sales s
         JOIN employees e ON e.id=s.employee_id
         LEFT JOIN customers c ON c.id=s.customer_id
         WHERE s.tenant_id=$1 AND s.store_id=$2 AND s.business_date BETWEEN $3 AND $4
         ORDER BY s.business_date, s.number`,
        [reportScope.tenantId, reportScope.storeId, reportScope.from, reportScope.to],
      ),
    );
    const header = 'number,business_date,time,status,cashier,customer,subtotal,discount,tax,total,refunded,methods';
    const lines = rows.rows.map((r: any) =>
      [
        r.number,
        r.business_date,
        new Date(r.occurred_at).toISOString(),
        r.status,
        r.cashier,
        r.customer,
        (Number(r.subtotal_satang) / 100).toFixed(2),
        (Number(r.discount_satang) / 100).toFixed(2),
        (Number(r.tax_satang) / 100).toFixed(2),
        (Number(r.total_satang) / 100).toFixed(2),
        (Number(r.refunded_satang) / 100).toFixed(2),
        r.methods ?? '',
      ]
        .map(cleanCsv)
        .join(','),
    );
    csv(res, `nexora-sales-${reportScope.from}-${reportScope.to}.csv`, [header, ...lines].join('\n'));
  });

  return router;
}
