import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * ScoreBar — horizontal fill bar (0..100). Animates width on mount.
 *
 * Props:
 *   value     — number 0..100 (clamped)
 *   gradient  — when true, fill uses --gradient-accent
 *   color     — explicit fill color (overrides default --accent)
 *   animated  — when false, fills instantly (no width transition)
 *   trackBg   — explicit track background
 *   height    — explicit pixel height (defaults to CSS .score-bar height: 6)
 */
export default function ScoreBar({
  value,
  gradient = false,
  color,
  animated = true,
  trackBg,
  height,
  className,
  style,
  ...rest
}) {
  const target = Math.max(0, Math.min(100, Number(value) || 0));
  const [width, setWidth] = useState(animated ? 0 : target);

  useEffect(() => {
    if (!animated) {
      setWidth(target);
      return;
    }
    const id = requestAnimationFrame(() => setWidth(target));
    return () => cancelAnimationFrame(id);
  }, [target, animated]);

  return (
    <div
      className={cn('score-bar', className)}
      style={{
        ...(trackBg ? { background: trackBg } : null),
        ...(typeof height === 'number' ? { height } : null),
        ...style,
      }}
      role="progressbar"
      aria-valuenow={target}
      aria-valuemin={0}
      aria-valuemax={100}
      {...rest}
    >
      <div
        className={cn('score-bar-fill', gradient && 'gradient')}
        style={{
          width: `${width}%`,
          ...(color ? { background: color } : null),
        }}
      />
    </div>
  );
}

export { ScoreBar };
