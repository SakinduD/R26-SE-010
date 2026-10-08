import React, { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * AnimatedInput — labelled input used by auth forms.
 * Restyled to use prototype .input + .field classes. Original API preserved:
 *   { label, error, type, className, id, ...inputProps }
 *
 * For password type, an inline eye-toggle icon button switches visibility.
 */
const AnimatedInput = forwardRef(function AnimatedInput(
  { label, error, type = 'text', className, id, ...props },
  ref,
) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;
  const inputId = id || props.name;

  return (
    <div className={cn('field', className)}>
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label}
        </label>
      )}

      <div style={{ position: 'relative' }}>
        <input
          id={inputId}
          ref={ref}
          type={inputType}
          data-error={Boolean(error) || undefined}
          aria-invalid={Boolean(error) || undefined}
          className="input"
          style={isPassword ? { paddingRight: 36 } : undefined}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="icon-btn"
            style={{
              position: 'absolute',
              right: 4,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 30,
              height: 30,
            }}
          >
            {showPassword ? (
              <EyeOff size={14} strokeWidth={1.6} />
            ) : (
              <Eye size={14} strokeWidth={1.6} />
            )}
          </button>
        )}
      </div>

      {error && (
        <span role="alert" className="field-error">
          {error}
        </span>
      )}
    </div>
  );
});

export default AnimatedInput;
