import React from 'react'
import Badge from '@/components/ui/Badge'
import ScoreBar from '@/components/ui/ScoreBar'
import { BAND_VARIANT, humanise } from './constants'

/** Difficulty 1-10 with its band label (beginner / intermediate / advanced). */
export default function DifficultyMeter({ difficulty, band, label = 'Difficulty' }) {
  if (typeof difficulty !== 'number') return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="t-cap">{label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {band && <Badge variant={BAND_VARIANT[band] ?? 'neutral'}>{humanise(band)}</Badge>}
          <span className="score-num fg" style={{ fontSize: 13 }}>
            {difficulty}/10
          </span>
        </span>
      </div>
      <ScoreBar
        value={difficulty * 10}
        gradient
        aria-valuetext={`${difficulty} out of 10${band ? `, ${band}` : ''}`}
        aria-label={label}
      />
    </div>
  )
}
