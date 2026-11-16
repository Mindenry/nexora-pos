import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Boxes,
  CircleDollarSign,
  Plus,
  ReceiptText,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { PageBody, PageHeader } from '../components/shell';
import { BarList, Donut, TrendChart } from '../components/charts';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  InlineAlert,
  Skeleton,
  Table,
  TD,
  TH,
  TR,
  cn,
} from '../components/ui';
import { SaleStatusBadge } from '../components/status';

interface DashboardData {
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
  previousKpis?: {
    grossSalesSatang: number;
    netSalesSatang: number;
    grossProfitSatang: number;
    orders: number;
    aovSatang: number;
  };
  trend: Array<{ date: string; salesSatang: number; orders: number }>;
  topProducts: Array<{ name: string; qty: number; revenueSatang: number }>;
  paymentBreakdown: Array<{ method: string; methodName: string; amountSatang: number; count: number }>;
  categoryBreakdown: Array<{ category: string; amountSatang: number }>;
  employeeBreakdown: Array<{ name: string; salesSatang: number; orders: number }>;
  branches: Array<{ storeId: string; name: string; salesSatang: number; orders: number }>;
  recentSales: Array<{
    id: string;
    number: string;
    totalSatang: number;
    status: string;
    occurredAt: string;
    customerName: string | null;
    employeeName: string;
  }>;
  lowStock: Array<{ productName: string; sku: string | null; onHand: number; reorderPoint: number }>;
  range: { from: string; to: string };
  store: { id: string; name: string };
}

const PRESETS = [
  { value: 'today', th: 'วันนี้', en: 'Today' },
  { value: 'last7', th: '7 วัน', en: '7 days' },
  { value: 'last30', th: '30 วัน', en: '30 days' },
  { value: 'this_month', th: 'เดือนนี้', en: 'This month' },
] as const;

const PAYMENT_COLORS = ['var(--jade)', 'var(--amber)', 'var(--info)', 'var(--violet)', '#7d8b84'];

