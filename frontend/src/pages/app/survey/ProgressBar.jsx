import React from 'react';
import { motion } from 'framer-motion';

/**
 * Sticky progress bar shown during the 44-question flow.
 * Uses role=progressbar for accessibility.
 */
export default function ProgressBar({ current, total }) {
  const pct = Math.round((current / total) * 100);

  return (
    <div
      style={{
        position: 'sticky',
        top: 48, // account for AppLayout topbar
        zIndex: 5,
        background: 'oklch(0.145 0.015 264 / 0.92)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '14px 32px',
      }}
    >
      <div
        style={{
          margin: '0 auto',
          maxWidth: 720,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span className="t-cap">
            <span className="score-num fg">{current}</span> of <span className="score-num">{total}</span>
          </span>
          <span className="t-cap score-num">{pct}% complete</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`Question ${current} of ${total}`}
          style={{
            position: 'relative',
            height: 2,
            background: 'var(--bg-elevated)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              background: 'var(--accent)',
              borderRadius: 2,
            }}
          />
        </div>
      </div>
    </div>
  );
}
