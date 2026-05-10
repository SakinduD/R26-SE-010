import React, { useId } from 'react';

/**
 * RadarChart — N-axis polygon radar in pure SVG.
 *
 * Props:
 *   data    — [{ label, value }] (value 0..100)
 *   size    — px diameter (default 280)
 *   levels  — number of concentric grid rings (default 4)
 *   dual    — optional second series [{ label, value }] overlapping in success color
 *   color   — primary stroke (default var(--accent))
 */
export default function RadarChart({
  data = [],
  size = 280,
  levels = 4,
  dual,
  color = 'var(--accent)',
  className,
  ...rest
}) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) - 30;
  const id = useId();

  if (!data.length) {
    return <div className={className} style={{ width: size, height: size }} />;
  }

  const angleFor = (i) => (Math.PI * 2 * i) / data.length - Math.PI / 2;

  const point = (val, i) => {
    const r = (Math.max(0, Math.min(100, val)) / 100) * radius;
    return [cx + r * Math.cos(angleFor(i)), cy + r * Math.sin(angleFor(i))];
  };

  const polygonPath = (series) =>
    series.map((s, i) => point(s.value ?? 0, i).join(',')).join(' ');

  // Grid rings
  const rings = [];
  for (let l = 1; l <= levels; l++) {
    const r = (l / levels) * radius;
    const ringPoints = data
      .map((_, i) => [cx + r * Math.cos(angleFor(i)), cy + r * Math.sin(angleFor(i))].join(','))
      .join(' ');
    rings.push(<polygon key={l} points={ringPoints} fill="none" stroke="var(--border-subtle)" strokeWidth="1" />);
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label="Radar chart"
      {...rest}
    >
      {/* concentric grid rings */}
      {rings}

      {/* axis lines */}
      {data.map((d, i) => {
        const [x, y] = point(100, i);
        return (
          <line
            key={`axis-${id}-${i}`}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="var(--border-subtle)"
            strokeWidth="1"
          />
        );
      })}

      {/* dual (background) series */}
      {dual && (
        <polygon
          points={polygonPath(dual)}
          fill="oklch(0.700 0.150 165 / 0.10)"
          stroke="var(--success)"
          strokeWidth="1.5"
        />
      )}

      {/* main series */}
      <polygon
        points={polygonPath(data)}
        fill="var(--accent-soft)"
        stroke={color}
        strokeWidth="1.75"
      />

      {/* axis labels */}
      {data.map((d, i) => {
        const [lx, ly] = point(115, i);
        return (
          <text
            key={`label-${id}-${i}`}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="middle"
            className="t-cap"
            fill="var(--text-tertiary)"
            style={{ fontSize: 11 }}
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

export { RadarChart };
