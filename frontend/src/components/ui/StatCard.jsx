import React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import Card from './Card';
import { cn } from '@/lib/utils';

/**
 * StatCard — small metric tile.
 *
 * Props:
 *   label  — small uppercase eyebrow
 *   value  — primary number (rendered in score-num / mono)
 *   unit   — optional suffix (e.g. "%", "pts")
 *   delta  — optional signed number; rendered with arrow + semantic color
 *   hint   — optional caption below value
 *   mono   — when false, do not apply score-num to the value (default true)
 */
export default function StatCard({
  label,
  value,
  unit,
  delta,
  hint,
  mono = true,
  className,
  ...rest
}) {
  const deltaPositive = typeof delta === 'number' && delta > 0;
  const deltaNegative = typeof delta === 'number' && delta < 0;
  const deltaColor = deltaPositive
    ? 'var(--success)'
    : deltaNegative
      ? 'var(--danger)'
      : 'var(--text-tertiary)';

  return (
    <Card className={cn(className)} style={{ padding: 16 }} {...rest}>
      <div className="t-over" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span
          className={mono ? 'score-num fg' : 'fg'}
          style={{ fontSize: 28, fontWeight: 500, lineHeight: 1, color: 'var(--text-primary)' }}
        >
          {value}
          {unit ? <span style={{ fontSize: 16, marginLeft: 2, color: 'var(--text-tertiary)' }}>{unit}</span> : null}
        </span>
        {typeof delta === 'number' && (
          <span
            className="score-num"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, color: deltaColor }}
          >
            {deltaPositive ? <ArrowUp size={12} strokeWidth={2} /> : null}
            {deltaNegative ? <ArrowDown size={12} strokeWidth={2} /> : null}
            {deltaPositive ? '+' : ''}{delta}
          </span>
        )}
      </div>
      {hint && (
        <div className="t-cap" style={{ marginTop: 8, color: 'var(--text-quaternary)' }}>
          {hint}
        </div>
      )}
    </Card>
  );
}

export { StatCard };
