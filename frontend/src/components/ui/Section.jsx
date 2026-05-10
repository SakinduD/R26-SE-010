import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Section — sub-section header used inside a page.
 *
 * Props:
 *   title    — h3 title
 *   sub      — caption below title
 *   right    — slot anchored right (e.g. Refresh button, filters)
 *   icon     — optional lucide icon (rendered before title)
 *   topRule  — when true, draws a top border-subtle divider with extra padding
 */
export default function Section({
  title,
  sub,
  right,
  icon: Icon,
  topRule = false,
  className,
  children,
  gap = 16,
  ...rest
}) {
  return (
    <section
      className={cn(className)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap,
        paddingTop: topRule ? 24 : 0,
        borderTop: topRule ? '1px solid var(--border-subtle)' : 'none',
      }}
      {...rest}
    >
      {(title || right) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0 }}>
            {title && (
              <div className="t-h3" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {Icon && (
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    <Icon size={16} strokeWidth={1.6} />
                  </span>
                )}
                {title}
              </div>
            )}
            {sub && <div className="t-cap">{sub}</div>}
          </div>
          {right && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export { Section };
