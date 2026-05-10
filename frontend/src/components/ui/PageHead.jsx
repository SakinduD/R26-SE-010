import React from 'react';
import { cn } from '@/lib/utils';

/**
 * PageHead — top-of-page header used on every app route.
 *
 * Props:
 *   eyebrow — small uppercase label (module name etc.)
 *   title   — main page title
 *   sub     — supporting paragraph
 *   right   — node anchored to the right (filters, action buttons, etc.)
 *   level   — "h1" | "h2" — sets the visual size (default h1)
 */
export default function PageHead({
  eyebrow,
  title,
  sub,
  right,
  level = 'h1',
  className,
  ...rest
}) {
  const titleClass = level === 'h2' ? 't-h2' : 't-h1';

  return (
    <div
      className={cn(className)}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 32,
      }}
      {...rest}
    >
      <div style={{ minWidth: 0 }}>
        {eyebrow && (
          <div className="t-over" style={{ marginBottom: 6 }}>
            {eyebrow}
          </div>
        )}
        <div className={titleClass}>{title}</div>
        {sub && (
          <div
            style={{
              marginTop: 6,
              fontSize: 15,
              color: 'var(--text-secondary)',
              maxWidth: 720,
            }}
          >
            {sub}
          </div>
        )}
      </div>
      {right && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {right}
        </div>
      )}
    </div>
  );
}

export { PageHead };
