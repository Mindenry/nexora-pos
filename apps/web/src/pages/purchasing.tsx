import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ScanBarcode, Truck } from 'lucide-react';
import { uuidv7 } from '@nexora/shared';
import { api, errorMessage, qs } from '../lib/api';
import { feedback } from '../lib/feedback';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { PageBody, PageHeader } from '../components/shell';
import { PurchaseStatusBadge } from '../components/status';
import { MoneyInput } from '../components/money-input';
import {
  Button,
  Card,
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
  useToast,
} from '../components/ui';

interface Supplier {
  id: string;
  code: string | null;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  poCount: number;
  purchaseTotalSatang: number;
}

interface PurchaseOrder {
  id: string;
  number: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  totalSatang: number;
  totalQty: number;
  supplierName: string;
  createdAt: string;
}

interface PurchaseDetail extends PurchaseOrder {
  notes: string;
  items: Array<{
    id: string;
    variantId: string;
    name: string;
    sku: string;
    barcode?: string | null;
    qtyOrdered: number;
    qtyReceived: number;
    unitCostSatang: number;
    lineTotalSatang: number;
  }>;
  receipts: Array<{ id: string; number: string; receivedAt: string; note: string }>;
}

interface StockRow {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  costSatang: number;
  onHand: number;
}

