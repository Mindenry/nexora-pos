import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Building2, Database, Plus, ShieldCheck } from 'lucide-react';
import { api, errorMessage, qs } from '../lib/api';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { PageBody, PageHeader } from '../components/shell';
import { BarList, KpiCard } from '../components/charts';
import { MoneyInput } from '../components/money-input';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Drawer,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  Table,
  TD,
  TH,
  TR,
  Tabs,
  useToast,
} from '../components/ui';

interface Overview {
  tenants: { total: number; active: number; trial: number; suspended: number };
  usage: { users: number; employees: number; stores: number; sales: number; gmv30dSatang: number };
  plans: Array<{ code: string; name: string; priceSatang: number; maxStores: number; maxEmployees: number }>;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  storeCount: number;
  employeeCount: number;
  sales30d: number;
  gmv30dSatang: number;
  createdAt: string;
  onboardedAt: string | null;
}

interface TenantDetail extends TenantRow {
  stores: Array<{ id: string; code: string; name: string; isActive: boolean; stockUnits: number }>;
  employees: Array<{ id: string; name: string; email: string; status: string; role: string | null }>;
  sales: Array<{ date: string; orders: number; totalSatang: number }>;
  currentPeriodEnd: string | null;
}

interface Plan {
  id: string;
  code: string;
  name: string;
  priceSatang: number;
  interval: string;
  features: Record<string, boolean>;
  maxStores: number;
  maxEmployees: number;
  isActive: boolean;
}

