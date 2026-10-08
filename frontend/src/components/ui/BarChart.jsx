import React, { useId } from 'react';

/**
 * BarChart — vertical SVG bar chart.
 *
 * Props:
 *   data    — [{ label, value }]
 *   height  — px height (default 140)
 *   color   — bar color (default var(--chart-1))
 *   yMax    — optional axis ceiling (default max(data) or 100)
 */
export default function BarChart({
  data = [],
  height = 140,
  color = 'var(--chart-1)',
  yMax,
  className,
  ...rest
}) {
  const id = useId();
  if (!data.length) {
    return <div className={className} style={{ height }} />;
  }

  const W = 320;
  const H = height;
  const padX = 10;
  const padTop = 8;
  const padBottom = 22;
  const innerH = H - padTop - padBottom;
  const innerW = W - padX * 2;
  const ceiling = yMax ?? Math.max(100, ...data.map((d) => d.value ?? 0));
  const slot = innerW / data.length;
  const barW = Math.max(8, Math.min(28, slot - 6));

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label="Bar chart"
      {...rest}
    >
      <line
        x1={padX}
        y1={H - padBottom}
        x2={W - padX}
        y2={H - padBottom}
        stroke="var(--border-subtle)"
        strokeWidth="1"
      />
      {data.map((d, i) => {
        const v = Math.max(0, Math.min(ceiling, d.value ?? 0));
        const h = (v / ceiling) * innerH;
        const x = padX + slot * i + (slot - barW) / 2;
        const y = H - padBottom - h;
        return (
          <g key={`b-${id}-${i}`}>
            <rect
              className="bar-rect"
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={3}
              fill={color}
            />
            <text
              x={x + barW / 2}
              y={H - 6}
              textAnchor="middle"
              fill="var(--text-quaternary)"
              style={{ fontSize: 10 }}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export { BarChart };
