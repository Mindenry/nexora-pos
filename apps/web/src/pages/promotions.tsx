import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Tag } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { PageBody, PageHeader } from '../components/shell';
import { MoneyInput } from '../components/money-input';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  useToast,
} from '../components/ui';

interface Promotion {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  valueBp: number | null;
  valueSatang: number | null;
  targetIds: string[];
  minSubtotalSatang: number;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  stackable: boolean;
  priority: number;
  isActive: boolean;
  couponEnabled: boolean;
}

interface Draft {
  name: string;
  code: string;
  kind: 'order_percent' | 'order_amount' | 'product_percent' | 'category_percent';
  percent: string;
  amountSatang: number;
  targetIds: string[];
  minSubtotalSatang: number;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  stackable: boolean;
  priority: number;
  isActive: boolean;
  couponEnabled: boolean;
}

const empty: Draft = {
  name: '',
  code: '',
  kind: 'order_percent',
  percent: '10',
  amountSatang: 0,
  targetIds: [],
  minSubtotalSatang: 0,
  startsAt: '',
  endsAt: '',
  usageLimit: '',
  stackable: false,
  priority: 100,
  isActive: true,
  couponEnabled: false,
};

const KIND_LABEL: Record<string, { th: string; en: string }> = {
  order_percent: { th: 'ลดทั้งบิล %', en: 'Order %' },
  order_amount: { th: 'ลดทั้งบิลจำนวนเงิน', en: 'Order amount' },
  product_percent: { th: 'ลดสินค้าที่เลือก %', en: 'Product %' },
  category_percent: { th: 'ลดหมวดที่เลือก %', en: 'Category %' },
};

