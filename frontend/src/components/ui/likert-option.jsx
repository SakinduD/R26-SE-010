import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Single Likert response button.
 * Rendered inside a role=radiogroup — each button acts as a radio option.
 */
export default function LikertOption({ value, label, selected, onSelect }) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(value)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onSelect(value);
        }
      }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.15 }}
      className={cn(
        // Base
        'relative flex w-full items-center gap-3 rounded-xl border px-4 py-3.5',
        'text-left text-sm font-medium transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        // Idle
        !selected && 'border-border bg-card text-card-foreground hover:border-primary/40 hover:bg-accent/40',
        // Selected — gradient from primary to violet
        selected && [
          'border-transparent text-white shadow-md',
          'bg-gradient-to-r from-primary to-violet-500',
          'ring-2 ring-primary ring-offset-2',
        ],
      )}
    >
      {/* Numeric indicator */}
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums',
          selected
            ? 'bg-white/20 text-white'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {value}
      </span>
      <span className="leading-snug">{label}</span>
    </motion.button>
  );
}
