import React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * EmptyState — prototype-styled "no data" placeholder.
 *
 * Props:
 *   icon         — lucide component (default: Inbox)
 *   title        — short heading
 *   description  — supporting paragraph
 *   action       — node (usually one or two buttons)
 */
export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  ...rest
}) {
  return (
    <div className={cn('empty', className)} {...rest}>
      <div className="empty-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={1.6} />
      </div>
      {title && <div className="t-h3">{title}</div>}
      {description && (
        <p className="t-body" style={{ color: 'var(--text-secondary)', maxWidth: 420, margin: 0 }}>
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>{action}</div>}
    </div>
  );
}

export { EmptyState };
