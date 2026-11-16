import { Printer } from 'lucide-react';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';
import { cn } from './ui';

export interface ReceiptSnapshot {
  type?: 'sale' | 'refund' | string;
  number: string;
  businessDate?: string;
  issuedAt?: string;
  business?: { name?: string; legalName?: string; taxId?: string; address?: string; phone?: string };
  store?: { name?: string; address?: string; phone?: string; taxId?: string };
  cashier?: string;
  customer?: { name?: string; phone?: string } | null;
  items?: Array<{
    name: string;
    sku?: string;
    qty: number;
    unitPriceSatang?: number;
    amountSatang?: number;
    totalSatang?: number;
    discountSatang?: number;
  }>;
  subtotalSatang?: number;
  discountSatang?: number;
  taxSatang?: number;
  totalSatang: number;
  changeSatang?: number;
  vatRateBp?: number;
  pricesIncludeTax?: boolean;
  pointsRedeemed?: number;
  pointsDiscountSatang?: number;
  loyaltyPoints?: number;
  payments?: Array<{ methodName?: string; method?: string; amountSatang: number; reference?: string }>;
  appliedPromotions?: Array<{ name: string; amountSatang: number }>;
  footer?: string;
  reprint?: boolean;
  originalNumber?: string;
  reason?: string;
}

