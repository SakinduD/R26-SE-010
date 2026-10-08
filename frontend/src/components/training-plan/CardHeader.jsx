import React from 'react'

/**
 * Shared card header — icon tile + title + optional right slot.
 * Matches the inline pattern already used across TrainingPlan.jsx cards.
 */
export default function CardHeader({ icon: Icon, title, right, tone = 'accent' }) {
  const palette =
    tone === 'muted'
      ? {
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-tertiary)',
        }
      : {
          background: 'var(--accent-soft)',
          border: '1px solid var(--accent-muted)',
          color: 'var(--accent)',
        }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          ...palette,
        }}
      >
        <Icon size={14} strokeWidth={1.8} />
      </div>
      <div className="t-h3" style={{ margin: 0 }}>
        {title}
      </div>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  )
}
