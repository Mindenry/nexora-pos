import { Router } from 'express';
import {
  NexoraError,
  cashMovementSchema,
  closeShiftSchema,
  listQuerySchema,
  openShiftSchema,
  uuidSchema,
} from '@nexora/shared';
import { requirePermission } from '../http/auth';
import { ok, created } from '../http/respond';
import { writeAudit } from '../services/audit';
import { runIdempotent } from '../services/idempotency';
import { getOpenShift, openShift, shiftSummary } from '../services/shifts';

export function shiftRoutes(): Router {
  const router = Router();

  router.get('/shifts/current', requirePermission('shifts.read'), async (req, res) => {
    const ctx = req.ctx;
    const data = await ctx.withDb(async (client) => {
      const shift = await getOpenShift(client, ctx.tenant!.id, ctx.store!.id, ctx.employee!.id);
      if (!shift) return null;
      return shiftSummary(client, ctx.tenant!.id, shift.id);
    });
    ok(res, data);
  });

  router.get('/shifts', requirePermission('shifts.read'), async (req, res) => {
    const ctx = req.ctx;
    const query = listQuerySchema.parse(req.query);
    const offset = (query.page - 1) * query.pageSize;
    const result = await ctx.withDb(async (client) => {
      const rows = await client.query(
        `SELECT s.id, s.status, s.opened_at, s.closed_at, s.opening_cash_satang,
                s.expected_cash_satang, s.counted_cash_satang, s.variance_satang,
                s.business_date, s.terminal_name, e.display_name AS employee_name,
                st.name AS store_name,
                (SELECT count(*)::bigint FROM sales sa WHERE sa.shift_id=s.id AND sa.status <> 'voided') AS sales_count,
                (SELECT COALESCE(sum(sa.total_satang),0)::bigint FROM sales sa WHERE sa.shift_id=s.id AND sa.status <> 'voided') AS sales_total
         FROM shifts s
         JOIN employees e ON e.id=s.employee_id
         JOIN stores st ON st.id=s.store_id
         WHERE s.tenant_id=$1 AND ($2::uuid IS NULL OR s.store_id=$2)
         ORDER BY s.opened_at DESC LIMIT $3 OFFSET $4`,
        [ctx.tenant!.id, ctx.store?.id ?? null, query.pageSize, offset],
      );
      const total = await client.query<{ count: number }>(
        `SELECT count(*)::bigint AS count FROM shifts WHERE tenant_id=$1 AND ($2::uuid IS NULL OR store_id=$2)`,
        [ctx.tenant!.id, ctx.store?.id ?? null],
      );
      return { rows: rows.rows, total: Number(total.rows[0]?.count ?? 0) };
    });
    ok(
      res,
      result.rows.map((r: any) => ({
        id: r.id,
        status: r.status,
        openedAt: r.opened_at,
        closedAt: r.closed_at,
        openingCashSatang: Number(r.opening_cash_satang),
        expectedCashSatang: r.expected_cash_satang != null ? Number(r.expected_cash_satang) : null,
        countedCashSatang: r.counted_cash_satang != null ? Number(r.counted_cash_satang) : null,
        varianceSatang: r.variance_satang != null ? Number(r.variance_satang) : null,
        businessDate: r.business_date,
        terminalName: r.terminal_name,
        employeeName: r.employee_name,
        storeName: r.store_name,
        salesCount: Number(r.sales_count),
        salesTotalSatang: Number(r.sales_total),
      })),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
      },
    );
  });

  router.get('/shifts/:id', requirePermission('shifts.read'), async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const ctx = req.ctx;
    const summary = await ctx.withDb((client) => shiftSummary(client, ctx.tenant!.id, id));
    ok(res, summary);
  });

  router.post('/shifts/open', requirePermission('shifts.open'), async (req, res) => {
    const input = openShiftSchema.parse(req.body);
    const ctx = req.ctx;
    const summary = await ctx.withDb(async (client) => {
      const shift = await openShift(client, {
        tenantId: ctx.tenant!.id,
        storeId: ctx.store!.id,
        employeeId: ctx.employee!.id,
        userId: ctx.user.id,
        timezone: ctx.store!.timezone,
        openingCashSatang: input.openingCashSatang,
        terminalName: input.terminalName ?? '',
      });
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        storeId: ctx.store!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'shift.opened',
        entityType: 'shift',
        entityId: shift.id,
        after: { openingCashSatang: input.openingCashSatang, businessDate: shift.business_date },
        correlationId: ctx.correlationId,
      });
      return shiftSummary(client, ctx.tenant!.id, shift.id);
    });
    created(res, summary);
  });

  router.post('/shifts/close', requirePermission('shifts.close'), async (req, res) => {
    const input = closeShiftSchema.parse(req.body);
    const ctx = req.ctx;
    const summary = await ctx.withDb(async (client) => {
      const shift = await getOpenShift(client, ctx.tenant!.id, ctx.store!.id, ctx.employee!.id);
      if (!shift) throw new NexoraError('DOMAIN_SHIFT_NOT_OPEN');
      const locked = await client.query(
        'SELECT id FROM shifts WHERE id=$1 FOR UPDATE',
        [shift.id],
      );
      if (!locked.rowCount) throw new NexoraError('DOMAIN_SHIFT_CLOSED');

      const before = await shiftSummary(client, ctx.tenant!.id, shift.id);
      if (before.pendingPayments > 0) throw new NexoraError('DOMAIN_SHIFT_PENDING_PAYMENTS');

      const variance = input.countedCashSatang - before.expectedCashSatang;
      await client.query(
        `UPDATE shifts SET status='closed', closed_at=now(), expected_cash_satang=$1,
           counted_cash_satang=$2, variance_satang=$3, closing_note=$4
         WHERE id=$5`,
        [before.expectedCashSatang, input.countedCashSatang, variance, input.note || '', shift.id],
      );
      await writeAudit(client, {
        tenantId: ctx.tenant!.id,
        storeId: ctx.store!.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
        action: 'shift.closed',
        entityType: 'shift',
        entityId: shift.id,
        before: { expectedCashSatang: before.expectedCashSatang },
        after: { countedCashSatang: input.countedCashSatang, variance, note: input.note ?? '' },
        correlationId: ctx.correlationId,
      });
      if (variance !== 0) {
        await client.query(
          `INSERT INTO notifications (tenant_id, store_id, type, severity, title, body, link)
           VALUES ($1,$2,'cash_variance','warning',$3,$4,$5)`,
          [
            ctx.tenant!.id,
            ctx.store!.id,
            'ปิดกะแล้วมีผลต่างเงินสด',
            `ผลต่าง ${(variance / 100).toFixed(2)} บาท โดย ${ctx.employee!.displayName}`,
            '/shifts',
          ],
        );
      }
      return shiftSummary(client, ctx.tenant!.id, shift.id);
    });
    ok(res, summary);
  });

  router.post('/shifts/cash-movements', requirePermission('shifts.cash'), async (req, res) => {
    const input = cashMovementSchema.parse(req.body);
    const ctx = req.ctx;
    const result = await ctx.withDb(async (client) => {
      const data = await runIdempotent(
        client,
        {
          tenantId: ctx.tenant!.id,
          operationId: input.operationId,
          scope: 'shift.cash_movement',
          payload: input,
        },
        async () => {
          const shift = await getOpenShift(client, ctx.tenant!.id, ctx.store!.id, ctx.employee!.id);
          if (!shift) throw new NexoraError('DOMAIN_SHIFT_NOT_OPEN');
          const signed =
            input.type === 'cash_in'
              ? input.amountSatang
              : -input.amountSatang;
          await client.query(
            `INSERT INTO cash_movements
              (tenant_id, store_id, shift_id, employee_id, type, amount_satang, reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              ctx.tenant!.id,
              ctx.store!.id,
              shift.id,
              ctx.employee!.id,
              input.type,
              signed,
              input.reason,
            ],
          );
          await writeAudit(client, {
            tenantId: ctx.tenant!.id,
            storeId: ctx.store!.id,
            actorUserId: ctx.user.id,
            actorName: ctx.user.name,
            action: `shift.${input.type}`,
            entityType: 'shift',
            entityId: shift.id,
            after: { amountSatang: signed, reason: input.reason },
            correlationId: ctx.correlationId,
          });
          const summary = await shiftSummary(client, ctx.tenant!.id, shift.id);
          return { expectedCashSatang: summary.expectedCashSatang };
        },
      );
      return data.data;
    });
    created(res, result);
  });

  return router;
}
