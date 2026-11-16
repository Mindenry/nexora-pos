import { Router } from 'express';
import { requirePermission } from '../http/auth';
import { ok } from '../http/respond';

type CheckStatus = 'ok' | 'warning' | 'critical' | 'info';

export function systemRoutes(): Router {
  const router = Router();

  router.get('/system/health', requirePermission('settings.manage'), async (req, res) => {
    const started = Date.now();
    const ctx = req.ctx;
    const data = await ctx.withDb(async (client) => {
      const dbStarted = Date.now();
      await client.query('SELECT 1');
      const dbLatencyMs = Date.now() - dbStarted;

      const stats = await client.query<{
        pending_sessions: number;
        paid_unlinked: number;
        expired_sessions: number;
        rejected_events: number;
        accounts: number;
        provider_active: boolean | null;
        provider_auto: boolean | null;
        provider_last_event: string | null;
        open_shifts: number;
        sales_today: number;
        db_size: number;
        low_stock: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM payment_sessions WHERE tenant_id=$1 AND status='pending') AS pending_sessions,
           (SELECT count(*)::int FROM payment_sessions WHERE tenant_id=$1 AND status='paid' AND sale_id IS NULL) AS paid_unlinked,
           (SELECT count(*)::int FROM payment_sessions WHERE tenant_id=$1 AND status='expired') AS expired_sessions,
           (SELECT count(*)::int FROM payment_webhook_events WHERE tenant_id=$1 AND status='rejected' AND created_at > now() - interval '24 hours') AS rejected_events,
           (SELECT count(*)::int FROM promptpay_accounts WHERE tenant_id=$1 AND is_active AND deleted_at IS NULL) AS accounts,
           (SELECT is_active FROM payment_provider_configs WHERE tenant_id=$1 AND store_id IS NULL LIMIT 1) AS provider_active,
           (SELECT auto_confirm FROM payment_provider_configs WHERE tenant_id=$1 AND store_id IS NULL LIMIT 1) AS provider_auto,
           (SELECT last_event_at::text FROM payment_provider_configs WHERE tenant_id=$1 AND store_id IS NULL LIMIT 1) AS provider_last_event,
           (SELECT count(*)::int FROM shifts WHERE tenant_id=$1 AND status='open') AS open_shifts,
           (SELECT count(*)::int FROM sales WHERE tenant_id=$1 AND business_date = (now() AT TIME ZONE 'Asia/Bangkok')::date) AS sales_today,
           pg_database_size(current_database()) AS db_size,
           (SELECT count(*)::int FROM (
             SELECT m.variant_id
             FROM inventory_movements m
             JOIN product_variants v ON v.id=m.variant_id
             JOIN products p ON p.id=v.product_id
             WHERE m.tenant_id=$1 AND p.track_inventory
             GROUP BY m.variant_id, p.reorder_point
             HAVING sum(m.qty_delta) <= p.reorder_point
           ) low) AS low_stock`,
        [ctx.tenant!.id],
      );
      const row = stats.rows[0]!;
      const checks: Array<{ key: string; labelTh: string; labelEn: string; status: CheckStatus; detail: string }> = [];

      checks.push({
        key: 'database',
        labelTh: 'ฐานข้อมูล',
        labelEn: 'Database',
        status: dbLatencyMs < 500 ? 'ok' : 'warning',
        detail: `${dbLatencyMs} ms`,
      });
      checks.push({
        key: 'promptpay_account',
        labelTh: 'บัญชีพร้อมเพย์',
        labelEn: 'PromptPay account',
        status: Number(row.accounts) > 0 ? 'ok' : 'warning',
        detail:
          Number(row.accounts) > 0
            ? `${row.accounts} active`
            : 'ยังไม่มีบัญชีรับเงิน',
      });
      checks.push({
        key: 'provider',
        labelTh: 'ผู้ให้บริการตรวจเงินเข้า',
        labelEn: 'Settlement provider',
        status: row.provider_active ? 'ok' : 'warning',
        detail: row.provider_active
          ? row.provider_auto
            ? 'เปิดใช้งาน + ยืนยันอัตโนมัติ'
            : 'เปิดใช้งาน แต่ยังไม่ยืนยันอัตโนมัติ'
          : 'ยังไม่เปิดใช้งาน (manual mode)',
      });
      checks.push({
        key: 'pending',
        labelTh: 'QR รอยืนยัน',
        labelEn: 'Pending QR sessions',
        status: Number(row.pending_sessions) > 0 ? 'info' : 'ok',
        detail: `${row.pending_sessions} pending`,
      });
      checks.push({
        key: 'paid_unlinked',
        labelTh: 'รับเงินแล้วแต่ยังไม่ผูกบิล',
        labelEn: 'Paid but unlinked',
        status: Number(row.paid_unlinked) > 0 ? 'critical' : 'ok',
        detail: `${row.paid_unlinked} sessions`,
      });
      checks.push({
        key: 'webhook_rejected',
        labelTh: 'Webhook ถูกปฏิเสธ 24 ชม.',
        labelEn: 'Rejected webhooks (24h)',
        status: Number(row.rejected_events) > 0 ? 'warning' : 'ok',
        detail: `${row.rejected_events} rejected`,
      });
      checks.push({
        key: 'low_stock',
        labelTh: 'สินค้าใกล้หมด',
        labelEn: 'Low stock',
        status: Number(row.low_stock) > 0 ? 'warning' : 'ok',
        detail: `${row.low_stock ?? 0} variants`,
      });

      const status = checks.some((c) => c.status === 'critical')
        ? 'critical'
        : checks.some((c) => c.status === 'warning')
          ? 'warning'
          : 'ok';

      return {
        status,
        checkedAt: new Date().toISOString(),
        api: {
          uptimeSeconds: Math.round(process.uptime()),
          nodeVersion: process.version,
          memoryUsedBytes: process.memoryUsage().rss,
        },
        database: {
          latencyMs: dbLatencyMs,
          sizeBytes: Number(row.db_size),
        },
        counts: {
          pendingSessions: Number(row.pending_sessions),
          paidUnlinked: Number(row.paid_unlinked),
          expiredSessions: Number(row.expired_sessions),
          rejectedWebhookEvents: Number(row.rejected_events),
          promptPayAccounts: Number(row.accounts),
          openShifts: Number(row.open_shifts),
          salesToday: Number(row.sales_today),
          lowStockVariants: Number(row.low_stock ?? 0),
        },
        integrations: {
          promptPay: {
            providerActive: row.provider_active ?? false,
            autoConfirm: row.provider_auto ?? false,
            lastEventAt: row.provider_last_event,
          },
        },
        checks,
      };
    });
    ok(res, data, { durationMs: Date.now() - started });
  });

  return router;
}
