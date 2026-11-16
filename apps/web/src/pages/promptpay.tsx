import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  CircleCheck,
  CircleX,
  Clock,
  Download,
  ExternalLink,
  Pencil,
  Printer,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Star,
  Trash2,
  Wallet,
} from 'lucide-react';
import { ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useLang } from '../lib/i18n';
import {
  identifierErrorMessage,
  identifierTypeLabel,
  promptPayApi,
  type PromptPayAccount,
  type PromptPayListMeta,
  type PromptPaySession,
  type PromptPayStatus,
} from '../lib/promptpay';
import { PageBody, PageHeader } from '../components/shell';
import { PromptPayStatusBadge } from '../components/status';
import {
  Badge,
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
  Switch,
  Table,
  TD,
  TH,
  TR,
  Tabs,
  Textarea,
  cn,
  useToast,
} from '../components/ui';

type Tab = 'history' | 'accounts';

interface AccountForm {
  identifierType: 'mobile' | 'national_id';
  identifier: string;
  displayName: string;
  isDefault: boolean;
  isActive: boolean;
}

const EMPTY_FORM: AccountForm = {
  identifierType: 'mobile',
  identifier: '',
  displayName: '',
  isDefault: false,
  isActive: true,
};

const AUDIT_LABELS: Record<string, { th: string; en: string }> = {
  created: { th: 'สร้าง QR', en: 'QR created' },
  confirmed: { th: 'ยืนยันรับเงิน', en: 'Payment confirmed' },
  cancelled: { th: 'ยกเลิก', en: 'Cancelled' },
  expired: { th: 'หมดอายุ', en: 'Expired' },
  qr_regenerated: { th: 'สร้าง QR ใหม่', en: 'QR regenerated' },
  replaced: { th: 'แทนที่ด้วยรายการใหม่', en: 'Replaced' },
  sale_linked: { th: 'เชื่อมกับบิลขาย', en: 'Linked to sale' },
};

