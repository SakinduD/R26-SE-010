import React, { forwardRef, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import TextInput from './TextInput';
import { cn } from '@/lib/utils';

/**
 * PasswordInput — wraps TextInput with a visibility toggle and a 4-segment
 * strength meter beneath the field.
 *
 * Strength scoring (lightweight, client-side only):
 *   length ≥ 8    → +1
 *   length ≥ 12   → +1
 *   has upper+lower→ +1
 *   has digit+symbol → +1
 * Maps 0→empty, 1→danger, 2→warning, 3→warning, 4→success.
 */
function scoreStrength(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (pw.length >= 12) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s += 1;
  return s;
}

const SEGMENT_COLORS = {
  1: 'var(--danger)',
  2: 'var(--warning)',
  3: 'var(--warning)',
  4: 'var(--success)',
};

const PasswordInput = forwardRef(function PasswordInput(
  { value, defaultValue, showStrength = true, className, onChange, ...rest },
  ref,
) {
  const [show, setShow] = useState(false);
  const [internal, setInternal] = useState(defaultValue ?? '');
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  const handleChange = (e) => {
    if (!isControlled) setInternal(e.target.value);
    onChange?.(e);
  };

  const score = useMemo(() => scoreStrength(current ?? ''), [current]);

  return (
    <div className={cn(className)}>
      <TextInput
        ref={ref}
        type={show ? 'text' : 'password'}
        value={isControlled ? value : undefined}
        defaultValue={isControlled ? undefined : defaultValue}
        onChange={handleChange}
        trailing={
          <button
            type="button"
            tabIndex={-1}
            className="icon-btn"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff size={14} strokeWidth={1.6} /> : <Eye size={14} strokeWidth={1.6} />}
          </button>
        }
        {...rest}
      />
      {showStrength && (
        <div
          aria-hidden
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 4,
            marginTop: 6,
          }}
        >
          {[1, 2, 3, 4].map((seg) => (
            <span
              key={seg}
              style={{
                height: 3,
                borderRadius: 2,
                background:
                  seg <= score
                    ? SEGMENT_COLORS[score] ?? 'var(--accent)'
                    : 'var(--bg-elevated)',
                transition: 'background var(--dur-fast) var(--ease)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default PasswordInput;
export { PasswordInput };