export function DashboardPage() {
  const { t, locale } = useLang();
  const { money, number, dateTime, percent } = useFormat();
  const { me, isDemo, can } = useAuth();
  const navigate = useNavigate();
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['value']>('last7');

  const query = useQuery({
    queryKey: ['dashboard', preset],
    queryFn: () => api<DashboardData>(`/reports/dashboard${preset === 'last7' ? '' : `?preset=${preset}`}`),
    enabled: can('reports.view'),
  });

  const data = query.data?.data;
  const kpis = data?.kpis;
  const marginBp =
    kpis && kpis.revenueExTaxSatang > 0
      ? Math.round((kpis.grossProfitSatang / kpis.revenueExTaxSatang) * 10_000)
      : 0;

  const paymentSegments = (data?.paymentBreakdown ?? []).map((item, index) => ({
    label: item.methodName || item.method,
    value: item.amountSatang,
    color: PAYMENT_COLORS[index % PAYMENT_COLORS.length]!,
  }));

  const delta = (current: number, previous: number | undefined) => {
    if (previous === undefined || previous === 0) return undefined;
    const change = ((current - previous) / previous) * 100;
    return {
      value: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
      positive: change >= 0,
    };
  };
  const previous = data?.previousKpis;
  const metrics = kpis
    ? [
        {
          label: t('ยอดขายรวม', 'Gross sales'),
          value: money(kpis.grossSalesSatang),
          sub: `${number(kpis.orders)} ${t('บิล', 'orders')}`,
          icon: CircleDollarSign,
          delta: delta(kpis.grossSalesSatang, previous?.grossSalesSatang),
        },
        {
          label: t('ยอดขายสุทธิ', 'Net sales'),
          value: money(kpis.netSalesSatang),
          sub: `${t('คืนสินค้า', 'Refunds')} ${money(kpis.refundsSatang)}`,
          icon: Wallet,
          delta: delta(kpis.netSalesSatang, previous?.netSalesSatang),
        },
        {
          label: t('กำไรขั้นต้น', 'Gross profit'),
          value: money(kpis.grossProfitSatang),
          sub: `${t('อัตรากำไร', 'Margin')} ${percent(marginBp)} · ${t('หลัง VAT', 'ex-VAT')}`,
          icon: TrendingUp,
          delta: delta(kpis.grossProfitSatang, previous?.grossProfitSatang),
        },
        {
          label: t('เฉลี่ยต่อบิล', 'Average order'),
          value: money(kpis.aovSatang),
          sub: `${number(kpis.itemsSold)} ${t('ชิ้น', 'items')} · ${money(kpis.discountsSatang)} ${t('ส่วนลด', 'discounts')}`,
          icon: ReceiptText,
          delta: delta(kpis.aovSatang, previous?.aovSatang),
        },
      ]
    : null;

  return (
    <PageBody>
      <PageHeader
        title={
          <span>
            {t('สวัสดี', 'Good to see you')} {me?.user.name.split(' ')[0] ?? ''}
          </span>
        }
        description={
          data
            ? `${data.store.name} · ${data.range.from} → ${data.range.to}`
            : t('ข้อมูลจากธุรกรรมจริงของคุณ', 'Live figures from your transactions.')
        }
        actions={
          <>
            <div className="flex items-center rounded-lg border border-line bg-surface p-0.5">
              {PRESETS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setPreset(item.value)}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors',
                    preset === item.value ? 'bg-surface-3 text-text' : 'text-muted hover:text-text',
                  )}
                >
                  {t(item.th, item.en)}
                </button>
              ))}
            </div>
            {can('sales.create') ? (
              <Button
                variant="primary"
                size="md"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => navigate('/pos')}
              >
                {t('ขายสินค้า', 'New sale')}
              </Button>
            ) : null}
          </>
        }
      />

      {isDemo ? (
        <div className="mb-4">
          <InlineAlert tone="warning" title={t('ข้อมูลตัวอย่าง', 'Demo environment')}>
            {t(
              'ตัวเลขทั้งหมดมาจากการขายจริงในระบบ แต่เป็นข้อมูลตัวอย่างสำหรับสาธิต ไม่ใช่ข้อมูลบัญชีจริง',
              'All figures come from real transactions in this system, but are sample data for demonstration — not real accounting records.',
            )}
          </InlineAlert>
        </div>
      ) : null}

      {query.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[110px] rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Skeleton className="h-[300px] rounded-xl xl:col-span-2" />
            <Skeleton className="h-[300px] rounded-xl" />
          </div>
        </div>
      ) : query.isError ? (
        <InlineAlert tone="danger" title={t('โหลดข้อมูลไม่สำเร็จ', 'Could not load dashboard')}>
          <div className="flex items-center gap-3">
            <span>{errorMessage(query.error, locale)}</span>
            <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
              {t('ลองใหม่', 'Retry')}
            </Button>
          </div>
        </InlineAlert>
      ) : kpis ? (
        <>
          <Card className="animate-rise overflow-hidden">
            <div className="grid grid-cols-2 xl:grid-cols-4">
              {(metrics ?? []).map((metric, index) => (
                <div
                  key={metric.label}
                  className={cn(
                    'border-line p-4 sm:p-5',
                    index % 2 === 1 && 'border-l',
                    index >= 2 && 'border-t xl:border-t-0',
                    index > 0 && 'xl:border-l',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-faint">
                      {metric.label}
                    </p>
                    <metric.icon className="h-4 w-4 text-jade/70" strokeWidth={1.8} />
                  </div>
                  <p className="num mt-2 text-[25px] font-semibold leading-none tracking-tight text-text">
                    {metric.value}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {metric.delta ? (
                      <span
                        className={cn(
                          'num rounded px-1.5 py-0.5 text-[10.5px] font-medium',
                          metric.delta.positive ? 'bg-jade-soft text-jade' : 'bg-danger-soft text-danger',
                        )}
                      >
                        {metric.delta.value}
                      </span>
                    ) : null}
                    <span className="text-[10px] text-faint">
                      {metric.delta ? t('เทียบช่วงก่อน', 'vs previous') : metric.sub}
                    </span>
                  </div>
                  {metric.delta ? (
                    <p className="mt-1 truncate text-[10.5px] text-muted">{metric.sub}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <div className="animate-rise animate-rise-1 mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title={t('แนวโน้มยอดขาย', 'Sales trend')}
                description={t('ยอดขายต่อวันตามวันที่ทำธุรกิจ', 'Daily sales by business date')}
                action={
                  <div className="text-right">
                    <p className="num text-[15px] font-semibold">{money(kpis.grossSalesSatang)}</p>
                    <p className="text-[10px] text-faint">{t('รวมช่วงที่เลือก', 'Selected period')}</p>
                  </div>
                }
              />
              <div className="px-4 pb-4">
                <TrendChart
                  data={(data.trend ?? []).map((d) => d.salesSatang)}
                  dates={(data.trend ?? []).map((d) => d.date.slice(5).replace('-', '/'))}
                  valueFormat={(value) => money(value, true)}
                  height={220}
                />
              </div>
            </Card>
            <Card>
              <CardHeader
                title={t('ช่องทางชำระเงิน', 'Payment mix')}
                description={t('ยอดรับจริงตามวิธีชำระ', 'Collected by tender')}
              />
              <Donut
                segments={paymentSegments}
                centerLabel={t('รับสุทธิ', 'Collected')}
                centerValue={kpis.netSalesSatang}
                valueFormat={(value) => money(value, true)}
              />
            </Card>
          </div>

          <div className="animate-rise animate-rise-2 mt-4 grid gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-2">
              <CardHeader
                title={t('สินค้าขายดี', 'Best sellers')}
                description={t('ตามยอดขายหลังหักคืน', 'Revenue after refunds')}
                action={
                  <Link to="/reports" className="text-[11px] font-medium text-jade hover:underline">
                    {t('ดูรายงาน', 'Reports')}
                  </Link>
                }
              />
              <BarList
                items={(data.topProducts ?? []).map((p) => ({
                  label: p.name,
                  value: p.revenueSatang,
                  meta: `${number(p.qty)} ${t('ชิ้น', 'units')}`,
                }))}
                valueFormat={(value) => money(value, true)}
                emptyLabel={t('ยังไม่มียอดขาย', 'No sales yet')}
              />
            </Card>
            <Card className="xl:col-span-3">
              <CardHeader
                title={t('รายการขายล่าสุด', 'Recent sales')}
                description={t('ทุกบิลมาจากฐานข้อมูลจริง', 'Every receipt is a real database row')}
                action={
                  <Link to="/sales" className="text-[11px] font-medium text-jade hover:underline">
                    {t('ทั้งหมด', 'All sales')}
                  </Link>
                }
              />
              {(data.recentSales ?? []).length === 0 ? (
                <EmptyState
                  icon={<ReceiptText className="h-5 w-5" />}
                  title={t('ยังไม่มีรายการขาย', 'No sales yet')}
                  description={t('เปิดกะและทำรายการแรกจากหน้าขาย', 'Open a shift and ring your first sale.')}
                  action={
                    <Button size="sm" variant="primary" onClick={() => navigate('/pos')}>
                      {t('ไปที่หน้าขาย', 'Open POS')}
                    </Button>
                  }
                />
              ) : (
                <Table className="-mt-2">
                  <thead>
                    <tr>
                      <TH>{t('เลขที่บิล', 'Receipt')}</TH>
                      <TH>{t('ลูกค้า', 'Customer')}</TH>
                      <TH>{t('พนักงาน', 'Cashier')}</TH>
                      <TH align="right">{t('ยอดรวม', 'Total')}</TH>
                      <TH>{t('สถานะ', 'Status')}</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.recentSales ?? []).map((sale) => (
                      <TR key={sale.id} onClick={() => navigate(`/sales/${sale.id}`)}>
                        <TD>
                          <span className="num text-[12px] font-medium">{sale.number}</span>
                          <span className="block text-[10px] text-faint">
                            {dateTime(sale.occurredAt)}
                          </span>
                        </TD>
                        <TD className="text-[12px]">{sale.customerName ?? t('ลูกค้าทั่วไป', 'Walk-in')}</TD>
                        <TD className="text-[12px] text-muted">{sale.employeeName}</TD>
                        <TD align="right" className="num text-[12.5px] font-medium">
                          {money(sale.totalSatang)}
                        </TD>
                        <TD>
                          <SaleStatusBadge status={sale.status} />
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>

          <div className="animate-rise animate-rise-3 mt-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader
                title={t('สต๊อกต่ำ', 'Low stock')}
                description={t('ถึงจุดสั่งซื้อแล้ว', 'At or below reorder point')}
                action={
                  <Link to="/inventory" className="text-[11px] font-medium text-jade hover:underline">
                    {t('จัดการ', 'Manage')}
                  </Link>
                }
              />
              {(data.lowStock ?? []).length === 0 ? (
                <div className="flex items-center gap-2 px-5 pb-6 text-[12px] text-muted">
                  <Boxes className="h-4 w-4 text-jade" />
                  {t('สต๊อกทุกรายการอยู่ในระดับปลอดภัย', 'All stock is above its reorder point.')}
                </div>
              ) : (
                <div className="px-5 pb-3">
                  {(data.lowStock ?? []).map((item) => (
                    <div
                      key={`${item.productName}-${item.sku ?? ''}`}
                      className="flex items-center justify-between gap-3 border-b border-line/60 py-2.5 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] text-text">{item.productName}</p>
                        <p className="text-[10.5px] text-faint">{item.sku ?? '—'}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="num text-[12px] font-medium text-amber">
                          {number(item.onHand)} / {number(item.reorderPoint)}
                        </span>
                        <TriangleAlert className="h-3.5 w-3.5 text-amber" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <CardHeader
                title={t('ผลงานแต่ละสาขา', 'Branch performance')}
                description={t('ช่วงวันที่เลือก', 'Selected period')}
              />
              <BarList
                items={(data.branches ?? []).map((b) => ({
                  label: b.name,
                  value: b.salesSatang,
                  meta: `${number(b.orders)} ${t('บิล', 'orders')}`,
                }))}
                valueFormat={(value) => money(value, true)}
                emptyLabel={t('ไม่มีข้อมูลสาขา', 'No branch data')}
                tone="info"
              />
            </Card>
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-[10.5px] text-faint">
            <ArrowUpRight className="h-3 w-3" />
            {t(
              'คำนวณจากตาราง sales, sale_items และ inventory_movements โดยตรง',
              'Computed directly from sales, sale_items and inventory_movements.',
            )}
          </p>
        </>
      ) : null}
    </PageBody>
  );
}
