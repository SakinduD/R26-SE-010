import React, { useEffect, useState } from 'react';

/**
 * RadialScore — circular gauge (0..100).
 *
 * Props:
 *   value     — 0..100 (clamped)
 *   label     — primary label below the score
 *   sub       — small caption below label
 *   size      — px diameter (default 88)
 *   color     — stroke color (default var(--accent))
 *   trackColor — track stroke (default var(--border-subtle))
 */
export default function RadialScore({
  value,
  label,
  sub,
  size = 88,
  color = 'var(--accent)',
  trackColor = 'var(--border-subtle)',
  ...rest
}) {
  const target = Math.max(0, Math.min(100, Number(value) || 0));
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setProgress(target));
    return () => cancelAnimationFrame(id);
  }, [target]);

  const r = (size - 8) / 2; // leave room for stroke
  const c = 2 * Math.PI * r;
  const offset = c - (progress / 100) * c;

  return (
    <div
      className="radial"
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      {...rest}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0,
        }}
      >
        <span
          className="score-num fg"
          style={{ fontSize: size > 100 ? 26 : 22, fontWeight: 500, lineHeight: 1 }}
        >
          {Math.round(target)}
        </span>
        {label && <span className="t-cap" style={{ marginTop: 2 }}>{label}</span>}
      </div>
      {sub && (
        <span className="t-cap" style={{ marginTop: 6, color: 'var(--text-tertiary)' }}>
          {sub}
        </span>
      )}
    </div>
  );
}

export { RadialScore };