export function PromptPayPage() {
  const { t, locale } = useLang();
  const { money, dateTime } = useFormat();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('history');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PromptPayStatus | ''>('');
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(false);

  const [accountModal, setAccountModal] = useState<'new' | PromptPayAccount | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>(EMPTY_FORM);
  const [savingAccount, setSavingAccount] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PromptPayAccount | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [staticAccount, setStaticAccount] = useState<PromptPayAccount | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const accounts = useQuery({
    queryKey: ['promptpay-accounts', includeInactive],
    queryFn: () => promptPayApi.listAccounts(includeInactive),
    enabled: can('promptpay.accounts.read'),
  });

  const sessions = useQuery({
    queryKey: ['promptpay-sessions', page, search, status],
    queryFn: () =>
      promptPayApi.listSessions({
        page,
        pageSize: 20,
        status,
        search,
      }),
    enabled: can('payments.read') && tab === 'history',
  });

  const detail = useQuery({
    queryKey: ['promptpay-session', detailId],
    queryFn: () => promptPayApi.getSession(detailId!),
    enabled: Boolean(detailId) && can('payments.read'),
  });

  const staticQr = useQuery({
    queryKey: ['promptpay-static-qr', staticAccount?.id],
    queryFn: () => promptPayApi.getStaticQr(staticAccount!.id),
    enabled: Boolean(staticAccount) && can('promptpay.accounts.read'),
  });

  const meta = sessions.data?.meta as PromptPayListMeta | undefined;
  const accountRows = useMemo(() => accounts.data?.data ?? [], [accounts.data]);
  const defaultAccount = useMemo(
    () => accountRows.find((account) => account.isDefault && account.isActive),
    [accountRows],
  );

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['promptpay-accounts'] }),
      queryClient.invalidateQueries({ queryKey: ['promptpay-sessions'] }),
      queryClient.invalidateQueries({ queryKey: ['promptpay-session'] }),
    ]);
  };

  const openNewAccount = () => {
    setAccountForm({ ...EMPTY_FORM, isDefault: accountRows.length === 0 });
    setAccountModal('new');
  };

  const openEditAccount = (account: PromptPayAccount) => {
    setAccountForm({
      identifierType: account.identifierType,
      identifier: '',
      displayName: account.displayName,
      isDefault: account.isDefault,
      isActive: account.isActive,
    });
    setAccountModal(account);
  };

  const describeAccountError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'DOMAIN_PROMPTPAY_IDENTIFIER_INVALID') {
      const reason = (error.details as { reason?: string } | undefined)?.reason;
      return identifierErrorMessage(reason, locale);
    }
    return errorMessage(error, locale);
  };

  const saveAccount = async () => {
    if (!accountForm.displayName.trim()) {
      toast.error(t('กรุณาตั้งชื่อบัญชี', 'Enter an account name'));
      return;
    }
    const editing = accountModal && accountModal !== 'new' ? accountModal : null;
    if (!editing && !accountForm.identifier.trim()) {
      toast.error(t('กรุณากรอกหมายเลขพร้อมเพย์', 'Enter a PromptPay identifier'));
      return;
    }
    setSavingAccount(true);
    try {
      if (editing) {
        await promptPayApi.updateAccount(editing.id, {
          displayName: accountForm.displayName.trim(),
          isDefault: accountForm.isDefault,
          isActive: accountForm.isActive,
          ...(accountForm.identifier.trim()
            ? {
                identifierType: accountForm.identifierType,
                identifier: accountForm.identifier.trim(),
              }
            : {}),
        });
        toast.success(t('บันทึกบัญชีแล้ว', 'Account saved'));
      } else {
        await promptPayApi.createAccount({
          identifierType: accountForm.identifierType,
          identifier: accountForm.identifier.trim(),
          displayName: accountForm.displayName.trim(),
          isDefault: accountForm.isDefault,
          isActive: accountForm.isActive,
        });
        toast.success(t('เพิ่มบัญชีพร้อมเพย์แล้ว', 'PromptPay account added'));
      }
      setAccountModal(null);
      await refreshAll();
    } catch (error) {
      toast.error(t('บันทึกไม่สำเร็จ', 'Could not save'), describeAccountError(error));
    } finally {
      setSavingAccount(false);
    }
  };

  const makeDefault = async (account: PromptPayAccount) => {
    try {
      await promptPayApi.setDefault(account.id);
      await refreshAll();
      toast.success(t('ตั้งเป็นบัญชีเริ่มต้นแล้ว', 'Default account updated'));
    } catch (error) {
      toast.error(t('ทำรายการไม่สำเร็จ', 'Action failed'), errorMessage(error, locale));
    }
  };

  const removeAccount = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await promptPayApi.deleteAccount(deleteTarget.id);
      setDeleteTarget(null);
      await refreshAll();
      toast.success(t('ลบบัญชีแล้ว', 'Account removed'));
    } catch (error) {
      toast.error(t('ลบไม่สำเร็จ', 'Could not delete'), errorMessage(error, locale));
    } finally {
      setDeleting(false);
    }
  };

  const cancelSession = async () => {
    if (!detailId) return;
    setActing(true);
    try {
      await promptPayApi.cancelSession(detailId, cancelReason.trim());
      setCancelConfirm(false);
      setCancelReason('');
      await Promise.all([refreshAll(), detail.refetch()]);
      toast.success(t('ยกเลิก QR แล้ว', 'QR cancelled'));
    } catch (error) {
      toast.error(t('ยกเลิกไม่สำเร็จ', 'Could not cancel'), errorMessage(error, locale));
    } finally {
      setActing(false);
    }
  };

  const regenerate = async () => {
    if (!detailId) return;
    setActing(true);
    try {
      await promptPayApi.regenerateSession(detailId);
      await Promise.all([refreshAll(), detail.refetch()]);
      toast.success(t('สร้าง QR ใหม่แล้ว', 'New QR generated'));
    } catch (error) {
      toast.error(t('สร้าง QR ไม่สำเร็จ', 'Could not regenerate'), errorMessage(error, locale));
    } finally {
      setActing(false);
    }
  };

  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    {
      value: 'history',
      label: t('ประวัติการชำระเงิน', 'Payment history'),
      count: meta?.total,
    },
  ];
  if (can('promptpay.accounts.read')) {
    tabs.push({
      value: 'accounts',
      label: t('บัญชีรับเงิน', 'Receiving accounts'),
      count: accountRows.length,
    });
  }

  return (
    <PageBody>
      <PageHeader
        title={t('พร้อมเพย์', 'PromptPay')}
        description={t(
          'สร้าง QR ตามมาตรฐาน Thai QR Payment และยืนยันเงินเข้าด้วยพนักงาน',
          'Thai QR Payment QR codes with staff-confirmed settlement.',
        )}
        actions={
          <>
            <Button
              variant="secondary"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void refreshAll()}
              loading={sessions.isFetching || accounts.isFetching}
            >
              {t('รีเฟรช', 'Refresh')}
            </Button>
            {can('promptpay.accounts.manage') && tab === 'accounts' ? (
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openNewAccount}>
                {t('เพิ่มบัญชี', 'Add account')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          {
            label: t('รับเงินสำเร็จ', 'Confirmed'),
            value: money(meta?.summary.paidSatang ?? 0),
            icon: BadgeCheck,
            hint: `${meta?.summary.paidCount ?? 0} ${t('รายการ', 'payments')}`,
          },
          {
            label: t('รอยืนยัน', 'Pending'),
            value: `${meta?.summary.pendingCount ?? 0}`,
            icon: Clock,
            hint: t('ต้องตรวจสอบก่อนปิดการขาย', 'Verify before completing the sale'),
          },
          {
            label: t('บัญชีเริ่มต้น', 'Default account'),
            value: defaultAccount?.displayName ?? t('ยังไม่ตั้งค่า', 'Not configured'),
            icon: Wallet,
            hint: defaultAccount
              ? `${identifierTypeLabel(defaultAccount.identifierType, locale)} · ${defaultAccount.maskedIdentifier}`
              : t('เพิ่มบัญชีเพื่อเริ่มรับเงิน', 'Add an account to receive money'),
          },
        ].map((item) => (
          <Card key={item.label} className="flex items-center gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-jade-soft text-jade">
              <item.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-faint">{item.label}</p>
              <p className="truncate text-[18px] font-semibold">{item.value}</p>
              <p className="truncate text-[10.5px] text-faint">{item.hint}</p>
            </div>
          </Card>
        ))}
      </div>

      {accountRows.length === 0 && can('promptpay.accounts.manage') ? (
        <div className="mb-4">
          <InlineAlert tone="warning">
            {t(
              'ยังไม่มีบัญชีพร้อมเพย์ ระบบจะไม่สามารถสร้าง QR รับเงินได้จนกว่าจะเพิ่มบัญชีที่ลงทะเบียนพร้อมเพย์แล้ว',
              'No PromptPay account yet. QR generation stays disabled until you add an account registered with PromptPay.',
            )}
          </InlineAlert>
        </div>
      ) : null}

      <Tabs value={tab} onChange={setTab} items={tabs} className="mb-3" />

      {tab === 'history' ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <div className="w-full max-w-[300px]">
              <SearchInput
                value={searchInput}
                onChange={setSearchInput}
                placeholder={t('ค้นหาเลขอ้างอิง / เลขบิล', 'Search reference / sale number')}
              />
            </div>
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as PromptPayStatus | '');
                setPage(1);
              }}
              className="h-9 w-[170px] text-[12px]"
            >
              <option value="">{t('ทุกสถานะ', 'All statuses')}</option>
              <option value="pending">{t('รอยืนยัน', 'Pending')}</option>
              <option value="paid">{t('ชำระแล้ว', 'Paid')}</option>
              <option value="expired">{t('หมดอายุ', 'Expired')}</option>
              <option value="cancelled">{t('ยกเลิก', 'Cancelled')}</option>
              <option value="refunded">{t('คืนเงินแล้ว', 'Refunded')}</option>
            </Select>
            <span className="ml-auto text-[11px] text-faint">
              {meta?.total ?? 0} {t('รายการ', 'records')}
            </span>
          </div>

          {sessions.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-11" />
              ))}
            </div>
          ) : (sessions.data?.data.length ?? 0) === 0 ? (
            <EmptyState
              icon={<QrCode className="h-5 w-5" />}
              title={t('ยังไม่มีรายการพร้อมเพย์', 'No PromptPay payments yet')}
              description={t(
                'เมื่อพนักงานสร้าง QR ที่หน้า POS รายการจะปรากฏที่นี่พร้อมสถานะและผู้ยืนยัน',
                'QR sessions created at the POS appear here with status and verifier.',
              )}
            />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <TH>{t('เวลา', 'Time')}</TH>
                    <TH>{t('เลขอ้างอิง', 'Reference')}</TH>
                    <TH className="text-right">{t('ยอด', 'Amount')}</TH>
                    <TH>{t('บัญชี', 'Account')}</TH>
                    <TH>{t('สถานะ', 'Status')}</TH>
                    <TH>{t('บิลขาย', 'Sale')}</TH>
                    <TH>{t('ผู้ยืนยัน', 'Verified by')}</TH>
                  </tr>
                </thead>
                <tbody>
                  {(sessions.data?.data ?? []).map((row) => (
                    <TR
                      key={row.id}
                      onClick={() => setDetailId(row.id)}
                      className="cursor-pointer"
                    >
                      <TD className="whitespace-nowrap text-[11.5px] text-muted">
                        {dateTime(row.createdAt)}
                      </TD>
                      <TD>
                        <span className="num text-[12px] font-medium">{row.reference}</span>
                      </TD>
                      <TD className="num text-right text-[12.5px] font-semibold">
                        {money(row.amountSatang)}
                      </TD>
                      <TD>
                        <div className="min-w-0">
                          <p className="truncate text-[12px]">{row.accountName}</p>
                          <p className="num text-[10.5px] text-faint">{row.maskedIdentifier}</p>
                        </div>
                      </TD>
                      <TD>
                        <PromptPayStatusBadge status={row.status} />
                      </TD>
                      <TD className="num text-[11.5px] text-muted">{row.saleNumber ?? '—'}</TD>
                      <TD className="text-[11.5px] text-muted">{row.verifierName ?? '—'}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
              <div className="flex items-center justify-between border-t border-line px-3 py-2">
                <span className="text-[11px] text-faint">
                  {meta?.page ?? 1} / {meta?.totalPages ?? 1}
                </span>
                <Pagination
                  page={page}
                  totalPages={meta?.totalPages ?? 1}
                  total={meta?.total ?? 0}
                  onPage={setPage}
                />
              </div>
            </>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
            <div>
              <p className="text-[12.5px] font-medium">
                {t('บัญชีพร้อมเพย์ที่ใช้รับเงิน', 'PromptPay receiving accounts')}
              </p>
              <p className="text-[10.5px] text-faint">
                {t(
                  'เก็บหมายเลขแบบเข้ารหัสและแสดงเฉพาะเลขที่ปิดบัง',
                  'Identifiers are encrypted at rest and only shown masked.',
                )}
              </p>
            </div>
            <label className="flex items-center gap-2 text-[11.5px] text-muted">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => setIncludeInactive(event.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--jade)]"
              />
              {t('รวมบัญชีที่ปิดใช้งาน', 'Include inactive')}
            </label>
          </div>

          {accounts.isLoading ? (
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          ) : accountRows.length === 0 ? (
            <EmptyState
              icon={<QrCode className="h-5 w-5" />}
              title={t('ยังไม่มีบัญชีพร้อมเพย์', 'No PromptPay account')}
              description={t(
                'เพิ่มเบอร์โทรศัพท์หรือเลขประจำตัวประชาชนที่ลงทะเบียนพร้อมเพย์แล้ว เพื่อสร้าง QR รับเงิน',
                'Add a mobile number or national ID registered with PromptPay to generate receiving QR codes.',
              )}
              action={
                can('promptpay.accounts.manage') ? (
                  <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openNewAccount}>
                    {t('เพิ่มบัญชีแรก', 'Add first account')}
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {accountRows.map((account) => (
                <div
                  key={account.id}
                  className={cn(
                    'rounded-xl border bg-surface p-4',
                    account.isDefault ? 'border-jade-border' : 'border-line',
                    !account.isActive && 'opacity-65',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-[13.5px] font-semibold">{account.displayName}</p>
                        {account.isDefault ? (
                          <Badge tone="jade" dot>
                            {t('ค่าเริ่มต้น', 'Default')}
                          </Badge>
                        ) : null}
                        {!account.isActive ? (
                          <Badge tone="neutral">{t('ปิดใช้งาน', 'Inactive')}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] text-muted">
                        {identifierTypeLabel(account.identifierType, locale)}
                      </p>
                      <p className="num mt-0.5 text-[14px] font-medium tracking-wide">
                        {account.maskedIdentifier}
                      </p>
                    </div>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-jade-soft text-jade">
                      <QrCode className="h-4 w-4" />
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<QrCode className="h-3.5 w-3.5" />}
                      onClick={() => setStaticAccount(account)}
                    >
                      {t('QR ไม่ระบุยอด', 'No-amount QR')}
                    </Button>
                    {can('promptpay.accounts.manage') ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          leftIcon={<Pencil className="h-3.5 w-3.5" />}
                          onClick={() => openEditAccount(account)}
                        >
                          {t('แก้ไข', 'Edit')}
                        </Button>
                        {account.isActive && !account.isDefault ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Star className="h-3.5 w-3.5" />}
                            onClick={() => void makeDefault(account)}
                          >
                            {t('ตั้งเป็นค่าเริ่มต้น', 'Set default')}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                          onClick={() => setDeleteTarget(account)}
                        >
                          {t('ลบ', 'Delete')}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-line p-4">
            <div className="flex items-start gap-2.5 rounded-lg bg-info-soft/50 p-3 text-[11px] text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <p>
                {t(
                  'การตรวจ Checksum ยืนยันเพียงว่าเลขมีรูปแบบถูกต้อง ไม่ได้ยืนยันว่าบัญชีนี้ลงทะเบียนพร้อมเพย์หรือเป็นของร้านคุณ กรุณาตรวจสอบกับแอปธนาคารก่อนใช้รับเงินจริง',
                  'A checksum only proves the number is well-formed. It does not prove the account is registered with PromptPay or owned by your shop. Verify it in your banking app before receiving real money.',
                )}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Add / edit account */}
      <Modal
        open={accountModal !== null}
        onClose={() => setAccountModal(null)}
        title={
          accountModal === 'new'
            ? t('เพิ่มบัญชีพร้อมเพย์', 'Add PromptPay account')
            : t('แก้ไขบัญชีพร้อมเพย์', 'Edit PromptPay account')
        }
        description={t(
          'ใช้หมายเลขที่ลงทะเบียนพร้อมเพย์ไว้แล้วเท่านั้น',
          'Use a number already registered with PromptPay.',
        )}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAccountModal(null)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button variant="primary" loading={savingAccount} onClick={() => void saveAccount()}>
              {t('บันทึก', 'Save')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-text">
              {t('ประเภทหมายเลข', 'Identifier type')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['mobile', 'national_id'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setAccountForm((prev) => ({ ...prev, identifierType: type }))}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors',
                    accountForm.identifierType === type
                      ? 'border-jade bg-jade-soft text-jade'
                      : 'border-line bg-surface text-muted hover:border-line-strong',
                  )}
                >
                  {identifierTypeLabel(type, locale)}
                </button>
              ))}
            </div>
          </div>

          <Field
            label={t('หมายเลขพร้อมเพย์', 'PromptPay identifier')}
            hint={
              accountModal !== 'new'
                ? t('เว้นว่างไว้หากไม่ต้องการเปลี่ยนหมายเลข', 'Leave blank to keep the current number.')
                : accountForm.identifierType === 'mobile'
                  ? t('เช่น 0812345678 หรือ +66812345678', 'e.g. 0812345678 or +66812345678')
                  : t('เลขประจำตัวประชาชน 13 หลัก', '13-digit national ID')
            }
            required={accountModal === 'new'}
          >
            <Input
              value={accountForm.identifier}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, identifier: event.target.value }))
              }
              placeholder={accountForm.identifierType === 'mobile' ? '0812345678' : '1-1001-12345-67-8'}
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>

          <Field label={t('ชื่อบัญชีที่แสดงใน POS', 'Display name')} required>
            <Input
              value={accountForm.displayName}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, displayName: event.target.value }))
              }
              placeholder={t('เช่น บัญชีหน้าร้าน', 'e.g. Front counter')}
              maxLength={80}
            />
          </Field>

          <label className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <span>
              <span className="block text-[12px] font-medium">{t('บัญชีเริ่มต้น', 'Default account')}</span>
              <span className="block text-[10.5px] text-faint">
                {t('ใช้สร้าง QR อัตโนมัติที่หน้า POS', 'Used automatically at the POS.')}
              </span>
            </span>
            <Switch
              checked={accountForm.isDefault}
              onChange={(value) => setAccountForm((prev) => ({ ...prev, isDefault: value }))}
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <span>
              <span className="block text-[12px] font-medium">{t('เปิดใช้งาน', 'Active')}</span>
              <span className="block text-[10.5px] text-faint">
                {t('ปิดเพื่อซ่อนจากหน้า POS โดยไม่ลบประวัติ', 'Hide from POS without deleting history.')}
              </span>
            </span>
            <Switch
              checked={accountForm.isActive}
              onChange={(value) => setAccountForm((prev) => ({ ...prev, isActive: value }))}
            />
          </label>

          <InlineAlert tone="info">
            {t(
              'หมายเลขจะถูกเข้ารหัสก่อนบันทึก และแสดงเฉพาะแบบปิดบังเท่านั้น',
              'The identifier is encrypted before storage and only ever shown masked.',
            )}
          </InlineAlert>
        </div>
      </Modal>

      {/* Delete account */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('ลบบัญชีพร้อมเพย์', 'Delete PromptPay account')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              {t('ยกเลิก', 'Cancel')}
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void removeAccount()}>
              {t('ลบบัญชี', 'Delete account')}
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted">
          {t('ต้องการลบบัญชี', 'Remove')}{' '}
          <span className="font-medium text-text">{deleteTarget?.displayName}</span>{' '}
          {t(
            'หรือไม่? ประวัติการชำระเงินเดิมจะยังอยู่ แต่จะใช้บัญชีนี้สร้าง QR ไม่ได้อีก',
            '? Past payments remain, but this account can no longer create QR codes.',
          )}
        </p>
      </Modal>

      {/* Static, no-amount QR */}
      <Modal
        open={Boolean(staticAccount)}
        onClose={() => setStaticAccount(null)}
        title={t('QR รับเงินไม่ระบุยอด', 'No-amount receiving QR')}
        description={staticAccount ? `${staticAccount.displayName} · ${staticAccount.maskedIdentifier}` : undefined}
        size="sm"
        footer={
          <Button variant="ghost" onClick={() => setStaticAccount(null)}>
            {t('ปิด', 'Close')}
          </Button>
        }
      >
        {staticQr.isLoading || !staticQr.data ? (
          <Skeleton className="mx-auto h-[280px] w-[280px]" />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col items-center rounded-xl border border-line bg-white p-3">
              <img
                src={staticQr.data.data.pngDataUrl}
                alt={t('QR พร้อมเพย์ไม่ระบุยอด', 'No-amount PromptPay QR')}
                className="h-[280px] w-[280px]"
              />
            </div>
            <InlineAlert tone="warning">
              {t(
                'QR นี้ใช้ซ้ำได้และไม่ผูกกับยอดขาย ผู้จ่ายต้องกรอกยอดเอง การสแกนหรือสร้าง QR ไม่ถือว่าชำระเงินแล้ว',
                'This reusable QR is not tied to a sale. The payer enters the amount. Generating or scanning it is not proof of payment.',
              )}
            </InlineAlert>
            <div className="flex flex-wrap items-center gap-1.5">
              <a
                href={staticQr.data.data.pngDataUrl}
                download={`promptpay-static-${staticAccount?.id.slice(0, 8)}.png`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-3 text-[13px] font-medium text-muted hover:bg-surface-3 hover:text-text"
              >
                <Download className="h-3.5 w-3.5" />
                PNG
              </a>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Download className="h-3.5 w-3.5" />}
                onClick={() => {
                  if (!staticQr.data?.data.svg) return;
                  const blob = new Blob([staticQr.data.data.svg], { type: 'image/svg+xml' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'promptpay-static.svg';
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                SVG
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Printer className="h-3.5 w-3.5" />}
                onClick={() => {
                  if (!staticQr.data || !staticAccount) return;
                  printStaticQr({
                    pngDataUrl: staticQr.data.data.pngDataUrl,
                    displayName: staticAccount.displayName,
                    maskedIdentifier: staticAccount.maskedIdentifier,
                  });
                }}
              >
                {t('พิมพ์', 'Print')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Session detail */}
      <Modal
        open={Boolean(detailId)}
        onClose={() => {
          setDetailId(null);
          setCancelConfirm(false);
        }}
        title={t('รายละเอียดการชำระพร้อมเพย์', 'PromptPay payment detail')}
        description={detail.data?.data.reference}
        size="md"
        footer={
          detail.data?.data.status === 'pending' ? (
            <>
              <Button
                variant="ghost"
                className="text-danger"
                onClick={() => setCancelConfirm(true)}
              >
                {t('ยกเลิก QR', 'Cancel QR')}
              </Button>
              <Button variant="secondary" loading={acting} onClick={() => void regenerate()}>
                {t('สร้าง QR ใหม่', 'New QR')}
              </Button>
              <Button variant="ghost" onClick={() => setDetailId(null)}>
                {t('ปิด', 'Close')}
              </Button>
            </>
          ) : detail.data?.data.status === 'expired' ? (
            <>
              <Button variant="ghost" onClick={() => setDetailId(null)}>
                {t('ปิด', 'Close')}
              </Button>
              <Button variant="primary" loading={acting} onClick={() => void regenerate()}>
                {t('สร้าง QR ใหม่', 'New QR')}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setDetailId(null)}>
              {t('ปิด', 'Close')}
            </Button>
          )
        }
      >
        {detail.isLoading || !detail.data ? (
          <div className="space-y-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <SessionDetail
            session={detail.data.data}
            cancelConfirm={cancelConfirm}
            cancelReason={cancelReason}
            acting={acting}
            onCancelReason={setCancelReason}
            onCancelConfirm={() => void cancelSession()}
            onDismissCancel={() => setCancelConfirm(false)}
          />
        )}
      </Modal>
    </PageBody>
  );
}

function printStaticQr(input: {
  pngDataUrl: string;
  displayName: string;
  maskedIdentifier: string;
}): void {
  const escape = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>PromptPay QR</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font-family: 'IBM Plex Sans Thai','Noto Sans Thai','Segoe UI',sans-serif; text-align:center; margin:0; color:#000; }
    h1 { font-size:14px; margin:0 0 2px; }
    .muted { font-size:10px; color:#444; }
    img { width:62mm; height:62mm; display:block; margin:6px auto; }
    .note { font-size:9px; color:#444; margin-top:6px; }
  </style></head><body>
    <h1>${escape(input.displayName)}</h1>
    <div class="muted">${escape(input.maskedIdentifier)}</div>
    <img src="${input.pngDataUrl}" alt="PromptPay QR" />
    <div class="note">สแกนด้วยแอปธนาคาร แล้วกรอกยอดเงิน<br/>QR นี้ใช้ซ้ำได้ • ไม่ใช่หลักฐานการชำระเงิน</div>
  </body></html>`;
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(() => iframe.remove(), 800);
  }, 200);
}

function SessionDetail({
  session,
  cancelConfirm,
  cancelReason,
  acting,
  onCancelReason,
  onCancelConfirm,
  onDismissCancel,
}: {
  session: PromptPaySession;
  cancelConfirm: boolean;
  cancelReason: string;
  acting: boolean;
  onCancelReason: (value: string) => void;
  onCancelConfirm: () => void;
  onDismissCancel: () => void;
}) {
  const { t } = useLang();
  const { money, dateTime } = useFormat();

  const note =
    typeof session.verification?.metadata.note === 'string'
      ? session.verification.metadata.note
      : '';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-faint">{t('ยอดชำระ', 'Amount')}</p>
          <p className="num text-[24px] font-semibold">{money(session.amountSatang)}</p>
        </div>
        <PromptPayStatusBadge status={session.status} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {[
          [t('เลขอ้างอิง', 'Reference'), session.reference],
          [
            t('บัญชี', 'Account'),
            `${session.account.displayName} · ${session.account.maskedIdentifier}`,
          ],
          [t('สร้างเมื่อ', 'Created'), dateTime(session.createdAt)],
          [t('หมดอายุ', 'Expires'), dateTime(session.expiresAt)],
          [t('ชำระเมื่อ', 'Paid at'), session.paidAt ? dateTime(session.paidAt) : '—'],
          [t('ผู้ยืนยัน', 'Verified by'), session.verifiedBy?.name ?? '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-faint">{label}</p>
            <p className="mt-0.5 text-[12px]">{value}</p>
          </div>
        ))}
      </div>

      {session.qr ? (
        <div className="flex flex-col items-center rounded-lg border border-line bg-white p-3">
          <img
            src={session.qr.pngDataUrl}
            alt={t('QR พร้อมเพย์', 'PromptPay QR')}
            className="h-[220px] w-[220px]"
          />
          <p className="mt-2 text-[10.5px] text-muted">
            {t('QR นี้ยังรอยืนยันเงินเข้า', 'This QR is still awaiting confirmation.')}
          </p>
        </div>
      ) : null}

      {session.verification ? (
        <div className="rounded-lg border border-jade-border bg-jade-soft/40 p-3">
          <div className="flex items-center gap-2 text-[12px] font-medium text-jade">
            <CircleCheck className="h-4 w-4" />
            {t('ยืนยันโดยพนักงาน', 'Verified by staff')}
          </div>
          <div className="mt-2 grid gap-1 text-[11.5px] text-muted">
            <p>
              {t('วิธี', 'Method')}: {session.verification.verificationMethod} ·{' '}
              {session.verification.provider}
            </p>
            {session.verification.reference ? (
              <p>
                {t('เลขอ้างอิงสลิป', 'Slip reference')}: {session.verification.reference}
              </p>
            ) : null}
            {note ? <p>{t('หมายเหตุ', 'Note')}: {note}</p> : null}
            <p>
              {t('เวลา', 'Time')}: {dateTime(session.verification.verifiedAt)}
            </p>
          </div>
        </div>
      ) : null}

      {session.sale ? (
        <Link
          to={`/sales/${session.sale.id}`}
          className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[12px] text-text hover:bg-surface-2"
        >
          <span>
            {t('เชื่อมกับบิลขาย', 'Linked sale')} <span className="num">{session.sale.number}</span>
          </span>
          <ExternalLink className="h-3.5 w-3.5 text-faint" />
        </Link>
      ) : null}

      {cancelConfirm ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
          <p className="text-[12px] font-medium text-danger">
            {t('ยืนยันการยกเลิก QR นี้?', 'Cancel this QR?')}
          </p>
          <p className="mt-0.5 text-[10.5px] text-muted">
            {t(
              'หากลูกค้าชำระเงินแล้ว ห้ามยกเลิก ให้ตรวจสอบและยืนยันรับเงินแทน',
              'If the customer already paid, do not cancel — verify the payment instead.',
            )}
          </p>
          <Textarea
            value={cancelReason}
            onChange={(event) => onCancelReason(event.target.value)}
            placeholder={t('เหตุผล (ไม่บังคับ)', 'Reason (optional)')}
            className="mt-2 min-h-[60px] text-[12px]"
            maxLength={300}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onDismissCancel}>
              {t('ไม่ยกเลิก', 'Keep')}
            </Button>
            <Button size="sm" variant="danger" loading={acting} onClick={onCancelConfirm}>
              {t('ยืนยันยกเลิก', 'Cancel QR')}
            </Button>
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-1.5 text-[11px] font-medium">{t('ไทม์ไลน์', 'Timeline')}</p>
        <div className="space-y-1.5">
          {session.audit.map((entry) => {
            const label = AUDIT_LABELS[entry.action];
            return (
              <div
                key={entry.id}
                className="flex items-start gap-2 rounded-md border border-line px-2.5 py-1.5"
              >
                <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-jade" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px]">
                    {label ? t(label.th, label.en) : entry.action}
                    {entry.actorName ? (
                      <span className="text-faint"> · {entry.actorName}</span>
                    ) : null}
                  </p>
                  <p className="text-[10px] text-faint">{dateTime(entry.createdAt)}</p>
                </div>
              </div>
            );
          })}
          {session.audit.length === 0 ? (
            <p className="text-[11px] text-faint">{t('ยังไม่มีเหตุการณ์', 'No events yet')}</p>
          ) : null}
        </div>
      </div>

      {session.status === 'paid' ? (
        <div className="flex items-center gap-2 rounded-lg bg-jade-soft/40 px-3 py-2 text-[11.5px] text-jade">
          <CircleCheck className="h-4 w-4" />
          {t('ยืนยันรับเงินครบแล้ว', 'Payment fully verified')}
        </div>
      ) : null}
      {session.status === 'cancelled' || session.status === 'expired' ? (
        <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[11.5px] text-muted">
          <CircleX className="h-4 w-4" />
          {t('QR นี้ใช้รับเงินไม่ได้แล้ว', 'This QR can no longer receive money.')}
        </div>
      ) : null}
    </div>
  );
}
