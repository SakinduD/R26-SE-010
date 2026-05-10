import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * TextInput — labelled text input using prototype .input + .field classes.
 *
 * Props:
 *   label   — optional label text (rendered above the input)
 *   helper  — optional helper caption (rendered below)
 *   error   — string; when set, switches input into error state
 *   success — boolean; when true, switches input into success state
 *   id, name — passed through; id auto-derived from name
 *   leading — optional node rendered inside input on the left
 *   trailing — optional node rendered inside input on the right
 */
const TextInput = forwardRef(function TextInput(
  {
    label,
    helper,
    error,
    success = false,
    leading,
    trailing,
    type = 'text',
    id,
    className,
    inputClassName,
    ...rest
  },
  ref,
) {
  const inputId = id || rest.name;
  const hasError = Boolean(error);

  return (
    <div className={cn('field', className)}>
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label}
        </label>
      )}
      <div style={{ position: 'relative' }}>
        {leading && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-tertiary)',
              pointerEvents: 'none',
            }}
          >
            {leading}
          </span>
        )}
        <input
          id={inputId}
          ref={ref}
          type={type}
          data-error={hasError || undefined}
          data-success={success || undefined}
          aria-invalid={hasError || undefined}
          className={cn('input', inputClassName)}
          style={{
            paddingLeft: leading ? 36 : undefined,
            paddingRight: trailing ? 36 : undefined,
          }}
          {...rest}
        />
        {trailing && (
          <span
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {trailing}
          </span>
        )}
      </div>
      {hasError ? (
        <span role="alert" className="field-error">
          {error}
        </span>
      ) : helper ? (
        <span className="field-helper">{helper}</span>
      ) : null}
    </div>
  );
});

export default TextInput;
export { TextInput };
