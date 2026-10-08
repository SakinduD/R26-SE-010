import React from 'react';
import { cn } from '@/lib/utils';

const VARIANT_CLASS = {
  neutral: '',
  accent: 'badge-accent',
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
};

const SIZE_STYLE = {
  sm: { height: 18, fontSize: 10, padding: '0 6px' },
  md: undefined,
};

/**
 * Badge — uses prototype .badge classes.
 * Soft-tinted background + matching text/border per semantic.
 */
export default function Badge({
  variant = 'neutral',
  size = 'md',
  className,
  children,
  ...rest
}) {
  return (
    <span
      className={cn('badge', VARIANT_CLASS[variant], className)}
      style={SIZE_STYLE[size]}
      {...rest}
    >
      {children}
    </span>
  );
}

export { Badge };
