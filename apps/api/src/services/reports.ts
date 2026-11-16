import type { DbClient } from '@nexora/db';
import { addDays, divRoundHalfUp } from '@nexora/shared';

export interface ReportScope {
  tenantId: string;
  storeId: string;
  from: string;
  to: string;
  accessibleStoreIds: string[];
}

export async function salesReport(client: DbClient, scope: ReportScope) {
  const { tenantId, storeId, from, to } = scope;

  const totalsResult = await client.query<{
    orders: number;
    gross: number;
    discounts: number;
    tax: number;
    cost: number;
    items: number;
  }>(
    `SELECT count(*)::bigint AS orders,
            COALESCE(sum(total_satang),0)::bigint AS gross,
            COALESCE(sum(discount_satang),0)::bigint AS discounts,
            COALESCE(sum(tax_satang),0)::bigint AS tax,
            COALESCE(sum(cost_satang),0)::bigint AS cost,
            COALESCE(sum(item_count),0)::bigint AS items
     FROM sales
     WHERE tenant_id=$1 AND store_id=$2 AND business_date BETWEEN $3 AND $4 AND status <> 'voided'`,
    [tenantId, storeId, from, to],
  );
  const totals = totalsResult.rows[0]!;

  const refundsResult = await client.query<{ amount: number; cost: number; tax: number }>(
    `SELECT COALESCE(sum(amount_satang),0)::bigint AS amount,
            COALESCE(sum(cost_satang),0)::bigint AS cost,
            COALESCE(sum(tax_satang),0)::bigint AS tax
     FROM refunds
     WHERE tenant_id=$1 AND store_id=$2 AND business_date BETWEEN $3 AND $4 AND status='completed'`,
    [tenantId, storeId, from, to],
  );
  const refunds = refundsResult.rows[0]!;
  const refundQtyResult = await client.query<{ qty: number }>(
    `SELECT COALESCE(sum(ri.qty),0)::bigint AS qty
     FROM refund_items ri JOIN refunds rf ON rf.id=ri.refund_id
     WHERE rf.tenant_id=$1 AND rf.store_id=$2 AND rf.business_date BETWEEN $3 AND $4 AND rf.status='completed'`,
    [tenantId, storeId, from, to],
  );

  const gross = Number(totals.gross);
  const refundTotal = Number(refunds.amount);
  const tax = Number(totals.tax);
  const refundTax = Number(refunds.tax);
  const netSales = gross - refundTotal;
  const netTax = tax - refundTax;
  const revenueExTax = netSales - netTax;
  const cogs = Number(totals.cost) - Number(refunds.cost);
  const grossProfit = revenueExTax - cogs;
  const orders = Number(totals.orders);

  const trendResult = await client.query<{ date: string; sales: number; orders: number }>(
    `SELECT business_date::text AS date, COALESCE(sum(total_satang),0)::bigint AS sales, count(*)::bigint AS orders
     FROM sales WHERE tenant_id=$1 AND store_id=$2 AND business_date BETWEEN $3 AND $4 AND status <> 'voided'
     GROUP BY business_date ORDER BY business_date`,
    [tenantId, storeId, from, to],
  );
  const trendMap = new Map(trendResult.rows.map((r) => [r.date, r]));
  const trend: Array<{ date: string; salesSatang: number; orders: number }> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const row = trendMap.get(d);
    trend.push({ date: d, salesSatang: Number(row?.sales ?? 0), orders: Number(row?.orders ?? 0) });
  }

  const topResult = await client.query<{ name: string; qty: number; revenue: number }>(
    `WITH refunded AS (
       SELECT ri.sale_item_id, sum(ri.amount_satang)::bigint AS amount, sum(ri.qty)::bigint AS qty
       FROM refund_items ri JOIN refunds rf ON rf.id=ri.refund_id
       WHERE rf.tenant_id=$1 AND rf.store_id=$2 AND rf.business_date BETWEEN $3 AND $4 AND rf.status='completed'
       GROUP BY ri.sale_item_id
     )
     SELECT si.product_name AS name,
            sum(si.qty - COALESCE(r.qty,0))::bigint AS qty,
            sum(si.line_total_satang - COALESCE(r.amount,0))::bigint AS revenue
     FROM sale_items si
     JOIN sales s ON s.id=si.sale_id
     LEFT JOIN refunded r ON r.sale_item_id=si.id
     WHERE s.tenant_id=$1 AND s.store_id=$2 AND s.business_date BETWEEN $3 AND $4 AND s.status <> 'voided'
     GROUP BY si.product_name ORDER BY revenue DESC LIMIT 8`,
    [tenantId, storeId, from, to],
  );

  const paymentResult = await client.query<{
    method: string;
    method_name: string;
    amount: number;
    count: number;
  }>(
    `SELECT p.method, max(p.method_name) AS method_name,
            COALESCE(sum(p.amount_satang),0)::bigint AS amount, count(*)::bigint AS count
     FROM payments p JOIN sales s ON s.id=p.sale_id
     WHERE s.tenant_id=$1 AND s.store_id=$2 AND s.business_date BETWEEN $3 AND $4
       AND s.status <> 'voided' AND p.status IN ('paid','partially_refunded','refunded')
     GROUP BY p.method ORDER BY amount DESC`,
    [tenantId, storeId, from, to],
  );

  const categoryResult = await client.query<{ category: string; amount: number }>(
    `SELECT COALESCE(c.name, 'ไม่ระบุหมวด') AS category,
            COALESCE(sum(si.line_total_satang - si.tax_satang),0)::bigint AS amount
     FROM sale_items si
     JOIN sales s ON s.id=si.sale_id
     JOIN product_variants v ON v.id=si.variant_id
     JOIN products p ON p.id=v.product_id
     LEFT JOIN categories c ON c.id=p.category_id
     WHERE s.tenant_id=$1 AND s.store_id=$2 AND s.business_date BETWEEN $3 AND $4 AND s.status <> 'voided'
     GROUP BY c.name ORDER BY amount DESC LIMIT 10`,
    [tenantId, storeId, from, to],
  );

  const employeeResult = await client.query<{ name: string; sales: number; orders: number }>(
    `SELECT e.display_name AS name, COALESCE(sum(s.total_satang),0)::bigint AS sales, count(*)::bigint AS orders
     FROM sales s JOIN employees e ON e.id=s.employee_id
     WHERE s.tenant_id=$1 AND s.store_id=$2 AND s.business_date BETWEEN $3 AND $4 AND s.status <> 'voided'
     GROUP BY e.display_name ORDER BY sales DESC`,
    [tenantId, storeId, from, to],
  );

  const branchResult = await client.query<{
    store_id: string;
    name: string;
    sales: number;
    orders: number;
  }>(
    `SELECT s.store_id, st.name, COALESCE(sum(s.total_satang),0)::bigint AS sales, count(*)::bigint AS orders
     FROM sales s JOIN stores st ON st.id=s.store_id
     WHERE s.tenant_id=$1 AND s.store_id = ANY($2::uuid[])
       AND s.business_date BETWEEN $3 AND $4 AND s.status <> 'voided'
     GROUP BY s.store_id, st.name ORDER BY sales DESC`,
    [tenantId, scope.accessibleStoreIds, from, to],
  );

  const recentResult = await client.query<{
    id: string;
    number: string;
    total: number;
    status: string;
    occurred_at: string;
    customer_name: string | null;
    employee_name: string;
  }>(
    `SELECT s.id, s.number, s.total_satang AS total, s.status, s.occurred_at,
            c.name AS customer_name, e.display_name AS employee_name
     FROM sales s JOIN employees e ON e.id=s.employee_id
     LEFT JOIN customers c ON c.id=s.customer_id
     WHERE s.tenant_id=$1 AND s.store_id=$2
     ORDER BY s.occurred_at DESC LIMIT 6`,
    [tenantId, storeId],
  );

  const lowStockResult = await client.query<{
    product_name: string;
    sku: string | null;
    on_hand: number;
    reorder_point: number;
  }>(
    `SELECT p.name AS product_name, v.sku,
            COALESCE(st.on_hand,0)::bigint AS on_hand, p.reorder_point
     FROM product_variants v
     JOIN products p ON p.id=v.product_id
     LEFT JOIN v_stock_on_hand st ON st.variant_id=v.id AND st.store_id=$2
     WHERE v.tenant_id=$1 AND v.status='active' AND p.status='active' AND p.track_inventory
       AND COALESCE(st.on_hand,0) <= p.reorder_point
     ORDER BY on_hand ASC LIMIT 8`,
    [tenantId, storeId],
  );

  return {
    kpis: {
      grossSalesSatang: gross,
      netSalesSatang: netSales,
      refundsSatang: refundTotal,
      discountsSatang: Number(totals.discounts),
      taxSatang: netTax,
      revenueExTaxSatang: revenueExTax,
      cogsSatang: cogs,
      grossProfitSatang: grossProfit,
      orders,
      aovSatang: orders > 0 ? divRoundHalfUp(netSales, orders) : 0,
      itemsSold: Number(totals.items) - Number(refundQtyResult.rows[0]?.qty ?? 0),
    },
    trend,
    topProducts: topResult.rows.map((r) => ({
      name: r.name,
      qty: Number(r.qty),
      revenueSatang: Number(r.revenue),
    })),
    paymentBreakdown: paymentResult.rows.map((r) => ({
      method: r.method,
      methodName: r.method_name,
      amountSatang: Number(r.amount),
      count: Number(r.count),
    })),
    categoryBreakdown: categoryResult.rows.map((r) => ({
      category: r.category,
      amountSatang: Number(r.amount),
    })),
    employeeBreakdown: employeeResult.rows.map((r) => ({
      name: r.name,
      salesSatang: Number(r.sales),
      orders: Number(r.orders),
    })),
    branches: branchResult.rows.map((r) => ({
      storeId: r.store_id,
      name: r.name,
      salesSatang: Number(r.sales),
      orders: Number(r.orders),
    })),
    recentSales: recentResult.rows.map((r) => ({
      id: r.id,
      number: r.number,
      totalSatang: Number(r.total),
      status: r.status,
      occurredAt: r.occurred_at,
      customerName: r.customer_name,
      employeeName: r.employee_name,
    })),
    lowStock: lowStockResult.rows.map((r) => ({
      productName: r.product_name,
      sku: r.sku,
      onHand: Number(r.on_hand),
      reorderPoint: r.reorder_point,
    })),
  };
}

