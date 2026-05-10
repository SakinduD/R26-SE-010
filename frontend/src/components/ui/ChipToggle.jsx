import React from 'react';
import { cn } from '@/lib/utils';

/**
 * ChipToggle — pill-shaped toggle button using the prototype .chip class.
 *
 * Props:
 *   active     — boolean (controlled)
 *   onClick    — () => void
 *   icon       — optional leading lucide component
 *   children   — chip label
 *   staticOnly — when true, render as non-interactive (pointer cursor off)
 */
export default function ChipToggle({
  active = false,
  onClick,
  icon: Icon,
  staticOnly = false,
  className,
  children,
  ...rest
}) {
  const Tag = staticOnly ? 'span' : 'button';
  const props = staticOnly
    ? {}
    : {
        type: 'button',
        onClick,
        'aria-pressed': active,
      };

  return (
    <Tag
      className={cn('chip', staticOnly && 'chip-static', className)}
      data-active={active || undefined}
      {...props}
      {...rest}
    >
      {Icon && <Icon size={12} strokeWidth={1.6} />}
      {children}
    </Tag>
  );
}

export { ChipToggle };
