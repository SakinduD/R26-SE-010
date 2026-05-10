import React, { useId } from 'react';

/**
 * LineChart — small SVG polyline chart.
 *
 * Props:
 *   data       — number[] (single series)
 *   multi      — [{ data, color }] (overrides `data` if provided)
 *   color      — stroke for single series (default var(--chart-1))
 *   height     — px height (default 120)
 *   showDots   — circle marker on each datum (default true)
 *   xLabels    — string[] for x-axis labels
 *   yMin/yMax  — optional axis bounds
 */
export default function LineChart({
  data,
  multi,
  color = 'var(--chart-1)',
  height = 120,
  showDots = true,
  xLabels,
  yMin,
  yMax,
  className,
  ...rest
}) {
  const id = useId();
  const series = multi && multi.length
    ? multi.map((s, i) => ({ data: s.data, color: s.color ?? `var(--chart-${(i % 5) + 1})` }))
    : [{ data: data ?? [], color }];

  const flat = series.flatMap((s) => s.data);
  if (!flat.length) {
    return <div className={className} style={{ height }} />;
  }

  const calcMin = yMin ?? Math.min(...flat);
  const calcMax = yMax ?? Math.max(...flat);
  const range = Math.max(1, calcMax - calcMin);
  const padX = 8;
  const padY = 12;
  const W = 320;
  const H = height;

  const xFor = (i, len) => padX + (i / Math.max(1, len - 1)) * (W - padX * 2);
  const yFor = (v) => H - padY - ((v - calcMin) / range) * (H - padY * 2);

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label="Line chart"
      {...rest}
    >
      {/* baseline grid */}
      <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="var(--border-subtle)" strokeWidth="1" />
      <line x1={padX} y1={padY} x2={W - padX} y2={padY} stroke="var(--border-subtle)" strokeWidth="1" strokeOpacity="0.4" />

      {series.map((s, sIdx) => {
        const points = s.data.map((v, i) => `${xFor(i, s.data.length)},${yFor(v)}`).join(' ');
        return (
          <g key={`s-${id}-${sIdx}`}>
            <polyline
              points={points}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {showDots &&
              s.data.map((v, i) => (
                <circle
                  key={`d-${id}-${sIdx}-${i}`}
                  cx={xFor(i, s.data.length)}
                  cy={yFor(v)}
                  r="2.5"
                  fill={s.color}
                />
              ))}
          </g>
        );
      })}

      {xLabels &&
        xLabels.map((lab, i) => (
          <text
            key={`xl-${id}-${i}`}
            x={xFor(i, xLabels.length)}
            y={H - 1}
            textAnchor="middle"
            fill="var(--text-quaternary)"
            style={{ fontSize: 9 }}
          >
            {lab}
          </text>
        ))}
    </svg>
  );
}

export { LineChart };
