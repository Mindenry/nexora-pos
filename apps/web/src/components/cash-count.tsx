import { useEffect, useState } from 'react';
import { Input } from './ui';
import { useLang } from '../lib/i18n';
import { useFormat } from '../lib/format';

const DENOMINATIONS = [
  { value: 100_000, labelTh: '1,000', labelEn: '1,000', kind: 'note' },
  { value: 50_000, labelTh: '500', labelEn: '500', kind: 'note' },
  { value: 10_000, labelTh: '100', labelEn: '100', kind: 'note' },
  { value: 5_000, labelTh: '50', labelEn: '50', kind: 'note' },
  { value: 2_000, labelTh: '20', labelEn: '20', kind: 'note' },
  { value: 1_000, labelTh: '10', labelEn: '10', kind: 'coin' },
  { value: 500, labelTh: '5', labelEn: '5', kind: 'coin' },
  { value: 200, labelTh: '2', labelEn: '2', kind: 'coin' },
  { value: 100, labelTh: '1', labelEn: '1', kind: 'coin' },
  { value: 50, labelTh: '0.50', labelEn: '0.50', kind: 'coin' },
  { value: 25, labelTh: '0.25', labelEn: '0.25', kind: 'coin' },
] as const;

/**
 * Helper for counting a drawer by denomination. It only overrides the parent
 * total once the operator starts entering counts, so the default "expected"
 * number is preserved for a quick close.
 */
export function CashCountHelper({
  expectedSatang,
  onChange,
}: {
  expectedSatang: number;
  onChange: (satang: number) => void;
}) {
  const { t } = useLang();
  const { money } = useFormat();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const total = DENOMINATIONS.reduce(
    (sum, denomination) => sum + denomination.value * (Number(counts[String(denomination.value)] ?? 0) || 0),
    0,
  );

  useEffect(() => {
    if (touched) onChange(total);
  }, [total, touched, onChange]);

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-medium text-text">{t('นับเงินแยกแบงก์/เหรียญ', 'Count by denomination')}</p>
        {touched ? (
          <button
            type="button"
            onClick={() => {
              setCounts({});
              setTouched(false);
              onChange(expectedSatang);
            }}
            className="text-[10px] text-faint hover:text-text"
          >
            {t('ล้าง', 'Clear')}
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        {DENOMINATIONS.map((denomination) => (
          <label key={denomination.value} className="flex items-center gap-1.5">
            <span className="w-12 shrink-0 text-right text-[10.5px] text-muted">
              {t(denomination.labelTh, denomination.labelEn)}
            </span>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={counts[String(denomination.value)] ?? ''}
              onChange={(event) => {
                setTouched(true);
                setCounts((prev) => ({ ...prev, [String(denomination.value)]: event.target.value }));
              }}
              className="h-8 px-2 text-right text-[12px]"
              placeholder="0"
              aria-label={`${t('จำนวน', 'Count')} ${denomination.labelTh}`}
            />
          </label>
        ))}
      </div>
      {touched ? (
        <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[11px]">
          <span className="text-muted">{t('รวมที่นับได้', 'Counted')}</span>
          <span className="num font-medium">{money(total)}</span>
        </div>
      ) : null}
    </div>
  );
}
