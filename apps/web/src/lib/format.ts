import { formatDate, formatDateTime, formatMoney, formatNumber, formatQty, percentLabel } from '@nexora/shared';
import { useLang } from './i18n';

export function useFormat() {
  const { locale } = useLang();
  return {
    money: (satang: number | null | undefined, compact = false) =>
      formatMoney(Number(satang ?? 0), locale, { compact }),
    moneyPlain: (satang: number | null | undefined) => formatMoney(Number(satang ?? 0), locale, { withSymbol: false }),
    number: (value: number | null | undefined) => formatNumber(Number(value ?? 0)),
    qty: (value: number | null | undefined) => formatQty(Number(value ?? 0)),
    date: (value: string | Date | null | undefined, timeZone = 'Asia/Bangkok') =>
      value ? formatDate(value, locale, timeZone) : '—',
    dateTime: (value: string | Date | null | undefined, timeZone = 'Asia/Bangkok') =>
      value ? formatDateTime(value, locale, timeZone) : '—',
    percent: percentLabel,
  };
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

export function todayISO(): string {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
}

export function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
