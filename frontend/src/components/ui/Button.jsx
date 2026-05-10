import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Button — uses prototype .btn classes from index.css.
 *
 * Variants (prototype): primary | secondary | ghost | danger
 * Sizes:                sm | md | lg
 *
 * Legacy aliases preserved so existing call-sites keep working:
 *   variant="default"     → primary
 *   variant="outline"     → secondary
 *   variant="destructive" → danger
 *   variant="link"        → ghost
 *   size="default"        → md
 *   size="xs"             → sm
 *   size="icon" / "icon-*"→ md (consumer should switch to <IconButton>)
 */

const VARIANT_CLASS = {
  primary: 'btn-primary',
  default: 'btn-primary',
  secondary: 'btn-secondary',
  outline: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  destructive: 'btn-danger',
  link: 'btn-ghost',
};

const SIZE_CLASS = {
  sm: 'btn-sm',
  md: '',
  default: '',
  lg: 'btn-lg',
  xs: 'btn-sm',
  icon: '',
  'icon-xs': 'btn-sm',
  'icon-sm': 'btn-sm',
  'icon-lg': 'btn-lg',
};

const Spinner = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    aria-hidden="true"
    style={{ position: 'absolute' }}
  >
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 12 12"
        to="360 12 12"
        dur="0.9s"
        repeatCount="indefinite"
      />
    </path>
  </svg>
);

export const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref
) {
  const variantClass = VARIANT_CLASS[variant] ?? VARIANT_CLASS.primary;
  const sizeClass = SIZE_CLASS[size] ?? '';
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      className={cn('btn', variantClass, sizeClass, loading && 'btn-loading', className)}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner />}
      <span className="btn-label">{children}</span>
    </button>
  );
});

/**
 * Compatibility shim — some call-sites compose className via
 * `cn(buttonVariants({ variant, size }))`. Returns an empty string so
 * those sites still produce a string output.
 */
export const buttonVariants = () => '';

export default Button;
