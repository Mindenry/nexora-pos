import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Printer, RotateCcw, Undo2 } from 'lucide-react';
import { uuidv7 } from '@nexora/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { printReceipt } from '../lib/print';
import { PageBody, PageHeader } from '../components/shell';
import { SaleStatusBadge } from '../components/status';
import { ReceiptView, type ReceiptSnapshot } from '../components/receipt';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  Modal,
  Skeleton,
  Table,
  TD,
  Textarea,
  TH,
  TR,
  useToast,
} from '../components/ui';

interface SaleDetail {
  id: string;
  number: string;
  status: string;
  businessDate: string;
  occurredAt: string;
  createdAt: string;
  subtotalSatang: number;
  discountSatang: number;
  taxSatang: number;
  totalSatang: number;
  costSatang: number;
  refundedSatang: number;
  changeSatang: number;
  itemCount: number;
  note: string;
  voidReason: string | null;
  storeId: string;
  storeName: string;
  storeAddress: string;
  employeeName: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  receipt: ReceiptSnapshot;
  items: Array<{
    id: string;
    productName: string;
    variantName: string;
    sku: string;
    qty: number;
    unitPriceSatang: number;
    discountSatang: number;
    taxSatang: number;
    lineTotalSatang: number;
    refundedQty: number;
    refundableQty: number;
  }>;
  payments: Array<{
    id: string;
    method: string;
    methodName: string;
    status: string;
    amountSatang: number;
    tenderedSatang: number | null;
    changeSatang: number;
    reference: string;
    paidAt: string | null;
  }>;
  refunds: Array<{
    id: string;
    number: string;
    amountSatang: number;
    taxSatang: number;
    reason: string;
    method: string;
    restock: boolean;
    createdAt: string;
  }>;
}

