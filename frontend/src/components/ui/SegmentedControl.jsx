import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * SegmentedControl — pill-style toggle with an animated sliding thumb.
 *
 * Props:
 *   options  — [{ label, value }] | string[]
 *   value    — currently selected value
 *   onChange — (value) => void
 */
export default function SegmentedControl({
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
  const optRefs = useRef({});
  const [thumb, setThumb] = useState({ left: 3, width: 0 });

  const recalc = () => {
    const btn = optRefs.current[value];
    const container = containerRef.current;
    if (!btn || !container) return;
    const cRect = container.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    setThumb({ left: bRect.left - cRect.left, width: bRect.width });
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
    <div
      ref={containerRef}
      className={cn('seg', className)}
      role="tablist"
      {...rest}
    >
      {normalized.map((opt) => (
        <button
          key={opt.value}
          ref={(el) => (optRefs.current[opt.value] = el)}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          data-active={value === opt.value}
          className="seg-opt"
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
      <div className="seg-thumb" style={{ left: thumb.left, width: thumb.width }} />
    </div>
  );
}

export { SegmentedControl };
