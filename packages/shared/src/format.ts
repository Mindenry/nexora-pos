import { DEFAULT_CURRENCY } from './dates';

/** Format integer satang for display. Presentation only — never feed back into math. */
export function formatMoney(
  satang: number,
  locale: 'th' | 'en' = 'th',
  options: { currency?: string; withSymbol?: boolean; compact?: boolean } = {},
): string {
  const currency = options.currency ?? DEFAULT_CURRENCY;
  const withSymbol = options.withSymbol ?? true;
  const formatter = new Intl.NumberFormat(locale === 'th' ? 'th-TH' : 'en-US', {
    style: withSymbol ? 'currency' : 'decimal',
    currency,
    currencyDisplay: 'narrowSymbol',
    ...(options.compact
      ? { notation: 'compact', maximumFractionDigits: 1, minimumFractionDigits: 0 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  });
  return formatter.format(satang / 100);
}

/** Parse user input into integer satang without float arithmetic. */
export function parseMoneyToSatang(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  const cleaned = input.trim().replace(/[,\s฿]/g, '');
  if (cleaned === '') return null;
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const fracRaw = (match[2] ?? '').padEnd(3, '0');
  const satang = Number(fracRaw.slice(0, 2));
  const third = Number(fracRaw.slice(2, 3));
  return whole * 100 + satang + (third >= 5 ? 1 : 0);
}

export function satangToBahtString(satang: number): string {
  const sign = satang < 0 ? '-' : '';
  const abs = Math.abs(satang);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatQty(qty: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(qty);
}

export function formatDateTime(
  value: string | Date,
  locale: 'th' | 'en' = 'th',
  timeZone = 'Asia/Bangkok',
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export function formatDate(
  value: string | Date,
  locale: 'th' | 'en' = 'th',
  timeZone = 'Asia/Bangkok',
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeZone,
  }).format(date);
}

export function percentLabel(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 0 : 2)}%`;
}
