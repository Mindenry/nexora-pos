import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, Users } from 'lucide-react';
import { api, errorMessage, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { PageBody, PageHeader } from '../components/shell';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Table,
  TD,
  TH,
  TR,
  Tabs,
  useToast,
} from '../components/ui';

interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  phone: string;
  status: string;
  email: string;
  roleCode: string | null;
  roleNameTh: string | null;
  roleNameEn: string | null;
  storeIds: string[];
  storeNames: string[];
  defaultStoreId: string | null;
  hiredAt: string | null;
  lastLoginAt: string | null;
}

interface Role {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  scope: string;
  permissions: string[];
}

interface StoreRow {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  timezone: string;
  taxId: string;
  receiptPrefix: string;
  isActive: boolean;
  employeeCount: number;
  salesCount: number;
}

interface Draft {
  name: string;
  email: string;
  phone: string;
  password: string;
  roleCode: string;
  storeIds: string[];
  status: string;
  newPassword: string;
}

export function EmployeesPage() {
  const { t, locale } = useLang();
  const { number, dateTime } = useFormat();
  const { me, can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'people' | 'roles' | 'stores'>('people');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', email: '', phone: '', password: '', roleCode: 'cashier', storeIds: [], status: 'active', newPassword: '' });
  const [storeFormOpen, setStoreFormOpen] = useState(false);
  const [storeDraft, setStoreDraft] = useState({ name: '', code: '', address: '', phone: '', timezone: 'Asia/Bangkok', taxId: '', receiptPrefix: 'R' });
  const [submitting, setSubmitting] = useState(false);

  const employees = useQuery({
    queryKey: ['employees', page, search],
    queryFn: () => api<Employee[]>(`/employees${qs({ page, pageSize: 20, search: search || undefined })}`),
    enabled: can('employees.manage'),
  });
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api<Role[]>('/roles'),
    enabled: can('employees.manage'),
  });
  const permissions = useQuery({
    queryKey: ['permissions'],
    queryFn: () => api<Array<{ code: string; module: string; labelTh: string; labelEn: string }>>('/permissions'),
    enabled: can('employees.manage') && tab === 'roles',
  });
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api<StoreRow[]>('/stores'),
    enabled: can('employees.manage'),
  });

  const rows = employees.data?.data ?? [];
  const storeRows = stores.data?.data ?? [];
  const defaultStore = me?.store?.id ?? storeRows[0]?.id ?? '';

  const openCreate = () => {
    setEditing(null);
    setDraft({ name: '', email: '', phone: '', password: '', roleCode: 'cashier', storeIds: defaultStore ? [defaultStore] : [], status: 'active', newPassword: '' });
    setFormOpen(true);
  };

  const openEdit = (employee: Employee) => {
    setEditing(employee);
    setDraft({
      name: employee.name,
      email: employee.email,
      phone: employee.phone,
      password: '',
      roleCode: employee.roleCode ?? 'cashier',
      storeIds: employee.storeIds,
      status: employee.status,
      newPassword: '',
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim() || draft.storeIds.length === 0) return;
    setSubmitting(true);
    try {
      if (editing) {
        await api(`/employees/${editing.id}`, {
          method: 'PATCH',
          body: {
            name: draft.name,
            phone: draft.phone,
            roleCode: draft.roleCode,
            storeIds: draft.storeIds,
            status: draft.status,
            newPassword: draft.newPassword || undefined,
          },
        });
      } else {
        await api('/employees', {
          method: 'POST',
          body: {
            name: draft.name,
            email: draft.email,
            phone: draft.phone,
            password: draft.password,
            roleCode: draft.roleCode,
            storeIds: draft.storeIds,
          },
        });
      }
      setFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success(editing ? t('แก้ไขพนักงานแล้ว', 'Employee updated') : t('เพิ่มพนักงานแล้ว', 'Employee created'));
    } catch (error) {
      toast.error(t('บันทึกไม่สำเร็จ', 'Save failed'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const saveStore = async () => {
    if (!storeDraft.name.trim() || !storeDraft.code.trim()) return;
    setSubmitting(true);
    try {
      await api('/stores', { method: 'POST', body: storeDraft });
      setStoreFormOpen(false);
      setStoreDraft({ name: '', code: '', address: '', phone: '', timezone: 'Asia/Bangkok', taxId: '', receiptPrefix: 'R' });
      await queryClient.invalidateQueries({ queryKey: ['stores'] });
      toast.success(t('เพิ่มสาขาแล้ว', 'Branch created'));
    } catch (error) {
      toast.error(t('เพิ่มสาขาไม่สำเร็จ', 'Could not create branch'), errorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const roleOptions = (roles.data?.data ?? []).filter((role) => role.code !== 'owner');

  return (
    <PageBody>
      <PageHeader
        title={t('พนักงานและสิทธิ์', 'Employees & access')}
        description={t('บทบาทและสาขาที่เข้าถึงถูกตรวจสอบที่เซิร์ฟเวอร์ทุกคำขอ', 'Roles and store scope are enforced on every request.')}
        actions={
          tab === 'people' && can('employees.manage') ? (
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              {t('เพิ่มพนักงาน', 'Add employee')}
            </Button>
          ) : tab === 'stores' && can('settings.manage') ? (
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setStoreFormOpen(true)}>
              {t('เพิ่มสาขา', 'Add branch')}
            </Button>
          ) : null
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'people', label: t('พนักงาน', 'Employees'), count: rows.length },
          { value: 'roles', label: t('บทบาท', 'Roles') },
          { value: 'stores', label: t('สาขา', 'Branches') },
        ]}
        className="mb-3"
      />

      {tab === 'people' ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t('ค้นหาชื่อหรืออีเมล', 'Search name or email')} className="max-w-[280px]" />
            <Badge tone="neutral">
              {number(rows.length)} / {number(Number((employees.data?.meta?.limits as { maxEmployees?: number } | undefined)?.maxEmployees ?? 0))} {t('สิทธิ์ตามแพ็กเกจ', 'plan limit')}
            </Badge>
          </div>
          {employees.isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title={t('ยังไม่มีพนักงาน', 'No employees')} />
          ) : (
            <Table>
              <thead><tr><TH>{t('ชื่อ', 'Name')}</TH><TH>{t('อีเมล', 'Email')}</TH><TH>{t('บทบาท', 'Role')}</TH><TH>{t('สาขา', 'Branches')}</TH><TH>{t('สถานะ', 'Status')}</TH><TH>{t('เข้าใช้ล่าสุด', 'Last login')}</TH></tr></thead>
              <tbody>
                {rows.map((employee) => (
                  <TR key={employee.id} onClick={() => openEdit(employee)}>
                    <TD><p className="text-[12.5px] font-medium">{employee.name}</p><p className="text-[10px] text-faint">{employee.employeeCode || '—'}</p></TD>
                    <TD className="text-[11.5px] text-muted">{employee.email}</TD>
                    <TD><Badge tone="jade">{locale === 'th' ? employee.roleNameTh : employee.roleNameEn}</Badge></TD>
                    <TD className="text-[11px] text-muted">{employee.storeNames.join(', ')}</TD>
                    <TD><Badge tone={employee.status === 'active' ? 'jade' : 'danger'}>{employee.status}</Badge></TD>
                    <TD className="text-[10.5px] text-muted">{employee.lastLoginAt ? dateTime(employee.lastLoginAt) : '—'}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : tab === 'roles' ? (
        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <Card>
            <CardHeader title={t('บทบาทในองค์กร', 'Tenant roles')} />
            <div className="divide-y divide-line px-4 pb-4">
              {(roles.data?.data ?? []).map((role) => (
                <div key={role.id} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[12.5px] font-medium">{locale === 'th' ? role.nameTh : role.nameEn}</p>
                    <Badge tone={role.scope === 'tenant' ? 'amber' : 'neutral'}>{role.scope}</Badge>
                  </div>
                  <p className="text-[10px] text-faint">{role.code} · {role.permissions.length} permissions</p>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title={t('เมทริกซ์สิทธิ์', 'Permission matrix')} description={t('สิทธิ์มีผลที่ API ไม่ใช่แค่ซ่อนปุ่ม', 'Permissions are enforced by the API, not just hidden buttons.')} />
            <Table>
              <thead><tr><TH>{t('สิทธิ์', 'Permission')}</TH>{(roles.data?.data ?? []).map((role) => <TH key={role.id} align="center">{role.code}</TH>)}</tr></thead>
              <tbody>
                {(permissions.data?.data ?? []).map((permission) => (
                  <TR key={permission.code}>
                    <TD><p className="text-[11.5px]">{locale === 'th' ? permission.labelTh : permission.labelEn}</p><p className="font-mono text-[9.5px] text-faint">{permission.code}</p></TD>
                    {(roles.data?.data ?? []).map((role) => (
                      <TD key={role.id} align="center">
                        {role.permissions.includes(permission.code) ? <ShieldCheck className="mx-auto h-3.5 w-3.5 text-jade" /> : <span className="text-line-strong">—</span>}
                      </TD>
                    ))}
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader title={t('สาขา', 'Branches')} description={t('แต่ละสาขามีสต๊อก กะ และเลขใบเสร็จของตัวเอง', 'Each branch owns its stock, shifts and receipt numbers.')} />
          {stores.isLoading ? <div className="p-4"><Skeleton className="h-20" /></div> : (
            <Table>
              <thead><tr><TH>{t('สาขา', 'Branch')}</TH><TH>{t('ที่อยู่', 'Address')}</TH><TH align="right">{t('พนักงาน', 'Staff')}</TH><TH align="right">{t('บิลทั้งหมด', 'Sales')}</TH><TH>{t('สถานะ', 'Status')}</TH></tr></thead>
              <tbody>
                {storeRows.map((store) => (
                  <TR key={store.id}>
                    <TD><p className="text-[12.5px] font-medium">{store.name}</p><p className="text-[10px] text-faint">{store.code} · {store.timezone}</p></TD>
                    <TD className="max-w-[280px] truncate text-[11px] text-muted">{store.address || '—'}</TD>
                    <TD align="right" className="num">{store.employeeCount}</TD>
                    <TD align="right" className="num">{store.salesCount}</TD>
                    <TD><Badge tone={store.isActive ? 'jade' : 'neutral'}>{store.isActive ? t('ใช้งาน', 'Active') : t('ปิด', 'Inactive')}</Badge></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('แก้ไขพนักงาน', 'Edit employee') : t('เพิ่มพนักงาน', 'New employee')}
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
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          {!editing ? (
            <Field label={t('อีเมล', 'Email')} required>
              <Input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
            </Field>
          ) : (
            <Field label={t('อีเมล', 'Email')}>
              <Input value={draft.email} disabled />
            </Field>
          )}
          <Field label={t('โทร', 'Phone')}>
            <Input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
          </Field>
          <Field label={t('บทบาท', 'Role')}>
            <Select value={draft.roleCode} onChange={(event) => setDraft({ ...draft, roleCode: event.target.value })}>
              {roleOptions.map((role) => (
                <option key={role.id} value={role.code}>{locale === 'th' ? role.nameTh : role.nameEn}</option>
              ))}
              {editing?.roleCode === 'owner' ? <option value="owner">{t('เจ้าของ (คงเดิม)', 'Owner (unchanged)')}</option> : null}
            </Select>
          </Field>
          <Field label={editing ? t('สถานะ', 'Status') : t('รหัสผ่านเริ่มต้น', 'Initial password')} required={!editing}>
            {editing ? (
              <Select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                <option value="active">{t('ใช้งาน', 'Active')}</option>
                <option value="suspended">{t('ระงับ', 'Suspended')}</option>
              </Select>
            ) : (
              <Input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} minLength={10} />
            )}
          </Field>
          <Field label={t('สาขาที่เข้าถึง', 'Store access')} className="sm:col-span-2">
            <div className="grid gap-1 rounded-lg border border-line p-3 sm:grid-cols-2">
              {storeRows.map((store) => (
                <label key={store.id} className="flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={draft.storeIds.includes(store.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        storeIds: event.target.checked
                          ? [...draft.storeIds, store.id]
                          : draft.storeIds.filter((id) => id !== store.id),
                      })
                    }
                    className="h-3.5 w-3.5 accent-[var(--jade)]"
                  />
                  {store.name}
                </label>
              ))}
            </div>
          </Field>
          {editing ? (
            <Field label={t('ตั้งรหัสผ่านใหม่', 'New password')} hint={t('เว้นว่างถ้าไม่เปลี่ยน', 'Leave blank to keep')} className="sm:col-span-2">
              <Input type="password" value={draft.newPassword} onChange={(event) => setDraft({ ...draft, newPassword: event.target.value })} />
            </Field>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={storeFormOpen}
        onClose={() => setStoreFormOpen(false)}
        title={t('เพิ่มสาขา', 'New branch')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStoreFormOpen(false)}>{t('ยกเลิก', 'Cancel')}</Button>
            <Button variant="primary" loading={submitting} onClick={() => void saveStore()}>{t('บันทึก', 'Save')}</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ชื่อสาขา', 'Branch name')} required><Input value={storeDraft.name} onChange={(event) => setStoreDraft({ ...storeDraft, name: event.target.value })} /></Field>
          <Field label={t('รหัส', 'Code')} required><Input value={storeDraft.code} onChange={(event) => setStoreDraft({ ...storeDraft, code: event.target.value.toUpperCase() })} /></Field>
          <Field label={t('ที่อยู่', 'Address')} className="sm:col-span-2"><Input value={storeDraft.address} onChange={(event) => setStoreDraft({ ...storeDraft, address: event.target.value })} /></Field>
          <Field label={t('โทร', 'Phone')}><Input value={storeDraft.phone} onChange={(event) => setStoreDraft({ ...storeDraft, phone: event.target.value })} /></Field>
          <Field label={t('เลขภาษี', 'Tax ID')}><Input value={storeDraft.taxId} onChange={(event) => setStoreDraft({ ...storeDraft, taxId: event.target.value })} /></Field>
          <Field label={t('คำนำหน้าใบเสร็จ', 'Receipt prefix')}><Input value={storeDraft.receiptPrefix} onChange={(event) => setStoreDraft({ ...storeDraft, receiptPrefix: event.target.value.toUpperCase() })} /></Field>
          <Field label={t('Timezone', 'Timezone')}><Input value={storeDraft.timezone} onChange={(event) => setStoreDraft({ ...storeDraft, timezone: event.target.value })} /></Field>
        </div>
      </Modal>
    </PageBody>
  );
}
