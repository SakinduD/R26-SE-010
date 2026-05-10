import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * LoadingButton — full-width submit button used by auth forms.
 * Restyled to use the prototype .btn classes. Original API preserved:
 *   { isLoading, children, className, disabled, variant, ...buttonProps }
 *   variant: 'primary' (default) | 'outline'
 */
const VARIANT_CLASS = {
  primary: 'btn-primary',
  outline: 'btn-secondary',
};

export default function LoadingButton({
  isLoading = false,
  children,
  className,
  disabled,
  variant = 'primary',
  type = 'submit',
  ...props
}) {
  const isDisabled = disabled || isLoading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      aria-disabled={isDisabled || undefined}
      className={cn(
        'btn',
        VARIANT_CLASS[variant] ?? VARIANT_CLASS.primary,
        'btn-lg',
        className,
      )}
      style={{ width: '100%' }}
      {...props}
    >
      {isLoading ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />
          <span>Please wait…</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
