import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * TabNav — underline-style tab navigation with sliding indicator.
 *
 * Props:
 *   options    — [{ label, value }] or string[]
 *   value      — currently selected value
 *   onChange   — (value) => void
 */
export default function TabNav({
  options = [],
  value,
  onChange,
  className,
  ...rest
}) {
  const normalized = options.map((o) =>
    typeof o === 'string' ? { label: o, value: o } : o,
  );
  const containerRef = useRef(null);
  const buttonRefs = useRef({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const recalc = () => {
    const btn = buttonRefs.current[value];
    const container = containerRef.current;
    if (!btn || !container) return;
    const cRect = container.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    setIndicator({ left: bRect.left - cRect.left, width: bRect.width });
  };

  useLayoutEffect(() => {
    recalc();
  }, [value, normalized.length]);

  useEffect(() => {
    const onResize = () => recalc();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  return (
    <div ref={containerRef} className={cn('tabnav', className)} role="tablist" {...rest}>
      {normalized.map((opt) => (
        <button
          key={opt.value}
          ref={(el) => (buttonRefs.current[opt.value] = el)}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          data-active={value === opt.value}
          className="tabnav-opt"
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
      <div className="tabnav-ind" style={{ left: indicator.left, width: indicator.width }} />
    </div>
  );
}

export { TabNav };
