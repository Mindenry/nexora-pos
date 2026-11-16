import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus, Wallet } from 'lucide-react';
import { uuidv7 } from '@nexora/shared';
import { api, errorMessage, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { PageBody, PageHeader } from '../components/shell';
import { ShiftStatusBadge } from '../components/status';
import { MoneyInput } from '../components/money-input';
import { CashCountHelper } from '../components/cash-count';
import { printShiftReport } from '../lib/shift-print';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  Modal,
  Pagination,
  Skeleton,
  Spinner,
  Table,
  TD,
  Textarea,
  TH,
  TR,
  useToast,
} from '../components/ui';

interface ShiftSummary {
  shift: {
    id: string;
    status: string;
    opened_at: string;
    closed_at: string | null;
    opening_cash_satang: number;
    expected_cash_satang: number | null;
    counted_cash_satang: number | null;
    variance_satang: number | null;
    business_date: string;
    terminal_name: string;
  };
  salesCount: number;
  salesTotalSatang: number;
  discountSatang?: number;
  taxSatang?: number;
  refundTotalSatang: number;
  cashSalesSatang: number;
  cashInSatang: number;
  cashOutSatang: number;
  expectedCashSatang: number;
  pendingPayments: number;
  payments: Array<{ method: string; methodName: string; count: number; amountSatang: number }>;
  topItems: Array<{ name: string; qty: number; amountSatang: number }>;
}

interface ShiftRow {
  id: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  openingCashSatang: number;
  expectedCashSatang: number | null;
  countedCashSatang: number | null;
  varianceSatang: number | null;
  businessDate: string;
  terminalName: string;
  employeeName: string;
  storeName: string;
  salesCount: number;
  salesTotalSatang: number;
}

