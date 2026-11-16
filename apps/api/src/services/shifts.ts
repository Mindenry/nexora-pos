import type { DbClient } from '@nexora/db';
import { NexoraError, businessDateOf } from '@nexora/shared';

export interface ShiftRow {
  id: string;
  store_id: string;
  employee_id: string;
  terminal_name: string;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  opening_cash_satang: number;
  expected_cash_satang: number | null;
  counted_cash_satang: number | null;
  variance_satang: number | null;
  closing_note: string;
  business_date: string;
}

export interface ShiftSummary {
  shift: ShiftRow;
  salesCount: number;
  salesTotalSatang: number;
  salesSubtotalSatang: number;
  discountSatang: number;
  taxSatang: number;
  refundTotalSatang: number;
  cashSalesSatang: number;
  cashInSatang: number;
  cashOutSatang: number;
  openingCashSatang: number;
  expectedCashSatang: number;
  countedCashSatang: number | null;
  varianceSatang: number | null;
  pendingPayments: number;
  payments: Array<{ method: string; methodName: string; count: number; amountSatang: number }>;
  topItems: Array<{ name: string; qty: number; amountSatang: number }>;
}

export async function getOpenShift(
  client: DbClient,
  tenantId: string,
  storeId: string,
  employeeId: string,
): Promise<ShiftRow | null> {
  const result = await client.query<ShiftRow>(
    `SELECT * FROM shifts
     WHERE tenant_id=$1 AND store_id=$2 AND employee_id=$3 AND status='open'`,
    [tenantId, storeId, employeeId],
  );
  return result.rows[0] ?? null;
}

