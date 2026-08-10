import React from 'react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import {
  DISPOSITION_LABEL,
  DOMAIN_LABEL,
  INTENSITY_LABEL,
  SESSION_LENGTH_LABEL,
  humanise,
} from '../constants'

const INFERRED = (
  <span className="t-cap" style={{ fontStyle: 'italic' }}>
    We'll infer this
  </span>
)

function Row({ label, children }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        padding: '10px 0',
        borderBottom: '1px solid var(--border-subtle)',
        alignItems: 'baseline',
      }}
    >
      <span className="t-cap" style={{ width: 150, flexShrink: 0 }}>
        {label}
      </span>
      <span className="fg" style={{ fontSize: 14, lineHeight: 1.5, minWidth: 0 }}>
        {children}
      </span>
    </div>
  )
}

/** Step 3 — exactly what will be POSTed, then generate. */
export default function StepReview({ values, headingRef }) {
  const skills = values.focus_skills ?? []

  return (
    <Card>
      <h2 ref={headingRef} tabIndex={-1} className="t-h2" style={{ margin: 0, outline: 'none' }}>
        Review and generate
      </h2>
      <p className="t-cap" style={{ marginTop: 6, marginBottom: 18, lineHeight: 1.55 }}>
        Here's what we'll send. Anything marked “we'll infer this” gets filled in from your goal
        and personality profile.
      </p>

      <div
        style={{
          padding: 14,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius)',
          marginBottom: 16,
        }}
      >
        <div className="t-over" style={{ marginBottom: 6 }}>
          Your goal
        </div>
        <p className="t-body fg" style={{ margin: 0, lineHeight: 1.6 }}>
          {values.goal_text}
        </p>
      </div>

      <Row label="Type of conversation">
        {values.domain ? DOMAIN_LABEL[values.domain] ?? humanise(values.domain) : INFERRED}
      </Row>
      <Row label="Setting">{values.workplace_context || INFERRED}</Row>
      <Row label="Your role">{values.learner_role || INFERRED}</Row>
      <Row label="Their role">{values.counterpart_role || INFERRED}</Row>
      <Row label="Their reaction">
        {values.counterpart_disposition
          ? DISPOSITION_LABEL[values.counterpart_disposition]
          : INFERRED}
      </Row>
      <Row label="Intensity">
        {values.intensity_preference ? INTENSITY_LABEL[values.intensity_preference] : INFERRED}
      </Row>
      <Row label="Session length">
        {values.session_length ? SESSION_LENGTH_LABEL[values.session_length] : INFERRED}
      </Row>
      <Row label="Focus skills">
        {skills.length > 0 ? (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
            {skills.map((s) => (
              <Badge key={s} variant="accent">
                {humanise(s)}
              </Badge>
            ))}
          </span>
        ) : (
          INFERRED
        )}
      </Row>
    </Card>
  )
}
