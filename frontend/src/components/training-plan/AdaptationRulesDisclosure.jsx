import React from 'react'
import { motion } from 'framer-motion'
import { SlidersHorizontal } from 'lucide-react'
import { fadeInUp } from '@/lib/animations'
import Card from '@/components/ui/Card'
import AccordionItem from '@/components/ui/AccordionItem'
import CardHeader from './CardHeader'

function RuleList({ label, items = [] }) {
  if (!items.length) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="t-over" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {items.map((item, i) => (
          <li
            key={i}
            className="t-cap"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.55 }}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Adaptation rules are machine-facing signal expressions, not learner copy —
 * they stay collapsed behind "Technical details" and are handy for demos.
 */
export default function AdaptationRulesDisclosure({ adaptation, generationSources, schemaVersion }) {
  if (!adaptation) return null

  return (
    <motion.div variants={fadeInUp}>
      <Card>
        <CardHeader icon={SlidersHorizontal} title="Technical details" tone="muted" />
        <AccordionItem
          title="Adaptation rules"
          subtitle="How this plan may bend mid-session"
        >
          <div className="t-cap" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            <span>Live nudges: {adaptation.allow_live_nudges ? 'allowed' : 'off'}</span>
            <span>Max difficulty shift: ±{adaptation.max_difficulty_delta}</span>
            <span>
              Strategy: {adaptation.strategy_locked_during_session ? 'locked' : 'adjustable'}
            </span>
          </div>
          <RuleList label="Soften when" items={adaptation.soften_on} />
          <RuleList label="Escalate when" items={adaptation.escalate_on} />
          <RuleList label="Abort when" items={adaptation.abort_conditions} />
        </AccordionItem>

        {(generationSources || schemaVersion) && (
          <AccordionItem title="Generation provenance" subtitle="Where each part came from">
            {schemaVersion && (
              <div className="t-cap" style={{ marginBottom: 8 }}>
                Contract schema version{' '}
                <span style={{ fontFamily: 'var(--font-mono)' }}>{schemaVersion}</span>
              </div>
            )}
            {generationSources && (
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {Object.entries(generationSources).map(([key, value]) => (
                  <li key={key} className="t-cap" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                    {key}: {value}
                  </li>
                ))}
              </ul>
            )}
          </AccordionItem>
        )}
      </Card>
    </motion.div>
  )
}