export async function profitReport(client: DbClient, scope: ReportScope) {
  const result = await client.query<{
    name: string;
    sku: string | null;
    qty: number;
    revenue: number;
    cogs: number;
  }>(
    `WITH refunded AS (
       SELECT ri.sale_item_id,
              sum(ri.amount_satang)::bigint AS amount,
              sum(ri.cost_satang)::bigint AS cost,
              sum(ri.qty)::bigint AS qty
       FROM refund_items ri JOIN refunds rf ON rf.id=ri.refund_id
       WHERE rf.tenant_id=$1 AND rf.store_id=$2 AND rf.business_date BETWEEN $3 AND $4 AND rf.status='completed'
       GROUP BY ri.sale_item_id
     )
     SELECT si.product_name AS name, max(si.sku) AS sku,
            sum(si.qty - COALESCE(r.qty,0))::bigint AS qty,
            sum(si.line_total_satang - si.tax_satang - COALESCE(r.amount,0))::bigint AS revenue,
            sum(si.cost_satang - COALESCE(r.cost,0))::bigint AS cogs
     FROM sale_items si
     JOIN sales s ON s.id=si.sale_id
     LEFT JOIN refunded r ON r.sale_item_id=si.id
     WHERE s.tenant_id=$1 AND s.store_id=$2 AND s.business_date BETWEEN $3 AND $4 AND s.status <> 'voided'
     GROUP BY si.product_name
     ORDER BY (sum(si.line_total_satang - si.tax_satang - COALESCE(r.amount,0)) - sum(si.cost_satang - COALESCE(r.cost,0))) DESC
     LIMIT 100`,
    [scope.tenantId, scope.storeId, scope.from, scope.to],
  );

  const items = result.rows.map((r) => {
    const revenue = Number(r.revenue);
    const cogs = Number(r.cogs);
    const profit = revenue - cogs;
    return {
      name: r.name,
      sku: r.sku,
      qty: Number(r.qty),
      revenueSatang: revenue,
      cogsSatang: cogs,
      profitSatang: profit,
      marginBp: revenue > 0 ? divRoundHalfUp(profit * 10_000, revenue) : 0,
    };
  });
  const revenue = items.reduce((s, i) => s + i.revenueSatang, 0);
  const cogs = items.reduce((s, i) => s + i.cogsSatang, 0);
  return {
    items,
    totals: {
      revenueSatang: revenue,
      cogsSatang: cogs,
      profitSatang: revenue - cogs,
      marginBp: revenue > 0 ? divRoundHalfUp((revenue - cogs) * 10_000, revenue) : 0,
    },
  };
}

