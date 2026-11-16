import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  ShieldCheck,
  Store,
  Zap,
} from 'lucide-react';
import { api, ApiError, errorMessage } from '../lib/api';
import { useAuth, type Me } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { Button, Card, Field, InlineAlert, Input } from '../components/ui';
import { cn } from '../components/ui';

function BrandPanel() {
  const { t } = useLang();
  return (
    <aside className="relative hidden overflow-hidden bg-sidebar px-10 py-9 text-sidebar-text lg:flex lg:flex-col lg:justify-between">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'linear-gradient(to bottom right, black, transparent 78%)',
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-jade text-[16px] font-bold text-white">
            N
          </span>
          <div>
            <p className="text-[13px] font-semibold tracking-[0.2em]">NEXORA</p>
            <p className="text-[9px] uppercase tracking-[0.28em] text-sidebar-muted">Retail operating system</p>
          </div>
        </div>
        <div className="mt-20 max-w-[440px]">
          <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10.5px] text-sidebar-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-jade" />
            {t('สร้างสำหรับธุรกิจค้าปลีกไทย', 'Built for Thai retail')}
          </p>
          <h1 className="text-balance text-[38px] font-semibold leading-[1.15] tracking-[-0.03em] xl:text-[44px]">
            {t('ทุกยอดขาย', 'Every sale')}
            <br />
            {t('ตรวจสอบได้ ตั้งแต่หน้าจนถึงบัญชี', 'accounted for, from counter to books.')}
          </h1>
          <p className="mt-5 max-w-[400px] text-[13.5px] leading-relaxed text-sidebar-muted">
            {t(
              'ขายหน้าร้าน สต๊อก กะเงินสด กำไร และหลายสาขา — ทำงานบนข้อมูลชุดเดียวที่พิสูจน์ได้',
              'Point of sale, stock, shifts, margin and multi-branch — on one provable set of records.',
            )}
          </p>
        </div>
      </div>
      <div className="relative grid max-w-[460px] grid-cols-2 gap-x-6 gap-y-4 border-t border-white/10 pt-6">
        {[
          {
            icon: Zap,
            th: 'ขายได้ในไม่กี่วินาที',
            en: 'Ring a sale in seconds',
            subTh: 'คีย์บอร์ด บาร์โค้ด และทัชสกรีน',
            subEn: 'Keyboard, barcode and touch',
          },
          {
            icon: ShieldCheck,
            th: 'เงินและสต๊อกตรงกัน',
            en: 'Money and stock agree',
            subTh: 'ทุกธุรกรรมมีหลักฐานย้อนหลัง',
            subEn: 'Every movement is auditable',
          },
          {
            icon: Store,
            th: 'พร้อมหลายสาขา',
            en: 'Multi-branch ready',
            subTh: 'แยกข้อมูลและสิทธิ์ชัดเจน',
            subEn: 'Tenant and store scoped',
          },
          {
            icon: KeyRound,
            th: 'สิทธิ์ตามบทบาท',
            en: 'Role-based access',
            subTh: 'ตรวจสอบที่เซิร์ฟเวอร์ทุกครั้ง',
            subEn: 'Authorised on the server',
          },
        ].map((item) => (
          <div key={item.en} className="flex gap-2.5">
            <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-jade" strokeWidth={1.8} />
            <div>
              <p className="text-[11.5px] font-medium text-sidebar-text">{t(item.th, item.en)}</p>
              <p className="text-[10.5px] text-sidebar-muted">{t(item.subTh, item.subEn)}</p>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function AuthSwitch() {
  const { locale, setLocale } = useLang();
  return (
    <div className="flex items-center gap-1 rounded-md border border-line bg-surface p-0.5">
      {(['th', 'en'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => setLocale(value)}
          className={cn(
            'rounded px-2 py-1 text-[10.5px] font-medium transition-colors',
            locale === value ? 'bg-surface-3 text-text' : 'text-muted hover:text-text',
          )}
        >
          {value === 'th' ? 'ไทย' : 'EN'}
        </button>
      ))}
    </div>
  );
}

export function LoginPage() {
  const { t } = useLang();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from;

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api<Me>('/auth/login', {
        method: 'POST',
        body: { email, password, remember },
      });
      login(result.data);
      if (result.data.user.isPlatformAdmin && !result.data.employee) navigate('/platform', { replace: true });
      else if (!result.data.tenant?.onboardedAt) navigate('/onboarding', { replace: true });
      else navigate(from && !from.startsWith('/login') ? from : '/dashboard', { replace: true });
    } catch (err) {
      setError(errorMessage(err, t('th', 'en') === 'th' ? 'th' : 'en'));
      if (err instanceof ApiError && err.code === 'AUTH_INVALID_CREDENTIALS') {
        setError(t('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'Incorrect email or password.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(demoEmail === 'admin@nexora.local' ? 'NexoraAdmin!2026' : 'NexoraDemo!2026');
    setError(null);
  };

  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[1.02fr_1fr]">
      <BrandPanel />
      <main className="flex min-h-screen flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-jade text-sm font-bold text-white">
              N
            </span>
            <span className="text-[12px] font-semibold tracking-[0.18em]">NEXORA</span>
          </div>
          <AuthSwitch />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[390px]">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-jade">
              {t('ยินดีต้อนรับกลับ', 'Welcome back')}
            </p>
            <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-text">
              {t('เข้าสู่ระบบร้านของคุณ', 'Sign in to your store')}
            </h1>
            <p className="mt-1 text-[13px] text-muted">
              {t('ใช้บัญชีที่ได้รับจากเจ้าของธุรกิจ', 'Use the account provided by your business owner.')}
            </p>

            <form onSubmit={submit} className="mt-7 space-y-4">
              {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
              <Field label={t('อีเมล', 'Email')} htmlFor="email" required>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@business.co.th"
                  leadingIcon={<Mail className="h-4 w-4" />}
                  required
                />
              </Field>
              <Field label={t('รหัสผ่าน', 'Password')} htmlFor="password" required>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••••"
                    leadingIcon={<KeyRound className="h-4 w-4" />}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-text"
                    aria-label={showPassword ? t('ซ่อนรหัสผ่าน', 'Hide password') : t('แสดงรหัสผ่าน', 'Show password')}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--jade)]"
                  />
                  {t('จดจำฉัน', 'Remember me')}
                </label>
              </div>
              <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
                {t('เข้าสู่ระบบ', 'Sign in')}
                {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
              </Button>
            </form>

            {import.meta.env.DEV ? (
              <Card className="mt-6 border-dashed bg-surface-2 p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-text">
                    {t('บัญชีเดโม (สภาพแวดล้อมพัฒนา)', 'Demo accounts (development)')}
                  </p>
                  <span className="rounded bg-amber-soft px-1.5 py-0.5 text-[9.5px] font-medium text-amber">
                    DEMO
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {[
                    ['owner@demo.nexora.local', t('เจ้าของ', 'Owner')],
                    ['cashier1@demo.nexora.local', t('แคชเชียร์', 'Cashier')],
                    ['manager@demo.nexora.local', t('ผู้จัดการ', 'Manager')],
                    ['admin@nexora.local', t('แพลตฟอร์ม', 'Platform')],
                  ].map(([demoEmail, label]) => (
                    <button
                      key={demoEmail}
                      type="button"
                      onClick={() => fillDemo(demoEmail!)}
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-left text-[10.5px] text-muted transition-colors hover:border-jade-border hover:text-text"
                    >
                      <span className="block font-medium text-text">{label}</span>
                      <span className="block truncate text-[9.5px] text-faint">{demoEmail}</span>
                    </button>
                  ))}
                </div>
              </Card>
            ) : null}

            <p className="mt-6 text-center text-[12px] text-muted">
              {t('ยังไม่มีบัญชี?', 'New to NEXORA?')}{' '}
              <Link to="/register" className="font-medium text-jade hover:underline">
                {t('สร้างธุรกิจใหม่', 'Create a business')}
              </Link>
            </p>
          </div>
        </div>
        <p className="text-center text-[10px] text-faint">
          NEXORA POS v0.1 · {t('ข้อมูลของคุณถูกแยกตามองค์กร', 'Tenant-isolated data')}
        </p>
      </main>
    </div>
  );
}

export function RegisterPage() {
  const { t } = useLang();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    businessName: '',
    ownerName: '',
    email: '',
    password: '',
    storeName: '',
    phone: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api<Me>('/auth/register', {
        method: 'POST',
        body: { ...form, currency: 'THB', timezone: 'Asia/Bangkok' },
      });
      login(result.data);
      navigate('/onboarding', { replace: true });
    } catch (err) {
      setError(errorMessage(err, t('th', 'en') === 'th' ? 'th' : 'en'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[0.9fr_1.1fr]">
      <BrandPanel />
      <main className="flex min-h-screen flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/login" className="text-[12px] font-medium text-jade hover:underline">
            ← {t('กลับไปเข้าสู่ระบบ', 'Back to sign in')}
          </Link>
          <AuthSwitch />
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-[520px]">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-jade">
              {t('เริ่มต้นใน 2 นาที', 'Set up in two minutes')}
            </p>
            <h1 className="mt-2 text-[28px] font-semibold tracking-tight">
              {t('สร้างธุรกิจและสาขาแรก', 'Create your business and first store')}
            </h1>
            <p className="mt-1 text-[13px] text-muted">
              {t(
                'ระบบจะสร้างร้าน สาขา บทบาท และวิธีชำระเงินให้พร้อมใช้งาน',
                'We create the store, roles and payment methods for you.',
              )}
            </p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('ชื่อธุรกิจ', 'Business name')} required>
                  <Input value={form.businessName} onChange={set('businessName')} placeholder="Nexora Retail" required />
                </Field>
                <Field label={t('ชื่อเจ้าของ', 'Owner name')} required>
                  <Input value={form.ownerName} onChange={set('ownerName')} placeholder="คุณณัฐพล" required />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('ชื่อสาขาแรก', 'First branch')} required>
                  <Input value={form.storeName} onChange={set('storeName')} placeholder="สาขาสยาม" required />
                </Field>
                <Field label={t('เบอร์โทร', 'Phone')} hint={t('ไม่บังคับ', 'Optional')}>
                  <Input value={form.phone} onChange={set('phone')} placeholder="02-000-0000" />
                </Field>
              </div>
              <Field label={t('อีเมลผู้ใช้', 'Account email')} required>
                <Input type="email" value={form.email} onChange={set('email')} placeholder="owner@business.co.th" required />
              </Field>
              <Field
                label={t('รหัสผ่าน', 'Password')}
                hint={t('อย่างน้อย 10 ตัวอักษร', 'At least 10 characters')}
                required
              >
                <Input
                  type="password"
                  value={form.password}
                  onChange={set('password')}
                  minLength={10}
                  autoComplete="new-password"
                  required
                />
              </Field>
              <div className="rounded-lg border border-line bg-surface-2 p-3 text-[11.5px] leading-relaxed text-muted">
                {t(
                  'การสร้างบัญชีถือว่ายอมรับนโยบายความเป็นส่วนตัว (PDPA) ระบบเก็บเฉพาะข้อมูลที่จำเป็นต่อการดำเนินธุรกิจ และไม่ใช้ข้อมูลส่วนบุคคลจริงในข้อมูลเดโม',
                  'Creating an account accepts the privacy policy (PDPA). We store only data needed to operate the business and never use real personal data in demo content.',
                )}
              </div>
              <Button type="submit" size="lg" variant="primary" loading={submitting} className="w-full">
                {t('สร้างบัญชีและเริ่มต้น', 'Create account and continue')}
                {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
