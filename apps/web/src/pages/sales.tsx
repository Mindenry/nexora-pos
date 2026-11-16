import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, ReceiptText, RefreshCw, Search } from 'lucide-react';
import { presetRange } from '@nexora/shared';
import { api, errorMessage, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { downloadFile } from '../lib/download';
import { PageBody, PageHeader } from '../components/shell';
import { SaleStatusBadge } from '../components/status';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineAlert,
  Input,
  Pagination,
  Select,
  Skeleton,
  Table,
  TD,
  TH,
  TR,
  cn,
} from '../components/ui';

interface SaleRow {
  id: string;
  number: string;
  status: string;
  businessDate: string;
  occurredAt: string;
  totalSatang: number;
  refundedSatang: number;
  itemCount: number;
  storeName: string;
  employeeName: string;
  customerName: string | null;
  methods: string[];
}

interface SalesMeta {
  summary: {
    grossSalesSatang: number;
    refundedSatang: number;
    taxSatang: number;
    discountSatang: number;
  };
  total: number;
  totalPages: number;
}

const PRESETS = [
  { key: 'today', th: 'วันนี้', en: 'Today' },
  { key: 'yesterday', th: 'เมื่อวาน', en: 'Yesterday' },
  { key: 'last7', th: '7 วัน', en: '7 days' },
  { key: 'last30', th: '30 วัน', en: '30 days' },
  { key: 'this_month', th: 'เดือนนี้', en: 'This month' },
] as const;