export function PlatformPage() {
  const { t, locale } = useLang();
  const { money, number, dateTime } = useFormat();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'overview' | 'tenants' | 'plans' | 'audit' | 'health'>('overview');
  const [search, setSearch] = useState('');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [planDraft, setPlanDraft] = useState({
    code: '',
    name: '',
    priceSatang: 0,
    interval: 'monthly' as 'monthly' | 'yearly',
    maxStores: 1,
    maxEmployees: 5,
    isActive: true,
    features: {
      pos: true,
      inventory: true,
      reports_basic: true,
      purchasing: false,
      loyalty: false,
      multi_store: false,
      offline: false,
      priority_support: false,
    } as Record<string, boolean>,
  });

  const overview = useQuery({
    queryKey: ['platform-overview'],
    queryFn: () => api<Overview>('/platform/overview'),
    enabled: tab === 'overview',
  });
  const tenants = useQuery({
    queryKey: ['platform-tenants', search],
    queryFn: () => api<TenantRow[]>(`/platform/tenants${qs({ pageSize: 50, search: search || undefined })}`),
    enabled: tab === 'tenants' || tab === 'overview',
  });
  const detail = useQuery({
    queryKey: ['platform-tenant', tenantId],
    queryFn: () => api<TenantDetail>(`/platform/tenants/${tenantId}`),
    enabled: Boolean(tenantId),
  });
  const plans = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api<Plan[]>('/platform/plans'),
    enabled: tab === 'plans' || tab === 'overview',
  });
  const audit = useQuery({
    queryKey: ['platform-audit'],
    queryFn: () => api<Array<{ id: string; tenantName: string | null; actorName: string; action: string; entityType: string; createdAt: string }>>('/platform/audit?pageSize=40'),
    enabled: tab === 'audit',
  });
  const health = useQuery({
    queryKey: ['platform-health'],
    queryFn: () => api<{
      database: { size: string; connections: number };
      migrations: Array<{ version: string; applied_at: string }>;
      integrity: { salesTotalSatang: number; paymentsTotalSatang: number; ledgerRows: number; paymentMatchesSales: boolean };
      uptimeSeconds: number;
    }>('/platform/health'),
    enabled: tab === 'health',
  });

  const updateTenant = async (patch: { status?: string; planCode?: string }) => {
    if (!tenantId) return;
    setSubmitting(true);
    try {
      await api(`/platform/tenants/${tenantId}`, { method: 'PATCH', body: patch });
      await queryClient.invalidateQueries({ queryKey: ['platform-tenant', tenantId] });
      await queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
      await queryClient.invalidateQueries({ queryKey: ['platform-overview'] });
      toast.success(t('อัปเดตองค์กรแล้ว', 'Tenant updated'));
    } catch (error) {
      toast.error(t('อัปเดตไม่สำเร็จ', 'Update failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const detailData = detail.data?.data;

  const openPlan = (plan?: Plan) => {
    setEditingPlan(plan ?? null);
    setPlanDraft(
      plan
        ? {
            code: plan.code,
            name: plan.name,
            priceSatang: plan.priceSatang,
            interval: plan.interval as 'monthly' | 'yearly',
            maxStores: plan.maxStores,
            maxEmployees: plan.maxEmployees,
            isActive: plan.isActive,
            features: {
              pos: true,
              inventory: true,
              reports_basic: true,
              purchasing: false,
              loyalty: false,
              multi_store: false,
              offline: false,
              priority_support: false,
              ...plan.features,
            },
          }
        : {
            code: '',
            name: '',
            priceSatang: 0,
            interval: 'monthly',
            maxStores: 1,
            maxEmployees: 5,
            isActive: true,
            features: {
              pos: true,
              inventory: true,
              reports_basic: true,
              purchasing: false,
              loyalty: false,
              multi_store: false,
              offline: false,
              priority_support: false,
            },
          },
    );
    setPlanOpen(true);
  };

  const savePlan = async () => {
    if (!planDraft.code.trim() || !planDraft.name.trim()) return;
    setSubmitting(true);
    try {
      if (editingPlan) {
        await api(`/platform/plans/${editingPlan.id}`, { method: 'PATCH', body: planDraft });
      } else {
        await api('/platform/plans', { method: 'POST', body: planDraft });
      }
      setPlanOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['platform-plans'] });
      await queryClient.invalidateQueries({ queryKey: ['platform-overview'] });
      toast.success(t('บันทึกแพ็กเกจแล้ว', 'Plan saved'));
    } catch (error) {
      toast.error(t('บันทึกไม่สำเร็จ', 'Save failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageBody>
      <PageHeader
        title={t('ผู้ดูแลแพลตฟอร์ม', 'Platform administration')}
        description={t('จัดการองค์กร แพ็กเกจ สุขภาพระบบ และประวัติการทำงาน', 'Tenants, plans, system health and platform audit.')}
        actions={
          <div className="flex items-center gap-2">
            {tab === 'plans' ? (
              <Button variant="primary" onClick={() => openPlan()} leftIcon={<Plus className="h-4 w-4" />}>
                {t('เพิ่มแพ็กเกจ', 'New plan')}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => void overview.refetch()}>
              {t('รีเฟรช', 'Refresh')}
            </Button>
          </div>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: t('ภาพรวม', 'Overview') },
          { value: 'tenants', label: t('องค์กร', 'Tenants') },
          { value: 'plans', label: t('แพ็กเกจ', 'Plans') },
          { value: 'audit', label: t('Audit', 'Audit') },
          { value: 'health', label: t('สุขภาพระบบ', 'Health') },
        ]}
        className="mb-3"
      />

      {tab === 'overview' ? (
        <div className="space-y-4">
          {overview.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
          ) : overview.data ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label={t('องค์กรทั้งหมด', 'Tenants')} value={number(overview.data.data.tenants.total)} sub={`${overview.data.data.tenants.active} active · ${overview.data.data.tenants.trial} trial`} icon={<Building2 className="h-4 w-4" />} />
                <KpiCard label={t('ผู้ใช้', 'Users')} value={number(overview.data.data.usage.users)} sub={`${overview.data.data.usage.employees} employees`} />
                <KpiCard label={t('สาขา', 'Stores')} value={number(overview.data.data.usage.stores)} sub={`${overview.data.data.usage.sales} sales`} />
                <KpiCard label={t('GMV 30 วัน', 'GMV 30d')} value={money(overview.data.data.usage.gmv30dSatang)} icon={<Activity className="h-4 w-4" />} />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader title={t('แพ็กเกจที่ใช้งาน', 'Plans')} />
                  <div className="divide-y divide-line px-5 pb-4">
                    {overview.data.data.plans.map((plan) => (
                      <div key={plan.code} className="flex items-center justify-between py-2.5">
                        <div>
                          <p className="text-[12.5px] font-medium">{plan.name}</p>
                          <p className="text-[10px] text-faint">{plan.maxStores} stores · {plan.maxEmployees} employees</p>
                        </div>
                        <span className="num text-[12px]">{money(plan.priceSatang)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card>
                  <CardHeader title={t('องค์กรล่าสุด', 'Recent tenants')} />
                  <div className="divide-y divide-line px-5 pb-4">
                    {(tenants.data?.data ?? []).slice(0, 5).map((tenant) => (
                      <button key={tenant.id} type="button" onClick={() => { setTenantId(tenant.id); setTab('tenants'); }} className="flex w-full items-center justify-between py-2.5 text-left">
                        <div>
                          <p className="text-[12.5px] font-medium">{tenant.name}</p>
                          <p className="text-[10px] text-faint">{tenant.planCode ?? '—'} · {tenant.storeCount} stores</p>
                        </div>
                        <Badge tone={tenant.status === 'active' ? 'jade' : tenant.status === 'trial' ? 'amber' : 'danger'}>{tenant.status}</Badge>
                      </button>
                    ))}
                  </div>
                </Card>
              </div>
            </>
          ) : null}
        </div>
      ) : tab === 'tenants' ? (
        <Card>
          <div className="flex items-center gap-2 border-b border-line p-3">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('ค้นหาองค์กร', 'Search tenants')} className="max-w-[280px]" />
          </div>
          {tenants.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : (
            <Table>
              <thead><tr><TH>{t('องค์กร', 'Tenant')}</TH><TH>{t('แพ็กเกจ', 'Plan')}</TH><TH align="right">{t('สาขา', 'Stores')}</TH><TH align="right">{t('พนักงาน', 'Employees')}</TH><TH align="right">GMV 30d</TH><TH>{t('สถานะ', 'Status')}</TH></tr></thead>
              <tbody>
                {(tenants.data?.data ?? []).map((tenant) => (
                  <TR key={tenant.id} onClick={() => setTenantId(tenant.id)}>
                    <TD><p className="text-[12.5px] font-medium">{tenant.name}</p><p className="text-[10px] text-faint">{tenant.slug} · {dateTime(tenant.createdAt)}</p></TD>
                    <TD><Badge tone="info">{tenant.planCode ?? '—'}</Badge></TD>
                    <TD align="right" className="num">{tenant.storeCount}</TD>
                    <TD align="right" className="num">{tenant.employeeCount}</TD>
                    <TD align="right" className="num">{money(tenant.gmv30dSatang)}</TD>
                    <TD><Badge tone={tenant.status === 'active' ? 'jade' : tenant.status === 'trial' ? 'amber' : 'danger'}>{tenant.status}</Badge></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : tab === 'plans' ? (
        <div className="grid gap-3 md:grid-cols-3">
          {plans.isLoading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />) : (plans.data?.data ?? []).map((plan) => (
            <Card key={plan.id} className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-semibold">{plan.name}</p>
                <Badge tone={plan.isActive ? 'jade' : 'neutral'}>{plan.interval}</Badge>
              </div>
              <p className="num mt-2 text-[24px] font-semibold">{money(plan.priceSatang)}</p>
              <p className="text-[10.5px] text-faint">{plan.maxStores} stores · {plan.maxEmployees} employees</p>
              <div className="mt-3 space-y-1 border-t border-line pt-3 text-[11px]">
                {Object.entries(plan.features).map(([key, enabled]) => (
                  <p key={key} className="flex justify-between"><span className="text-muted">{key}</span><span className={enabled ? 'text-jade' : 'text-faint'}>{enabled ? 'on' : 'off'}</span></p>
                ))}
              </div>
              <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={() => openPlan(plan)}>
                {t('แก้ไขแพ็กเกจ', 'Edit plan')}
              </Button>
            </Card>
          ))}
        </div>
      ) : tab === 'audit' ? (
        <Card>
          <CardHeader title={t('Platform audit', 'Platform audit')} description={t('ทุกการเปลี่ยนแปลงขององค์กรและแพ็กเกจ', 'Every tenant and plan change.')} />
          {audit.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : (audit.data?.data ?? []).length === 0 ? (
            <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title={t('ยังไม่มีรายการ', 'No entries')} />
          ) : (
            <Table>
              <thead><tr><TH>{t('เวลา', 'Time')}</TH><TH>{t('องค์กร', 'Tenant')}</TH><TH>{t('ผู้ทำ', 'Actor')}</TH><TH>{t('การกระทำ', 'Action')}</TH><TH>{t('วัตถุ', 'Entity')}</TH></tr></thead>
              <tbody>
                {(audit.data?.data ?? []).map((row) => (
                  <TR key={row.id}>
                    <TD className="text-[11px] text-muted">{dateTime(row.createdAt)}</TD>
                    <TD className="text-[12px]">{row.tenantName ?? '—'}</TD>
                    <TD className="text-[12px]">{row.actorName}</TD>
                    <TD><span className="font-mono text-[10.5px] text-violet">{row.action}</span></TD>
                    <TD className="text-[10.5px] text-faint">{row.entityType}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {health.isLoading ? <Skeleton className="h-64 rounded-xl" /> : health.data ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiCard label={t('ฐานข้อมูล', 'Database')} value={health.data.data.database.size ?? '—'} sub={`${health.data.data.database.connections} connections`} icon={<Database className="h-4 w-4" />} />
                <KpiCard label={t('Uptime', 'Uptime')} value={`${Math.floor(health.data.data.uptimeSeconds / 60)}m`} />
                <KpiCard
                  label={t('ความสอดคล้องเงิน', 'Money integrity')}
                  value={health.data.data.integrity.paymentMatchesSales ? t('ตรงกัน', 'Reconciled') : t('ไม่ตรง', 'Mismatch')}
                  sub={`${money(health.data.data.integrity.salesTotalSatang)} / ${money(health.data.data.integrity.paymentsTotalSatang)}`}
                  icon={<ShieldCheck className="h-4 w-4" />}
                />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader title={t('Migration ล่าสุด', 'Recent migrations')} />
                  <div className="divide-y divide-line px-5 pb-4">
                    {health.data.data.migrations.map((migration) => (
                      <div key={migration.version} className="flex justify-between py-2 text-[11.5px]">
                        <span className="font-mono">{migration.version}</span>
                        <span className="text-faint">{dateTime(migration.applied_at)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card>
                  <CardHeader title={t('Ledger', 'Ledger')} />
                  <div className="px-5 pb-5">
                    <p className="text-[12px] text-muted">{t('จำนวน movement ในสต๊อก', 'Stock movements')}</p>
                    <p className="num text-[20px] font-semibold">{number(health.data.data.integrity.ledgerRows)}</p>
                    <p className="mt-2 text-[11px] text-faint">{t('ตรวจสอบยอดขายเทียบ payments ทุกครั้งที่โหลดหน้านี้', 'Sales vs payments is checked on every load.')}</p>
                  </div>
                </Card>
              </div>
            </>
          ) : null}
        </div>
      )}

      <Drawer
        open={Boolean(tenantId)}
        onClose={() => setTenantId(null)}
        title={detailData?.name ?? t('องค์กร', 'Tenant')}
        description={detailData ? `${detailData.slug} · ${detailData.planCode ?? '—'}` : undefined}
        width="lg"
        footer={
          detailData ? (
            <>
              <Button
                variant={detailData.status === 'suspended' ? 'primary' : 'danger'}
                loading={submitting}
                onClick={() => void updateTenant({ status: detailData.status === 'suspended' ? 'active' : 'suspended' })}
              >
                {detailData.status === 'suspended' ? t('เปิดใช้งานอีกครั้ง', 'Reactivate') : t('ระงับองค์กร', 'Suspend')}
              </Button>
              <Button variant="secondary" onClick={() => void updateTenant({ planCode: detailData.planCode === 'growth' ? 'scale' : 'growth' })}>
                {t('เปลี่ยนแพ็กเกจ', 'Change plan')}
              </Button>
            </>
          ) : undefined
        }
      >
        {detail.isLoading ? <Skeleton className="h-40" /> : detailData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-line p-3"><p className="text-[10px] text-faint">GMV 30d</p><p className="num text-[15px] font-semibold">{money(detailData.gmv30dSatang)}</p></div>
              <div className="rounded-lg border border-line p-3"><p className="text-[10px] text-faint">{t('สถานะ', 'Status')}</p><Badge tone={detailData.status === 'active' ? 'jade' : detailData.status === 'trial' ? 'amber' : 'danger'}>{detailData.status}</Badge></div>
            </div>
            <div>
              <p className="mb-1 text-[11.5px] font-semibold">{t('สาขา', 'Stores')}</p>
              {detailData.stores.map((store) => (
                <div key={store.id} className="flex justify-between border-b border-line/60 py-1.5 text-[12px]">
                  <span>{store.name} <span className="text-[10px] text-faint">{store.code}</span></span>
                  <span className="num text-muted">{number(store.stockUnits)} units</span>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1 text-[11.5px] font-semibold">{t('พนักงาน', 'Employees')}</p>
              {detailData.employees.map((employee) => (
                <div key={employee.id} className="flex justify-between border-b border-line/60 py-1.5 text-[12px]">
                  <span>{employee.name} <span className="text-[10px] text-faint">{employee.email}</span></span>
                  <Badge tone="neutral">{employee.role}</Badge>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1 text-[11.5px] font-semibold">{t('ยอดขาย 14 วัน', 'Sales 14d')}</p>
              <BarList items={detailData.sales.map((sale) => ({ label: sale.date, value: sale.totalSatang }))} valueFormat={(v) => money(v, true)} tone="info" />
            </div>
            <InlineAlert tone="info">
              {t('การระงับองค์กรจะเพิกถอน session ทั้งหมดทันที และ API จะปฏิเสธคำขอถัดไป', 'Suspending revokes all sessions immediately; the API rejects subsequent requests.')}
            </InlineAlert>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title={editingPlan ? t('แก้ไขแพ็กเกจ', 'Edit plan') : t('เพิ่มแพ็กเกจ', 'New plan')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlanOpen(false)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void savePlan()}>
              {t('บันทึก', 'Save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('รหัส', 'Code')} required>
            <Input
              value={planDraft.code}
              onChange={(event) => setPlanDraft({ ...planDraft, code: event.target.value.toLowerCase() })}
              className="font-mono"
              disabled={planDraft.code === 'starter' || planDraft.code === 'growth' || planDraft.code === 'scale'}
            />
          </Field>
          <Field label={t('ชื่อแพ็กเกจ', 'Plan name')} required>
            <Input value={planDraft.name} onChange={(event) => setPlanDraft({ ...planDraft, name: event.target.value })} />
          </Field>
          <Field label={t('ราคา / งวด', 'Price / interval')}>
            <MoneyInput value={planDraft.priceSatang} onChange={(value) => setPlanDraft({ ...planDraft, priceSatang: value })} />
          </Field>
          <Field label={t('รอบบิล', 'Billing interval')}>
            <Select
              value={planDraft.interval}
              onChange={(event) => setPlanDraft({ ...planDraft, interval: event.target.value as 'monthly' | 'yearly' })}
            >
              <option value="monthly">{t('รายเดือน', 'Monthly')}</option>
              <option value="yearly">{t('รายปี', 'Yearly')}</option>
            </Select>
          </Field>
          <Field label={t('จำนวนสาขาสูงสุด', 'Max stores')}>
            <Input type="number" min={1} value={planDraft.maxStores} onChange={(event) => setPlanDraft({ ...planDraft, maxStores: Number(event.target.value) || 1 })} />
          </Field>
          <Field label={t('จำนวนพนักงานสูงสุด', 'Max employees')}>
            <Input type="number" min={1} value={planDraft.maxEmployees} onChange={(event) => setPlanDraft({ ...planDraft, maxEmployees: Number(event.target.value) || 1 })} />
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[12px] font-medium">{t('ฟีเจอร์ที่เปิดใช้', 'Enabled features')}</p>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-line p-3">
              {Object.keys(planDraft.features).map((feature) => (
                <label key={feature} className="flex items-center gap-2 text-[11.5px]">
                  <input
                    type="checkbox"
                    checked={Boolean(planDraft.features[feature])}
                    onChange={(event) =>
                      setPlanDraft({
                        ...planDraft,
                        features: { ...planDraft.features, [feature]: event.target.checked },
                      })
                    }
                    className="h-3.5 w-3.5 accent-[var(--jade)]"
                  />
                  {feature}
                </label>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <Switch
              checked={planDraft.isActive}
              onChange={(value) => setPlanDraft({ ...planDraft, isActive: value })}
              label={t('เปิดขายแพ็กเกจนี้', 'Plan is available')}
            />
          </div>
        </div>
      </Modal>
    </PageBody>
  );
}