export function ReceiptView({
  receipt,
  onPrint,
  className,
}: {
  receipt: ReceiptSnapshot;
  onPrint?: () => void;
  className?: string;
}) {
  const { t } = useLang();
  const { money, dateTime } = useFormat();
  const isRefund = receipt.type === 'refund';
  const items = receipt.items ?? [];
  const payments = receipt.payments ?? [];
  const vatPercent = ((receipt.vatRateBp ?? 700) / 100).toFixed(0);

  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[430px] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_60px_-30px_rgba(15,21,19,0.5)]',
        className,
      )}
    >
      <div className={cn('relative px-5 pb-4 pt-5 text-white', isRefund ? 'bg-[#3a1715]' : 'bg-[#0f1513]')}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-jade text-[15px] font-bold tracking-tight text-white shadow-sm">
              N
            </span>
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-white">NEXORA POS</p>
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-white/45">
                {t('ระบบขายหน้าร้าน', 'Retail point of sale')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onPrint ? (
              <button
                type="button"
                onClick={onPrint}
                aria-label={t('พิมพ์ใบเสร็จ', 'Print receipt')}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Printer className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em]',
                isRefund ? 'bg-danger/20 text-[#ffb4ad]' : 'bg-jade/20 text-jade-soft',
              )}
            >
              {isRefund ? t('คืนสินค้า', 'Refund') : receipt.reprint ? t('พิมพ์ซ้ำ', 'Reprint') : t('ใบเสร็จ', 'Receipt')}
            </span>
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[9px] uppercase tracking-[0.18em] text-white/40">
              {t('เลขที่ใบเสร็จ', 'Receipt no.')}
            </p>
            <p className="num mt-0.5 text-[17px] font-semibold tracking-[0.04em]">{receipt.number}</p>
          </div>
          <p className="text-right text-[9.5px] leading-relaxed text-white/55">
            {dateTime(receipt.issuedAt ?? new Date())}
            <br />
            {receipt.businessDate ?? ''}
          </p>
        </div>
      </div>

      <div className="px-5 pb-5 pt-4">
        <div className="text-center">
          <p className="text-[15px] font-semibold tracking-[0.02em]">{receipt.business?.name}</p>
          {receipt.business?.legalName ? (
            <p className="mt-0.5 text-[10px] text-muted">{receipt.business.legalName}</p>
          ) : null}
          <p className="mt-1 text-[9.5px] leading-relaxed text-faint">
            {[receipt.store?.name ?? receipt.business?.address, receipt.store?.address]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="text-[9.5px] text-faint">
            {[receipt.business?.phone, receipt.business?.taxId ? `${t('เลขประจำตัวผู้เสียภาษี', 'Tax ID')} ${receipt.business.taxId}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-line bg-surface-2/70 px-3 py-2.5 text-[10.5px]">
          <Meta label={t('พนักงานขาย', 'Cashier')} value={receipt.cashier ?? '—'} />
          <Meta label={t('ช่องทาง', 'Channel')} value={receipt.store?.name ?? t('หน้าร้าน', 'In-store')} align="right" />
          {receipt.customer ? (
            <Meta label={t('ลูกค้า', 'Customer')} value={receipt.customer.name ?? '—'} />
          ) : null}
          {receipt.originalNumber ? (
            <Meta label={t('อ้างอิงใบเดิม', 'Original')} value={receipt.originalNumber} align="right" />
          ) : null}
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between border-b border-line pb-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-faint">
              {t('รายการสินค้า', 'Items')}
            </p>
            <p className="text-[9px] uppercase tracking-[0.14em] text-faint">
              {items.reduce((sum, item) => sum + item.qty, 0)} {t('ชิ้น', 'pcs')}
            </p>
          </div>
          <div className="divide-y divide-line/60">
            {items.map((item, index) => {
              const total = item.totalSatang ?? item.amountSatang ?? 0;
              const unit = item.unitPriceSatang ?? (item.qty > 0 ? total / item.qty : 0);
              return (
                <div key={`${item.name}-${index}`} className="flex items-start gap-2.5 py-2.5">
                  <span className="num mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-surface-3 px-1 text-[10px] font-semibold text-muted">
                    ×{item.qty}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-medium leading-snug">{item.name}</p>
                    <p className="mt-0.5 text-[9.5px] text-faint">
                      {money(unit)} {t('ต่อชิ้น', 'each')}
                      {item.sku ? ` · ${item.sku}` : ''}
                      {Number(item.discountSatang ?? 0) > 0 ? ` · -${money(item.discountSatang)}` : ''}
                    </p>
                  </div>
                  <span className="num shrink-0 text-[11.5px] font-medium">{money(total)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-line bg-surface-2/60 p-3">
          <div className="space-y-1.5 text-[10.5px]">
            <Row label={t('ยอดรวมสินค้า', 'Subtotal')} value={money(receipt.subtotalSatang ?? receipt.totalSatang)} />
            {Number(receipt.discountSatang ?? 0) > 0 ? (
              <Row
                label={t('ส่วนลด', 'Discount')}
                value={`-${money(receipt.discountSatang)}`}
                tone="jade"
              />
            ) : null}
            {Number(receipt.pointsRedeemed ?? 0) > 0 ? (
              <Row
                label={`${t('ใช้คะแนน', 'Points used')} ${receipt.pointsRedeemed}`}
                value={
                  Number(receipt.pointsDiscountSatang ?? 0) > 0
                    ? `-${money(receipt.pointsDiscountSatang)}`
                    : t('ในส่วนลด', 'in discount')
                }
                tone="amber"
              />
            ) : null}
            <Row
              label={`${t('ภาษีมูลค่าเพิ่ม', 'VAT')} ${vatPercent}%${receipt.pricesIncludeTax === false ? '' : ` (${t('รวมในราคา', 'included')})`}`}
              value={money(receipt.taxSatang ?? 0)}
            />
          </div>
          <div className="mt-2 flex items-end justify-between border-t border-line pt-2.5">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-faint">
                {t('ยอดสุทธิ', 'Total')}
              </p>
              <p className="text-[9.5px] text-faint">
                {payments.length > 1 ? t('ชำระหลายช่องทาง', 'Split payment') : t('ชำระครบถ้วน', 'Paid in full')}
              </p>
            </div>
            <p className="num text-[24px] font-semibold leading-none text-jade">{money(receipt.totalSatang)}</p>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {payments.map((payment, index) => (
            <div key={index} className="flex items-center justify-between text-[10.5px]">
              <span className="flex items-center gap-1.5 text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-jade" />
                {payment.methodName ?? payment.method}
                {payment.reference ? (
                  <span className="num text-[9px] text-faint">· {payment.reference}</span>
                ) : null}
              </span>
              <span className="num">{money(payment.amountSatang)}</span>
            </div>
          ))}
          {Number(receipt.changeSatang ?? 0) > 0 ? (
            <div className="flex items-center justify-between rounded-lg bg-jade-soft px-2.5 py-1.5 text-[11px] font-semibold text-jade">
              <span>{t('เงินทอน', 'Change')}</span>
              <span className="num">{money(receipt.changeSatang)}</span>
            </div>
          ) : null}
        </div>

        {(receipt.appliedPromotions ?? []).length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {(receipt.appliedPromotions ?? []).map((promo) => (
              <span key={`${promo.name}-${promo.amountSatang}`} className="rounded-full bg-jade-soft px-2 py-0.5 text-[9px] text-jade">
                {promo.name}
              </span>
            ))}
          </div>
        ) : null}

        {Number(receipt.loyaltyPoints ?? 0) > 0 ? (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-amber/20 bg-amber-soft/40 px-2.5 py-1.5 text-[10px] text-amber">
            <span>{t('คะแนนที่ได้รับ', 'Points earned')}</span>
            <span className="num font-semibold">+{receipt.loyaltyPoints}</span>
          </div>
        ) : null}

        {receipt.reason ? (
          <p className="mt-3 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[9.5px] text-muted">
            {t('เหตุผล', 'Reason')}: {receipt.reason}
          </p>
        ) : null}

        <div className="mt-4 border-t border-dashed border-line pt-3 text-center">
          <p className="text-[10px] leading-relaxed text-muted">
            {receipt.footer ?? t('ขอบคุณที่ใช้บริการ', 'Thank you for your visit')}
          </p>
          <p className="mt-1.5 text-[8.5px] uppercase tracking-[0.18em] text-faint">
            NEXORA POS · {receipt.businessDate ?? ''}
          </p>
          <p className="num mt-0.5 text-[8.5px] text-faint">
            {receipt.number} · {dateTime(receipt.issuedAt ?? new Date())}
          </p>
        </div>
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  align = 'left',
}: {
  label: string;
  value: string;
  align?: 'left' | 'right';
}) {
  return (
    <div className={align === 'right' ? 'text-right' : undefined}>
      <p className="text-[8.5px] uppercase tracking-[0.12em] text-faint">{label}</p>
      <p className="mt-0.5 truncate text-[10.5px] font-medium">{value}</p>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'jade' | 'amber';
}) {
  return (
    <div className={cn('flex justify-between gap-3', tone === 'jade' && 'text-jade', tone === 'amber' && 'text-amber')}>
      <span className={tone ? undefined : 'text-muted'}>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