export async function shiftSummary(
  client: DbClient,
  tenantId: string,
  shiftId: string,
): Promise<ShiftSummary> {
  const shiftResult = await client.query<ShiftRow>(
    'SELECT * FROM shifts WHERE tenant_id=$1 AND id=$2',
    [tenantId, shiftId],
  );
  const shift = shiftResult.rows[0];
  if (!shift) throw new NexoraError('NOT_FOUND');

  const stats = await client.query<{
    sales_count: number;
    sales_total: number;
    sales_subtotal: number;
    discount: number;
    tax: number;
    refund_total: number;
  }>(
    `SELECT
       (SELECT count(*)::bigint FROM sales WHERE tenant_id=$1 AND shift_id=$2 AND status <> 'voided') AS sales_count,
       (SELECT COALESCE(sum(total_satang),0)::bigint FROM sales WHERE tenant_id=$1 AND shift_id=$2 AND status <> 'voided') AS sales_total,
       (SELECT COALESCE(sum(subtotal_satang),0)::bigint FROM sales WHERE tenant_id=$1 AND shift_id=$2 AND status <> 'voided') AS sales_subtotal,
       (SELECT COALESCE(sum(discount_satang),0)::bigint FROM sales WHERE tenant_id=$1 AND shift_id=$2 AND status <> 'voided') AS discount,
       (SELECT COALESCE(sum(tax_satang),0)::bigint FROM sales WHERE tenant_id=$1 AND shift_id=$2 AND status <> 'voided') AS tax,
       (SELECT COALESCE(sum(amount_satang),0)::bigint FROM refunds WHERE tenant_id=$1 AND shift_id=$2 AND status='completed') AS refund_total`,
    [tenantId, shiftId],
  );
  const row = stats.rows[0]!;

  const cash = await client.query<{
    opening: number;
    cash_in: number;
    cash_out: number;
    sale_cash: number;
    refund_cash: number;
  }>(
    `SELECT
       COALESCE(sum(amount_satang) FILTER (WHERE type='opening'),0)::bigint AS opening,
       COALESCE(sum(amount_satang) FILTER (WHERE type='cash_in'),0)::bigint AS cash_in,
       COALESCE(sum(amount_satang) FILTER (WHERE type IN ('cash_out','safe_drop')),0)::bigint AS cash_out,
       COALESCE(sum(amount_satang) FILTER (WHERE type='sale_cash'),0)::bigint AS sale_cash,
       COALESCE(sum(amount_satang) FILTER (WHERE type='refund_cash'),0)::bigint AS refund_cash
     FROM cash_movements WHERE tenant_id=$1 AND shift_id=$2`,
    [tenantId, shiftId],
  );
  const cashRow = cash.rows[0]!;
  const expected =
    Number(cashRow.opening) +
    Number(cashRow.cash_in) +
    Number(cashRow.cash_out) +
    Number(cashRow.sale_cash) +
    Number(cashRow.refund_cash);

  const pending = await client.query<{ count: number }>(
    `SELECT count(*)::bigint AS count FROM payments p
     JOIN sales s ON s.id=p.sale_id
     WHERE s.tenant_id=$1 AND s.shift_id=$2 AND p.status='pending'`,
    [tenantId, shiftId],
  );

  const payments = await client.query<{
    method: string;
    method_name: string;
    count: number;
    amount: number;
  }>(
    `SELECT p.method, max(p.method_name) AS method_name, count(*)::bigint AS count,
            COALESCE(sum(p.amount_satang),0)::bigint AS amount
     FROM payments p JOIN sales s ON s.id=p.sale_id
     WHERE s.tenant_id=$1 AND s.shift_id=$2 AND p.status IN ('paid','partially_refunded','refunded')
     GROUP BY p.method ORDER BY amount DESC`,
    [tenantId, shiftId],
  );

  const topItems = await client.query<{ name: string; qty: number; amount: number }>(
    `SELECT si.product_name AS name, sum(si.qty)::bigint AS qty,
            sum(si.line_total_satang)::bigint AS amount
     FROM sale_items si JOIN sales s ON s.id=si.sale_id
     WHERE s.tenant_id=$1 AND s.shift_id=$2 AND s.status <> 'voided'
     GROUP BY si.product_name ORDER BY amount DESC LIMIT 5`,
    [tenantId, shiftId],
  );

  return {
    shift,
    salesCount: Number(row.sales_count),
    salesTotalSatang: Number(row.sales_total),
    salesSubtotalSatang: Number(row.sales_subtotal),
    discountSatang: Number(row.discount),
    taxSatang: Number(row.tax),
    refundTotalSatang: Number(row.refund_total),
    openingCashSatang: Number(cashRow.opening),
    cashSalesSatang: Number(cashRow.sale_cash),
    cashInSatang: Number(cashRow.cash_in),
    cashOutSatang: Number(cashRow.cash_out),
    expectedCashSatang: expected,
    countedCashSatang: shift.counted_cash_satang != null ? Number(shift.counted_cash_satang) : null,
    varianceSatang: shift.variance_satang != null ? Number(shift.variance_satang) : null,
    pendingPayments: Number(pending.rows[0]?.count ?? 0),
    payments: payments.rows.map((p) => ({
      method: p.method,
      methodName: p.method_name,
      count: Number(p.count),
      amountSatang: Number(p.amount),
    })),
    topItems: topItems.rows.map((i) => ({
      name: i.name,
      qty: Number(i.qty),
      amountSatang: Number(i.amount),
    })),
  };
}

export async function openShift(
  client: DbClient,
  params: {
    tenantId: string;
    storeId: string;
    employeeId: string;
    userId: string;
    timezone: string;
    openingCashSatang: number;
    terminalName: string;
  },
): Promise<ShiftRow> {
  const existing = await getOpenShift(client, params.tenantId, params.storeId, params.employeeId);
  if (existing) throw new NexoraError('DOMAIN_SHIFT_ALREADY_OPEN');
  const businessDate = businessDateOf(new Date(), params.timezone);
  const result = await client.query<ShiftRow>(
    `INSERT INTO shifts
      (tenant_id, store_id, employee_id, terminal_name, opening_cash_satang, business_date)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      params.tenantId,
      params.storeId,
      params.employeeId,
      params.terminalName,
      params.openingCashSatang,
      businessDate,
    ],
  );
  const shift = result.rows[0]!;
  if (params.openingCashSatang > 0) {
    await client.query(
      `INSERT INTO cash_movements
        (tenant_id, store_id, shift_id, employee_id, type, amount_satang, reason)
       VALUES ($1,$2,$3,$4,'opening',$5,'Opening float')`,
      [params.tenantId, params.storeId, shift.id, params.employeeId, params.openingCashSatang],
    );
  }
  return shift;
}
