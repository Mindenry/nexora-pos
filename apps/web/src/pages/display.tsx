import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Check, Maximize2, ShieldCheck } from 'lucide-react';
import { formatMoney } from '@nexora/shared';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { readDisplayState, subscribeDisplay, type DisplayState } from '../lib/display';
import { SHOWCASE_ART } from '../lib/art';

function useClock(): Date {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function CustomerDisplayPage() {
  const { me } = useAuth();
  const { t, locale } = useLang();
  const now = useClock();
  const [state, setState] = useState<DisplayState | null>(() => readDisplayState());

  useEffect(() => subscribeDisplay(setState), []);

  useEffect(() => {
    document.title = t('จอลูกค้า', 'Customer display') + ' · NEXORA';
    return () => {
      document.title = 'NEXORA POS';
    };
  }, [t]);

  const money = (satang: number) => formatMoney(satang, locale);
  const stalePaid = state?.kind === 'paid' && Date.now() - new Date(state.updatedAt).getTime() > 120_000;
  const view: DisplayState | null = stalePaid ? null : state;
  const storeName = view?.storeName ?? me?.store?.name ?? '';
  const businessName = view?.businessName ?? me?.business?.name ?? 'NEXORA';

  const total = useMemo(() => (view?.kind === 'cart' ? view.totalSatang : 0), [view]);

  if (!me?.store) return <Navigate to="/login" replace />;

  if (!view || view.kind === 'idle') {
    return (
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#F2EEE3] text-[#1B221E]">
        <DisplayHeader storeName={storeName} businessName={businessName} now={now} />
        <main className="relative flex min-h-0 flex-1 items-center px-[clamp(24px,5vw,104px)] py-8">
          <div className="grid w-full items-center gap-[clamp(28px,5vw,80px)] lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <h1 className="whitespace-nowrap text-[clamp(30px,3.4vw,64px)] font-semibold leading-[1.02] tracking-[-0.035em]">
                {t('ขอบคุณที่แวะมา', 'Thanks for stopping by.')}
              </h1>
              <p className="mt-5 max-w-[40ch] text-[clamp(14px,1.25vw,21px)] leading-relaxed text-[#5B665F]">
                {t(
                  'สแกนสินค้าเพื่อเริ่มรายการ ยอดของคุณจะแสดงที่นี่แบบเรียลไทม์',
                  'Scan your items to begin. Your basket appears here in real time.',
                )}
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {[t('เงินสด', 'Cash'), t('โอนเงิน', 'Transfer'), t('บัตร', 'Card'), 'PromptPay QR'].map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-[#CFC7B7] bg-[#F8F5ED] px-3.5 py-1.5 text-[clamp(10px,0.9vw,14px)] font-medium text-[#5B665F]"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-5">
              {SHOWCASE_ART.map((art, index) => (
                <figure
                  key={art.key}
                  className={`overflow-hidden rounded-[clamp(14px,1.6vw,26px)] border border-[#D9D1C1] bg-[#F8F5ED] ${
                    index === 0 ? 'sm:translate-y-6' : index === 3 ? 'sm:-translate-y-6' : ''
                  }`}
                >
                  <img src={art.url} alt="" className="aspect-[4/3] w-full object-cover" />
                  <figcaption className="px-3 py-2 text-[clamp(10px,0.9vw,14px)] font-medium text-[#5B665F]">
                    {locale === 'th' ? art.labelTh : art.labelEn}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </main>
        <DisplayFooter />
      </div>
    );
  }

  if (view.kind === 'paid') {
    return (
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#0E1412] text-[#EDF2EF]">
        <header className="flex items-center justify-between px-[clamp(24px,5vw,104px)] py-6">
          <Brand businessName={businessName} dark />
          <span className="text-[clamp(10px,0.9vw,14px)] uppercase tracking-[0.2em] text-[#8B9A92]">{storeName}</span>
        </header>
        <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="display-pop flex h-[clamp(72px,9vw,132px)] w-[clamp(72px,9vw,132px)] items-center justify-center rounded-full bg-[#2AA78C] text-[#08110E]">
            <Check className="h-[46%] w-[46%]" strokeWidth={2.5} />
          </span>
          <p className="mt-6 text-[clamp(13px,1.1vw,19px)] uppercase tracking-[0.24em] text-[#8B9A92]">
            {t('ชำระเงินสำเร็จ', 'Payment complete')}
          </p>
          <p className="mt-2 text-[clamp(48px,7vw,112px)] font-semibold leading-none tracking-[-0.04em]">
            {money(view.totalSatang)}
          </p>
          {view.changeSatang > 0 ? (
            <p className="mt-4 text-[clamp(16px,1.6vw,28px)] text-[#D9A94E]">
              {t('เงินทอน', 'Change')} <span className="font-semibold text-[#F5F7F4]">{money(view.changeSatang)}</span>
            </p>
          ) : null}
          <p className="mt-6 text-[clamp(14px,1.3vw,22px)] text-[#AEBAB3]">
            {t('ขอบคุณที่ใช้บริการ', 'Thank you for shopping with us')}
          </p>
          <p className="num mt-2 text-[clamp(10px,0.9vw,14px)] tracking-wide text-[#6E7C74]">{view.number}</p>
        </main>
        <DisplayFooter dark />
      </div>
    );
  }

  const vatLabel =
    view.pricesIncludeTax
      ? `${t('รวม VAT', 'VAT included')} ${(view.vatRateBp / 100).toFixed(0)}%`
      : `${t('VAT', 'VAT')} ${(view.vatRateBp / 100).toFixed(0)}%`;

  return (
    <div className="flex min-h-screen flex-col bg-[#F2EEE3] text-[#1B221E]">
      <DisplayHeader storeName={storeName} businessName={businessName} now={now} />
      <main className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1.45fr_1fr]">
        <section className="flex min-h-0 flex-col px-[clamp(24px,4vw,76px)] py-6">
          <div className="mb-4 flex items-end justify-between border-b border-[#D9D1C1] pb-3">
            <div>
              <p className="text-[clamp(10px,0.9vw,14px)] uppercase tracking-[0.18em] text-[#7B867F]">
                {t('รายการของคุณ', 'Your items')}
              </p>
              <p className="text-[clamp(13px,1.1vw,18px)] text-[#5B665F]">
                {view.itemCount} {t('ชิ้น', 'items')}
              </p>
            </div>
            <span className="text-[clamp(10px,0.9vw,14px)] text-[#7B867F]">{t('ราคาต่อหน่วย', 'Unit price')}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {view.lines.map((line, index) => (              <div
                key={`${line.name}-${index}`}
                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-[clamp(10px,1.4vw,22px)] border-b border-[#E2DBCC] py-[clamp(8px,1vw,16px)]"
              >
                <div className="h-[clamp(38px,4vw,66px)] w-[clamp(38px,4vw,66px)] overflow-hidden rounded-[clamp(8px,1vw,14px)] border border-[#D9D1C1] bg-[#F8F5ED]">
                  {line.imageUrl ? (
                    <img src={line.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[10px] text-[#9A9588]">N</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[clamp(14px,1.35vw,23px)] font-medium leading-tight">{line.name}</p>
                  <p className="num text-[clamp(10px,0.9vw,14px)] text-[#7B867F]">
                    {line.qty} × {money(line.unitPriceSatang)}
                  </p>
                </div>
                <span className="num text-[clamp(10px,0.9vw,14px)] text-[#7B867F]">
                  {money(line.unitPriceSatang)}
                </span>
                <span className="num min-w-[7ch] text-right text-[clamp(14px,1.35vw,23px)] font-semibold">
                  {money(line.totalSatang)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-[#D9D1C1] pt-4 text-[clamp(10px,0.9vw,14px)] text-[#7B867F]">
            <span>{t('ขอบคุณที่เลือกซื้อกับเรา', 'Thank you for shopping with us')}</span>
            <span className="num">
              {view.itemCount} {t('ชิ้น', 'items')}
            </span>
          </div>
        </section>

        <aside className="flex flex-col justify-between bg-[#0E1412] px-[clamp(24px,4vw,64px)] py-8 text-[#EDF2EF]">
          <div>
            <p className="text-[clamp(10px,0.9vw,14px)] uppercase tracking-[0.2em] text-[#8B9A92]">
              {t('ยอดที่ต้องชำระ', 'Amount due')}
            </p>
            <p className="num mt-3 text-[clamp(46px,6.4vw,104px)] font-semibold leading-none tracking-[-0.04em]">
              {money(total)}
            </p>
            <div className="mt-8 space-y-2 border-t border-white/10 pt-5 text-[clamp(12px,1vw,17px)]">
              <Row label={t('ยอดสินค้า', 'Subtotal')} value={money(view.subtotalSatang)} />
              {view.discountSatang > 0 ? (
                <Row label={t('ส่วนลด', 'Discount')} value={`-${money(view.discountSatang)}`} accent />
              ) : null}
              <Row label={vatLabel} value={money(view.taxSatang)} />
            </div>
          </div>
          <div>
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <p className="flex items-center gap-2 text-[clamp(11px,1vw,16px)] text-[#AEBAB3]">
                <ShieldCheck className="h-4 w-4 text-[#2AA78C]" />
                {t('ราคานี้เป็นราคาสุทธิและมีหลักฐานการชำระครบถ้วน', 'Final price with a complete payment record.')}
              </p>
            </div>
            <p className="mt-5 text-center text-[clamp(10px,0.9vw,14px)] text-[#6E7C74]">
              {t('กรุณาตรวจสอบรายการก่อนชำระเงิน', 'Please review your items before paying.')}
            </p>
          </div>
        </aside>
      </main>
      <DisplayFooter />
    </div>
  );
}

function Brand({ businessName, dark }: { businessName: string; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0C7360] text-[13px] font-bold text-white">
        N
      </span>
      <div>
        <p className={`text-[11px] font-semibold tracking-[0.18em] ${dark ? 'text-[#EDF2EF]' : 'text-[#1B221E]'}`}>
          NEXORA
        </p>
        <p className={`text-[9px] uppercase tracking-[0.18em] ${dark ? 'text-[#8B9A92]' : 'text-[#7B867F]'}`}>
          {businessName}
        </p>
      </div>
    </div>
  );
}

function DisplayHeader({ storeName, businessName, now }: { storeName: string; businessName: string; now: Date }) {
  return (
    <header className="flex items-center justify-between border-b border-[#D9D1C1] px-[clamp(24px,4vw,76px)] py-4">
      <Brand businessName={businessName} />
      <div className="flex items-center gap-4">
        <span className="text-[clamp(11px,1vw,16px)] font-medium text-[#5B665F]">{storeName}</span>
        <span className="num text-[clamp(11px,1vw,16px)] text-[#7B867F]">
          {now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <button
          type="button"
          onClick={() => void document.documentElement.requestFullscreen?.()}
          className="rounded-md border border-[#CFC7B7] bg-[#F8F5ED] p-1.5 text-[#7B867F] hover:text-[#1B221E]"
          aria-label="Fullscreen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}

function DisplayFooter({ dark }: { dark?: boolean }) {
  return (
    <footer
      className={`flex items-center justify-between border-t px-[clamp(24px,4vw,76px)] py-3 text-[clamp(9px,0.8vw,12px)] ${
        dark ? 'border-white/10 text-[#6E7C74]' : 'border-[#D9D1C1] text-[#7B867F]'
      }`}
    >
      <span>NEXORA POS · {new Date().getFullYear() + 543}</span>
      <span>{dark ? 'ขอบคุณที่ใช้บริการ' : 'Customer display / จอลูกค้า'}</span>
    </footer>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[#AEBAB3]">{label}</span>
      <span className={`num font-medium ${accent ? 'text-[#D9A94E]' : 'text-[#F5F7F4]'}`}>{value}</span>
    </div>
  );
}
