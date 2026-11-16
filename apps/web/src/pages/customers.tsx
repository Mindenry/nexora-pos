import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, UserPlus, Users } from 'lucide-react';
import { api, errorMessage, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { PageBody, PageHeader } from '../components/shell';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  Modal,
  Pagination,
  SearchInput,
  Skeleton,
  Table,
  TD,
  Textarea,
  TH,
  TR,
  useToast,
} from '../components/ui';

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  tier: string;
  totalSpentSatang: number;
  lastPurchaseAt: string | null;
  consentMarketing: boolean;
  points: number;
}

interface CustomerDetail extends CustomerRow {
  address: string;
  taxId: string;
  birthday: string | null;
  consentAt: string | null;
  notes: string;
  loyaltyLedger: Array<{ id: string; pointsDelta: number; type: string; reason: string; createdAt: string }>;
  sales: Array<{ id: string; number: string; status: string; businessDate: string; totalSatang: number }>;
}

const TIER_TONES: Record<string, 'neutral' | 'jade' | 'amber' | 'violet'> = {
  standard: 'neutral',
  silver: 'neutral',
  gold: 'amber',
  platinum: 'violet',
};

export function CustomersPage() {
  const { t, locale } = useLang();
  const { money, number, dateTime } = useFormat();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', taxId: '', notes: '', consentMarketing: false });
  const [pointsOpen, setPointsOpen] = useState(false);
  const [pointsDelta, setPointsDelta] = useState(0);
  const [pointsReason, setPointsReason] = useState('');
  const [anonymizeOpen, setAnonymizeOpen] = useState(false);
  const [anonymizeReason, setAnonymizeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const list = useQuery({
    queryKey: ['customers', page, search],
    queryFn: () => api<CustomerRow[]>(`/customers${qs({ page, pageSize: 20, search: search || undefined })}`),
    enabled: can('customers.read'),
  });

  const detail = useQuery({
    queryKey: ['customer', selectedId],
    queryFn: () => api<CustomerDetail>(`/customers/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('customer');
    if (param) setSelectedId(param);
  }, []);

  const rows = list.data?.data ?? [];
  const customer = detail.data?.data;

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', phone: '', email: '', address: '', taxId: '', notes: '', consentMarketing: false });
    setFormOpen(true);
  };

  const openEdit = (row: CustomerRow) => {
    setEditing(row);
    const source = customer?.id === row.id ? customer : row;
    setForm({
      name: source.name,
      phone: source.phone ?? '',
      email: source.email ?? '',
      address: (source as CustomerDetail).address ?? '',
      taxId: (source as CustomerDetail).taxId ?? '',
      notes: (source as CustomerDetail).notes ?? '',
      consentMarketing: source.consentMarketing,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      if (editing) await api(`/customers/${editing.id}`, { method: 'PATCH', body: form });
      else await api('/customers', { method: 'POST', body: form });
      setFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['customer'] });
      toast.success(editing ? t('แก้ไขลูกค้าแล้ว', 'Customer updated') : t('เพิ่มลูกค้าแล้ว', 'Customer created'));
    } catch (error) {
      toast.error(t('บันทึกไม่สำเร็จ', 'Save failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const adjustPoints = async () => {
    if (!customer || pointsDelta === 0 || pointsReason.trim().length < 3) return;
    setSubmitting(true);
    try {
      await api(`/customers/${customer.id}/points`, {
        method: 'POST',
        body: { pointsDelta, reason: pointsReason },
      });
      setPointsOpen(false);
      setPointsDelta(0);
      setPointsReason('');
      await queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(t('ปรับคะแนนแล้ว', 'Points adjusted'));
    } catch (error) {
      toast.error(t('ปรับคะแนนไม่สำเร็จ', 'Adjustment failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const anonymize = async () => {
    if (!customer || anonymizeReason.trim().length < 3) return;
    setSubmitting(true);
    try {
      await api(`/customers/${customer.id}/anonymize`, {
        method: 'POST',
        body: { reason: anonymizeReason },
      });
      setAnonymizeOpen(false);
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(t('ปิดข้อมูลลูกค้าแล้ว', 'Customer anonymized'));
    } catch (error) {
      toast.error(t('ดำเนินการไม่สำเร็จ', 'Action failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageBody>
      <PageHeader
        title={t('ลูกค้า', 'Customers')}
        description={t('สมาชิก คะแนนสะสม และประวัติการซื้อ พร้อมการจัดการตาม PDPA', 'Members, loyalty and purchase history with PDPA controls.')}
        actions={
          can('customers.manage') ? (
            <Button variant="primary" leftIcon={<UserPlus className="h-4 w-4" />} onClick={openCreate}>
              {t('เพิ่มลูกค้า', 'Add customer')}
            </Button>
          ) : null
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="w-full max-w-[300px]">
            <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder={t('ชื่อ เบอร์โทร หรือรหัส', 'Name, phone or code')} />
          </div>
          <Badge tone="jade">
            {t('คะแนนค้างทั้งระบบ', 'Points liability')} {number(Number(list.data?.meta?.pointsLiability ?? 0))}
          </Badge>
          <span className="ml-auto text-[11px] text-faint">{number(Number(list.data?.meta?.total ?? 0))} {t('คน', 'customers')}</span>
        </div>
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title={t('ยังไม่มีลูกค้า', 'No customers')} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <TH>{t('ลูกค้า', 'Customer')}</TH>
                  <TH>{t('ติดต่อ', 'Contact')}</TH>
                  <TH align="right">{t('ยอดซื้อสะสม', 'Lifetime spend')}</TH>
                  <TH align="right">{t('คะแนน', 'Points')}</TH>
                  <TH>{t('ระดับ', 'Tier')}</TH>
                  <TH>{t('ซื้อล่าสุด', 'Last purchase')}</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <TR key={row.id} onClick={() => setSelectedId(row.id)}>
                    <TD>
                      <p className="text-[12.5px] font-medium">{row.name}</p>
                      <p className="text-[10px] text-faint">{row.code}</p>
                    </TD>
                    <TD>
                      <span className="text-[11.5px] text-muted">{row.phone ?? '—'}</span>
                      {row.consentMarketing ? <Badge tone="jade" className="ml-1 px-1 py-0 text-[9px]">consent</Badge> : null}
                    </TD>
                    <TD align="right" className="num">{money(row.totalSpentSatang)}</TD>
                    <TD align="right" className="num text-jade">{number(row.points)}</TD>
                    <TD><Badge tone={TIER_TONES[row.tier] ?? 'neutral'}>{row.tier}</Badge></TD>
                    <TD className="text-[11px] text-muted">{row.lastPurchaseAt ? dateTime(row.lastPurchaseAt) : '—'}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} totalPages={Number(list.data?.meta?.totalPages ?? 1)} total={Number(list.data?.meta?.total ?? 0)} onPage={setPage} />
          </>
        )}
      </Card>

      <Drawer
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={customer?.name ?? t('ลูกค้า', 'Customer')}
        description={customer ? `${customer.code} · ${customer.phone ?? ''}` : undefined}
        width="lg"
        footer={
          customer && can('customers.manage') ? (
            <>
              <Button variant="ghost" onClick={() => setAnonymizeOpen(true)}>{t('ปิดข้อมูล (PDPA)', 'Anonymize')}</Button>
              <Button variant="secondary" leftIcon={<Gift className="h-4 w-4" />} onClick={() => setPointsOpen(true)}>{t('ปรับคะแนน', 'Adjust points')}</Button>
              <Button variant="primary" onClick={() => openEdit(customer)}>{t('แก้ไข', 'Edit')}</Button>
            </>
          ) : undefined
        }
      >
        {detail.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-40" /></div>
        ) : customer ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: t('ยอดซื้อสะสม', 'Lifetime spend'), value: money(customer.totalSpentSatang) },
                { label: t('คะแนนคงเหลือ', 'Points balance'), value: number(customer.points) },
                { label: t('ระดับสมาชิก', 'Tier'), value: customer.tier },
                { label: t('ยินยอมการตลาด', 'Marketing consent'), value: customer.consentMarketing ? t('ยินยอม', 'Yes') : t('ไม่ยินยอม', 'No') },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-line p-3">
                  <p className="text-[10px] text-faint">{item.label}</p>
                  <p className="num mt-0.5 text-[14px] font-semibold">{item.value}</p>
                </div>
              ))}
            </div>
            {customer.notes ? <p className="rounded-lg bg-surface-2 p-3 text-[12px] text-muted">{customer.notes}</p> : null}
            <div>
              <p className="mb-2 text-[11.5px] font-semibold">{t('ประวัติการซื้อ', 'Purchase history')}</p>
              {customer.sales.length === 0 ? <p className="text-[11.5px] text-faint">{t('ยังไม่มีการซื้อ', 'No purchases')}</p> : (
                customer.sales.map((sale) => (
                  <a key={sale.id} href={`/sales/${sale.id}`} className="flex justify-between border-b border-line/60 py-1.5 text-[12px] hover:text-jade">
                    <span className="num">{sale.number} <span className="text-[10px] text-faint">{sale.businessDate}</span></span>
                    <span className="num">{money(sale.totalSatang)}</span>
                  </a>
                ))
              )}
            </div>
            <div>
              <p className="mb-2 text-[11.5px] font-semibold">{t('ประวัติคะแนน', 'Loyalty ledger')}</p>
              {customer.loyaltyLedger.map((entry) => (
                <div key={entry.id} className="flex justify-between border-b border-line/60 py-1.5 text-[11.5px]">
                  <span className="text-muted">{entry.reason}</span>
                  <span className={entry.pointsDelta >= 0 ? 'num text-jade' : 'num text-amber'}>
                    {entry.pointsDelta > 0 ? '+' : ''}{entry.pointsDelta}
                  </span>
                </div>
              ))}
              {customer.loyaltyLedger.length === 0 ? <p className="text-[11.5px] text-faint">{t('ยังไม่มีรายการ', 'No entries')}</p> : null}
            </div>
            <div className="text-[10.5px] text-faint">
              <p>{t('ที่อยู่', 'Address')}: {customer.address || '—'}</p>
              <p>{t('เลขภาษี', 'Tax ID')}: {customer.taxId || '—'}</p>
              <p>{t('วันเกิด', 'Birthday')}: {customer.birthday || '—'}</p>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('แก้ไขลูกค้า', 'Edit customer') : t('เพิ่มลูกค้า', 'New customer')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>{t('ยกเลิก', 'Cancel')}</Button>
            <Button variant="primary" loading={submitting} onClick={() => void save()}>{t('บันทึก', 'Save')}</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ชื่อ', 'Name')} required className="sm:col-span-2">
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label={t('เบอร์โทร', 'Phone')}>
            <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </Field>
          <Field label={t('อีเมล', 'Email')}>
            <Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </Field>
          <Field label={t('ที่อยู่', 'Address')} className="sm:col-span-2">
            <Textarea value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} rows={2} />
          </Field>
          <Field label={t('เลขภาษี', 'Tax ID')}>
            <Input value={form.taxId} onChange={(event) => setForm({ ...form, taxId: event.target.value })} />
          </Field>
          <Field label={t('หมายเหตุ', 'Notes')}>
            <Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-[12px] sm:col-span-2">
            <input
              type="checkbox"
              checked={form.consentMarketing}
              onChange={(event) => setForm({ ...form, consentMarketing: event.target.checked })}
              className="h-4 w-4 accent-[var(--jade)]"
            />
            {t('ได้รับความยินยอมสำหรับการตลาดแล้ว', 'Customer consented to marketing')}
          </label>
        </div>
      </Modal>

      <Modal
        open={pointsOpen}
        onClose={() => setPointsOpen(false)}
        title={t('ปรับคะแนน', 'Adjust points')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPointsOpen(false)}>{t('ยกเลิก', 'Cancel')}</Button>
            <Button variant="primary" loading={submitting} disabled={pointsDelta === 0 || pointsReason.trim().length < 3} onClick={() => void adjustPoints()}>
              {t('บันทึก', 'Save')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('จำนวนคะแนน (ติดลบได้)', 'Points delta')}>
            <Input type="number" value={pointsDelta} onChange={(event) => setPointsDelta(Number(event.target.value) || 0)} />
          </Field>
          <Field label={t('เหตุผล', 'Reason')} required>
            <Input value={pointsReason} onChange={(event) => setPointsReason(event.target.value)} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={anonymizeOpen}
        onClose={() => setAnonymizeOpen(false)}
        onConfirm={() => void anonymize()}
        title={t('ปิดข้อมูลลูกค้า', 'Anonymize customer')}
        description={
          <div className="space-y-2">
            <InlineAlert tone="warning">
              {t('ข้อมูลส่วนบุคคลจะถูกลบ แต่ประวัติการขายยังคงอยู่เพื่อการบัญชี', 'Personal data is erased; sales history remains for accounting.')}
            </InlineAlert>
            <Input value={anonymizeReason} onChange={(event) => setAnonymizeReason(event.target.value)} placeholder={t('เหตุผล (คำขอ PDPA)', 'Reason (PDPA request)')} />
          </div>
        }
        confirmLabel={t('ยืนยัน', 'Confirm')}
        loading={submitting}
      />
    </PageBody>
  );
}
