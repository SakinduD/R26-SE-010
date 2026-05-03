import React from 'react';
import { motion } from 'framer-motion';

/**
 * Sticky progress bar shown during the 44-question flow.
 * Uses role=progressbar for accessibility.
 */
export default function ProgressBar({ current, total }) {
  const pct = Math.round((current / total) * 100);

  return (
    <div className="sticky top-0 z-30 bg-background/90 backdrop-blur-sm border-b border-border/40 px-4 py-3">
      <div className="mx-auto flex max-w-xl items-center gap-3">
        {/* Track */}
        <div
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`Question ${current} of ${total}`}
          className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-violet-500"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>

        {/* Label */}
        <span className="shrink-0 tabular-nums text-xs font-medium text-muted-foreground">
          {current} / {total}
        </span>
      </div>
    </div>
  );
}