export function SalesPage() {
  const { t, locale } = useLang();
  const { money, dateTime } = useFormat();
  const { can, storeId } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState(() => presetRange('last7'));
  const [activePreset, setActivePreset] = useState<string>('last7');
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['sales', range, status, search, page, storeId],
    queryFn: () =>
      api<SaleRow[]>(
        `/sales${qs({ from: range.from, to: range.to, status: status || undefined, search: search || undefined, page, pageSize: 25 })}`,
      ),
    enabled: can('sales.read'),
  });

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta as SalesMeta | undefined;

  const setPreset = (key: (typeof PRESETS)[number]['key']) => {
    setActivePreset(key);
    setRange(presetRange(key));
    setPage(1);
  };

  const exportCsv = async () => {
    try {
      await downloadFile(
        `/reports/sales/export.csv${qs({ from: range.from, to: range.to })}`,
        `nexora-sales-${range.from}-${range.to}.csv`,
      );
    } catch {
      // Keep the UI quiet; the browser surfaces the failure.
    }
  };

  return (
    <PageBody>
      <PageHeader
        title={t('รายการขาย', 'Sales')}
        description={t('ทุกบิลที่บันทึกแล้ว พร้อมหลักฐานการชำระและสต๊อก', 'Every completed sale with payment and stock evidence.')}
        actions={
          <>
            {can('reports.export') ? (
              <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={() => void exportCsv()}>
                {t('ส่งออก CSV', 'Export CSV')}
              </Button>
            ) : null}
            {can('sales.create') ? (
              <Button variant="primary" onClick={() => navigate('/pos')}>
                {t('ขายสินค้า', 'New sale')}
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface-2 p-0.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => setPreset(preset.key)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors',
                  activePreset === preset.key ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
                )}
              >
                {t(preset.th, preset.en)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={range.from}
              onChange={(event) => {
                setActivePreset('custom');
                setRange((prev) => ({ ...prev, from: event.target.value }));
                setPage(1);
              }}
              className="h-9 w-[140px] text-[12px]"
              aria-label={t('จากวันที่', 'From date')}
            />
            <span className="text-faint">→</span>
            <Input
              type="date"
              value={range.to}
              onChange={(event) => {
                setActivePreset('custom');
                setRange((prev) => ({ ...prev, to: event.target.value }));
                setPage(1);
              }}
              className="h-9 w-[140px] text-[12px]"
              aria-label={t('ถึงวันที่', 'To date')}
            />
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <div className="relative w-full max-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setSearch(searchInput);
                    setPage(1);
                  }
                }}
                placeholder={t('เลขที่บิล / ชื่อลูกค้า', 'Receipt or customer')}
                className="h-9 pl-8 text-[12px]"
              />
            </div>
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="h-9 w-[150px] text-[12px]"
            >
              <option value="">{t('ทุกสถานะ', 'All statuses')}</option>
              <option value="completed">{t('สำเร็จ', 'Completed')}</option>
              <option value="partially_refunded">{t('คืนบางส่วน', 'Partially refunded')}</option>
              <option value="refunded">{t('คืนแล้ว', 'Refunded')}</option>
              <option value="voided">{t('ยกเลิก', 'Voided')}</option>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void query.refetch()}
            >
              {t('รีเฟรช', 'Refresh')}
            </Button>
          </div>
        </div>
      </Card>

      {query.isError ? (
        <InlineAlert tone="danger">{errorMessage(query.error, locale)}</InlineAlert>
      ) : (
        <Card>
          <div className="grid grid-cols-2 border-b border-line sm:grid-cols-4">
            {[
              { label: t('ยอดขายรวม', 'Gross sales'), value: money(meta?.summary.grossSalesSatang ?? 0) },
              { label: t('คืนสินค้า', 'Refunds'), value: money(meta?.summary.refundedSatang ?? 0) },
              { label: t('ส่วนลด', 'Discounts'), value: money(meta?.summary.discountSatang ?? 0) },
              { label: t('VAT', 'VAT'), value: money(meta?.summary.taxSatang ?? 0) },
            ].map((stat, index) => (
              <div key={stat.label} className={cn('px-4 py-3', index > 0 && 'border-l border-line')}>
                <p className="text-[10px] uppercase tracking-wide text-faint">{stat.label}</p>
                <p className="num mt-1 text-[16px] font-semibold">{stat.value}</p>
              </div>
            ))}
          </div>
          {query.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<ReceiptText className="h-5 w-5" />}
              title={t('ไม่พบรายการขาย', 'No sales in this range')}
              description={t('ลองเปลี่ยนช่วงวันที่ หรือเริ่มขายจากหน้าขาย', 'Change the date range or ring a sale from the terminal.')}
              action={
                can('sales.create') ? (
                  <Button variant="primary" size="sm" onClick={() => navigate('/pos')}>
                    {t('ไปที่หน้าขาย', 'Open POS')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <TH>{t('เลขที่บิล', 'Receipt')}</TH>
                    <TH>{t('วันที่', 'Date')}</TH>
                    <TH>{t('ลูกค้า', 'Customer')}</TH>
                    <TH>{t('พนักงาน', 'Cashier')}</TH>
                    <TH>{t('ชำระโดย', 'Tender')}</TH>
                    <TH align="right">{t('ยอดรวม', 'Total')}</TH>
                    <TH>{t('สถานะ', 'Status')}</TH>
                    <TH />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((sale) => (
                    <TR key={sale.id} onClick={() => navigate(`/sales/${sale.id}`)}>
                      <TD>
                        <span className="num text-[12px] font-medium">{sale.number}</span>
                        <span className="block text-[10px] text-faint">{sale.itemCount} {t('รายการ', 'items')}</span>
                      </TD>
                      <TD>
                        <span className="text-[12px]">{dateTime(sale.occurredAt)}</span>
                        <span className="block text-[10px] text-faint">{sale.businessDate}</span>
                      </TD>
                      <TD className="text-[12px]">{sale.customerName ?? t('ลูกค้าทั่วไป', 'Walk-in')}</TD>
                      <TD className="text-[12px] text-muted">{sale.employeeName}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {sale.methods.map((method) => (
                            <Badge key={method} tone="neutral" className="px-1.5 py-0 text-[9.5px]">
                              {method}
                            </Badge>
                          ))}
                        </div>
                      </TD>
                      <TD align="right">
                        <span className="num text-[12.5px] font-medium">{money(sale.totalSatang)}</span>
                        {sale.refundedSatang > 0 ? (
                          <span className="num block text-[10px] text-amber">
                            -{money(sale.refundedSatang)}
                          </span>
                        ) : null}
                      </TD>
                      <TD>
                        <SaleStatusBadge status={sale.status} />
                      </TD>
                      <TD align="right">
                        <span className="text-[11px] text-jade">{t('เปิด', 'View')}</span>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
              <Pagination
                page={page}
                totalPages={meta?.totalPages ?? 1}
                total={meta?.total ?? 0}
                onPage={setPage}
                labels={{ previous: t('ก่อนหน้า', 'Previous'), next: t('ถัดไป', 'Next'), of: t('รายการ', 'records') }}
              />
            </>
          )}
        </Card>
      )}
    </PageBody>
  );
}
