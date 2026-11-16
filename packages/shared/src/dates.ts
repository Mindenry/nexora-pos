export const DEFAULT_TIMEZONE = 'Asia/Bangkok';
export const DEFAULT_CURRENCY = 'THB';

export interface DateRange {
  from: string;
  to: string;
}

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'this_month'
  | 'custom';

export function businessDateOf(instant: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function presetRange(
  preset: DatePreset,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): DateRange {
  const today = businessDateOf(now, timeZone);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'this_month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    default:
      return { from: today, to: today };
  }
}

export function isValidBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10) === value;
}

export function businessDateRangeLabel(range: DateRange, locale: 'th' | 'en' = 'th'): string {
  const fmt = new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const from = fmt.format(new Date(`${range.from}T00:00:00Z`));
  if (range.from === range.to) return from;
  return `${from} – ${fmt.format(new Date(`${range.to}T00:00:00Z`))}`;
}
