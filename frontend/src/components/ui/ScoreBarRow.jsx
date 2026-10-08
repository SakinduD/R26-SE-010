import React from 'react';
import ScoreBar from './ScoreBar';
import Badge from './Badge';

/**
 * ScoreBarRow — single horizontal row used in OCEAN summary lists.
 * 28 px letter chip + label + score bar + numeric score + optional level badge.
 *
 * Props:
 *   letter    — 1–2 char chip text (e.g. "O", "C")
 *   label     — full trait/skill name
 *   value     — 0..100 score
 *   level     — optional "HIGH" | "MID" | "LOW" string → Badge variant
 *   gradient  — passes through to ScoreBar
 *   color     — passes through to ScoreBar
 */
const LEVEL_VARIANT = {
  HIGH: 'accent',
  MID: 'neutral',
  LOW: 'info',
};

export default function ScoreBarRow({
  letter,
  label,
  value,
  level,
  gradient = false,
  color,
  ...rest
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 110px 1fr 56px auto',
        alignItems: 'center',
        gap: 12,
      }}
      {...rest}
    >
      {letter ? (
        <div className="letter-chip" style={{ width: 28, height: 28, fontSize: 12 }}>
          {letter}
        </div>
      ) : (
        <span style={{ width: 28, height: 28 }} />
      )}
      <div className="fg" style={{ fontSize: 13 }}>{label}</div>
      <ScoreBar value={value} gradient={gradient} color={color} animated={false} />
      <div
        className="score-num fg"
        style={{ textAlign: 'right', fontSize: 14 }}
      >
        {Math.round(Number(value) || 0)}
      </div>
      <div style={{ textAlign: 'right' }}>
        {level ? (
          <Badge variant={LEVEL_VARIANT[level] ?? 'neutral'} size="sm">
            {level}
          </Badge>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

export { ScoreBarRow };
