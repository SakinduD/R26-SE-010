import React, { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Accessible input with label, error display, and password toggle.
 * Forwards ref so it works seamlessly with react-hook-form's register().
 */
const AnimatedInput = forwardRef(function AnimatedInput(
  { label, error, type = 'text', className, id, ...props },
  ref
) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;
  const inputId = id || props.name;

  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-foreground"
        >
          {label}
        </label>
      )}

      <div className="relative">
        <input
          id={inputId}
          ref={ref}
          type={inputType}
          className={cn(
            'flex w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground',
            'placeholder:text-muted-foreground/50',
            'transition-all duration-200 outline-none',
            'focus:ring-2 focus:ring-ring/70 focus:border-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-destructive focus:ring-destructive/30',
            isPassword && 'pr-10',
            className
          )}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive leading-snug">
          {error}
        </p>
      )}
    </div>
  );
});

export default AnimatedInput;
