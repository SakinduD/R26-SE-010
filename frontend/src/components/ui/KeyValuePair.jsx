import React from 'react';
import { cn } from '@/lib/utils';

/**
 * KeyValuePair — small label/value display row.
 *
 * Props:
 *   k          — label (rendered as t-cap text-tertiary)
 *   v          — value (rendered as t-body text-primary)
 *   layout     — "row" (default, justify-between) | "col" (vertical)
 *   mono       — when true, value rendered with score-num
 *   className  — extra classes
 */
export default function KeyValuePair({
  k,
  v,
  layout = 'row',
  mono = false,
  className,
  ...rest
}) {
  if (layout === 'col') {
    return (
      <div
        className={cn(className)}
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
        {...rest}
      >
        <span className="t-cap" style={{ color: 'var(--text-tertiary)' }}>
          {k}
        </span>
        <span
          className={mono ? 'score-num fg' : 'fg'}
          style={{ fontSize: 14 }}
        >
          {v}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(className)}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '6px 0',
      }}
      {...rest}
    >
      <span className="t-cap" style={{ color: 'var(--text-tertiary)' }}>
        {k}
      </span>
      <span
        className={mono ? 'score-num fg' : 'fg'}
        style={{ fontSize: 14, textAlign: 'right' }}
      >
        {v}
      </span>
    </div>
  );
}

export { KeyValuePair };
