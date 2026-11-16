import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Boxes,
  ClipboardCheck,
  RefreshCw,
  SlidersHorizontal,
  Truck,
} from 'lucide-react';
import { uuidv7 } from '@nexora/shared';
import { api, errorMessage, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { PageBody, PageHeader } from '../components/shell';
import { TransferStatusBadge } from '../components/status';
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
  SearchInput,
  Select,
  Skeleton,
  Table,
  TD,
  Textarea,
  TH,
  TR,
  Tabs,
  cn,
  useToast,
} from '../components/ui';

interface StockRow {
  variantId: string;
  variantName: string;
  sku: string | null;
  barcode: string | null;
  productId: string;
  productName: string;
  categoryName: string | null;
  trackInventory: boolean;
  reorderPoint: number;
  costSatang: number;
  priceSatang: number;
  onHand: number;
  stockValueSatang: number;
}

interface MovementRow {
  id: string;
  type: string;
  qtyDelta: number;
  unitCostSatang: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
  productName: string;
  variantName: string;
  sku: string | null;
  actorName: string | null;
}

interface TransferRow {
  id: string;
  number: string;
  status: string;
  note: string;
  fromStore: string;
  toStore: string;
  totalQty: number;
  createdAt: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
}

interface TransferDetail extends TransferRow {
  fromStoreId: string;
  toStoreId: string;
  items: Array<{
    id: string;
    variantId: string;
    qty: number;
    receivedQty: number;
    productName: string;
    variantName: string;
    sku: string | null;
  }>;
}

interface StoreRow {
  id: string;
  code: string;
  name: string;
}

const MOVEMENT_LABELS: Record<string, { th: string; en: string; tone: 'jade' | 'amber' | 'danger' | 'info' | 'neutral' }> = {
  initial_load: { th: 'สต๊อกเริ่มต้น', en: 'Initial load', tone: 'info' },
  purchase_receipt: { th: 'รับสินค้า', en: 'Purchase receipt', tone: 'jade' },
  sales_deduction: { th: 'ขาย', en: 'Sale', tone: 'neutral' },
  sales_return: { th: 'รับคืน', en: 'Sales return', tone: 'amber' },
  transfer_out: { th: 'โอนออก', en: 'Transfer out', tone: 'amber' },
  transfer_in: { th: 'โอนเข้า', en: 'Transfer in', tone: 'jade' },
  adjustment_increase: { th: 'ปรับเพิ่ม', en: 'Adjust +', tone: 'info' },
  adjustment_decrease: { th: 'ปรับลด', en: 'Adjust −', tone: 'amber' },
  stock_count: { th: 'ตรวจนับ', en: 'Stock count', tone: 'info' },
  purchase_return: { th: 'คืนผู้จำหน่าย', en: 'Purchase return', tone: 'danger' },
};

