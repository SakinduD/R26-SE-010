import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const SIZE_CLASS = {
  sm: 'icon-btn--sm',
  md: '',
  lg: 'icon-btn--lg',
};

/**
 * IconButton — 32×32 square button using prototype .icon-btn class.
 * `aria-label` is required for accessibility.
 */
const IconButton = forwardRef(function IconButton(
  { size = 'md', className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn('icon-btn', SIZE_CLASS[size], className)}
      style={
        size === 'sm'
          ? { width: 28, height: 28 }
          : size === 'lg'
            ? { width: 36, height: 36 }
            : undefined
      }
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
export { IconButton };
