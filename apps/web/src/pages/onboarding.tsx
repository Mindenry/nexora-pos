import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CreditCard,
  Landmark,
  Package,
  Store,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { Badge, Button, Card, InlineAlert, Spinner, cn } from '../components/ui';

interface OnboardingState {
  completed: boolean;
  steps: Array<{ key: string; done: boolean }>;
  counts: {
    products: number;
    employees: number;
    stores: number;
    paymentMethods: number;
    categories: number;
    sales: number;
  };
}

export function OnboardingPage() {
  const { t, locale } = useLang();
  const { me, refresh, isDemo } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => api<OnboardingState>('/onboarding'),
  });

  const complete = useMutation({
    mutationFn: () => api('/onboarding/complete', { method: 'POST', body: {} }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      await refresh();
      navigate('/dashboard');
    },
  });

  if (!me?.employee) {
    navigate('/login');
    return null;
  }

  const state = query.data?.data;
  const done = state?.steps.filter((s) => s.done).length ?? 0;
  const total = state?.steps.length ?? 7;
  const pct = Math.round((done / total) * 100);

  const steps = [
    {
      key: 'business',
      icon: Store,
      titleTh: 'ข้อมูลธุรกิจ',
      titleEn: 'Business profile',
      descTh: 'ชื่อร้าน ที่อยู่ เลขภาษี และข้อมูลใบเสร็จ',
      descEn: 'Name, address, tax ID and receipt details.',
      to: '/settings',
      actionTh: 'ตรวจสอบข้อมูล',
      actionEn: 'Review profile',
    },
    {
      key: 'tax',
      icon: Landmark,
      titleTh: 'ภาษีและสกุลเงิน',
      titleEn: 'Tax and currency',
      descTh: 'VAT 7% ตั้งต้น ปรับได้ตามการจดทะเบียนจริง',
      descEn: 'VAT 7% default, configurable to your registration.',
      to: '/settings',
      actionTh: 'ตั้งค่าภาษี',
      actionEn: 'Tax settings',
    },
    {
      key: 'store',
      icon: Store,
      titleTh: 'สาขา',
      titleEn: 'Branch',
      descTh: 'เปิดสาขาเพิ่มและกำหนดผู้ดูแล',
      descEn: 'Add branches and assign managers.',
      to: '/employees',
      actionTh: 'จัดการสาขา',
      actionEn: 'Manage branches',
    },
    {
      key: 'products',
      icon: Package,
      titleTh: 'เพิ่มสินค้า',
      titleEn: 'Add products',
      descTh: 'สร้างสินค้าแรกหรือนำเข้าจาก CSV',
      descEn: 'Create your first product or import CSV.',
      to: '/products?new=1',
      actionTh: 'เพิ่มสินค้า',
      actionEn: 'Add product',
    },
    {
      key: 'employees',
      icon: UserPlus,
      titleTh: 'เพิ่มพนักงาน',
      titleEn: 'Invite your team',
      descTh: 'กำหนดบทบาทและสาขาที่เข้าถึงได้',
      descEn: 'Assign roles and store access.',
      to: '/employees?new=1',
      actionTh: 'เพิ่มพนักงาน',
      actionEn: 'Add employee',
    },
    {
      key: 'payments',
      icon: CreditCard,
      titleTh: 'วิธีชำระเงิน',
      titleEn: 'Payment methods',
      descTh: 'เงินสด โอน บัตร และ QR พร้อมใช้งาน',
      descEn: 'Cash, transfer, card and QR are ready.',
      to: '/settings',
      actionTh: 'ตรวจสอบ',
      actionEn: 'Review',
    },
    {
      key: 'pos',
      icon: CheckCircle2,
      titleTh: 'เปิดกะและขายรายการแรก',
      titleEn: 'Open a shift and sell',
      descTh: 'เปิดกะ รับเงินสด และปิดกะให้ยอดตรง',
      descEn: 'Open a shift, take cash and reconcile.',
      to: '/pos',
      actionTh: 'ไปที่หน้าขาย',
      actionEn: 'Open POS',
    },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-jade text-sm font-bold text-white">
              N
            </span>
            <div>
              <p className="text-[12px] font-semibold tracking-[0.16em]">NEXORA</p>
              <p className="text-[9px] uppercase tracking-[0.2em] text-faint">Setup</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDemo ? <Badge tone="amber">{t('ข้อมูลเดโม', 'Demo data')}</Badge> : null}
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              {t('ข้ามไปภาพรวม', 'Skip to overview')}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8">
        <div className="mb-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-jade">
            {t('พร้อมใช้งาน', 'Go live')}
          </p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">
            {t('ตั้งค่าร้านให้พร้อมขาย', 'Get your store ready')}
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            {t(
              'ทำตามขั้นตอนด้านล่าง ระบบจะตรวจสอบความพร้อมจากข้อมูลจริงของคุณ',
              'Work through the checklist. Progress is computed from your real data.',
            )}
          </p>
        </div>

        <Card className="mb-5 p-5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-medium text-text">
              {done} / {total} {t('ขั้นตอน', 'steps')}
            </span>
            <span className="num text-muted">{pct}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-jade transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          {isDemo ? (
            <div className="mt-4">
              <InlineAlert tone="info" title={t('นี่คือข้อมูลเดโม', 'This is demo data')}>
                {t(
                  'ทุกยอดและสต๊อกสร้างจากระบบจริง แต่เป็นข้อมูลตัวอย่าง ห้ามใช้ตัดสินใจทางบัญชี',
                  'Every sale and stock movement came from the real engine, but it is sample data — do not use it for accounting decisions.',
                )}
              </InlineAlert>
            </div>
          ) : null}
        </Card>

        {query.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : query.isError ? (
          <InlineAlert tone="danger">{errorMessage(query.error, locale)}</InlineAlert>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {steps.map((step) => {
              const isDone = state?.steps.find((s) => s.key === step.key)?.done;
              return (
                <Card key={step.key} className={cn('flex items-start gap-3 p-4', isDone && 'bg-surface-2')}>
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                      isDone ? 'border-jade-border bg-jade-soft text-jade' : 'border-line bg-surface-3 text-muted',
                    )}
                  >
                    {isDone ? <Check className="h-4 w-4" /> : <step.icon className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-text">{t(step.titleTh, step.titleEn)}</p>
                      {isDone ? (
                        <Badge tone="jade" className="px-1.5 py-0 text-[9.5px]">
                          {t('เสร็จแล้ว', 'Done')}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-muted">{t(step.descTh, step.descEn)}</p>
                    <button
                      type="button"
                      onClick={() => navigate(step.to)}
                      className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-jade hover:underline"
                    >
                      {t(step.actionTh, step.actionEn)}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Users className="h-4 w-4" />
            {t('ต้องการความช่วยเหลือ? เปิดคู่มือการใช้งาน', 'Need help? Open the operations guide')}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/dashboard')}>
              {t('ไปที่ภาพรวม', 'Go to overview')}
            </Button>
            <Button
              variant="primary"
              loading={complete.isPending}
              onClick={() => complete.mutate()}
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              {t('ตั้งค่าเสร็จสิ้น', 'Finish setup')}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