export function ShiftsPage() {
  const { t, locale } = useLang();
  const { money, number, dateTime } = useFormat();
  const { can, storeId, me } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [cashModal, setCashModal] = useState<'cash_in' | 'cash_out' | null>(null);
  const [detailShift, setDetailShift] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [openingCash, setOpeningCash] = useState(200_000);
  const [terminal, setTerminal] = useState('Counter 1');
  const [counted, setCounted] = useState(0);
  const [note, setNote] = useState('');
  const [cashAmount, setCashAmount] = useState(0);
  const [cashReason, setCashReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const current = useQuery({
    queryKey: ['shift-current', storeId],
    queryFn: () => api<ShiftSummary | null>('/shifts/current'),
    enabled: can('shifts.read'),
  });

  const history = useQuery({
    queryKey: ['shifts', page, storeId],
    queryFn: () =>
      api<ShiftRow[]>(`/shifts${qs({ page, pageSize: 15 })}`),
    enabled: can('shifts.read'),
  });

  const detail = useQuery({
    queryKey: ['shift', detailShift],
    queryFn: () => api<ShiftSummary>(`/shifts/${detailShift}`),
    enabled: Boolean(detailShift),
  });

  const summary = current.data?.data ?? null;
  const rows = history.data?.data ?? [];
  const meta = history.data?.meta;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['shift-current'] });
    await queryClient.invalidateQueries({ queryKey: ['shifts'] });
    await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const openShift = async () => {
    setSubmitting(true);
    try {
      await api('/shifts/open', {
        method: 'POST',
        body: { openingCashSatang: openingCash, terminalName: terminal },
      });
      setOpenModal(false);
      await refresh();
      toast.success(t('เปิดกะแล้ว', 'Shift opened'));
    } catch (error) {
      toast.error(t('เปิดกะไม่สำเร็จ', 'Could not open shift'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const closeShift = async () => {
    setSubmitting(true);
    try {
      await api('/shifts/close', {
        method: 'POST',
        body: { countedCashSatang: counted, note },
      });
      setCloseModal(false);
      setNote('');
      await refresh();
      toast.success(t('ปิดกะแล้ว', 'Shift closed'));
    } catch (error) {
      toast.error(t('ปิดกะไม่สำเร็จ', 'Could not close shift'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const recordCash = async () => {
    if (!cashModal || cashAmount <= 0 || cashReason.trim().length < 2) return;
    setSubmitting(true);
    try {
      await api('/shifts/cash-movements', {
        method: 'POST',
        body: {
          operationId: uuidv7(),
          type: cashModal,
          amountSatang: cashAmount,
          reason: cashReason,
        },
      });
      setCashModal(null);
      setCashAmount(0);
      setCashReason('');
      await refresh();
      toast.success(t('บันทึกเงินสดแล้ว', 'Cash movement recorded'));
    } catch (error) {
      toast.error(t('บันทึกไม่สำเร็จ', 'Could not record cash'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageBody>
      <PageHeader
        title={t('กะและเงินสด', 'Shifts & cash')}
        description={t('เงินสดในลิ้นชักต้องกระทบยอดกับยอดขายจริงทุกกะ', 'Every shift reconciles recorded sales to cash in the drawer.')}
        actions={
          summary ? (
            <>
              {can('shifts.cash') ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setCashModal('cash_in')}>
                    {t('รับเงินสดเข้า', 'Cash in')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setCashModal('cash_out')}>
                    {t('จ่ายเงินสดออก', 'Cash out')}
                  </Button>
                </>
              ) : null}
              {can('shifts.close') ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    setCounted(summary.expectedCashSatang);
                    setCloseModal(true);
                  }}
                >
                  {t('ปิดกะ', 'Close shift')}
                </Button>
              ) : null}
            </>
          ) : can('shifts.open') ? (
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setOpenModal(true)}>
              {t('เปิดกะ', 'Open shift')}
            </Button>
          ) : null
        }
      />

      {current.isLoading ? (
        <Skeleton className="mb-4 h-48 rounded-xl" />
      ) : summary ? (
        <div className="mb-4 grid gap-4 xl:grid-cols-3">
          <Card className="p-5 xl:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ShiftStatusBadge status={summary.shift.status} />
                  <Badge tone="neutral">{summary.shift.terminal_name || '—'}</Badge>
                </div>
                <p className="mt-2 text-[12px] text-muted">
                  {t('เปิดเมื่อ', 'Opened')} {dateTime(summary.shift.opened_at)} · {t('วันที่ทำธุรกิจ', 'Business date')}{' '}
                  {summary.shift.business_date}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-faint">{t('เงินสดที่ควรมี', 'Expected cash')}</p>
                <p className="num text-[24px] font-semibold">{money(summary.expectedCashSatang)}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: t('ยอดขาย', 'Sales'), value: money(summary.salesTotalSatang) },
                { label: t('จำนวนบิล', 'Orders'), value: number(summary.salesCount) },
                { label: t('เงินสดเริ่มต้น', 'Opening'), value: money(summary.shift.opening_cash_satang) },
                { label: t('คืนเงินสด', 'Cash refunds'), value: money(summary.refundTotalSatang) },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-line bg-surface-2 p-2.5">
                  <p className="text-[10px] text-faint">{item.label}</p>
                  <p className="num mt-0.5 text-[13px] font-medium">{item.value}</p>
                </div>
              ))}
            </div>
            {summary.pendingPayments > 0 ? (
              <div className="mt-3">
                <InlineAlert tone="warning">
                  {t('มีการชำระเงินรอยืนยัน ปิดกะไม่ได้จนกว่าจะตรวจสอบ', 'A payment is still pending; the shift cannot close yet.')}
                </InlineAlert>
              </div>
            ) : null}
          </Card>
          <Card>
            <CardHeader title={t('ช่องทางชำระในกะ', 'Tender in shift')} />
            <div className="px-5 pb-5">
              {summary.payments.length === 0 ? (
                <p className="text-[12px] text-faint">{t('ยังไม่มีการชำระเงิน', 'No payments yet')}</p>
              ) : (
                summary.payments.map((payment) => (
                  <div key={payment.method} className="flex items-center justify-between border-b border-line/60 py-1.5 text-[12px] last:border-0">
                    <span className="text-muted">
                      {payment.methodName} <span className="text-[10px] text-faint">({payment.count})</span>
                    </span>
                    <span className="num font-medium">{money(payment.amountSatang)}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      ) : (
        <Card className="mb-4">
          <EmptyState
            icon={<Wallet className="h-5 w-5" />}
            title={t('ยังไม่มีกะที่เปิดอยู่', 'No open shift for this store')}
            description={t('เปิดกะเพื่อเริ่มรับชำระเงินและกระทบยอดเงินสด', 'Open a shift before taking payments and reconciling cash.')}
            action={
              can('shifts.open') ? (
                <Button variant="primary" onClick={() => setOpenModal(true)}>
                  {t('เปิดกะ', 'Open shift')}
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      <Card>
        <CardHeader
          title={t('ประวัติกะ', 'Shift history')}
          description={t('ยอดคาดหวังและส่วนต่างที่บันทึกไว้', 'Recorded expected cash and variance')}
        />
        {history.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Clock className="h-5 w-5" />} title={t('ยังไม่มีประวัติกะ', 'No shifts yet')} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <TH>{t('วันที่', 'Date')}</TH>
                  <TH>{t('พนักงาน', 'Cashier')}</TH>
                  <TH>{t('สาขา', 'Store')}</TH>
                  <TH align="right">{t('ยอดขาย', 'Sales')}</TH>
                  <TH align="right">{t('ควรมี', 'Expected')}</TH>
                  <TH align="right">{t('นับได้', 'Counted')}</TH>
                  <TH align="right">{t('ผลต่าง', 'Variance')}</TH>
                  <TH>{t('สถานะ', 'Status')}</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((shift) => (
                  <TR key={shift.id} onClick={() => setDetailShift(shift.id)}>
                    <TD>
                      <span className="text-[12px]">{dateTime(shift.openedAt)}</span>
                      <span className="block text-[10px] text-faint">{shift.terminalName || '—'}</span>
                    </TD>
                    <TD className="text-[12px]">{shift.employeeName}</TD>
                    <TD className="text-[12px] text-muted">{shift.storeName}</TD>
                    <TD align="right" className="num">{money(shift.salesTotalSatang)}</TD>
                    <TD align="right" className="num">{shift.expectedCashSatang != null ? money(shift.expectedCashSatang) : '—'}</TD>
                    <TD align="right" className="num">{shift.countedCashSatang != null ? money(shift.countedCashSatang) : '—'}</TD>
                    <TD align="right" className="num">
                      {shift.varianceSatang == null ? (
                        '—'
                      ) : shift.varianceSatang === 0 ? (
                        <span className="text-jade">0.00</span>
                      ) : (
                        <span className={shift.varianceSatang > 0 ? 'text-amber' : 'text-danger'}>
                          {money(shift.varianceSatang)}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <ShiftStatusBadge status={shift.status} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={page}
              totalPages={Number(meta?.totalPages ?? 1)}
              total={Number(meta?.total ?? 0)}
              onPage={setPage}
            />
          </>
        )}
      </Card>

      <Modal
        open={openModal}
        onClose={() => setOpenModal(false)}
        title={t('เปิดกะ', 'Open shift')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpenModal(false)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void openShift()}>
              {t('เปิดกะ', 'Open shift')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('เงินสดเริ่มต้น', 'Opening cash')}>
            <MoneyInput value={openingCash} onChange={setOpeningCash} />
          </Field>
          <Field label={t('เครื่อง / จุดขาย', 'Terminal')}>
            <Input value={terminal} onChange={(event) => setTerminal(event.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={closeModal}
        onClose={() => setCloseModal(false)}
        title={t('ปิดกะ', 'Close shift')}
        description={t('นับเงินสดจริงในลิ้นชัก', 'Count the cash physically in the drawer.')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloseModal(false)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void closeShift()}>
              {t('ยืนยันปิดกะ', 'Close shift')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-surface-2 p-3 text-[12px]">
            <div className="flex justify-between">
              <span className="text-muted">{t('เงินสดที่ควรมี', 'Expected')}</span>
              <span className="num font-medium">{money(summary?.expectedCashSatang ?? 0)}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted">{t('ส่วนต่าง', 'Variance')}</span>
              <span className={counted - (summary?.expectedCashSatang ?? 0) === 0 ? 'num text-jade' : 'num text-amber'}>
                {money(counted - (summary?.expectedCashSatang ?? 0))}
              </span>
            </div>
          </div>
          <Field label={t('เงินสดนับได้', 'Counted cash')}>
            <MoneyInput value={counted} onChange={setCounted} />
          </Field>
          <CashCountHelper expectedSatang={summary?.expectedCashSatang ?? 0} onChange={setCounted} />
          <Field label={t('หมายเหตุ', 'Note')}>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={cashModal !== null}
        onClose={() => setCashModal(null)}
        title={cashModal === 'cash_in' ? t('รับเงินสดเข้า', 'Cash in') : t('จ่ายเงินสดออก', 'Cash out')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCashModal(null)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={cashAmount <= 0 || cashReason.trim().length < 2}
              onClick={() => void recordCash()}
            >
              {t('บันทึก', 'Record')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('จำนวนเงิน', 'Amount')}>
            <MoneyInput value={cashAmount} onChange={setCashAmount} />
          </Field>
          <Field label={t('เหตุผล', 'Reason')}>
            <Input value={cashReason} onChange={(event) => setCashReason(event.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(detailShift)}
        onClose={() => setDetailShift(null)}
        title={t('สรุปกะ', 'Shift summary')}
        size="md"
        footer={
          detail.data ? (
            <>
              <Button variant="ghost" onClick={() => setDetailShift(null)}>
                {t('ปิด', 'Close')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const s = detail.data.data;
                  const row = rows.find((shift) => shift.id === detailShift);
                  printShiftReport({
                    businessName: me?.business?.name ?? 'NEXORA',
                    storeName: s.shift ? (row?.storeName ?? me?.store?.name ?? '') : '',
                    cashier: row?.employeeName ?? me?.employee?.displayName ?? '',
                    mode: s.shift.status === 'closed' ? 'Z' : 'X',
                    openedAt: s.shift.opened_at,
                    closedAt: s.shift.closed_at,
                    businessDate: s.shift.business_date,
                    salesCount: s.salesCount,
                    salesTotalSatang: s.salesTotalSatang,
                    discountSatang: s.discountSatang ?? 0,
                    taxSatang: s.taxSatang ?? 0,
                    refundTotalSatang: s.refundTotalSatang,
                    openingCashSatang: s.shift.opening_cash_satang,
                    cashSalesSatang: s.cashSalesSatang,
                    cashInSatang: s.cashInSatang,
                    cashOutSatang: s.cashOutSatang,
                    expectedCashSatang: s.expectedCashSatang,
                    countedCashSatang: s.shift.counted_cash_satang,
                    varianceSatang: s.shift.variance_satang,
                    payments: s.payments,
                    topItems: s.topItems,
                  });
                }}
              >
                {t('พิมพ์สรุปกะ', 'Print report')}
              </Button>
            </>
          ) : null
        }
      >
        {detail.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : detail.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: t('ยอดขาย', 'Sales'), value: money(detail.data.data.salesTotalSatang) },
                { label: t('บิล', 'Orders'), value: number(detail.data.data.salesCount) },
                { label: t('เงินสดควรมี', 'Expected cash'), value: money(detail.data.data.expectedCashSatang) },
                {
                  label: t('ผลต่าง', 'Variance'),
                  value: detail.data.data.shift.variance_satang != null ? money(detail.data.data.shift.variance_satang) : '—',
                },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-line p-3">
                  <p className="text-[10px] text-faint">{item.label}</p>
                  <p className="num mt-0.5 text-[15px] font-semibold">{item.value}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium text-muted">{t('สินค้าขายดีในกะ', 'Top items')}</p>
              {detail.data.data.topItems.map((item) => (
                <div key={item.name} className="flex justify-between border-b border-line/60 py-1.5 text-[12px]">
                  <span>{item.name} <span className="text-[10px] text-faint">×{item.qty}</span></span>
                  <span className="num">{money(item.amountSatang)}</span>
                </div>
              ))}
              {detail.data.data.topItems.length === 0 ? (
                <p className="text-[12px] text-faint">{t('ไม่มีรายการ', 'No items')}</p>
              ) : null}
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium text-muted">{t('การชำระเงิน', 'Payments')}</p>
              {detail.data.data.payments.map((payment) => (
                <div key={payment.method} className="flex justify-between border-b border-line/60 py-1.5 text-[12px]">
                  <span>{payment.methodName} ({payment.count})</span>
                  <span className="num">{money(payment.amountSatang)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>
    </PageBody>
  );
}