export function InventoryPage() {
  const { t, locale } = useLang();
  const { money, number, dateTime } = useFormat();
  const { can, storeId, me } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<'overview' | 'movements' | 'transfers'>('overview');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [adjustTarget, setAdjustTarget] = useState<StockRow | null>(null);
  const [adjustDirection, setAdjustDirection] = useState<'increase' | 'decrease'>('increase');
  const [adjustQty, setAdjustQty] = useState(1);
  const [adjustReason, setAdjustReason] = useState('');
  const [countOpen, setCountOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [countNote, setCountNote] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferLines, setTransferLines] = useState<Array<{ variantId: string; qty: number }>>([]);
  const [transferVariant, setTransferVariant] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [movementPage, setMovementPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const overview = useQuery({
    queryKey: ['inventory', 'overview', page, search, lowOnly, storeId],
    queryFn: () =>
      api<StockRow[]>(`/inventory/overview${qs({ page, pageSize: 20, search: search || undefined, lowStock: lowOnly || undefined })}`),
    enabled: can('inventory.read'),
  });

  const allStock = useQuery({
    queryKey: ['inventory', 'all', storeId],
    queryFn: () => api<StockRow[]>('/inventory/overview?pageSize=100'),
    enabled: can('inventory.read') && (countOpen || transferOpen),
  });

  const movements = useQuery({
    queryKey: ['inventory', 'movements', movementPage, storeId],
    queryFn: () => api<MovementRow[]>(`/inventory/movements${qs({ page: movementPage, pageSize: 25 })}`),
    enabled: can('inventory.read') && tab === 'movements',
  });

  const transfers = useQuery({
    queryKey: ['transfers', storeId],
    queryFn: () => api<TransferRow[]>('/transfers?pageSize=30'),
    enabled: can('inventory.read') && tab === 'transfers',
  });

  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api<StoreRow[]>('/stores'),
    enabled: can('inventory.transfer'),
  });

  const detail = useQuery({
    queryKey: ['transfer', detailId],
    queryFn: () => api<TransferDetail>(`/transfers/${detailId}`),
    enabled: Boolean(detailId),
  });

  const rows = overview.data?.data ?? [];
  const summary = overview.data?.meta?.summary as
    | { totalValueSatang: number; totalUnits: number; lowStockCount: number }
    | undefined;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory'] });
    await queryClient.invalidateQueries({ queryKey: ['transfers'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
  };

  const submitAdjust = async () => {
    if (!adjustTarget || adjustQty <= 0 || adjustReason.trim().length < 3) return;
    setSubmitting(true);
    try {
      await api('/inventory/adjust', {
        method: 'POST',
        body: {
          operationId: uuidv7(),
          variantId: adjustTarget.variantId,
          direction: adjustDirection,
          qty: adjustQty,
          reason: adjustReason,
        },
      });
      setAdjustTarget(null);
      setAdjustQty(1);
      setAdjustReason('');
      await refresh();
      toast.success(t('ปรับสต๊อกแล้ว', 'Stock adjusted'));
    } catch (error) {
      toast.error(t('ปรับสต๊อกไม่สำเร็จ', 'Adjustment failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const openCount = async () => {
    await allStock.refetch();
    const list = allStock.data?.data ?? [];
    const initial: Record<string, number> = {};
    for (const row of list) initial[row.variantId] = row.onHand;
    setCounts(initial);
    setCountOpen(true);
  };

  const submitCount = async () => {
    const items = Object.entries(counts).map(([variantId, countedQty]) => ({ variantId, countedQty }));
    if (items.length === 0) return;
    setSubmitting(true);
    try {
      const result = await api<{ variances: Array<{ difference: number }> }>('/inventory/counts', {
        method: 'POST',
        body: { operationId: uuidv7(), note: countNote, items },
      });
      const changed = result.data.variances.filter((v) => v.difference !== 0).length;
      setCountOpen(false);
      setCountNote('');
      await refresh();
      toast.success(t('บันทึกการตรวจนับแล้ว', 'Stock count recorded'), `${changed} ${t('รายการปรับ', 'adjustments')}`);
    } catch (error) {
      toast.error(t('ตรวจนับไม่สำเร็จ', 'Count failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const submitTransfer = async () => {
    if (!transferTarget || transferLines.length === 0) return;
    setSubmitting(true);
    try {
      await api('/transfers', {
        method: 'POST',
        body: {
          operationId: uuidv7(),
          toStoreId: transferTarget,
          note: transferNote,
          items: transferLines,
        },
      });
      setTransferOpen(false);
      setTransferLines([]);
      setTransferNote('');
      await queryClient.invalidateQueries({ queryKey: ['transfers'] });
      toast.success(t('สร้างใบโอนแล้ว', 'Transfer created'));
    } catch (error) {
      toast.error(t('สร้างใบโอนไม่สำเร็จ', 'Transfer failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const dispatchTransfer = async (id: string) => {
    setSubmitting(true);
    try {
      await api(`/transfers/${id}/dispatch`, {
        method: 'POST',
        body: { operationId: uuidv7() },
      });
      await refresh();
      await detail.refetch();
      toast.success(t('ส่งสินค้าออกแล้ว', 'Transfer dispatched'));
    } catch (error) {
      toast.error(t('ส่งออกไม่สำเร็จ', 'Dispatch failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const submitReceive = async () => {
    if (!detail.data) return;
    const items = Object.entries(receiveQty)
      .filter(([, qty]) => qty > 0)
      .map(([transferItemId, qty]) => ({ transferItemId, qty }));
    if (items.length === 0) return;
    setSubmitting(true);
    try {
      await api(`/transfers/${detail.data.data.id}/receive`, {
        method: 'POST',
        body: { operationId: uuidv7(), items },
      });
      await refresh();
      await detail.refetch();
      toast.success(t('รับสินค้าแล้ว', 'Transfer received'));
    } catch (error) {
      toast.error(t('รับสินค้าไม่สำเร็จ', 'Receive failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const transferDetail = detail.data?.data;
  useEffect(() => {
    if (!transferDetail) return;
    const initial: Record<string, number> = {};
    for (const item of transferDetail.items) initial[item.id] = item.qty - item.receivedQty;
    setReceiveQty(initial);
  }, [transferDetail]);

  const canReceive =
    transferDetail &&
    transferDetail.status === 'dispatched' &&
    me?.store?.id === transferDetail.toStoreId;

  const selectedVariant = useMemo(
    () => (allStock.data?.data ?? []).find((row) => row.variantId === transferVariant),
    [allStock.data, transferVariant],
  );

  return (
    <PageBody>
      <PageHeader
        title={t('สต๊อกสินค้า', 'Inventory')}
        description={t('สต๊อกคำนวณจากรายการเคลื่อนไหว ไม่มีตัวเลขที่แก้ไขตรง ๆ', 'Stock is the sum of movements — never an editable number.')}
        actions={
          <>
            {can('inventory.count') ? (
              <Button variant="secondary" leftIcon={<ClipboardCheck className="h-4 w-4" />} onClick={() => void openCount()}>
                {t('ตรวจนับสต๊อก', 'Stock count')}
              </Button>
            ) : null}
            {can('inventory.transfer') ? (
              <Button variant="primary" leftIcon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setTransferOpen(true)}>
                {t('โอนสินค้า', 'Transfer')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: t('มูลค่าสต๊อก (ทุน)', 'Stock value (cost)'), value: money(summary?.totalValueSatang ?? 0), icon: Boxes },
          { label: t('หน่วยในสต๊อก', 'Units on hand'), value: number(summary?.totalUnits ?? 0), icon: Boxes },
          { label: t('ต่ำกว่าจุดสั่งซื้อ', 'Below reorder point'), value: number(summary?.lowStockCount ?? 0), icon: SlidersHorizontal },
        ].map((item) => (
          <Card key={item.label} className="flex items-center gap-3 p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-jade-soft text-jade">
              <item.icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-faint">{item.label}</p>
              <p className="num text-[18px] font-semibold">{item.value}</p>
            </div>
          </Card>
        ))}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: t('ภาพรวมสต๊อก', 'Stock overview') },
          { value: 'movements', label: t('ประวัติเคลื่อนไหว', 'Movements') },
          { value: 'transfers', label: t('โอนระหว่างสาขา', 'Transfers') },
        ]}
        className="mb-3"
      />

      {tab === 'overview' ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <div className="w-full max-w-[280px]">
              <SearchInput value={searchInput} onChange={setSearchInput} placeholder={t('ค้นหาสินค้า / SKU', 'Search product / SKU')} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={lowOnly}
                onChange={(event) => {
                  setLowOnly(event.target.checked);
                  setPage(1);
                }}
                className="h-3.5 w-3.5 accent-[var(--jade)]"
              />
              {t('เฉพาะต่ำกว่าจุดสั่งซื้อ', 'Low stock only')}
            </label>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void overview.refetch()} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
              {t('รีเฟรช', 'Refresh')}
            </Button>
          </div>
          {overview.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 7 }).map((_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon={<Boxes className="h-5 w-5" />} title={t('ไม่พบสินค้าในสต๊อก', 'No stock rows')} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <TH>{t('สินค้า', 'Product')}</TH>
                    <TH>{t('หมวด', 'Category')}</TH>
                    <TH align="right">{t('คงเหลือ', 'On hand')}</TH>
                    <TH align="right">{t('จุดสั่งซื้อ', 'Reorder')}</TH>
                    <TH align="right">{t('ทุน/หน่วย', 'Unit cost')}</TH>
                    <TH align="right">{t('มูลค่า', 'Value')}</TH>
                    <TH align="right">{t('จัดการ', 'Actions')}</TH>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const low = row.trackInventory && row.onHand <= row.reorderPoint;
                    return (
                      <TR key={row.variantId}>
                        <TD>
                          <p className="text-[12.5px] font-medium">{row.productName}</p>
                          <p className="text-[10px] text-faint">
                            {row.variantName !== 'มาตรฐาน' ? `${row.variantName} · ` : ''}
                            {row.sku ?? '—'}
                          </p>
                        </TD>
                        <TD className="text-[12px] text-muted">{row.categoryName ?? '—'}</TD>
                        <TD align="right">
                          <span className={cn('num text-[12.5px] font-medium', low && 'text-amber')}>{number(row.onHand)}</span>
                          {!row.trackInventory ? <span className="ml-1 text-[9px] text-faint">ไม่นับ</span> : null}
                        </TD>
                        <TD align="right" className="num text-muted">{row.reorderPoint}</TD>
                        <TD align="right" className="num">{money(row.costSatang)}</TD>
                        <TD align="right" className="num">{money(row.stockValueSatang)}</TD>
                        <TD align="right">
                          {can('inventory.adjust') && row.trackInventory ? (
                            <Button size="sm" variant="ghost" onClick={() => setAdjustTarget(row)}>
                              {t('ปรับ', 'Adjust')}
                            </Button>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination
                page={page}
                totalPages={Number(overview.data?.meta?.totalPages ?? 1)}
                total={Number(overview.data?.meta?.total ?? 0)}
                onPage={setPage}
              />
            </>
          )}
        </Card>
      ) : tab === 'movements' ? (
        <Card>
          {movements.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 7 }).map((_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : (movements.data?.data ?? []).length === 0 ? (
            <EmptyState icon={<Truck className="h-5 w-5" />} title={t('ยังไม่มีการเคลื่อนไหว', 'No movements yet')} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <TH>{t('เวลา', 'Time')}</TH>
                    <TH>{t('ประเภท', 'Type')}</TH>
                    <TH>{t('สินค้า', 'Product')}</TH>
                    <TH align="right">{t('จำนวน', 'Qty')}</TH>
                    <TH align="right">{t('ทุน/หน่วย', 'Unit cost')}</TH>
                    <TH>{t('เหตุผล', 'Reason')}</TH>
                    <TH>{t('ผู้ทำ', 'By')}</TH>
                  </tr>
                </thead>
                <tbody>
                  {(movements.data?.data ?? []).map((movement) => {
                    const label = MOVEMENT_LABELS[movement.type] ?? { th: movement.type, en: movement.type, tone: 'neutral' as const };
                    return (
                      <TR key={movement.id}>
                        <TD className="text-[11px] text-muted">{dateTime(movement.createdAt)}</TD>
                        <TD>
                          <Badge tone={label.tone}>{t(label.th, label.en)}</Badge>
                        </TD>
                        <TD>
                          <p className="text-[12px]">{movement.productName}</p>
                          <p className="text-[10px] text-faint">{movement.sku ?? '—'}</p>
                        </TD>
                        <TD align="right" className={cn('num font-medium', movement.qtyDelta > 0 ? 'text-jade' : 'text-amber')}>
                          {movement.qtyDelta > 0 ? '+' : ''}
                          {movement.qtyDelta}
                        </TD>
                        <TD align="right" className="num">{money(movement.unitCostSatang)}</TD>
                        <TD className="max-w-[240px] truncate text-[11.5px] text-muted">{movement.reason || '—'}</TD>
                        <TD className="text-[11px] text-muted">{movement.actorName ?? '—'}</TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination
                page={movementPage}
                totalPages={Number(movements.data?.meta?.totalPages ?? 1)}
                total={Number(movements.data?.meta?.total ?? 0)}
                onPage={setMovementPage}
              />
            </>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader title={t('ใบโอนสินค้า', 'Stock transfers')} description={t('ส่งออกแล้วต้องรับเข้าปลายทางเท่านั้น', 'Dispatch then receive at the destination.')} />
          {transfers.isLoading ? (
            <div className="space-y-2 px-4 pb-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : (transfers.data?.data ?? []).length === 0 ? (
            <EmptyState
              icon={<ArrowRightLeft className="h-5 w-5" />}
              title={t('ยังไม่มีใบโอน', 'No transfers yet')}
              action={
                can('inventory.transfer') ? (
                  <Button variant="primary" size="sm" onClick={() => setTransferOpen(true)}>
                    {t('สร้างใบโอน', 'Create transfer')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <TH>{t('เลขที่', 'Number')}</TH>
                  <TH>{t('เส้นทาง', 'Route')}</TH>
                  <TH align="right">{t('จำนวน', 'Qty')}</TH>
                  <TH>{t('สถานะ', 'Status')}</TH>
                  <TH>{t('สร้างเมื่อ', 'Created')}</TH>
                </tr>
              </thead>
              <tbody>
                {(transfers.data?.data ?? []).map((transfer) => (
                  <TR key={transfer.id} onClick={() => setDetailId(transfer.id)}>
                    <TD className="num text-[12px] font-medium">{transfer.number}</TD>
                    <TD className="text-[12px]">
                      {transfer.fromStore} → {transfer.toStore}
                    </TD>
                    <TD align="right" className="num">{transfer.totalQty}</TD>
                    <TD>
                      <TransferStatusBadge status={transfer.status} />
                    </TD>
                    <TD className="text-[11px] text-muted">{dateTime(transfer.createdAt)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <Modal
        open={Boolean(adjustTarget)}
        onClose={() => setAdjustTarget(null)}
        title={t('ปรับสต๊อก', 'Adjust stock')}
        description={adjustTarget ? `${adjustTarget.productName} · ${adjustTarget.sku ?? ''}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjustTarget(null)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={adjustQty <= 0 || adjustReason.trim().length < 3}
              onClick={() => void submitAdjust()}
            >
              {t('บันทึกการปรับ', 'Record adjustment')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex rounded-lg border border-line p-0.5">
            {(['increase', 'decrease'] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                onClick={() => setAdjustDirection(direction)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium',
                  adjustDirection === direction ? 'bg-jade-soft text-jade' : 'text-muted',
                )}
              >
                {direction === 'increase' ? t('เพิ่ม', 'Increase') : t('ลด', 'Decrease')}
              </button>
            ))}
          </div>
          <Field label={t('จำนวน', 'Quantity')}>
            <Input type="number" min={1} value={adjustQty} onChange={(event) => setAdjustQty(Number(event.target.value) || 1)} />
          </Field>
          <Field label={t('เหตุผล', 'Reason')} required>
            <Textarea value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} rows={2} placeholder={t('ต้องระบุเพื่อการตรวจสอบ', 'Required for audit')} />
          </Field>
          <p className="text-[10.5px] text-faint">
            {t('ระบบจะบันทึก movement ใหม่ ไม่แก้ไขยอดเดิม', 'A new movement is appended; balances are never edited.')}
          </p>
        </div>
      </Modal>

      <Modal
        open={countOpen}
        onClose={() => setCountOpen(false)}
        title={t('ตรวจนับสต๊อก', 'Stock count')}
        description={t('กรอกจำนวนที่นับได้จริง ระบบจะปรับเฉพาะส่วนต่าง', 'Enter counted quantities; only differences are adjusted.')}
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCountOpen(false)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submitCount()}>
              {t('บันทึกผลนับ', 'Submit count')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('หมายเหตุ', 'Note')}>
            <Input value={countNote} onChange={(event) => setCountNote(event.target.value)} placeholder={t('รอบนับ / ผู้ร่วมนับ', 'Count round / witnesses')} />
          </Field>
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-line">
            <Table>
              <thead>
                <tr>
                  <TH>{t('สินค้า', 'Product')}</TH>
                  <TH>{t('SKU', 'SKU')}</TH>
                  <TH align="right">{t('ในระบบ', 'System')}</TH>
                  <TH align="right">{t('นับได้', 'Counted')}</TH>
                  <TH align="right">{t('ส่วนต่าง', 'Difference')}</TH>
                </tr>
              </thead>
              <tbody>
                {(allStock.data?.data ?? []).map((row) => {
                  const counted = counts[row.variantId] ?? row.onHand;
                  const diff = counted - row.onHand;
                  return (
                    <TR key={row.variantId}>
                      <TD className="text-[12px]">{row.productName}</TD>
                      <TD className="text-[11px] text-faint">{row.sku ?? '—'}</TD>
                      <TD align="right" className="num">{row.onHand}</TD>
                      <TD align="right">
                        <Input
                          type="number"
                          min={0}
                          value={counted}
                          onChange={(event) =>
                            setCounts((prev) => ({ ...prev, [row.variantId]: Math.max(0, Number(event.target.value) || 0) }))
                          }
                          className="h-8 w-20 text-right"
                        />
                      </TD>
                      <TD align="right" className={cn('num', diff === 0 ? 'text-faint' : 'text-amber')}>
                        {diff > 0 ? '+' : ''}
                        {diff}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </div>
      </Modal>

      <Modal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        title={t('โอนสินค้าระหว่างสาขา', 'Transfer stock')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTransferOpen(false)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button variant="primary" loading={submitting} disabled={!transferTarget || transferLines.length === 0} onClick={() => void submitTransfer()}>
              {t('สร้างใบโอน', 'Create transfer')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('สาขาปลายทาง', 'Destination store')} required>
            <Select value={transferTarget} onChange={(event) => setTransferTarget(event.target.value)}>
              <option value="">{t('เลือกสาขา', 'Select a store')}</option>
              {(stores.data?.data ?? [])
                .filter((store) => store.id !== me?.store?.id)
                .map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="rounded-lg border border-line">
            <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
              <div className="min-w-[220px] flex-1">
                <Field label={t('สินค้า', 'Product')}>
                  <Select value={transferVariant} onChange={(event) => setTransferVariant(event.target.value)}>
                    <option value="">{t('เลือกสินค้า', 'Select product')}</option>
                    {(allStock.data?.data ?? []).map((row) => (
                      <option key={row.variantId} value={row.variantId}>
                        {row.productName} · {row.sku ?? ''} ({row.onHand})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="w-24">
                <Field label={t('จำนวน', 'Qty')}>
                  <Input
                    type="number"
                    min={1}
                    value={1}
                    onChange={(event) => {
                      const qty = Number(event.target.value) || 1;
                      setTransferLines((prev) =>
                        prev.map((line) =>
                          line.variantId === transferVariant ? { ...line, qty } : line,
                        ),
                      );
                    }}
                  />
                </Field>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!transferVariant}
                onClick={() => {
                  if (!transferVariant) return;
                  setTransferLines((prev) => {
                    if (prev.some((line) => line.variantId === transferVariant)) return prev;
                    return [...prev, { variantId: transferVariant, qty: 1 }];
                  });
                  setTransferVariant('');
                }}
              >
                {t('เพิ่ม', 'Add')}
              </Button>
            </div>
            <div className="divide-y divide-line">
              {transferLines.map((line) => {
                const row = (allStock.data?.data ?? []).find((r) => r.variantId === line.variantId);
                return (
                  <div key={line.variantId} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[12px]">{row?.productName} · {row?.sku}</span>
                    <Input
                      type="number"
                      min={1}
                      max={row?.onHand ?? line.qty}
                      value={line.qty}
                      onChange={(event) => {
                        const qty = Math.max(1, Math.min(row?.onHand ?? 9999, Number(event.target.value) || 1));
                        setTransferLines((prev) => prev.map((l) => (l.variantId === line.variantId ? { ...l, qty } : l)));
                      }}
                      className="h-8 w-20 text-right"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setTransferLines((prev) => prev.filter((l) => l.variantId !== line.variantId))}
                    >
                      ×
                    </Button>
                  </div>
                );
              })}
              {transferLines.length === 0 ? (
                <p className="px-3 py-4 text-center text-[11.5px] text-faint">{t('ยังไม่มีรายการ', 'No items yet')}</p>
              ) : null}
            </div>
          </div>
          <Field label={t('หมายเหตุ', 'Note')}>
            <Input value={transferNote} onChange={(event) => setTransferNote(event.target.value)} />
          </Field>
          {selectedVariant ? (
            <p className="text-[10.5px] text-faint">
              {t('คงเหลือต้นทาง', 'Source stock')} {selectedVariant.onHand}
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={transferDetail?.number ?? t('ใบโอนสินค้า', 'Stock transfer')}
        description={transferDetail ? `${transferDetail.fromStore} → ${transferDetail.toStore}` : undefined}
        size="lg"
        footer={
          transferDetail ? (
            <>
              <Button variant="ghost" onClick={() => setDetailId(null)}>
                {t('ปิด', 'Close')}
              </Button>
              {transferDetail.status === 'draft' && transferDetail.fromStoreId === me?.store?.id ? (
                <Button variant="primary" loading={submitting} onClick={() => void dispatchTransfer(transferDetail.id)}>
                  {t('ส่งสินค้าออก', 'Dispatch')}
                </Button>
              ) : null}
              {canReceive ? (
                <Button variant="primary" loading={submitting} onClick={() => void submitReceive()}>
                  {t('ยืนยันรับสินค้า', 'Receive')}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {detail.isLoading ? (
          <div className="flex justify-center py-8">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : transferDetail ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <TransferStatusBadge status={transferDetail.status} />
              <span className="text-[11px] text-faint">{dateTime(transferDetail.createdAt)}</span>
            </div>
            {canReceive ? (
              <InlineAlert tone="info">
                {t('กรอกจำนวนที่รับได้จริง ระบบจะไม่ยอมให้รับซ้ำเกินที่ส่งมา', 'Enter what actually arrived; over-receiving is blocked.')}
              </InlineAlert>
            ) : null}
            <Table>
              <thead>
                <tr>
                  <TH>{t('สินค้า', 'Product')}</TH>
                  <TH align="right">{t('ส่งมา', 'Sent')}</TH>
                  <TH align="right">{t('รับแล้ว', 'Received')}</TH>
                  {canReceive ? <TH align="right">{t('รับครั้งนี้', 'Receive now')}</TH> : null}
                </tr>
              </thead>
              <tbody>
                {transferDetail.items.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <p className="text-[12px]">{item.productName}</p>
                      <p className="text-[10px] text-faint">{item.sku}</p>
                    </TD>
                    <TD align="right" className="num">{item.qty}</TD>
                    <TD align="right" className="num">{item.receivedQty}</TD>
                    {canReceive ? (
                      <TD align="right">
                        <Input
                          type="number"
                          min={0}
                          max={item.qty - item.receivedQty}
                          value={receiveQty[item.id] ?? 0}
                          onChange={(event) =>
                            setReceiveQty((prev) => ({
                              ...prev,
                              [item.id]: Math.max(0, Math.min(item.qty - item.receivedQty, Number(event.target.value) || 0)),
                            }))
                          }
                          className="h-8 w-20 text-right"
                        />
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}
      </Modal>
    </PageBody>
  );
}
