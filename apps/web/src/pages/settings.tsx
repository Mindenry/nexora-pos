import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, ShieldCheck } from 'lucide-react';
import { api, errorMessage, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { PageBody, PageHeader } from '../components/shell';
import { ReceiptView } from '../components/receipt';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  Select,
  Skeleton,
  Switch,
  Table,
  TD,
  Textarea,
  TH,
  TR,
  Tabs,
  useToast,
} from '../components/ui';

interface PaymentMethod {
  id?: string;
  code: string;
  name: string;
  type: 'cash' | 'card' | 'qr' | 'transfer' | 'other';
  requiresReference: boolean;
  opensDrawer: boolean;
  isActive: boolean;
  sortOrder: number;
}

interface AuditRow {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  createdAt: string;
}

export function SettingsPage() {
  const { t, locale } = useLang();
  const { me, refresh, can } = useAuth();
  const { dateTime } = useFormat();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'business' | 'payments' | 'receipt' | 'audit'>('business');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    legalName: '',
    taxId: '',
    address: '',
    phone: '',
    email: '',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
    vatPercent: 7,
    pricesIncludeTax: true,
    receiptFooter: '',
    receiptPrefix: 'R',
    loyaltyEarnPerBaht: 1,
    offlineCashEnabled: false,
    discountLimitPercent: 20,
  });
  const [methods, setMethods] = useState<PaymentMethod[]>([]);

  useEffect(() => {
    if (!me?.business) return;
    const b = me.business;
    setForm({
      name: b.name,
      legalName: b.legalName,
      taxId: b.taxId,
      address: b.address,
      phone: b.phone,
      email: b.email,
      currency: b.currency,
      timezone: b.timezone,
      vatPercent: b.vatRateBp / 100,
      pricesIncludeTax: b.pricesIncludeTax,
      receiptFooter: b.receiptFooter,
      receiptPrefix: b.receiptPrefix,
      loyaltyEarnPerBaht: b.loyaltyEarnPerBaht,
      offlineCashEnabled: b.offlineCashEnabled,
      discountLimitPercent: b.discountLimitBp / 100,
    });
  }, [me?.business]);

  const paymentMethods = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api<PaymentMethod[]>('/settings/payment-methods'),
    enabled: can('settings.manage') && tab === 'payments',
  });

  useEffect(() => {
    if (paymentMethods.data) setMethods(paymentMethods.data.data);
  }, [paymentMethods.data]);

  const audit = useQuery({
    queryKey: ['audit', tab],
    queryFn: () => api<AuditRow[]>(`/audit-logs${qs({ pageSize: 30 })}`),
    enabled: can('audit.view') && tab === 'audit',
  });

  const saveBusiness = async () => {
    setSaving(true);
    try {
      await api('/settings/business', {
        method: 'PUT',
        body: {
          name: form.name,
          legalName: form.legalName,
          taxId: form.taxId,
          address: form.address,
          phone: form.phone,
          email: form.email,
          currency: form.currency,
          timezone: form.timezone,
          vatRateBp: Math.round(form.vatPercent * 100),
          pricesIncludeTax: form.pricesIncludeTax,
          receiptFooter: form.receiptFooter,
          receiptPrefix: form.receiptPrefix,
          loyaltyEarnPerBaht: form.loyaltyEarnPerBaht,
          offlineCashEnabled: form.offlineCashEnabled,
          discountLimitBp: Math.round(form.discountLimitPercent * 100),
        },
      });
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
      toast.success(t('บันทึกการตั้งค่าแล้ว', 'Settings saved'));
    } catch (error) {
      toast.error(t('บันทึกไม่สำเร็จ', 'Save failed'), errorMessage(error, locale));
    } finally {
      setSaving(false);
    }
  };

  const saveMethods = async () => {
    setSaving(true);
    try {
      await api('/settings/payment-methods', {
        method: 'PUT',
        body: { methods },
      });
      await queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
      await queryClient.invalidateQueries({ queryKey: ['pos-bootstrap'] });
      toast.success(t('บันทึกวิธีชำระเงินแล้ว', 'Payment methods saved'));
    } catch (error) {
      toast.error(t('บันทึกไม่สำเร็จ', 'Save failed'), errorMessage(error, locale));
    } finally {
      setSaving(false);
    }
  };

  const sampleReceipt = {
    number: `${form.receiptPrefix}-20261116-00042`,
    businessDate: '2026-11-16',
    issuedAt: new Date().toISOString(),
    business: {
      name: form.name,
      legalName: form.legalName,
      taxId: form.taxId,
      address: form.address,
      phone: form.phone,
    },
    store: { name: me?.store?.name },
    cashier: me?.employee?.displayName,
    items: [{ name: 'ตัวอย่างสินค้า', sku: 'DEMO-001', qty: 2, unitPriceSatang: 6500, totalSatang: 13000 }],
    subtotalSatang: 13000,
    discountSatang: 0,
    taxSatang: 850,
    totalSatang: 13000,
    changeSatang: 0,
    vatRateBp: Math.round(form.vatPercent * 100),
    pricesIncludeTax: form.pricesIncludeTax,
    payments: [{ methodName: t('เงินสด', 'Cash'), amountSatang: 13000 }],
    footer: form.receiptFooter,
  };

  return (
    <PageBody>
      <PageHeader
        title={t('ตั้งค่าร้าน', 'Store settings')}
        description={t('ภาษี ใบเสร็จ การชำระเงิน และการตรวจสอบย้อนหลัง', 'Tax, receipts, payments and audit.')}
        actions={
          tab === 'business' ? (
            <Button variant="primary" leftIcon={<Save className="h-4 w-4" />} loading={saving} onClick={() => void saveBusiness()}>
              {t('บันทึก', 'Save changes')}
            </Button>
          ) : tab === 'payments' ? (
            <Button variant="primary" leftIcon={<Save className="h-4 w-4" />} loading={saving} onClick={() => void saveMethods()}>
              {t('บันทึกวิธีชำระ', 'Save methods')}
            </Button>
          ) : null
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'business', label: t('ธุรกิจและภาษี', 'Business & tax') },
          { value: 'payments', label: t('การชำระเงิน', 'Payments') },
          { value: 'receipt', label: t('ใบเสร็จ', 'Receipt') },
          { value: 'audit', label: t('ประวัติการทำงาน', 'Audit log') },
        ]}
        className="mb-3"
      />

      {tab === 'business' ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title={t('ข้อมูลธุรกิจ', 'Business profile')} description={t('ปรากฏบนใบเสร็จและเอกสาร', 'Shown on receipts and documents.')} />
            <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
              <Field label={t('ชื่อร้าน', 'Business name')} required><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
              <Field label={t('ชื่อนิติบุคคล', 'Legal name')}><Input value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} /></Field>
              <Field label={t('เลขประจำตัวผู้เสียภาษี', 'Tax ID')}><Input value={form.taxId} onChange={(event) => setForm({ ...form, taxId: event.target.value })} /></Field>
              <Field label={t('โทร', 'Phone')}><Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
              <Field label={t('ที่อยู่', 'Address')} className="sm:col-span-2"><Textarea value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} rows={2} /></Field>
              <Field label={t('อีเมล', 'Email')}><Input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
              <Field label={t('สกุลเงิน', 'Currency')}><Input value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></Field>
              <Field label={t('Timezone', 'Timezone')}><Input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></Field>
              <Field label={t('VAT (%)', 'VAT (%)')} hint={t('ค่าเริ่มต้น 7% ปรับได้ตามการจดทะเบียน', 'Default 7%, change to your registration.')}>
                <Input type="number" min={0} max={50} step="0.01" value={form.vatPercent} onChange={(event) => setForm({ ...form, vatPercent: Number(event.target.value) || 0 })} />
              </Field>
              <div className="sm:col-span-2">
                <Switch
                  checked={form.pricesIncludeTax}
                  onChange={(value) => setForm({ ...form, pricesIncludeTax: value })}
                  label={t('ราคาสินค้ารวม VAT', 'Prices include VAT')}
                  description={t('ปิดหากต้องการบวก VAT ตอนชำระ', 'Disable to add VAT at checkout.')}
                />
              </div>
              <Field label={t('ส่วนลดสูงสุด بدونอนุมัติ (%)', 'Discount limit without approval (%)')}>
                <Input type="number" min={0} max={100} value={form.discountLimitPercent} onChange={(event) => setForm({ ...form, discountLimitPercent: Number(event.target.value) || 0 })} />
              </Field>
              <Field label={t('คะแนนต่อ 100 บาท', 'Points per THB 100')}>
                <Input type="number" min={0} value={form.loyaltyEarnPerBaht} onChange={(event) => setForm({ ...form, loyaltyEarnPerBaht: Number(event.target.value) || 0 })} />
              </Field>
              <div className="sm:col-span-2">
                <Switch
                  checked={form.offlineCashEnabled}
                  onChange={(value) => setForm({ ...form, offlineCashEnabled: value })}
                  label={t('อนุญาตขายเงินสดแบบออฟไลน์', 'Allow offline cash sales')}
                  description={t('เฉพาะเงินสด รายการจะซิงก์พร้อม idempotency key', 'Cash only; queued sales replay with idempotency keys.')}
                />
              </div>
            </div>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title={t('ใบเสร็จ', 'Receipt')} />
              <div className="space-y-3 px-5 pb-5">
                <Field label={t('คำนำหน้าเลขที่', 'Number prefix')}><Input value={form.receiptPrefix} onChange={(event) => setForm({ ...form, receiptPrefix: event.target.value.toUpperCase() })} /></Field>
                <Field label={t('ข้อความท้ายใบเสร็จ', 'Receipt footer')}><Textarea value={form.receiptFooter} onChange={(event) => setForm({ ...form, receiptFooter: event.target.value })} rows={2} /></Field>
              </div>
            </Card>
            <InlineAlert tone="warning" title={t('ข้อจำกัดที่ยังไม่เปิดใช้', 'Not enabled yet')}>
              {t(
                'PromptPay/e-Tax ต้องเชื่อมผู้ให้บริการที่ได้รับอนุญาต การยืนยัน QR ในระบบนี้เป็นการยืนยันโดยพนักงานพร้อมเลขอ้างอิง',
                'PromptPay/e-Tax need a licensed provider. QR confirmation here is a staff attestation with a reference, not a provider signal.',
              )}
            </InlineAlert>
          </div>
        </div>
      ) : tab === 'payments' ? (
        <Card>
          <CardHeader
            title={t('วิธีชำระเงินของสาขา', 'Branch payment methods')}
            description={t('รหัสต้องไม่ซ้ำ และวิธีที่ไม่ใช้แล้วจะถูกปิด', 'Codes are unique; removed methods are disabled, not deleted.')}
            action={
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setMethods((prev) => [...prev, { code: '', name: '', type: 'other', requiresReference: false, opensDrawer: false, isActive: true, sortOrder: prev.length * 10 + 10 }])}
              >
                {t('เพิ่มวิธี', 'Add method')}
              </Button>
            }
          />
          {paymentMethods.isLoading ? (
            <div className="p-4"><Skeleton className="h-24" /></div>
          ) : (
            <div className="space-y-2 px-5 pb-5">
              {methods.map((method, index) => (
                <div key={method.id ?? index} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-12">
                  <Input className="h-9 sm:col-span-2" value={method.code} placeholder="code" onChange={(event) => setMethods((prev) => prev.map((m, i) => (i === index ? { ...m, code: event.target.value.toLowerCase() } : m)))} />
                  <Input className="h-9 sm:col-span-3" value={method.name} placeholder={t('ชื่อที่แสดง', 'Display name')} onChange={(event) => setMethods((prev) => prev.map((m, i) => (i === index ? { ...m, name: event.target.value } : m)))} />
                  <Select className="h-9 sm:col-span-2" value={method.type} onChange={(event) => setMethods((prev) => prev.map((m, i) => (i === index ? { ...m, type: event.target.value as PaymentMethod['type'] } : m)))}>
                    <option value="cash">cash</option>
                    <option value="card">card</option>
                    <option value="qr">qr</option>
                    <option value="transfer">transfer</option>
                    <option value="other">other</option>
                  </Select>
                  <div className="flex items-center gap-3 sm:col-span-3">
                    <label className="flex items-center gap-1 text-[10.5px]"><input type="checkbox" checked={method.requiresReference} onChange={(event) => setMethods((prev) => prev.map((m, i) => (i === index ? { ...m, requiresReference: event.target.checked } : m)))} className="accent-[var(--jade)]" /> ref</label>
                    <label className="flex items-center gap-1 text-[10.5px]"><input type="checkbox" checked={method.opensDrawer} onChange={(event) => setMethods((prev) => prev.map((m, i) => (i === index ? { ...m, opensDrawer: event.target.checked } : m)))} className="accent-[var(--jade)]" /> drawer</label>
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:col-span-2">
                    <Switch checked={method.isActive} onChange={(value) => setMethods((prev) => prev.map((m, i) => (i === index ? { ...m, isActive: value } : m)))} />
                    <Button size="icon-sm" variant="ghost" onClick={() => setMethods((prev) => prev.filter((_, i) => i !== index))}>×</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : tab === 'receipt' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="p-5">
            <p className="mb-3 text-[12px] font-medium">{t('ตัวอย่างใบเสร็จ', 'Receipt preview')}</p>
            <ReceiptView receipt={sampleReceipt} />
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title={t('ข้อมูลที่ต้องตรวจสอบก่อนใช้จริง', 'Before going live')} />
              <div className="space-y-2 px-5 pb-5 text-[12px] text-muted">
                {[
                  t('เลขประจำตัวผู้เสียภาษีและชื่อนิติบุคคลต้องตรงกับหนังสือรับรอง', 'Tax ID and legal name must match the company certificate.'),
                  t('รูปแบบใบกำกับภาษีอย่างย่อ/เต็มต้องผ่านการตรวจสอบจากนักบัญชี', 'Abbreviated/full tax invoice layout must be reviewed by an accountant.'),
                  t('เลขรันใบเสร็จต้องไม่ซ้ำและไม่ถูกใช้ซ้ำหลัง restore', 'Receipt numbers must never repeat, including after a restore.'),
                  t('การส่ง e-Tax ต้องเชื่อมผู้ให้บริการที่ได้รับอนุญาต', 'e-Tax submission requires a licensed provider.'),
                ].map((item) => (
                  <p key={item} className="flex gap-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-jade" />{item}</p>
                ))}
              </div>
            </Card>
            <InlineAlert tone="info">
              {t('ใบเสร็จที่บันทึกแล้วเป็น snapshot จึงไม่เปลี่ยนตามการแก้ไขสินค้าหรือภาษีภายหลัง', 'Stored receipts are snapshots and never change with later product or tax edits.')}
            </InlineAlert>
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader title={t('ประวัติการทำงาน', 'Audit log')} description={t('การคืนเงิน ยกเลิก ปรับสต๊อก และเปลี่ยนสิทธิ์ถูกบันทึกแบบเพิ่มอย่างเดียว', 'Refunds, voids, adjustments and permission changes are append-only.')} />
          {audit.isLoading ? (
            <div className="p-4"><Skeleton className="h-40" /></div>
          ) : (audit.data?.data ?? []).length === 0 ? (
            <EmptyState title={t('ยังไม่มีรายการ', 'No audit entries')} />
          ) : (
            <Table>
              <thead><tr><TH>{t('เวลา', 'Time')}</TH><TH>{t('ผู้ทำ', 'Actor')}</TH><TH>{t('การกระทำ', 'Action')}</TH><TH>{t('วัตถุ', 'Entity')}</TH><TH>{t('เหตุผล', 'Reason')}</TH></tr></thead>
              <tbody>
                {(audit.data?.data ?? []).map((row) => (
                  <TR key={row.id}>
                    <TD className="text-[11px] text-muted">{dateTime(row.createdAt)}</TD>
                    <TD className="text-[12px]">{row.actorName}</TD>
                    <TD><span className="font-mono text-[10.5px] text-jade">{row.action}</span></TD>
                    <TD className="text-[10.5px] text-faint">{row.entityType}</TD>
                    <TD className="max-w-[260px] truncate text-[11px] text-muted">{row.reason ?? '—'}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      <p className="mt-4 text-[10px] text-faint">
        {t('การสำรองข้อมูลและผู้ให้บริการชำระเงินเป็นงานเชื่อมต่อภายนอก — ดู docs/ARCHITECTURE.md', 'Backups and payment providers are external integrations — see docs/ARCHITECTURE.md.')}
      </p>
    </PageBody>
  );
}
