import { useId, useMemo, useState, type ReactNode } from 'react';
import { cn } from './ui';

export function TrendChart({
  data,
  height = 200,
  valueFormat,
  dates,
  className,
}: {
  data: number[];
  height?: number;
  valueFormat: (value: number) => string;
  dates?: string[];
  className?: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const padX = 8;
  const padTop = 14;
  const padBottom = 26;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const max = Math.max(1, ...data);
  const pointCount = Math.max(1, data.length);

  const points = useMemo(
    () =>
      data.map((value, index) => {
        const x = padX + (pointCount === 1 ? innerW / 2 : (index / (pointCount - 1)) * innerW);
        const y = padTop + innerH - (value / max) * innerH;
        return { x, y, value, index };
      }),
    [data, innerH, innerW, max, pointCount],
  );

  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
    let path = `M ${points[0]!.x} ${points[0]!.y}`;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1]!;
      const curr = points[i]!;
      const midX = (prev.x + curr.x) / 2;
      path += ` C ${midX} ${prev.y}, ${midX} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return path;
  }, [points]);

  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? padX} ${padTop + innerH} L ${points[0]?.x ?? padX} ${padTop + innerH} Z`;
  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const hoverPoint = hover != null ? points[hover] : null;

  return (
    <div className={cn('relative w-full', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Sales trend chart"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--jade)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--jade)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines.map((ratio) => {
          const y = padTop + innerH * ratio;
          return (
            <g key={ratio}>
              <line
                x1={padX}
                x2={width - padX}
                y1={y}
                y2={y}
                stroke="var(--line)"
                strokeDasharray="3 5"
                strokeWidth="1"
              />
              <text x={padX} y={y - 4} fontSize="9" fill="var(--faint)" className="num">
                {valueFormat(max * (1 - ratio))}
              </text>
            </g>
          );
        })}
        {points.length > 1 ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
        <path d={linePath} fill="none" stroke="var(--jade)" strokeWidth="2" strokeLinecap="round" />
        {points.map((point) => (
          <g key={point.index}>
            <rect
              x={point.x - innerW / pointCount / 2}
              y={padTop}
              width={Math.max(8, innerW / pointCount)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(point.index)}
            />
            {hover === point.index ? (
              <>
                <line
                  x1={point.x}
                  x2={point.x}
                  y1={padTop}
                  y2={padTop + innerH}
                  stroke="var(--line-strong)"
                  strokeWidth="1"
                />
                <circle cx={point.x} cy={point.y} r="4" fill="var(--surface)" stroke="var(--jade)" strokeWidth="2" />
              </>
            ) : null}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between px-1 text-[10px] text-faint">
        <span>{dates?.[0] ?? ''}</span>
        <span>{dates?.[Math.floor((dates.length - 1) / 2)] ?? ''}</span>
        <span>{dates?.[dates.length - 1] ?? ''}</span>
      </div>
      {hoverPoint ? (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] elevated"
          style={{
            left: `${(hoverPoint.x / width) * 100}%`,
            top: `${Math.max(0, (hoverPoint.y / height) * 100 - 16)}%`,
          }}
        >
          <div className="font-medium text-text">{valueFormat(hoverPoint.value)}</div>
          <div className="text-[10px] text-faint">{dates?.[hoverPoint.index] ?? ''}</div>
        </div>
      ) : null}
    </div>
  );
}

export function BarList({
  items,
  valueFormat,
  emptyLabel = 'No data',
  tone = 'jade',
}: {
  items: Array<{ label: string; value: number; meta?: string }>;
  valueFormat: (value: number) => string;
  emptyLabel?: string;
  tone?: 'jade' | 'amber' | 'info';
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const colors = {
    jade: 'bg-jade',
    amber: 'bg-amber',
    info: 'bg-info',
  };
  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-[12.5px] text-faint">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-3 px-5 pb-5">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-[12.5px] text-text">{item.label}</span>
            <span className="num shrink-0 text-[12px] font-medium text-muted">
              {valueFormat(item.value)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn('h-full rounded-full', colors[tone])}
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </div>
          {item.meta ? <p className="mt-1 text-[10.5px] text-faint">{item.meta}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function Donut({
  segments,
  centerLabel,
  centerValue,
  valueFormat,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  centerLabel: string;
  centerValue: number;
  valueFormat: (value: number) => string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-4 px-5 pb-5 sm:flex-row sm:items-center">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
          {total > 0
            ? segments.map((segment) => {
                const length = (segment.value / total) * circumference;
                const circle = (
                  <circle
                    key={segment.label}
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth="10"
                    strokeDasharray={`${Math.max(0, length - 1.5)} ${circumference}`}
                    strokeDashoffset={-offset}
                    strokeLinecap="butt"
                  />
                );
                offset += length;
                return circle;
              })
            : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wide text-faint">{centerLabel}</span>
          <span className="num text-[15px] font-semibold text-text">{valueFormat(centerValue)}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {segments.length === 0 ? (
          <p className="text-[12px] text-faint">No payments</p>
        ) : (
          segments.map((segment) => (
            <div key={segment.label} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: segment.color }} />
                <span className="truncate text-muted">{segment.label}</span>
              </span>
              <span className="num shrink-0 font-medium text-text">{valueFormat(segment.value)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function Sparkline({
  data,
  className,
  tone = 'jade',
}: {
  data: number[];
  className?: string;
  tone?: 'jade' | 'danger';
}) {
  const width = 120;
  const height = 32;
  const max = Math.max(1, ...data);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = data.length <= 1 ? width / 2 : (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('h-8 w-28', className)} aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={tone === 'jade' ? 'var(--jade)' : 'var(--danger)'}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  icon,
  delta,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  delta?: { value: string; positive?: boolean };
  tone?: 'neutral' | 'jade' | 'amber' | 'danger';
}) {
  const tones = {
    neutral: 'bg-surface-3 text-muted',
    jade: 'bg-jade-soft text-jade',
    amber: 'bg-amber-soft text-amber',
    danger: 'bg-danger-soft text-danger',
  };
  return (
    <div className="rounded-xl border border-line bg-surface p-4 card-shadow">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-faint">{label}</p>
        {icon ? (
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', tones[tone])}>
            {icon}
          </span>
        ) : null}
      </div>
      <p className="num mt-2 text-[26px] font-semibold leading-tight tracking-tight text-text">{value}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
        {delta ? (
          <span
            className={cn(
              'num rounded px-1.5 py-0.5 font-medium',
              delta.positive === false ? 'bg-danger-soft text-danger' : 'bg-jade-soft text-jade',
            )}
          >
            {delta.value}
          </span>
        ) : null}
        {sub ? <span className="truncate">{sub}</span> : null}
      </div>
    </div>
  );
}
