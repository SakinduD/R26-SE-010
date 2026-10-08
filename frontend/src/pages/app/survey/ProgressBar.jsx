import React from 'react';
import { motion } from 'framer-motion';

export default function ProgressBar({
  answered,
  total,
  page,
  pageCount,
  pageComplete = [],
  onJump,
}) {
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  const remaining = total - answered;

  return (
    <div className="survey-bar">
      <div className="survey-bar-inner">
        <div className="survey-bar-meta">
          <span className="t-cap">
            Page <span className="score-num fg">{page + 1}</span> of{' '}
            <span className="score-num">{pageCount}</span>
          </span>
          <span className="t-cap">
            <span className="score-num fg">{answered}</span>
            <span className="score-num"> / {total}</span> answered
            {remaining === 0 && ' — all done'}
          </span>
        </div>

        <div
          className="survey-pips"
          role="progressbar"
          aria-valuenow={answered}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`${answered} of ${total} statements answered`}
        >
          {Array.from({ length: pageCount }, (_, i) => {
            const state = pageComplete[i] ? 'done' : i === page ? 'current' : 'todo';
            return (
              <button
                key={i}
                type="button"
                className="survey-pip"
                data-state={state}
                onClick={() => onJump?.(i)}
                aria-label={`Go to page ${i + 1} of ${pageCount}${
                  pageComplete[i] ? ' (complete)' : ''
                }`}
                aria-current={i === page ? 'step' : undefined}
              />
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            aria-hidden
            style={{
              position: 'relative',
              flex: 1,
              height: 2,
              background: 'var(--bg-elevated)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <motion.div
              initial={false}
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
          <span className="t-cap score-num" style={{ flexShrink: 0 }}>
            {pct}%
          </span>
        </div>
      </div>
    </div>
  );
}