export function PromotionsPage() {
  const { t, locale } = useLang();
  const { money, dateTime } = useFormat();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [saving, setSaving] = useState(false);

  const list = useQuery({
    queryKey: ['promotions'],
    queryFn: () => api<Promotion[]>('/promotions?pageSize=50'),
    enabled: can('promotions.manage'),
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/categories'),
    enabled: open,
  });

  const products = useQuery({
    queryKey: ['products', 'promo-targets'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/products?pageSize=100&includeInactive=true'),
    enabled: open,
  });

  useEffect(() => {
    if (open) return;
    setEditing(null);
  }, [open]);

  const openCreate = () => {
    setEditing(null);
    setDraft(empty);
    setOpen(true);
  };

  const openEdit = (promo: Promotion) => {
    setEditing(promo);
    setDraft({
      name: promo.name,
      code: promo.code ?? '',
      kind: promo.kind as Draft['kind'],
      percent: String((promo.valueBp ?? 0) / 100),
      amountSatang: promo.valueSatang ?? 0,
      targetIds: promo.targetIds ?? [],
      minSubtotalSatang: promo.minSubtotalSatang,
      startsAt: promo.startsAt ? promo.startsAt.slice(0, 16) : '',
      endsAt: promo.endsAt ? promo.endsAt.slice(0, 16) : '',
      usageLimit: promo.usageLimit != null ? String(promo.usageLimit) : '',
      stackable: promo.stackable,
      priority: promo.priority,
      isActive: promo.isActive,
      couponEnabled: promo.couponEnabled,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    const percentBp = Math.round(Number(draft.percent) * 100);
    const payload = {
      name: draft.name,
      code: draft.code || '',
      kind: draft.kind,
      valueBp: draft.kind.endsWith('_percent') ? percentBp : undefined,
      valueSatang: draft.kind === 'order_amount' ? draft.amountSatang : undefined,
      targetIds: draft.targetIds,
      minSubtotalSatang: draft.minSubtotalSatang,
      startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : '',
      endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : '',
      usageLimit: draft.usageLimit ? Number(draft.usageLimit) : undefined,
      stackable: draft.stackable,
      priority: draft.priority,
      isActive: draft.isActive,
      couponEnabled: draft.couponEnabled,
    };
    try {
      if (editing) await api(`/promotions/${editing.id}`, { method: 'PUT', body: payload });
      else await api('/promotions', { method: 'POST', body: payload });
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['promotions'] });
      toast.success(editing ? t('แก้ไขโปรโมชั่นแล้ว', 'Promotion updated') : t('สร้างโปรโมชั่นแล้ว', 'Promotion created'));
    } catch (error) {
      toast.error(t('บันทึกไม่สำเร็จ', 'Save failed'), errorMessage(error, locale));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (promo: Promotion) => {
    try {
      await api(`/promotions/${promo.id}/toggle`, {
        method: 'POST',
        body: { isActive: !promo.isActive },
      });
      await queryClient.invalidateQueries({ queryKey: ['promotions'] });
    } catch (error) {
      toast.error(t('เปลี่ยนสถานะไม่สำเร็จ', 'Toggle failed'), errorMessage(error, locale));
    }
  };

  const rows = list.data?.data ?? [];
  const targetOptions = draft.kind === 'category_percent'
    ? (categories.data?.data ?? []).map((c) => ({ id: c.id, name: c.name }))
    : (products.data?.data ?? []).map((p) => ({ id: p.id, name: p.name }));

  return (
    <PageBody>
      <PageHeader
        title={t('โปรโมชั่นและคูปอง', 'Promotions & coupons')}
        description={t('ส่วนลดถูกคำนวณใหม่ที่เซิร์ฟเวอร์ทุกครั้ง และไม่ซ้อนกันโดยไม่ตั้งใจ', 'Discounts are recalculated server-side and never stack by accident.')}
        actions={
          can('promotions.manage') ? (
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              {t('สร้างโปรโมชั่น', 'New promotion')}
            </Button>
          ) : null
        }
      />

      {list.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Tag className="h-5 w-5" />} title={t('ยังไม่มีโปรโมชั่น', 'No promotions')} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((promo) => (
            <Card key={promo.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-semibold">{promo.name}</p>
                    <Badge tone={promo.isActive ? 'jade' : 'neutral'}>{promo.isActive ? t('เปิด', 'Active') : t('ปิด', 'Off')}</Badge>
                    {promo.couponEnabled ? <Badge tone="amber">{t('คูปอง', 'Coupon')}</Badge> : null}
                  </div>
                  <p className="mt-1 text-[11.5px] text-muted">
                    {KIND_LABEL[promo.kind] ? t(KIND_LABEL[promo.kind]!.th, KIND_LABEL[promo.kind]!.en) : promo.kind}
                    {' · '}
                    {promo.kind.endsWith('_percent')
                      ? `${(promo.valueBp ?? 0) / 100}%`
                      : money(promo.valueSatang ?? 0)}
                  </p>
                  {promo.code ? <p className="mt-1 font-mono text-[11px] text-jade">{promo.code}</p> : null}
                  <p className="mt-1 text-[10.5px] text-faint">
                    {t('ขั้นต่ำ', 'Min')} {money(promo.minSubtotalSatang)}
                    {promo.usageLimit ? ` · ${promo.usedCount}/${promo.usageLimit}` : ` · ${t('ใช้แล้ว', 'used')} ${promo.usedCount}`}
                    {promo.endsAt ? ` · ${t('ถึง', 'until')} ${dateTime(promo.endsAt)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="num text-[10px] text-faint">P{promo.priority}</span>
                  <Switch checked={promo.isActive} onChange={() => void toggle(promo)} />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
                <span className="text-[10px] text-faint">
                  {promo.stackable ? t('ซ้อนได้', 'Stackable') : t('ซ้อนไม่ได้', 'Exclusive')}
                  {' · '}{promo.targetIds.length} {t('เป้าหมาย', 'targets')}
                </span>
                <Button size="sm" variant="ghost" onClick={() => openEdit(promo)}>{t('แก้ไข', 'Edit')}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('แก้ไขโปรโมชั่น', 'Edit promotion') : t('สร้างโปรโมชั่น', 'New promotion')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('ยกเลิก', 'Cancel')}</Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>{t('บันทึก', 'Save')}</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ชื่อโปรโมชั่น', 'Name')} required className="sm:col-span-2">
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label={t('ประเภท', 'Type')}>
            <Select
              value={draft.kind}
              onChange={(event) => setDraft({ ...draft, kind: event.target.value as Draft['kind'], targetIds: [] })}
            >
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{t(label.th, label.en)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('รหัสคูปอง', 'Coupon code')} hint={t('เว้นว่างสำหรับโปรอัตโนมัติ', 'Leave blank for automatic')}>
            <Input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })} className="font-mono uppercase" />
          </Field>
          {draft.kind.endsWith('_percent') ? (
            <Field label={t('เปอร์เซ็นต์ส่วนลด', 'Discount %')}>
              <Input type="number" min="0" max="100" step="0.01" value={draft.percent} onChange={(event) => setDraft({ ...draft, percent: event.target.value })} />
            </Field>
          ) : (
            <Field label={t('จำนวนส่วนลด', 'Discount amount')}>
              <MoneyInput value={draft.amountSatang} onChange={(value) => setDraft({ ...draft, amountSatang: value })} />
            </Field>
          )}
          <Field label={t('ยอดขั้นต่ำ', 'Minimum subtotal')}>
            <MoneyInput value={draft.minSubtotalSatang} onChange={(value) => setDraft({ ...draft, minSubtotalSatang: value })} />
          </Field>
          <Field label={t('เริ่ม', 'Starts')}>
            <Input type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} />
          </Field>
          <Field label={t('สิ้นสุด', 'Ends')}>
            <Input type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} />
          </Field>
          <Field label={t('จำกัดจำนวนครั้ง', 'Usage limit')}>
            <Input type="number" min={0} value={draft.usageLimit} onChange={(event) => setDraft({ ...draft, usageLimit: event.target.value })} placeholder={t('ไม่จำกัด', 'Unlimited')} />
          </Field>
          <Field label={t('ลำดับความสำคัญ', 'Priority')}>
            <Input type="number" min={0} value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) || 0 })} />
          </Field>
          <div className="sm:col-span-2">
            <Switch checked={draft.couponEnabled} onChange={(value) => setDraft({ ...draft, couponEnabled: value })} label={t('ใช้เป็นคูปอง', 'Use as coupon')} />
          </div>
          <div className="sm:col-span-2">
            <Switch checked={draft.stackable} onChange={(value) => setDraft({ ...draft, stackable: value })} label={t('ซ้อนกับโปรอื่นได้', 'Can stack')} />
          </div>
          {(draft.kind === 'product_percent' || draft.kind === 'category_percent') ? (
            <Field label={t('เป้าหมาย', 'Targets')} className="sm:col-span-2">
              <div className="max-h-40 overflow-y-auto rounded-lg border border-line p-2">
                {targetOptions.map((option) => (
                  <label key={option.id} className="flex items-center gap-2 py-0.5 text-[12px]">
                    <input
                      type="checkbox"
                      checked={draft.targetIds.includes(option.id)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          targetIds: event.target.checked
                            ? [...draft.targetIds, option.id]
                            : draft.targetIds.filter((id) => id !== option.id),
                        })
                      }
                      className="h-3.5 w-3.5 accent-[var(--jade)]"
                    />
                    {option.name}
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
          <div className="sm:col-span-2">
            <Switch checked={draft.isActive} onChange={(value) => setDraft({ ...draft, isActive: value })} label={t('เปิดใช้งานทันที', 'Active')} />
          </div>
          <p className="rounded-lg bg-surface-2 p-2.5 text-[10.5px] text-muted sm:col-span-2">
            {t('ถ้าโปรที่ซ้อนไม่ได้ถูกใช้ คูปองจะถูกเพิกเฉยและแสดงเหตุผลให้แคชเชียร์เห็น', 'If an exclusive promotion applies, the coupon is ignored and the reason is shown at checkout.')}
          </p>
        </div>
      </Modal>
    </PageBody>
  );
}