export function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useLang();
  const { money, dateTime } = useFormat();
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [refundOpen, setRefundOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [refundQty, setRefundQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [voidReason, setVoidReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refundResult, setRefundResult] = useState<ReceiptSnapshot | null>(null);

  const query = useQuery({
    queryKey: ['sale', id],
    queryFn: () => api<SaleDetail>(`/sales/${id}`),
    enabled: Boolean(id),
  });

  const sale = query.data?.data;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['sale', id] });
    await queryClient.invalidateQueries({ queryKey: ['sales'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const printCurrent = async () => {
    try {
      const result = await api<ReceiptSnapshot>(`/sales/${id}/receipt`);
      printReceipt(result.data);
    } catch (error) {
      toast.error(t('พิมพ์ใบเสร็จไม่สำเร็จ', 'Print failed'), errorMessage(error, locale));
    }
  };

  const reprint = async () => {
    try {
      const result = await api<ReceiptSnapshot>(`/sales/${id}/reprint`, { method: 'POST', body: {} });
      printReceipt(result.data);
      toast.success(t('พิมพ์ซ้ำแล้ว', 'Reprinted'));
    } catch (error) {
      toast.error(t('พิมพ์ซ้ำไม่สำเร็จ', 'Reprint failed'), errorMessage(error, locale));
    }
  };

  const selectedItems = Object.entries(refundQty)
    .filter(([, qty]) => qty > 0)
    .map(([saleItemId, qty]) => ({ saleItemId, qty }));

  const refundEstimate = (sale?.items ?? []).reduce((sum, item) => {
    const qty = refundQty[item.id] ?? 0;
    if (qty <= 0) return sum;
    return sum + Math.round((item.lineTotalSatang * qty) / item.qty);
  }, 0);

  const submitRefund = async () => {
    if (!sale || selectedItems.length === 0 || reason.trim().length < 3) return;
    setSubmitting(true);
    try {
      const result = await api<{ refundId: string; number: string; receipt: ReceiptSnapshot }>('/refunds', {
        method: 'POST',
        body: {
          operationId: uuidv7(),
          saleId: sale.id,
          items: selectedItems,
          reason,
          restock,
        },
      });
      setRefundOpen(false);
      setRefundQty({});
      setReason('');
      setRefundResult(result.data.receipt);
      await refresh();
      toast.success(t('คืนสินค้าสำเร็จ', 'Refund recorded'), result.data.number);
    } catch (error) {
      toast.error(t('คืนสินค้าไม่สำเร็จ', 'Refund failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const submitVoid = async () => {
    if (!sale || voidReason.trim().length < 3) return;
    setSubmitting(true);
    try {
      await api(`/sales/${sale.id}/void`, {
        method: 'POST',
        body: { operationId: uuidv7(), reason: voidReason },
      });
      setVoidOpen(false);
      setVoidReason('');
      await refresh();
      toast.success(t('ยกเลิกบิลแล้ว', 'Sale voided'));
    } catch (error) {
      toast.error(t('ยกเลิกบิลไม่สำเร็จ', 'Void failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  if (query.isLoading) {
    return (
      <PageBody>
        <Skeleton className="mb-4 h-8 w-64" />
        <div className="grid gap-4 xl:grid-cols-3">
          <Skeleton className="h-80 rounded-xl xl:col-span-2" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </PageBody>
    );
  }

  if (!sale) {
    return (
      <PageBody>
        <EmptyState
          title={t('ไม่พบรายการขาย', 'Sale not found')}
          description={errorMessage(query.error, locale)}
          action={
            <Button variant="secondary" onClick={() => navigate('/sales')}>
              {t('กลับรายการขาย', 'Back to sales')}
            </Button>
          }
        />
      </PageBody>
    );
  }

  const refundable = sale.status === 'completed' || sale.status === 'partially_refunded';
  const canRefund = refundable && sale.items.some((item) => item.refundableQty > 0) && can('refunds.create');
  const canVoid = sale.status === 'completed' && sale.refundedSatang === 0 && can('sales.cancel');

  return (
    <PageBody>
      <button
        type="button"
        onClick={() => navigate('/sales')}
        className="mb-3 flex items-center gap-1 text-[12px] text-muted hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('กลับรายการขาย', 'Back to sales')}
      </button>
      <PageHeader
        title={
          <span className="num flex flex-wrap items-center gap-3">
            {sale.number}
            <span className="num text-[16px] font-normal text-muted">{money(sale.totalSatang)}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SaleStatusBadge status={sale.status} />
            <span>{dateTime(sale.occurredAt)} · {sale.storeName} · {sale.employeeName}</span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" leftIcon={<Printer className="h-4 w-4" />} onClick={() => void printCurrent()}>
              {t('พิมพ์', 'Print')}
            </Button>
            {can('sales.read') ? (
              <Button variant="secondary" leftIcon={<Undo2 className="h-4 w-4" />} onClick={() => void reprint()}>
                {t('พิมพ์ซ้ำ', 'Reprint')}
              </Button>
            ) : null}
            {canVoid ? (
              <Button variant="secondary" leftIcon={<Ban className="h-4 w-4" />} onClick={() => setVoidOpen(true)}>
                {t('ยกเลิกบิล', 'Void')}
              </Button>
            ) : null}
            {canRefund ? (
              <Button variant="primary" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={() => setRefundOpen(true)}>
                {t('คืนสินค้า', 'Refund')}
              </Button>
            ) : null}
          </>
        }
      />

      {sale.status === 'voided' ? (
        <div className="mb-4">
          <InlineAlert tone="danger" title={t('บิลนี้ถูกยกเลิก', 'This sale was voided')}>
            {sale.voidReason}
          </InlineAlert>
        </div>
      ) : null}
      {sale.customerId ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Badge tone="info">{sale.customerName}</Badge>
          <span>{sale.customerPhone}</span>
          <button
            type="button"
            className="text-jade hover:underline"
            onClick={() => navigate(`/customers?customer=${sale.customerId}`)}
          >
            {t('ดูประวัติลูกค้า', 'View customer')}
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader
              title={t('รายการสินค้า', 'Items')}
              description={`${sale.itemCount} ${t('ชิ้น', 'units')}`}
              action={
                <span className="num text-[12px] text-muted">
                  {t('ต้นทุน', 'Cost')} {money(sale.costSatang)}
                </span>
              }
            />
            <Table>
              <thead>
                <tr>
                  <TH>{t('สินค้า', 'Product')}</TH>
                  <TH align="right">{t('จำนวน', 'Qty')}</TH>
                  <TH align="right">{t('ราคา/หน่วย', 'Unit')}</TH>
                  <TH align="right">{t('ส่วนลด', 'Discount')}</TH>
                  <TH align="right">{t('รวม', 'Total')}</TH>
                  <TH align="right">{t('คืนแล้ว', 'Refunded')}</TH>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <p className="text-[12.5px] font-medium">{item.productName}</p>
                      <p className="text-[10px] text-faint">
                        {item.variantName} · {item.sku}
                      </p>
                    </TD>
                    <TD align="right" className="num">{item.qty}</TD>
                    <TD align="right" className="num">{money(item.unitPriceSatang)}</TD>
                    <TD align="right" className="num">{money(item.discountSatang)}</TD>
                    <TD align="right" className="num font-medium">{money(item.lineTotalSatang)}</TD>
                    <TD align="right" className="num">
                      {item.refundedQty > 0 ? (
                        <Badge tone="amber">{item.refundedQty}</Badge>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <div className="ml-auto max-w-xs space-y-1 border-t border-line px-5 py-3 text-[12px]">
              <div className="flex justify-between text-muted">
                <span>{t('ยอดรวมสินค้า', 'Subtotal')}</span>
                <span className="num">{money(sale.subtotalSatang)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>{t('ส่วนลด', 'Discount')}</span>
                <span className="num">-{money(sale.discountSatang)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>{t('VAT', 'VAT')}</span>
                <span className="num">{money(sale.taxSatang)}</span>
              </div>
              <div className="flex justify-between border-t border-line pt-1.5 text-[14px] font-semibold">
                <span>{t('ยอดสุทธิ', 'Total')}</span>
                <span className="num">{money(sale.totalSatang)}</span>
              </div>
              {sale.refundedSatang > 0 ? (
                <div className="flex justify-between text-amber">
                  <span>{t('คืนแล้ว', 'Refunded')}</span>
                  <span className="num">-{money(sale.refundedSatang)}</span>
                </div>
              ) : null}
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title={t('การชำระเงิน', 'Payments')} />
              <div className="space-y-2 px-5 pb-5">
                {sale.payments.map((payment) => (
                  <div key={payment.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[12.5px] font-medium">{payment.methodName || payment.method}</p>
                        <p className="text-[10px] text-faint">
                          {payment.reference ? `${payment.reference} · ` : ''}
                          {payment.paidAt ? dateTime(payment.paidAt) : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="num text-[12.5px] font-medium">{money(payment.amountSatang)}</p>
                        <Badge tone={payment.status === 'paid' ? 'jade' : 'amber'} className="mt-0.5">
                          {payment.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
                {sale.changeSatang > 0 ? (
                  <p className="text-right text-[11px] text-muted">
                    {t('เงินทอน', 'Change')} <span className="num font-medium text-text">{money(sale.changeSatang)}</span>
                  </p>
                ) : null}
              </div>
            </Card>
            <Card>
              <CardHeader title={t('การคืนสินค้า', 'Refunds')} />
              {sale.refunds.length === 0 ? (
                <p className="px-5 pb-5 text-[12px] text-faint">{t('ยังไม่มีการคืนสินค้า', 'No refunds')}</p>
              ) : (
                <div className="space-y-2 px-5 pb-5">
                  {sale.refunds.map((refund) => (
                    <div key={refund.id} className="rounded-lg border border-line p-3">
                      <div className="flex items-center justify-between">
                        <p className="num text-[12px] font-medium">{refund.number}</p>
                        <span className="num text-[12.5px] font-medium text-amber">-{money(refund.amountSatang)}</span>
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-muted">{refund.reason}</p>
                      <p className="text-[10px] text-faint">
                        {dateTime(refund.createdAt)} · {refund.method} ·{' '}
                        {refund.restock ? t('คืนเข้าสต๊อก', 'restocked') : t('ไม่คืนสต๊อก', 'not restocked')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>

        <div>
          <ReceiptView receipt={sale.receipt} onPrint={() => void printCurrent()} />
          <p className="mt-2 text-center text-[10px] text-faint">
            {t('ใบเสร็จที่บันทึกไว้จะไม่เปลี่ยนแม้ราคาสินค้าจะเปลี่ยนภายหลัง', 'The receipt snapshot never changes when prices change later.')}
          </p>
        </div>
      </div>

      <Modal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        title={t('คืนสินค้า', 'Create refund')}
        description={`${sale.number} · ${t('สูงสุด', 'max')} ${money(sale.totalSatang - sale.refundedSatang)}`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefundOpen(false)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={selectedItems.length === 0 || reason.trim().length < 3}
              onClick={() => void submitRefund()}
            >
              {t('ยืนยันคืนสินค้า', 'Confirm refund')} · {money(refundEstimate)}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            {sale.items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium">{item.productName}</p>
                  <p className="text-[10.5px] text-faint">
                    {item.sku} · {t('ซื้อ', 'bought')} {item.qty} · {t('คืนได้', 'refundable')} {item.refundableQty} ·{' '}
                    {money(item.lineTotalSatang)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={item.refundableQty}
                    value={refundQty[item.id] ?? 0}
                    onChange={(event) =>
                      setRefundQty((prev) => ({
                        ...prev,
                        [item.id]: Math.max(0, Math.min(item.refundableQty, Number(event.target.value) || 0)),
                      }))
                    }
                    className="h-8 w-20 text-right"
                    disabled={item.refundableQty === 0}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setRefundQty((prev) => ({ ...prev, [item.id]: item.refundableQty }))
                    }
                    disabled={item.refundableQty === 0}
                  >
                    {t('ทั้งหมด', 'All')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Field label={t('เหตุผลการคืน', 'Reason')} required>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder={t('เช่น สินค้าชำรุด, ลูกค้าเปลี่ยนใจ', 'e.g. damaged, customer changed mind')}
            />
          </Field>
          <Checkbox
            checked={restock}
            onChange={setRestock}
            label={t('รับสินค้าคืนเข้าสต๊อก', 'Restock returned items')}
          />
          <p className="rounded-lg bg-surface-2 p-2.5 text-[11px] text-muted">
            {t(
              'การคืนเงินสดจะถูกบันทึกในกะที่เปิดอยู่ และต้องไม่เกินยอดที่รับชำระไว้',
              'Cash refunds are recorded in the open shift and cannot exceed the amount originally captured.',
            )}
          </p>
        </div>
      </Modal>

      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={t('ยกเลิกบิล', 'Void sale')}
        description={t('การยกเลิกจะคืนสต๊อกและกลับรายการเงินสดแบบทันที', 'This reverses stock and cash immediately.')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoidOpen(false)}>
              {t('ไม่ยกเลิก', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              loading={submitting}
              disabled={voidReason.trim().length < 3}
              onClick={() => void submitVoid()}
            >
              {t('ยืนยันยกเลิกบิล', 'Void sale')}
            </Button>
          </>
        }
      >
        <Field label={t('เหตุผล', 'Reason')} required>
          <Textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} rows={3} />
        </Field>
      </Modal>

      <Modal
        open={Boolean(refundResult)}
        onClose={() => setRefundResult(null)}
        title={t('คืนสินค้าสำเร็จ', 'Refund complete')}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => refundResult && printReceipt(refundResult)} leftIcon={<Printer className="h-4 w-4" />}>
              {t('พิมพ์ใบรับคืน', 'Print refund slip')}
            </Button>
            <Button variant="primary" onClick={() => setRefundResult(null)}>
              {t('เสร็จสิ้น', 'Done')}
            </Button>
          </>
        }
      >
        {refundResult ? <ReceiptView receipt={refundResult} onPrint={() => printReceipt(refundResult)} /> : null}
      </Modal>
    </PageBody>
  );
}
