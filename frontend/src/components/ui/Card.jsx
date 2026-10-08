import React from 'react';
import { cn } from '@/lib/utils';

const VARIANT_CLASS = {
  default: '',
  interactive: 'card-interactive',
  elevated: 'card-elevated',
  accent: 'card-accent',
};

/**
 * Card — uses prototype .card + variant classes.
 *
 * variants: default | interactive | elevated | accent
 */
export default function Card({
  variant = 'default',
  className,
  children,
  ...rest
}) {
  return (
    <div className={cn('card', VARIANT_CLASS[variant], className)} {...rest}>
      {children}
    </div>
  );
}

export { Card };
