import React from 'react';
import { cn } from '@/lib/utils';

/**
 * LikertOption — single Likert response button.
 *
 * Original API preserved (used by SurveyForm.jsx):
 *   - value      — numeric option (1..5)
 *   - label      — visible label (typically the same number)
 *   - selected   — boolean
 *   - onSelect(value) — click/keypress handler
 *
 * Visual is now driven by .likert-opt class from index.css (prototype style).
 * The component renders as role="radio" inside a parent role="radiogroup".
 */
export default function LikertOption({ value, label, selected, onSelect }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-selected={selected || undefined}
      onClick={() => onSelect?.(value)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onSelect?.(value);
        }
      }}
      className={cn('likert-opt')}
    >
      <span className="score-num">{label ?? value}</span>
    </button>
  );
}
