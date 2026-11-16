import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Printer,
  QrCode,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useLang } from '../lib/i18n';
import {
  identifierTypeLabel,
  promptPayApi,
  type PromptPayAccount,
  type PromptPaySession,
  type PromptPaySessionCreateBody,
} from '../lib/promptpay';
import { feedback } from '../lib/feedback';
import {
  Badge,
  Button,
  Field,
  InlineAlert,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from './ui';

interface PromptPayPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirmed: (session: PromptPaySession) => void;
  onOpenSettings: () => void;
  operationId: string;
  amountSatang: number;
  cart: Pick<
    PromptPaySessionCreateBody,
    'items' | 'orderDiscount' | 'couponCode' | 'customerId' | 'redeemPoints'
  >;
}

export function PromptPayPaymentDialog({
  open,
  onClose,
  onConfirmed,
  onOpenSettings,
  operationId,
  amountSatang,
  cart,
}: PromptPayPaymentDialogProps) {
  const { t, locale } = useLang();
  const { money, dateTime } = useFormat();
  const { can } = useAuth();
  const toast = useToast();

  const [accounts, setAccounts] = useState<PromptPayAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [session, setSession] = useState<PromptPaySession | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [slipReference, setSlipReference] = useState('');
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const [overrideExpired, setOverrideExpired] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const autoStarted = useRef(false);
  const autoHandled = useRef<string | null>(null);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  useEffect(() => {
    if (!open) {
      autoStarted.current = false;
      return;
    }
    autoStarted.current = false;
    setAccounts(null);
    setAccountsError(null);
    setSession(null);
    setError(null);
    setConfirmStep(false);
    setSlipReference('');
    setNote('');
    setChecked(false);
    setOverrideExpired(false);
    setAccountId('');
    setNow(Date.now());

    let active = true;
    promptPayApi
      .listAccounts(false)
      .then((result) => {
        if (!active) return;
        const list = result.data;
        setAccounts(list);
        setAccountId(list.find((account) => account.isDefault)?.id ?? list[0]?.id ?? '');
      })
      .catch((cause) => {
        if (!active) return;
        setAccounts([]);
        setAccountsError(errorMessage(cause, locale));
      });
    return () => {
      active = false;
    };
  }, [open, locale]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  const createSession = async (selectedAccountId?: string) => {
    if (!operationId) return;
    setCreating(true);
    setError(null);
    try {
      const result = await promptPayApi.createSession({
        ...cart,
        operationId,
        amountSatang,
        accountId: selectedAccountId || accountId || undefined,
      });
      setSession(result.data);
      setNow(Date.now());
      feedback('scan');
    } catch (cause) {
      const message =
        cause instanceof ApiError && cause.code === 'DOMAIN_PROMPTPAY_NOT_CONFIGURED'
          ? t(
              'ยังไม่มีบัญชีพร้อมเพย์ที่เปิดใช้งาน',
              'No active PromptPay account is configured.',
            )
          : errorMessage(cause, locale);
      setError(message);
      feedback('error');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!open || autoStarted.current) return;
    if (accounts === null || accounts.length === 0) return;
    autoStarted.current = true;
    void createSession(accounts.find((account) => account.isDefault)?.id ?? accounts[0]!.id);
    // createSession intentionally reads current state; auto-create runs once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accounts]);

  const regenerate = async () => {
    if (!session) return;
    setCreating(true);
    setError(null);
    try {
      const result = await promptPayApi.regenerateSession(session.id);
      setSession(result.data);
      setNow(Date.now());
      setConfirmStep(false);
      setChecked(false);
      setOverrideExpired(false);
      feedback('scan');
    } catch (cause) {
      setError(errorMessage(cause, locale));
      feedback('error');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!open || !session || session.status !== 'pending') return;
    if (session.verificationMode?.mode !== 'automatic' || !session.verificationMode.autoConfirm) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const result = await promptPayApi.getSession(session.id);
        if (cancelled) return;
        if (result.data.status === 'paid') {
          setSession(result.data);
          if (autoHandled.current !== result.data.id) {
            autoHandled.current = result.data.id;
            onConfirmedRef.current(result.data);
            feedback('success');
            toast.success(
              t('ระบบตรวจพบเงินเข้าแล้ว', 'Payment detected automatically'),
              result.data.reference,
            );
          }
        } else if (result.data.status !== session.status) {
          setSession(result.data);
        }
      } catch {
        // A transient network error should not stop the polling loop.
      }
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, session, t, toast]);

  const expiresIn = session
    ? Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - now) / 1000))
    : 0;
  const expired = Boolean(session && session.status === 'pending' && expiresIn <= 0);
  const status = session?.status ?? 'pending';
  const paid = status === 'paid';
  const terminal = ['cancelled', 'expired', 'refunded', 'failed'].includes(status);

  const confirm = async () => {
    if (!session || !checked) return;
    if ((expired || status === 'expired') && !overrideExpired) {
      setError(t('QR หมดอายุแล้ว กรุณาสร้าง QR ใหม่', 'This QR expired. Generate a new one.'));
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      const result = await promptPayApi.confirmSession(session.id, {
        receivedAmountSatang: session.amountSatang,
        reference: slipReference.trim(),
        note: note.trim(),
        overrideExpired: overrideExpired || undefined,
      });
      setSession(result.data);
      setConfirmStep(false);
      setChecked(false);
      setSlipReference('');
      setNote('');
      onConfirmed(result.data);
      feedback('success');
      toast.success(
        result.meta?.alreadyVerified
          ? t('รายการนี้ยืนยันไว้แล้ว', 'This payment was already verified')
          : t('ยืนยันรับเงินแล้ว', 'Payment confirmed'),
        session.reference,
      );
    } catch (cause) {
      feedback('error');
      setError(errorMessage(cause, locale));
    } finally {
      setConfirming(false);
    }
  };

  const cancel = async () => {
    if (!session || session.status !== 'pending') {
      onClose();
      return;
    }
    setCancelling(true);
    try {
      await promptPayApi.cancelSession(session.id, 'Cancelled from POS');
      toast.info(t('ยกเลิก QR แล้ว', 'QR cancelled'), session.reference);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, locale));
    } finally {
      setCancelling(false);
    }
  };

  const copyPayload = async () => {
    if (!session?.qr?.payload) return;
    try {
      await navigator.clipboard.writeText(session.qr.payload);
      toast.success(t('คัดลอก Payload แล้ว', 'Payload copied'));
    } catch {
      toast.error(t('คัดลอกไม่ได้', 'Could not copy'));
    }
  };

  const downloadSvg = () => {
    if (!session?.qr?.svg) return;
    const blob = new Blob([session.qr.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `promptpay-${session.reference}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const print = () => {
    if (!session?.qr) return;
    printPromptPayQr(session, {
      businessName: t('ใบรับชำระพร้อมเพย์', 'PromptPay payment'),
    });
  };

  const canVerify = can('payments.confirm');
  const canManageProvider = can('promptpay.providers.manage');
  const showConfirm = confirmStep && !paid && !terminal;

  const accountOptions = useMemo(
    () => accounts?.filter((account) => account.isActive) ?? [],
    [accounts],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('รับชำระด้วยพร้อมเพย์', 'PromptPay payment')}
      description={
        session
          ? `${session.reference} · ${session.account.displayName}`
          : t('สร้าง QR ตามยอดขายนี้', 'Generate a QR for this sale')
      }
      size="md"
      footer={
        paid ? (
          <Button variant="primary" onClick={onClose}>
            {t('เสร็จสิ้น', 'Done')}
          </Button>
        ) : showConfirm ? (
          <>
            <Button variant="ghost" onClick={() => setConfirmStep(false)} disabled={confirming}>
              {t('ย้อนกลับ', 'Back')}
            </Button>
            <Button
              variant="primary"
              loading={confirming}
              disabled={!checked}
              onClick={() => void confirm()}
            >
              {t('ยืนยันว่าได้รับเงินแล้ว', 'Confirm money received')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => void cancel()}
              loading={cancelling}
            >
              {t('ยกเลิก QR', 'Cancel QR')}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('ปิด', 'Close')}
            </Button>
            {terminal ? (
              <Button
                variant="secondary"
                loading={creating}
                leftIcon={<RefreshCw className="h-4 w-4" />}
                onClick={() => void regenerate()}
              >
                {t('สร้าง QR ใหม่', 'New QR')}
              </Button>
            ) : null}
            {!terminal && !paid ? (
              <Button
                variant={session?.verificationMode?.mode === 'automatic' ? 'secondary' : 'primary'}
                disabled={!canVerify || expired}
                onClick={() => setConfirmStep(true)}
              >
                {session?.verificationMode?.mode === 'automatic'
                  ? t('ยืนยันด้วยพนักงาน', 'Confirm manually')
                  : t('ยืนยันรับชำระเงิน', 'Verify payment')}
              </Button>
            ) : null}
          </>
        )
      }
    >
      {accountsError ? (
        <InlineAlert tone="danger">{accountsError}</InlineAlert>
      ) : accounts === null ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-[300px]" />
        </div>
      ) : accountOptions.length === 0 ? (
        <div className="py-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-soft text-amber">
            <QrCode className="h-6 w-6" />
          </span>
          <p className="mt-3 text-[14px] font-semibold">
            {t('ยังไม่ได้ตั้งค่าบัญชีพร้อมเพย์', 'PromptPay is not configured')}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] text-muted">
            {t(
              'เพิ่มเบอร์โทรศัพท์หรือเลขประจำตัวประชาชนที่ลงทะเบียนพร้อมเพย์ก่อนสร้าง QR รับเงิน',
              'Add a mobile number or national ID registered with PromptPay before generating a receiving QR.',
            )}
          </p>
          {can('promptpay.accounts.manage') ? (
            <Button variant="primary" className="mt-4" onClick={onOpenSettings}>
              {t('ไปตั้งค่าบัญชี', 'Open PromptPay settings')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

          <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-4 py-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-faint">
                {t('ยอดที่ต้องชำระ', 'Amount due')}
              </p>
              <p className="num text-[26px] font-semibold">{money(session?.amountSatang ?? amountSatang)}</p>
            </div>
            {session ? <PromptPayStatus session={session} expired={expired} /> : null}
          </div>

          {session?.status === 'pending' ? (
            session.verificationMode?.mode === 'automatic' &&
            session.verificationMode.autoConfirm ? (
              <div className="flex items-start gap-2 rounded-lg border border-info/20 bg-info-soft/60 px-3 py-2 text-[11px] text-info">
                <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                <span>
                  {t('ระบบกำลังตรวจเงินเข้าอัตโนมัติผ่าน', 'Waiting for automatic confirmation via')}{' '}
                  <span className="font-medium">
                    {session.verificationMode.displayName ?? t('ผู้ให้บริการ', 'provider')}
                  </span>
                  {' · '}
                  {t('อัปเดตทุก 4 วินาที', 'checks every 4 seconds')}
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[10.5px] text-muted">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <span>
                    {session.verificationMode?.configured
                      ? t(
                          'มีผู้ให้บริการเชื่อมต่ออยู่ แต่ยังไม่ได้เปิด “ยืนยันอัตโนมัติ” จึงใช้การยืนยันโดยพนักงาน',
                          'A provider is connected but auto-confirm is off, so staff confirmation is used.',
                        )
                      : t(
                          'โหมดยืนยันด้วยพนักงาน: ยังไม่ได้เชื่อมผู้ให้บริการสำหรับตรวจเงินเข้าอัตโนมัติ',
                          'Manual mode: no automatic settlement provider is connected.',
                        )}
                  </span>
                  {session.verificationMode?.configured && canManageProvider ? (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="ml-1 font-medium text-jade underline decoration-jade/40 underline-offset-2"
                    >
                      {t('เปิดตั้งค่า', 'Open settings')}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          ) : null}

          {!session ? (
            <div className="py-8 text-center">
              {creating ? (
                <>
                  <Skeleton className="mx-auto h-[280px] w-[280px]" />
                  <p className="mt-3 text-[12px] text-muted">
                    {t('กำลังสร้าง QR…', 'Generating QR…')}
                  </p>
                </>
              ) : (
                <>
                  <QrCode className="mx-auto h-10 w-10 text-faint" />
                  <p className="mt-2 text-[12.5px] text-muted">
                    {t('สร้าง QR สำหรับยอดนี้', 'Generate a QR for this amount')}
                  </p>
                  <Button
                    variant="primary"
                    className="mt-3"
                    loading={creating}
                    onClick={() => void createSession()}
                  >
                    {t('สร้าง QR พร้อมเพย์', 'Generate PromptPay QR')}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              {session.qr ? (
                <div className="flex flex-col items-center rounded-xl border border-line bg-white p-3">
                  <img
                    src={session.qr.pngDataUrl}
                    alt={t('QR พร้อมเพย์', 'PromptPay QR')}
                    className="h-[280px] w-[280px]"
                  />
                  <p className="mt-2 text-center text-[10.5px] text-neutral-500">
                    {t(
                      'ให้ลูกค้าสแกนด้วยแอปธนาคาร แล้วตรวจสอบยอดเงินเข้าด้วยตัวเอง',
                      'Ask the customer to scan with a banking app, then check the incoming amount yourself.',
                    )}
                  </p>
                </div>
              ) : paid ? (
                <div className="rounded-xl border border-jade-border bg-jade-soft/40 px-4 py-8 text-center">
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-jade text-white">
                    <Check className="h-7 w-7" />
                  </span>
                  <p className="mt-3 text-[15px] font-semibold text-jade">
                    {t('ได้รับเงินเรียบร้อยแล้ว', 'Payment received')}
                  </p>
                  <p className="num mt-1 text-[22px] font-semibold">
                    {money(session.amountSatang)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    {t('กดปิด แล้วยืนยันการชำระเงินเพื่อปิดบิล', 'Close, then confirm checkout to finish the sale.')}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-line bg-surface-2 p-8 text-center">
                  <QrCode className="mx-auto h-9 w-9 text-faint" />
                  <p className="mt-2 text-[12px] text-muted">
                    {t('QR นี้ไม่พร้อมใช้งาน', 'This QR is no longer available')}
                  </p>
                </div>
              )}

              <div className="grid gap-2 text-[11.5px] sm:grid-cols-2">
                <div className="rounded-lg border border-line px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-faint">{t('เลขอ้างอิง', 'Reference')}</p>
                  <p className="num mt-0.5 font-medium">{session.reference}</p>
                </div>
                <div className="rounded-lg border border-line px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-faint">{t('บัญชีรับเงิน', 'Receiving account')}</p>
                  <p className="mt-0.5 truncate">
                    {session.account.displayName} · {session.account.maskedIdentifier}
                  </p>
                </div>
                <div className="rounded-lg border border-line px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-faint">{t('ประเภท', 'Type')}</p>
                  <p className="mt-0.5">
                    {identifierTypeLabel(session.account.identifierType, locale)}
                  </p>
                </div>
                <div className="rounded-lg border border-line px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-faint">{t('หมดอายุ', 'Expires')}</p>
                  <p className="mt-0.5">
                    {expired || terminal
                      ? t('หมดอายุแล้ว', 'Expired')
                      : `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, '0')} · ${dateTime(session.expiresAt)}`}
                  </p>
                </div>
              </div>

              {accountOptions.length > 1 ? (
                <Field label={t('บัญชีรับเงิน', 'Receiving account')}>
                  <Select
                    value={accountId}
                    onChange={(event) => setAccountId(event.target.value)}
                    disabled={Boolean(session)}
                    className="h-9 text-[12px]"
                  >
                    {accountOptions.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.displayName} · {account.maskedIdentifier}
                        {account.isDefault ? ` (${t('ค่าเริ่มต้น', 'default')})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              {terminal ? (
                <InlineAlert tone={status === 'cancelled' ? 'warning' : 'danger'}>
                  {status === 'cancelled'
                    ? t('QR นี้ถูกยกเลิกแล้ว', 'This QR was cancelled.')
                    : t('QR นี้หมดอายุแล้ว กรุณาสร้างใหม่', 'This QR expired. Generate a new one.')}
                </InlineAlert>
              ) : null}

              {expired && status === 'pending' ? (
                <InlineAlert tone="warning">
                  {t(
                    'QR หมดอายุแล้ว หากลูกค้าชำระเงินไปแล้ว ให้ตรวจสอบยอดและยืนยันแบบเกินเวลา หรือสร้าง QR ใหม่',
                    'The QR expired. If the customer already paid, verify it with an expiry override, or generate a new QR.',
                  )}
                </InlineAlert>
              ) : null}

              {showConfirm ? (
                <div className="rounded-xl border border-jade-border bg-jade-soft/30 p-3">
                  <p className="text-[12.5px] font-semibold">
                    {t('ยืนยันการรับเงิน', 'Confirm receipt')}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    {t(
                      'ทำขั้นตอนนี้เฉพาะเมื่อเห็นเงินเข้าบัญชีจริงแล้วเท่านั้น',
                      'Only do this after you can see the money in the account.',
                    )}
                  </p>
                  <div className="mt-2 space-y-2">
                    <Field
                      label={t('เลขอ้างอิงสลิป / ธุรกรรม (ไม่บังคับ)', 'Slip / transaction reference (optional)')}
                    >
                      <Input
                        value={slipReference}
                        onChange={(event) => setSlipReference(event.target.value)}
                        placeholder={t('เช่น เลขที่สลิป', 'e.g. slip reference')}
                        maxLength={120}
                        className="h-9 text-[12px]"
                      />
                    </Field>
                    <Field label={t('หมายเหตุ (ไม่บังคับ)', 'Note (optional)')}>
                      <Textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder={t('เช่น ตรวจสอบ statement แล้ว', 'e.g. checked bank statement')}
                        maxLength={500}
                        className="min-h-[56px] text-[12px]"
                      />
                    </Field>
                    {expired || status === 'expired' ? (
                      <label className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber-soft/50 px-2.5 py-2 text-[11px] text-amber">
                        <input
                          type="checkbox"
                          checked={overrideExpired}
                          onChange={(event) => setOverrideExpired(event.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 accent-[var(--amber)]"
                        />
                        {t(
                          'ยืนยันแม้ QR หมดอายุ เพราะตรวจสอบเงินเข้าแล้ว',
                          'Override expiry because I verified the incoming payment.',
                        )}
                      </label>
                    ) : null}
                    <label className="flex items-start gap-2 text-[11.5px]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setChecked(event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[var(--jade)]"
                      />
                      {t(
                        `ฉันตรวจสอบแล้วว่าได้รับเงิน ${money(session.amountSatang)} เข้าบัญชี`,
                        `I verified that ${money(session.amountSatang)} arrived in the account.`,
                      )}
                    </label>
                  </div>
                </div>
              ) : null}

              {paid ? (
                <div className="flex items-center gap-2 rounded-lg border border-jade-border bg-jade-soft/50 px-3 py-2.5 text-[12px] text-jade">
                  <Check className="h-4 w-4" />
                  {t('ยืนยันรับเงินเรียบร้อยแล้ว', 'Payment verified')}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Printer className="h-3.5 w-3.5" />}
                  onClick={print}
                >
                  {t('พิมพ์ QR', 'Print QR')}
                </Button>
                {session.qr ? (
                  <a
                    href={session.qr.pngDataUrl}
                    download={`promptpay-${session.reference}.png`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-3 text-[13px] font-medium text-muted hover:bg-surface-3 hover:text-text"
                  >
                    <Download className="h-3.5 w-3.5" />
                    PNG
                  </a>
                ) : null}
                {session.qr ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<Download className="h-3.5 w-3.5" />}
                    onClick={downloadSvg}
                  >
                    SVG
                  </Button>
                ) : null}
                {session.qr?.payload ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<Copy className="h-3.5 w-3.5" />}
                    onClick={() => void copyPayload()}
                  >
                    {t('คัดลอก Payload', 'Copy payload')}
                  </Button>
                ) : null}
                {session.status === 'pending' && !expired ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                    onClick={() => void regenerate()}
                    loading={creating}
                  >
                    {t('สร้าง QR ใหม่', 'New QR')}
                  </Button>
                ) : null}
              </div>

              {!canVerify ? (
                <p className="flex items-center gap-1.5 text-[10.5px] text-faint">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t(
                    'คุณไม่มีสิทธิ์ยืนยันการรับเงิน กรุณาเรียกผู้จัดการ',
                    'You cannot verify receipt. Ask a manager to confirm.',
                  )}
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function PromptPayStatus({ session, expired }: { session: PromptPaySession; expired: boolean }) {
  const { t } = useLang();
  if (session.status === 'paid') {
    return (
      <Badge tone="jade" dot>
        {t('ชำระแล้ว', 'Paid')}
      </Badge>
    );
  }
  if (session.status === 'cancelled') {
    return <Badge tone="neutral">{t('ยกเลิก', 'Cancelled')}</Badge>;
  }
  if (session.status === 'expired' || expired) {
    return <Badge tone="danger">{t('หมดอายุ', 'Expired')}</Badge>;
  }
  if (session.status === 'refunded') {
    return <Badge tone="info">{t('คืนเงินแล้ว', 'Refunded')}</Badge>;
  }
  return (
    <Badge tone="amber" dot>
      {t('รอยืนยัน', 'Pending')}
    </Badge>
  );
}

function printPromptPayQr(
  session: PromptPaySession,
  options: { businessName: string },
): void {
  if (!session.qr) return;
  const escape = (value: unknown) =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const amount = new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
  }).format(session.amountSatang / 100);
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escape(session.reference)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font-family: 'IBM Plex Sans Thai','Noto Sans Thai','Segoe UI',sans-serif; color:#000; margin:0; text-align:center; }
    h1 { font-size:14px; margin:0 0 2px; }
    .muted { font-size:10px; color:#444; }
    .amount { font-size:22px; font-weight:700; margin:8px 0; }
    img { width: 62mm; height: 62mm; display:block; margin: 0 auto; }
    .ref { margin-top:6px; font-size:11px; letter-spacing:.04em; }
    .foot { margin-top:8px; font-size:9px; color:#444; }
  </style></head><body>
    <h1>${escape(options.businessName)}</h1>
    <div class="muted">${escape(session.account.displayName)} · ${escape(session.account.maskedIdentifier)}</div>
    <div class="amount">${escape(amount)}</div>
    <img src="${session.qr.pngDataUrl}" alt="PromptPay QR" />
    <div class="ref">REF ${escape(session.reference)}</div>
    <div class="foot">สแกนด้วยแอปธนาคารที่รองรับพร้อมเพย์<br/>QR มีอายุถึง ${escape(new Date(session.expiresAt).toLocaleString('th-TH'))}</div>
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
