import React from 'react';
import { cn } from '@/lib/utils';

/**
 * DistributionStrip — horizontal stacked proportional bar.
 *
 * Props:
 *   segments — [{ label, value, color }]
 *   height   — px height (default 8)
 *   showLegend — whether to render labels below the bar (default true)
 */
export default function DistributionStrip({
  segments = [],
  height = 8,
  showLegend = true,
  className,
  ...rest
}) {
  const total = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0) || 1;

  return (
    <div className={cn(className)} {...rest}>
      <div
        style={{
          display: 'flex',
          height,
          background: 'var(--bg-input)',
          borderRadius: 999,
          overflow: 'hidden',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {segments.map((s, i) => {
          const pct = ((Number(s.value) || 0) / total) * 100;
          const fill = s.color ?? `var(--chart-${(i % 5) + 1})`;
          return (
            <div
              key={s.label ?? i}
              style={{
                width: `${pct}%`,
                background: fill,
                transition: 'width 700ms var(--ease)',
              }}
              title={`${s.label}: ${Math.round(pct)}%`}
            />
          );
        })}
      </div>
      {showLegend && segments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          {segments.map((s, i) => {
            const pct = ((Number(s.value) || 0) / total) * 100;
            const fill = s.color ?? `var(--chart-${(i % 5) + 1})`;
            return (
              <div
                key={`leg-${s.label ?? i}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 2,
                    background: fill,
                    borderRadius: 1,
                  }}
                />
                <span className="t-cap" style={{ color: 'var(--text-secondary)' }}>
                  {s.label} <span className="score-num" style={{ marginLeft: 4 }}>{Math.round(pct)}%</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { DistributionStrip };