export async function taxReport(client: DbClient, scope: ReportScope) {
  const sales = await client.query<{ tax_rate_bp: number; gross: number; tax: number; net: number; orders: number }>(
    `SELECT tax_rate_bp,
            COALESCE(sum(total_satang),0)::bigint AS gross,
            COALESCE(sum(tax_satang),0)::bigint AS tax,
            COALESCE(sum(total_satang - tax_satang),0)::bigint AS net,
            count(*)::bigint AS orders
     FROM sales
     WHERE tenant_id=$1 AND store_id=$2 AND business_date BETWEEN $3 AND $4 AND status <> 'voided'
     GROUP BY tax_rate_bp ORDER BY tax_rate_bp`,
    [scope.tenantId, scope.storeId, scope.from, scope.to],
  );
  const refunds = await client.query<{ tax: number; amount: number }>(
    `SELECT COALESCE(sum(tax_satang),0)::bigint AS tax, COALESCE(sum(amount_satang),0)::bigint AS amount
     FROM refunds
     WHERE tenant_id=$1 AND store_id=$2 AND business_date BETWEEN $3 AND $4 AND status='completed'`,
    [scope.tenantId, scope.storeId, scope.from, scope.to],
  );
  return {
    rows: sales.rows.map((r) => ({
      taxRateBp: r.tax_rate_bp,
      grossSalesSatang: Number(r.gross),
      taxSatang: Number(r.tax),
      netSalesSatang: Number(r.net),
      orders: Number(r.orders),
    })),
    refunds: {
      amountSatang: Number(refunds.rows[0]?.amount ?? 0),
      taxSatang: Number(refunds.rows[0]?.tax ?? 0),
    },
  };
}

