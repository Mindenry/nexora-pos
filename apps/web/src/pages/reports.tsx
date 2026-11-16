import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { presetRange, type DatePreset } from '@nexora/shared';
import { api, errorMessage, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { downloadFile } from '../lib/download';
import { PageBody, PageHeader } from '../components/shell';
import { BarList, Donut, KpiCard, TrendChart } from '../components/charts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  InlineAlert,
  Input,
  Skeleton,
  Table,
  TD,
  TH,
  TR,
  Tabs,
  cn,
  useToast,
} from '../components/ui';

const PRESETS: Array<{ key: DatePreset; th: string; en: string }> = [
  { key: 'today', th: 'วันนี้', en: 'Today' },
  { key: 'last7', th: '7 วัน', en: '7 days' },
  { key: 'last30', th: '30 วัน', en: '30 days' },
  { key: 'this_month', th: 'เดือนนี้', en: 'This month' },
];

interface SalesReport {
  kpis: {
    grossSalesSatang: number;
    netSalesSatang: number;
    refundsSatang: number;
    discountsSatang: number;
    taxSatang: number;
    revenueExTaxSatang: number;
    cogsSatang: number;
    grossProfitSatang: number;
    orders: number;
    aovSatang: number;
    itemsSold: number;
  };
  trend: Array<{ date: string; salesSatang: number; orders: number }>;
  topProducts: Array<{ name: string; qty: number; revenueSatang: number }>;
  paymentBreakdown: Array<{ method: string; methodName: string; amountSatang: number; count: number }>;
  categoryBreakdown: Array<{ category: string; amountSatang: number }>;
  employeeBreakdown: Array<{ name: string; salesSatang: number; orders: number }>;
}

interface ProfitReport {
  items: Array<{ name: string; sku: string | null; qty: number; revenueSatang: number; cogsSatang: number; profitSatang: number; marginBp: number }>;
  totals: { revenueSatang: number; cogsSatang: number; profitSatang: number; marginBp: number };
}

interface TaxReport {
  rows: Array<{ taxRateBp: number; grossSalesSatang: number; taxSatang: number; netSalesSatang: number; orders: number }>;
  refunds: { amountSatang: number; taxSatang: number };
}

interface InventoryReport {
  totals: { totalValueSatang: number; totalUnits: number; skuCount: number; lowStockCount: number; outOfStockCount: number };
  byCategory: Array<{ category: string; valueSatang: number; units: number }>;
  lowStock: Array<{ productName: string; sku: string | null; onHand: number; reorderPoint: number; costSatang: number }>;
}

const PAYMENT_COLORS = ['var(--jade)', 'var(--amber)', 'var(--info)', 'var(--violet)', '#7d8b84'];

