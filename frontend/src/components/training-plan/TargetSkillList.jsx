import React from 'react'
import ChipToggle from '@/components/ui/ChipToggle'
import { humanise } from './constants'

/**
 * Ranked target-skill chips. The backend returns them highest-priority first,
 * so the first chip is emphasised.
 */
export default function TargetSkillList({ skills = [], label = 'Target skills' }) {
  if (!skills.length) return null

  return (
    <div>
      {label && (
        <div className="t-over" style={{ marginBottom: 8 }}>
          {label}
        </div>
      )}
      <ul
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {skills.map((skill, i) => (
          <li key={skill}>
            <ChipToggle staticOnly active={i === 0}>
              {i === 0 && (
                <span className="t-cap" style={{ fontSize: 10, opacity: 0.75 }}>
                  1st
                </span>
              )}
              {humanise(skill)}
            </ChipToggle>
          </li>
        ))}
      </ul>
    </div>
  )
}
