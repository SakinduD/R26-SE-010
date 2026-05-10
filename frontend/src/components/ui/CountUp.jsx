import React, { useEffect, useState } from 'react';

/**
 * CountUp — animates a number from 0 to `to` using requestAnimationFrame
 * with a cubic ease-out curve.
 *
 * Render the number in whatever className is passed (usually score-num).
 */
export default function CountUp({
  to = 0,
  duration = 800,
  decimals = 0,
  suffix = '',
  prefix = '',
  className,
  ...rest
}) {
  const [v, setV] = useState(0);

  useEffect(() => {
    let raf;
    let t0;
    const step = (t) => {
      if (!t0) t0 = t;
      const p = Math.min((t - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(eased * Number(to));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => raf && cancelAnimationFrame(raf);
  }, [to, duration]);

  return (
    <span className={className} {...rest}>
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}

export { CountUp };