export function ReportsPage() {
  const { t, locale } = useLang();
  const { money, number, percent, date } = useFormat();
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'sales' | 'profit' | 'tax' | 'inventory'>('sales');
  const [range, setRange] = useState(() => presetRange('last30'));
  const [preset, setPreset] = useState<DatePreset>('last30');

  const rangeQuery = qs({ from: range.from, to: range.to });

  const sales = useQuery({
    queryKey: ['report-sales', range, tab],
    queryFn: () => api<SalesReport>(`/reports/sales${rangeQuery}`),
    enabled: can('reports.view') && tab === 'sales',
  });
  const profit = useQuery({
    queryKey: ['report-profit', range, tab],
    queryFn: () => api<ProfitReport>(`/reports/profit${rangeQuery}`),
    enabled: can('reports.view') && tab === 'profit',
  });
  const tax = useQuery({
    queryKey: ['report-tax', range, tab],
    queryFn: () => api<TaxReport>(`/reports/tax${rangeQuery}`),
    enabled: can('reports.view') && tab === 'tax',
  });
  const inventory = useQuery({
    queryKey: ['report-inventory', range, tab],
    queryFn: () => api<InventoryReport>('/reports/inventory'),
    enabled: can('reports.view') && tab === 'inventory',
  });

  const setRangePreset = (key: DatePreset) => {
    setPreset(key);
    setRange(presetRange(key));
  };

  const exportSales = async () => {
    try {
      await downloadFile(
        `/reports/sales/export.csv${rangeQuery}`,
        `nexora-sales-${range.from}-${range.to}.csv`,
      );
    } catch {
      toast.error(t('ส่งออกไม่สำเร็จ', 'Export failed'));
    }
  };

  const loading = sales.isLoading || profit.isLoading || tax.isLoading || inventory.isLoading;
  const error = sales.error ?? profit.error ?? tax.error ?? inventory.error;

  return (
    <PageBody>
      <PageHeader
        title={t('รายงาน', 'Reports')}
        description={t('ยอดขาย กำไร ภาษี และสต๊อก คำนวณจากธุรกรรมจริง', 'Sales, profit, tax and stock from live transactions.')}
        actions={
          can('reports.export') ? (
            <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={() => void exportSales()}>
              {t('ส่งออกยอดขาย', 'Export sales')}
            </Button>
          ) : null
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface-2 p-0.5">
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setRangePreset(item.key)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[11.5px] font-medium',
                  preset === item.key ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
                )}
              >
                {t(item.th, item.en)}
              </button>
            ))}
          </div>
          <Input
            type="date"
            value={range.from}
            onChange={(event) => {
              setPreset('custom');
              setRange((prev) => ({ ...prev, from: event.target.value }));
            }}
            className="h-9 w-[145px] text-[12px]"
          />
          <span className="text-faint">→</span>
          <Input
            type="date"
            value={range.to}
            onChange={(event) => {
              setPreset('custom');
              setRange((prev) => ({ ...prev, to: event.target.value }));
            }}
            className="h-9 w-[145px] text-[12px]"
          />
          <span className="ml-auto text-[11px] text-faint">{range.from} → {range.to}</span>
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'sales', label: t('ยอดขาย', 'Sales') },
          { value: 'profit', label: t('กำไร', 'Profit') },
          { value: 'tax', label: t('ภาษี', 'Tax') },
          { value: 'inventory', label: t('สต๊อก', 'Inventory') },
        ]}
        className="mb-3"
      />

      {error ? <InlineAlert tone="danger">{errorMessage(error, locale)}</InlineAlert> : loading ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : tab === 'sales' && sales.data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label={t('ยอดขายรวม', 'Gross sales')} value={money(sales.data.data.kpis.grossSalesSatang)} sub={`${number(sales.data.data.kpis.orders)} ${t('บิล', 'orders')}`} />
            <KpiCard label={t('ยอดขายหลัง VAT', 'Net revenue ex-VAT')} value={money(sales.data.data.kpis.revenueExTaxSatang)} sub={`VAT ${money(sales.data.data.kpis.taxSatang)}`} />
            <KpiCard label={t('กำไรขั้นต้น', 'Gross profit')} value={money(sales.data.data.kpis.grossProfitSatang)} sub={`${t('ต้นทุน', 'COGS')} ${money(sales.data.data.kpis.cogsSatang)}`} />
            <KpiCard label={t('เฉลี่ยต่อบิล', 'Average order')} value={money(sales.data.data.kpis.aovSatang)} sub={`${number(sales.data.data.kpis.itemsSold)} ${t('ชิ้น', 'items')}`} />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title={t('ยอดขายรายวัน', 'Daily sales')} />
              <div className="px-4 pb-4">
                <TrendChart
                  data={sales.data.data.trend.map((d) => d.salesSatang)}
                  dates={sales.data.data.trend.map((d) => d.date.slice(5))}
                  valueFormat={(value) => money(value, true)}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title={t('ช่องทางชำระ', 'Payment mix')} />
              <Donut
                segments={sales.data.data.paymentBreakdown.map((item, index) => ({
                  label: item.methodName || item.method,
                  value: item.amountSatang,
                  color: PAYMENT_COLORS[index % PAYMENT_COLORS.length]!,
                }))}
                centerLabel={t('รับสุทธิ', 'Collected')}
                centerValue={sales.data.data.kpis.netSalesSatang}
                valueFormat={(value) => money(value, true)}
              />
            </Card>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title={t('ยอดขายตามหมวด', 'Sales by category')} />
              <BarList items={sales.data.data.categoryBreakdown.map((c) => ({ label: c.category, value: c.amountSatang }))} valueFormat={(v) => money(v, true)} />
            </Card>
            <Card>
              <CardHeader title={t('ยอดขายตามพนักงาน', 'Sales by employee')} />
              <BarList items={sales.data.data.employeeBreakdown.map((e) => ({ label: e.name, value: e.salesSatang, meta: `${e.orders} ${t('บิล', 'orders')}` }))} valueFormat={(v) => money(v, true)} tone="info" />
            </Card>
          </div>
          <Card>
            <CardHeader title={t('สินค้าขายดี', 'Top products')} />
            <Table>
              <thead><tr><TH>{t('สินค้า', 'Product')}</TH><TH align="right">{t('ชิ้น', 'Qty')}</TH><TH align="right">{t('รายได้', 'Revenue')}</TH></tr></thead>
              <tbody>
                {sales.data.data.topProducts.map((p) => (
                  <TR key={p.name}><TD className="text-[12px]">{p.name}</TD><TD align="right" className="num">{p.qty}</TD><TD align="right" className="num">{money(p.revenueSatang)}</TD></TR>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      ) : tab === 'profit' && profit.data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label={t('รายได้หลัง VAT', 'Revenue ex-VAT')} value={money(profit.data.data.totals.revenueSatang)} />
            <KpiCard label={t('ต้นทุนขาย', 'COGS')} value={money(profit.data.data.totals.cogsSatang)} />
            <KpiCard label={t('กำไรขั้นต้น', 'Gross profit')} value={money(profit.data.data.totals.profitSatang)} />
            <KpiCard label={t('อัตรากำไร', 'Margin')} value={percent(profit.data.data.totals.marginBp)} />
          </div>
          <Card>
            <CardHeader title={t('กำไรตามสินค้า', 'Product margin')} description={t('คำนวณจากต้นทุน ณ เวลาที่ขาย', 'Cost is snapshotted at sale time.')} />
            {profit.data.data.items.length === 0 ? <EmptyState title={t('ไม่มีข้อมูลในช่วงนี้', 'No data in this period')} /> : (
              <Table>
                <thead><tr><TH>{t('สินค้า', 'Product')}</TH><TH align="right">{t('ชิ้น', 'Qty')}</TH><TH align="right">{t('รายได้', 'Revenue')}</TH><TH align="right">COGS</TH><TH align="right">{t('กำไร', 'Profit')}</TH><TH align="right">{t('อัตรา', 'Margin')}</TH></tr></thead>
                <tbody>
                  {profit.data.data.items.map((item) => (
                    <TR key={item.name}>
                      <TD><p className="text-[12px]">{item.name}</p><p className="text-[10px] text-faint">{item.sku}</p></TD>
                      <TD align="right" className="num">{item.qty}</TD>
                      <TD align="right" className="num">{money(item.revenueSatang)}</TD>
                      <TD align="right" className="num">{money(item.cogsSatang)}</TD>
                      <TD align="right" className={cn('num font-medium', item.profitSatang >= 0 ? 'text-jade' : 'text-danger')}>{money(item.profitSatang)}</TD>
                      <TD align="right" className="num">{percent(item.marginBp)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      ) : tab === 'tax' && tax.data ? (
        <div className="space-y-4">
          <InlineAlert tone="warning" title={t('ใช้เพื่อตรวจสอบภายในเท่านั้น', 'Internal reconciliation only')}>
            {t('การยื่นภาษีและการออกเอกสารทางกฎหมายต้องตรวจสอบกับนักบัญชีและกรมสรรพากร', 'Tax filing and legal documents must be reviewed with an accountant and the Revenue Department.')}
          </InlineAlert>
          <Card>
            <CardHeader title={t('สรุปภาษีมูลค่าเพิ่ม', 'VAT summary')} description={`${range.from} → ${range.to}`} />
            <Table>
              <thead><tr><TH>{t('อัตรา', 'Rate')}</TH><TH align="right">{t('ยอดรวม', 'Gross')}</TH><TH align="right">{t('ภาษี', 'VAT')}</TH><TH align="right">{t('ยอดก่อน VAT', 'Net')}</TH><TH align="right">{t('บิล', 'Orders')}</TH></tr></thead>
              <tbody>
                {tax.data.data.rows.map((row) => (
                  <TR key={row.taxRateBp}>
                    <TD><Badge tone="jade">{(row.taxRateBp / 100).toFixed(2)}%</Badge></TD>
                    <TD align="right" className="num">{money(row.grossSalesSatang)}</TD>
                    <TD align="right" className="num">{money(row.taxSatang)}</TD>
                    <TD align="right" className="num">{money(row.netSalesSatang)}</TD>
                    <TD align="right" className="num">{row.orders}</TD>
                  </TR>
                ))}
                {tax.data.data.rows.length === 0 ? <TR><TD colSpan={5} className="text-center text-faint">{t('ไม่มีข้อมูล', 'No data')}</TD></TR> : null}
              </tbody>
            </Table>
            <div className="flex flex-wrap justify-end gap-6 border-t border-line px-5 py-3 text-[12px]">
              <span className="text-muted">{t('คืนสินค้า', 'Refunds')} <span className="num text-text">{money(tax.data.data.refunds.amountSatang)}</span></span>
              <span className="text-muted">{t('ภาษีที่คืน', 'Refund VAT')} <span className="num text-text">{money(tax.data.data.refunds.taxSatang)}</span></span>
            </div>
          </Card>
        </div>
      ) : tab === 'inventory' && inventory.data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label={t('มูลค่าสต๊อก', 'Stock value')} value={money(inventory.data.data.totals.totalValueSatang)} />
            <KpiCard label={t('หน่วยในสต๊อก', 'Units')} value={number(inventory.data.data.totals.totalUnits)} />
            <KpiCard label={t('ต่ำกว่าจุดสั่งซื้อ', 'Low stock')} value={number(inventory.data.data.totals.lowStockCount)} />
            <KpiCard label={t('หมดสต๊อก', 'Out of stock')} value={number(inventory.data.data.totals.outOfStockCount)} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title={t('มูลค่าตามหมวด', 'Value by category')} />
              <BarList items={inventory.data.data.byCategory.map((c) => ({ label: c.category, value: c.valueSatang, meta: `${c.units} ${t('หน่วย', 'units')}` }))} valueFormat={(v) => money(v, true)} />
            </Card>
            <Card>
              <CardHeader title={t('สินค้าต้องสั่งซื้อ', 'Reorder list')} />
              <div className="max-h-[320px] overflow-y-auto">
                <Table>
                  <thead><tr><TH>{t('สินค้า', 'Product')}</TH><TH align="right">{t('คงเหลือ', 'On hand')}</TH><TH align="right">{t('จุดสั่ง', 'Reorder')}</TH></tr></thead>
                  <tbody>
                    {inventory.data.data.lowStock.map((item) => (
                      <TR key={`${item.productName}-${item.sku}`}>
                        <TD><p className="text-[12px]">{item.productName}</p><p className="text-[10px] text-faint">{item.sku}</p></TD>
                        <TD align="right" className="num text-amber">{item.onHand}</TD>
                        <TD align="right" className="num">{item.reorderPoint}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card>
          </div>
        </div>
      ) : null}
      <p className="mt-4 text-[10px] text-faint">{t('ข้อมูล ณ', 'As of')} {date(new Date())} · {t('คำนวณจากฐานข้อมูลโดยตรง', 'Computed directly from the database')}</p>
    </PageBody>
  );
}
