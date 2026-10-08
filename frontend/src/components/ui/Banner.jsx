import React, { useState } from 'react';
import { Info, CheckCircle2, AlertTriangle, AlertOctagon, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const VARIANT_META = {
  info:    { className: 'banner-info',    Icon: Info,           color: 'var(--info)' },
  success: { className: 'banner-success', Icon: CheckCircle2,   color: 'var(--success)' },
  warning: { className: 'banner-warning', Icon: AlertTriangle,  color: 'var(--warning)' },
  danger:  { className: 'banner-danger',  Icon: AlertOctagon,   color: 'var(--danger)' },
};

/**
 * Banner — inline status message with semantic icon and 3px left accent stripe.
 *
 * variants: info | success | warning | danger
 */
export default function Banner({
  variant = 'info',
  dismissible = false,
  onDismiss,
  className,
  children,
  ...rest
}) {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  const meta = VARIANT_META[variant] ?? VARIANT_META.info;
  const Icon = meta.Icon;

  const handleDismiss = () => {
    setOpen(false);
    if (onDismiss) onDismiss();
  };

  return (
    <div
      role={variant === 'danger' || variant === 'warning' ? 'alert' : 'status'}
      className={cn('banner', meta.className, className)}
      style={{ borderLeft: `3px solid ${meta.color}` }}
      {...rest}
    >
      <span style={{ color: meta.color, flexShrink: 0, marginTop: 1 }}>
        <Icon size={16} strokeWidth={1.6} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          className="icon-btn"
          style={{ width: 22, height: 22, flexShrink: 0 }}
          aria-label="Dismiss"
        >
          <X size={12} strokeWidth={1.6} />
        </button>
      )}
    </div>
  );
}

export { Banner };