export function PurchasingPage() {
  const { t, locale } = useLang();
  const { money, number, dateTime } = useFormat();
  const { can, storeId } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'orders' | 'suppliers'>('orders');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [receiveScan, setReceiveScan] = useState('');
  const receiveScanRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Array<{ variantId: string; qty: number; unitCostSatang: number }>>([]);
  const [pickerVariant, setPickerVariant] = useState('');
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', contactName: '' });
  const [submitting, setSubmitting] = useState(false);

  const orders = useQuery({
    queryKey: ['purchase-orders', page, statusFilter, storeId],
    queryFn: () =>
      api<PurchaseOrder[]>(`/purchase-orders${qs({ page, pageSize: 15, status: statusFilter || undefined })}`),
    enabled: can('purchasing.read') && tab === 'orders',
  });

  const suppliers = useQuery({
    queryKey: ['suppliers', page, search],
    queryFn: () => api<Supplier[]>(`/suppliers${qs({ page, pageSize: 20, search: search || undefined })}`),
    enabled: can('purchasing.read'),
  });

  const detail = useQuery({
    queryKey: ['purchase-order', detailId],
    queryFn: () => api<PurchaseDetail>(`/purchase-orders/${detailId}`),
    enabled: Boolean(detailId),
  });

  const stock = useQuery({
    queryKey: ['inventory', 'all', storeId],
    queryFn: () => api<StockRow[]>('/inventory/overview?pageSize=100'),
    enabled: can('purchasing.manage') && createOpen,
  });

  useEffect(() => {
    if (!detail.data) return;
    const initial: Record<string, number> = {};
    for (const item of detail.data.data.items) initial[item.id] = 0;
    setReceiveQty(initial);
    setReceiveScan('');
  }, [detail.data]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    await queryClient.invalidateQueries({ queryKey: ['purchase-order'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  const transition = async (path: string, body: Record<string, unknown> = {}) => {
    if (!detailId) return;
    setSubmitting(true);
    try {
      await api(path, { method: 'POST', body: { operationId: uuidv7(), ...body } });
      await refresh();
      await detail.refetch();
      toast.success(t('อัปเดตใบสั่งซื้อแล้ว', 'Purchase order updated'));
    } catch (error) {
      toast.error(t('ดำเนินการไม่สำเร็จ', 'Action failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const submitReceive = async () => {
    if (!detail.data) return;
    const items = Object.entries(receiveQty)
      .filter(([, qty]) => qty > 0)
      .map(([poItemId, qty]) => ({ poItemId, qty }));
    if (items.length === 0) return;
    await transition(`/purchase-orders/${detail.data.data.id}/receive`, { items, note: '' });
  };

  const createOrder = async () => {
    if (!supplierId || lines.length === 0) return;
    setSubmitting(true);
    try {
      await api('/purchase-orders', {
        method: 'POST',
        body: {
          operationId: uuidv7(),
          supplierId,
          expectedDate: expectedDate || undefined,
          notes,
          items: lines,
        },
      });
      setCreateOpen(false);
      setLines([]);
      setNotes('');
      setSupplierId('');
      await refresh();
      toast.success(t('สร้างใบสั่งซื้อแล้ว', 'Purchase order created'));
    } catch (error) {
      toast.error(t('สร้างใบสั่งซื้อไม่สำเร็จ', 'Could not create order'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const createSupplier = async () => {
    if (!supplierForm.name.trim()) return;
    setSubmitting(true);
    try {
      await api('/suppliers', {
        method: 'POST',
        body: { ...supplierForm },
      });
      setSupplierOpen(false);
      setSupplierForm({ name: '', phone: '', contactName: '' });
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(t('เพิ่มผู้จำหน่ายแล้ว', 'Supplier created'));
    } catch (error) {
      toast.error(t('เพิ่มผู้จำหน่ายไม่สำเร็จ', 'Could not create supplier'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const order = detail.data?.data;
  const receiveTotal = order
    ? order.items.reduce((sum, item) => sum + (receiveQty[item.id] ?? 0) * item.unitCostSatang, 0)
    : 0;

  const handleReceiveScan = (value?: string) => {
    // Prefer the live DOM value so fast scanner keystrokes are never dropped.
    const code = (value ?? receiveScan).trim();
    if (!code || !order) return;
    const item = order.items.find((line) => line.barcode === code || line.sku === code);
    if (!item) {
      feedback('error');
      toast.error(t('ไม่พบสินค้าในใบสั่งซื้อ', 'Item not on this purchase order'), code);
      setReceiveScan('');
      receiveScanRef.current?.focus();
      return;
    }
    const remaining = item.qtyOrdered - item.qtyReceived;
    setReceiveQty((prev) => ({
      ...prev,
      [item.id]: Math.min(remaining, (prev[item.id] ?? 0) + 1),
    }));
    setReceiveScan('');
    feedback('scan');
    receiveScanRef.current?.focus();
  };

  return (
    <PageBody>
      <PageHeader
        title={t('จัดซื้อและผู้จำหน่าย', 'Purchasing & suppliers')}
        description={t('ใบสั่งซื้อ การอนุมัติ และการรับสินค้าเข้าสต๊อก', 'Purchase orders, approval and goods receiving.')}
        actions={
          can('purchasing.manage') ? (
            <>
              <Button variant="secondary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setSupplierOpen(true)}>
                {t('ผู้จำหน่ายใหม่', 'New supplier')}
              </Button>
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
                {t('สร้างใบสั่งซื้อ', 'New purchase order')}
              </Button>
            </>
          ) : null
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'orders', label: t('ใบสั่งซื้อ', 'Purchase orders') },
          { value: 'suppliers', label: t('ผู้จำหน่าย', 'Suppliers') },
        ]}
        className="mb-3"
      />

      {tab === 'orders' ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <Select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="h-9 w-[170px] text-[12px]">
              <option value="">{t('ทุกสถานะ', 'All statuses')}</option>
              <option value="draft">{t('ฉบับร่าง', 'Draft')}</option>
              <option value="submitted">{t('รออนุมัติ', 'Submitted')}</option>
              <option value="approved">{t('อนุมัติแล้ว', 'Approved')}</option>
              <option value="partially_received">{t('รับบางส่วน', 'Partially received')}</option>
              <option value="received">{t('รับครบ', 'Received')}</option>
            </Select>
            <span className="ml-auto text-[11px] text-faint">
              {number(Number(orders.data?.meta?.total ?? 0))} {t('ใบ', 'orders')}
            </span>
          </div>
          {orders.isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (orders.data?.data ?? []).length === 0 ? (
            <EmptyState icon={<Truck className="h-5 w-5" />} title={t('ยังไม่มีใบสั่งซื้อ', 'No purchase orders')} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <TH>{t('เลขที่', 'Number')}</TH>
                    <TH>{t('ผู้จำหน่าย', 'Supplier')}</TH>
                    <TH align="right">{t('จำนวน', 'Qty')}</TH>
                    <TH align="right">{t('มูลค่า', 'Value')}</TH>
                    <TH>{t('สถานะ', 'Status')}</TH>
                    <TH>{t('คาดรับ', 'Expected')}</TH>
                  </tr>
                </thead>
                <tbody>
                  {(orders.data?.data ?? []).map((po) => (
                    <TR key={po.id} onClick={() => setDetailId(po.id)}>
                      <TD className="num text-[12px] font-medium">{po.number}</TD>
                      <TD className="text-[12px]">{po.supplierName}</TD>
                      <TD align="right" className="num">{po.totalQty}</TD>
                      <TD align="right" className="num">{money(po.totalSatang)}</TD>
                      <TD><PurchaseStatusBadge status={po.status} /></TD>
                      <TD className="text-[11px] text-muted">{po.expectedDate ?? '—'}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
              <Pagination page={page} totalPages={Number(orders.data?.meta?.totalPages ?? 1)} total={Number(orders.data?.meta?.total ?? 0)} onPage={setPage} />
            </>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex items-center gap-2 border-b border-line p-3">
            <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder={t('ค้นหาผู้จำหน่าย', 'Search suppliers')} className="max-w-[280px]" />
          </div>
          {suppliers.isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (suppliers.data?.data ?? []).length === 0 ? (
            <EmptyState icon={<Truck className="h-5 w-5" />} title={t('ยังไม่มีผู้จำหน่าย', 'No suppliers')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <TH>{t('ชื่อ', 'Name')}</TH>
                  <TH>{t('ติดต่อ', 'Contact')}</TH>
                  <TH>{t('โทร', 'Phone')}</TH>
                  <TH align="right">{t('ใบสั่งซื้อ', 'Orders')}</TH>
                  <TH align="right">{t('ยอดซื้อ', 'Purchases')}</TH>
                </tr>
              </thead>
              <tbody>
                {(suppliers.data?.data ?? []).map((supplier) => (
                  <TR key={supplier.id}>
                    <TD>
                      <p className="text-[12.5px] font-medium">{supplier.name}</p>
                      <p className="text-[10px] text-faint">{supplier.code ?? '—'}</p>
                    </TD>
                    <TD className="text-[12px]">{supplier.contactName || '—'}</TD>
                    <TD className="text-[12px] text-muted">{supplier.phone || '—'}</TD>
                    <TD align="right" className="num">{supplier.poCount}</TD>
                    <TD align="right" className="num">{money(supplier.purchaseTotalSatang)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <Modal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={order?.number ?? t('ใบสั่งซื้อ', 'Purchase order')}
        description={order ? `${order.supplierName} · ${order.orderDate}` : undefined}
        size="lg"
        footer={
          order ? (
            <>
              <Button variant="ghost" onClick={() => setDetailId(null)}>{t('ปิด', 'Close')}</Button>
              {order.status === 'draft' && can('purchasing.manage') ? (
                <Button variant="secondary" loading={submitting} onClick={() => void transition(`/purchase-orders/${order.id}/submit`)}>
                  {t('ส่งขออนุมัติ', 'Submit')}
                </Button>
              ) : null}
              {order.status === 'submitted' && can('purchasing.approve') ? (
                <Button variant="primary" loading={submitting} onClick={() => void transition(`/purchase-orders/${order.id}/approve`)}>
                  {t('อนุมัติ', 'Approve')}
                </Button>
              ) : null}
              {['approved', 'partially_received'].includes(order.status) && can('purchasing.manage') ? (
                <Button variant="primary" loading={submitting} onClick={() => void submitReceive()}>
                  {t('รับสินค้า', 'Receive')} · {money(receiveTotal)}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {order ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <PurchaseStatusBadge status={order.status} />
              <span className="num text-[15px] font-semibold">{money(order.totalSatang)}</span>
            </div>
            {order.notes ? <p className="text-[11.5px] text-muted">{order.notes}</p> : null}
            {['approved', 'partially_received'].includes(order.status) ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <Field
                    label={t('สแกนรับสินค้า', 'Scan to receive')}
                    hint={t('สแกนบาร์โค้ด/SKU แล้ว Enter เพื่อนับทีละชิ้น', 'Scan barcode/SKU and press Enter to add one.')}
                  >
                    <Input
                      ref={receiveScanRef}
                      value={receiveScan}
                      onChange={(event) => setReceiveScan(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleReceiveScan(event.currentTarget.value);
                        }
                      }}
                      placeholder={t('ยิงบาร์โค้ด…', 'Scan barcode…')}
                      leadingIcon={<ScanBarcode className="h-4 w-4" />}
                    />
                  </Field>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setReceiveQty(
                      Object.fromEntries(
                        order.items.map((item) => [item.id, item.qtyOrdered - item.qtyReceived]),
                      ),
                    )
                  }
                >
                  {t('รับทั้งหมด', 'Receive all')}
                </Button>
              </div>
            ) : null}
            {['approved', 'partially_received'].includes(order.status) ? (
              <InlineAlert tone="info">
                {t('ระบุจำนวนที่รับจริง ระบบจะสร้าง movement และอัปเดตต้นทุนสินค้า', 'Enter received quantities; stock and cost are updated.')}
              </InlineAlert>
            ) : null}
            <Table>
              <thead>
                <tr>
                  <TH>{t('สินค้า', 'Product')}</TH>
                  <TH align="right">{t('สั่ง', 'Ordered')}</TH>
                  <TH align="right">{t('รับแล้ว', 'Received')}</TH>
                  <TH align="right">{t('ทุน', 'Cost')}</TH>
                  {['approved', 'partially_received'].includes(order.status) ? <TH align="right">{t('รับครั้งนี้', 'Now')}</TH> : null}
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <p className="text-[12px]">{item.name}</p>
                      <p className="text-[10px] text-faint">{item.sku}</p>
                    </TD>
                    <TD align="right" className="num">{item.qtyOrdered}</TD>
                    <TD align="right" className="num">{item.qtyReceived}</TD>
                    <TD align="right" className="num">{money(item.unitCostSatang)}</TD>
                    {['approved', 'partially_received'].includes(order.status) ? (
                      <TD align="right">
                        <Input
                          type="number"
                          min={0}
                          max={item.qtyOrdered - item.qtyReceived}
                          value={receiveQty[item.id] ?? 0}
                          onChange={(event) =>
                            setReceiveQty((prev) => ({
                              ...prev,
                              [item.id]: Math.max(0, Math.min(item.qtyOrdered - item.qtyReceived, Number(event.target.value) || 0)),
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
            {order.receipts.length > 0 ? (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted">{t('ประวัติรับสินค้า', 'Receiving history')}</p>
                {order.receipts.map((receipt) => (
                  <div key={receipt.id} className="flex justify-between border-b border-line/60 py-1 text-[11px]">
                    <span>{receipt.number}</span>
                    <span className="text-faint">{dateTime(receipt.receivedAt)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('สร้างใบสั่งซื้อ', 'New purchase order')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>{t('ยกเลิก', 'Cancel')}</Button>
            <Button variant="primary" loading={submitting} disabled={!supplierId || lines.length === 0} onClick={() => void createOrder()}>
              {t('สร้าง', 'Create')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('ผู้จำหน่าย', 'Supplier')} required>
              <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                <option value="">{t('เลือกผู้จำหน่าย', 'Select supplier')}</option>
                {(suppliers.data?.data ?? []).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('วันคาดรับ', 'Expected date')}>
              <Input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} />
            </Field>
          </div>
          <div className="rounded-lg border border-line">
            <div className="flex items-end gap-2 border-b border-line p-3">
              <div className="flex-1">
                <Field label={t('สินค้า', 'Product')}>
                  <Select value={pickerVariant} onChange={(event) => setPickerVariant(event.target.value)}>
                    <option value="">{t('เลือกสินค้า', 'Select product')}</option>
                    {(stock.data?.data ?? []).map((row) => (
                      <option key={row.variantId} value={row.variantId}>
                        {row.productName} · {row.sku ?? ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!pickerVariant}
                onClick={() => {
                  const row = (stock.data?.data ?? []).find((r) => r.variantId === pickerVariant);
                  if (!row) return;
                  setLines((prev) =>
                    prev.some((line) => line.variantId === row.variantId)
                      ? prev
                      : [...prev, { variantId: row.variantId, qty: 10, unitCostSatang: row.costSatang }],
                  );
                  setPickerVariant('');
                }}
              >
                {t('เพิ่ม', 'Add')}
              </Button>
            </div>
            <div className="divide-y divide-line">
              {lines.map((line) => {
                const row = (stock.data?.data ?? []).find((r) => r.variantId === line.variantId);
                return (
                  <div key={line.variantId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[12px]">{row?.productName} · {row?.sku}</span>
                    <Input
                      type="number"
                      min={1}
                      value={line.qty}
                      onChange={(event) =>
                        setLines((prev) => prev.map((l) => (l.variantId === line.variantId ? { ...l, qty: Math.max(1, Number(event.target.value) || 1) } : l)))
                      }
                      className="h-8 w-16 text-right"
                    />
                    <div className="w-28">
                      <MoneyInput
                        className="h-8 text-right"
                        value={line.unitCostSatang}
                        onChange={(value) => setLines((prev) => prev.map((l) => (l.variantId === line.variantId ? { ...l, unitCostSatang: value } : l)))}
                      />
                    </div>
                    <Button size="icon-sm" variant="ghost" onClick={() => setLines((prev) => prev.filter((l) => l.variantId !== line.variantId))}>×</Button>
                  </div>
                );
              })}
              {lines.length === 0 ? <p className="px-3 py-4 text-center text-[11.5px] text-faint">{t('ยังไม่มีรายการ', 'No items')}</p> : null}
            </div>
          </div>
          <Field label={t('หมายเหตุ', 'Notes')}>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
          </Field>
          <p className="text-right text-[12px] text-muted">
            {t('มูลค่ารวม', 'Total')} <span className="num font-semibold text-text">{money(lines.reduce((sum, line) => sum + line.qty * line.unitCostSatang, 0))}</span>
          </p>
        </div>
      </Modal>

      <Modal
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        title={t('เพิ่มผู้จำหน่าย', 'New supplier')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSupplierOpen(false)}>{t('ยกเลิก', 'Cancel')}</Button>
            <Button variant="primary" loading={submitting} onClick={() => void createSupplier()}>{t('บันทึก', 'Save')}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('ชื่อบริษัท', 'Company')} required>
            <Input value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })} />
          </Field>
          <Field label={t('ผู้ติดต่อ', 'Contact')}>
            <Input value={supplierForm.contactName} onChange={(event) => setSupplierForm({ ...supplierForm, contactName: event.target.value })} />
          </Field>
          <Field label={t('โทร', 'Phone')}>
            <Input value={supplierForm.phone} onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })} />
          </Field>
        </div>
      </Modal>
    </PageBody>
  );
}