export async function inventoryReport(client: DbClient, scope: ReportScope) {
  const totals = await client.query<{
    total_value: number;
    total_units: number;
    sku_count: number;
    low_count: number;
    out_count: number;
  }>(
    `SELECT
       COALESCE(sum(CASE WHEN p.track_inventory THEN COALESCE(s.on_hand,0) * v.cost_satang ELSE 0 END),0)::bigint AS total_value,
       COALESCE(sum(CASE WHEN p.track_inventory THEN COALESCE(s.on_hand,0) ELSE 0 END),0)::bigint AS total_units,
       count(*)::bigint AS sku_count,
       count(*) FILTER (WHERE p.track_inventory AND COALESCE(s.on_hand,0) > 0 AND COALESCE(s.on_hand,0) <= p.reorder_point)::bigint AS low_count,
       count(*) FILTER (WHERE p.track_inventory AND COALESCE(s.on_hand,0) <= 0)::bigint AS out_count
     FROM product_variants v
     JOIN products p ON p.id=v.product_id
     LEFT JOIN v_stock_on_hand s ON s.variant_id=v.id AND s.store_id=$2
     WHERE v.tenant_id=$1 AND v.status='active' AND p.status='active'`,
    [scope.tenantId, scope.storeId],
  );
  const byCategory = await client.query<{ category: string; value: number; units: number }>(
    `SELECT COALESCE(c.name,'ไม่ระบุหมวด') AS category,
            COALESCE(sum(COALESCE(s.on_hand,0) * v.cost_satang),0)::bigint AS value,
            COALESCE(sum(COALESCE(s.on_hand,0)),0)::bigint AS units
     FROM product_variants v
     JOIN products p ON p.id=v.product_id
     LEFT JOIN categories c ON c.id=p.category_id
     LEFT JOIN v_stock_on_hand s ON s.variant_id=v.id AND s.store_id=$2
     WHERE v.tenant_id=$1 AND v.status='active' AND p.status='active' AND p.track_inventory
     GROUP BY c.name ORDER BY value DESC`,
    [scope.tenantId, scope.storeId],
  );
  const lowStock = await client.query<{
    product_name: string;
    sku: string | null;
    on_hand: number;
    reorder_point: number;
    cost_satang: number;
  }>(
    `SELECT p.name AS product_name, v.sku, COALESCE(s.on_hand,0)::bigint AS on_hand,
            p.reorder_point, v.cost_satang
     FROM product_variants v
     JOIN products p ON p.id=v.product_id
     LEFT JOIN v_stock_on_hand s ON s.variant_id=v.id AND s.store_id=$2
     WHERE v.tenant_id=$1 AND v.status='active' AND p.status='active' AND p.track_inventory
       AND COALESCE(s.on_hand,0) <= p.reorder_point
     ORDER BY on_hand ASC LIMIT 100`,
    [scope.tenantId, scope.storeId],
  );
  return {
    totals: {
      totalValueSatang: Number(totals.rows[0]?.total_value ?? 0),
      totalUnits: Number(totals.rows[0]?.total_units ?? 0),
      skuCount: Number(totals.rows[0]?.sku_count ?? 0),
      lowStockCount: Number(totals.rows[0]?.low_count ?? 0),
      outOfStockCount: Number(totals.rows[0]?.out_count ?? 0),
    },
    byCategory: byCategory.rows.map((r) => ({
      category: r.category,
      valueSatang: Number(r.value),
      units: Number(r.units),
    })),
    lowStock: lowStock.rows.map((r) => ({
      productName: r.product_name,
      sku: r.sku,
      onHand: Number(r.on_hand),
      reorderPoint: r.reorder_point,
      costSatang: Number(r.cost_satang),
    })),
  };
}
