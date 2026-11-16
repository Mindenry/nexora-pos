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
  return (
    <div className={cn('rounded-xl border border-line bg-surface', className)}>
      <div className="flex items-center justify-between border-b border-dashed border-line px-5 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-faint">
            {isRefund ? t('ใบรับคืนสินค้า', 'Refund receipt') : t('ใบเสร็จรับเงิน', 'Receipt')}
          </p>
          <p className="num text-[14px] font-semibold">{receipt.number}</p>
        </div>
        {onPrint ? (
          <button
            type="button"
            onClick={onPrint}
            className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] text-muted hover:text-text"
          >
            <Printer className="h-3.5 w-3.5" />
            {t('พิมพ์', 'Print')}
          </button>
        ) : null}
      </div>
      <div className="px-5 py-4 font-sans">
        <div className="text-center">
          <p className="text-[15px] font-semibold tracking-[0.08em]">{receipt.business?.name}</p>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">{receipt.business?.address}</p>
          <p className="text-[10.5px] text-muted">
            {receipt.business?.phone}
            {receipt.business?.taxId ? ` · ${t('เลขภาษี', 'Tax ID')} ${receipt.business.taxId}` : ''}
          </p>
          {receipt.store?.name ? <p className="mt-1 text-[10.5px] text-muted">{receipt.store.name}</p> : null}
          {receipt.reprint ? (
            <p className="mt-1 inline-block border border-line px-1.5 py-0.5 text-[9px]">
              {t('พิมพ์ซ้ำ', 'REPRINT')}
            </p>
          ) : null}
          {isRefund ? (
            <p className="mt-2 text-[12px] font-semibold">{t('ใบรับคืนสินค้า', 'REFUND')}</p>
          ) : null}
        </div>
        <div className="mt-3 space-y-1 border-y border-dashed border-line py-2 text-[10.5px]">
          <div className="flex justify-between">
            <span className="text-muted">{t('วันที่', 'Date')}</span>
            <span>{dateTime(receipt.issuedAt ?? new Date())}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">{t('พนักงาน', 'Cashier')}</span>
            <span>{receipt.cashier}</span>
          </div>
          {receipt.customer ? (
            <div className="flex justify-between">
              <span className="text-muted">{t('ลูกค้า', 'Customer')}</span>
              <span>{receipt.customer.name}</span>
            </div>
          ) : null}
          {receipt.originalNumber ? (
            <div className="flex justify-between">
              <span className="text-muted">{t('อ้างอิงบิล', 'Original')}</span>
              <span>{receipt.originalNumber}</span>
            </div>
          ) : null}
        </div>
        <div className="mt-2">
          {items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex items-start justify-between gap-3 py-1 text-[11px]">
              <div className="min-w-0">
                <p className="truncate">{item.name}</p>
                <p className="text-[9.5px] text-faint">
                  {item.qty} × {money((item.unitPriceSatang ?? item.totalSatang ?? 0) / (item.qty || 1))}
                  {item.sku ? ` · ${item.sku}` : ''}
                </p>
              </div>
              <span className="num shrink-0">{money(item.totalSatang ?? item.amountSatang ?? 0)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-1 border-t border-dashed border-line pt-2 text-[11px]">
          <div className="flex justify-between">
            <span className="text-muted">{t('ยอดรวมสินค้า', 'Subtotal')}</span>
            <span className="num">{money(receipt.subtotalSatang ?? receipt.totalSatang)}</span>
          </div>
          {Number(receipt.discountSatang ?? 0) > 0 ? (
            <div className="flex justify-between">
              <span className="text-muted">{t('ส่วนลด', 'Discount')}</span>
              <span className="num">-{money(receipt.discountSatang)}</span>
            </div>
          ) : null}
          {(receipt.appliedPromotions ?? []).map((promo) => (
            <div key={promo.name} className="flex justify-between text-jade">
              <span className="truncate">{promo.name}</span>
              <span className="num">-{money(promo.amountSatang)}</span>
            </div>
          ))}
          <div className="flex justify-between">
            <span className="text-muted">
              {t('ภาษีมูลค่าเพิ่ม', 'VAT')} {((receipt.vatRateBp ?? 700) / 100).toFixed(0)}%
              {receipt.pricesIncludeTax === false ? '' : ` (${t('รวม', 'included')})`}
            </span>
            <span className="num">{money(receipt.taxSatang ?? 0)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-line pt-2 text-[15px] font-semibold">
            <span>{t('ยอดสุทธิ', 'Total')}</span>
            <span className="num">{money(receipt.totalSatang)}</span>
          </div>
          {(receipt.payments ?? []).map((payment, index) => (
            <div key={index} className="flex justify-between text-[10.5px] text-muted">
              <span>
                {payment.methodName ?? payment.method}
                {payment.reference ? ` · ${payment.reference}` : ''}
              </span>
              <span className="num">{money(payment.amountSatang)}</span>
            </div>
          ))}
          {Number(receipt.changeSatang ?? 0) > 0 ? (
            <div className="flex justify-between text-[12px] font-semibold">
              <span>{t('เงินทอน', 'Change')}</span>
              <span className="num">{money(receipt.changeSatang)}</span>
            </div>
          ) : null}
          {receipt.reason ? (
            <p className="pt-1 text-[10px] text-muted">{t('เหตุผล', 'Reason')}: {receipt.reason}</p>
          ) : null}
        </div>
        <p className="mt-4 text-center text-[9.5px] leading-relaxed text-faint">
          {receipt.footer ?? t('ขอบคุณที่ใช้บริการ', 'Thank you')}
          <br />
          NEXORA POS · {receipt.businessDate}
        </p>
      </div>
    </div>
  );
}
