import React from 'react'
import { motion } from 'framer-motion'
import { MapPin, Flag, Users, Zap, CheckCircle2, AlertTriangle } from 'lucide-react'
import { fadeInUp } from '@/lib/animations'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import AccordionItem from '@/components/ui/AccordionItem'
import CardHeader from './CardHeader'
import { DISPOSITION_LABEL, DISPOSITION_VARIANT, MEDIUM_LABEL, humanise } from './constants'

function Bullets({ items = [], icon: Icon, iconColor = 'var(--accent)' }) {
  if (!items.length) return null
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {items.map((item, i) => (
        <li key={i} className="t-cap" style={{ display: 'flex', gap: 8, lineHeight: 1.55 }}>
          <span style={{ color: iconColor, flexShrink: 0, marginTop: 2 }}>
            {Icon ? <Icon size={12} strokeWidth={1.8} /> : '·'}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function Block({ title, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="t-over" style={{ marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function PressureDots({ level }) {
  if (typeof level !== 'number') return null
  return (
    <span
      style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}
      aria-label={`Pressure level ${level} of 5`}
      title={`Pressure level ${level} of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: n <= level ? 'var(--accent)' : 'var(--border-subtle)',
          }}
        />
      ))}
    </span>
  )
}

/**
 * The "here's what you're walking into" briefing.
 *
 * Reads as prose, not a JSON dump — APM describes what the scenario must
 * contain; RPE writes the actual dialogue, so nothing here is a script.
 */
export default function ScenarioBlueprintCard({ blueprint }) {
  if (!blueprint) return null

  const setting = blueprint.setting ?? {}
  const persona = blueprint.counterpart_persona ?? {}

  return (
    <motion.div variants={fadeInUp}>
      <Card>
        <CardHeader
          icon={MapPin}
          title="What you're walking into"
          right={<PressureDots level={blueprint.pressure_level} />}
        />

        {blueprint.situation_summary && (
          <p className="t-body fg" style={{ lineHeight: 1.65, margin: 0 }}>
            {blueprint.situation_summary}
          </p>
        )}

        <div
          className="t-cap"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            marginTop: 14,
            paddingTop: 14,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {setting.where && <span>📍 {setting.where}</span>}
          {setting.when && <span>{setting.when}</span>}
          {blueprint.medium && <span>{MEDIUM_LABEL[blueprint.medium] ?? humanise(blueprint.medium)}</span>}
        </div>

        {blueprint.learner_objective && (
          <Block title="Your objective">
            <p className="t-body fg" style={{ margin: 0, lineHeight: 1.6 }}>
              {blueprint.learner_objective}
            </p>
          </Block>
        )}

        {blueprint.trigger_event && (
          <Block title="How it starts">
            <p className="t-cap" style={{ margin: 0, lineHeight: 1.6 }}>
              {blueprint.trigger_event}
            </p>
          </Block>
        )}

        {blueprint.stakes && (
          <Block title="What's at stake">
            <p className="t-cap" style={{ margin: 0, lineHeight: 1.6 }}>
              {blueprint.stakes}
            </p>
          </Block>
        )}

        {persona.role && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                padding: 14,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Users size={13} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} />
                <span className="fg" style={{ fontSize: 14, fontWeight: 500 }}>
                  {persona.role}
                </span>
                {persona.disposition && (
                  <Badge
                    size="sm"
                    variant={DISPOSITION_VARIANT[persona.disposition] ?? 'neutral'}
                  >
                    {DISPOSITION_LABEL[persona.disposition] ?? humanise(persona.disposition)}
                  </Badge>
                )}
              </div>

              {persona.communication_style && (
                <p className="t-cap" style={{ margin: '0 0 10px', lineHeight: 1.55 }}>
                  {persona.communication_style}
                </p>
              )}

              {persona.motivations?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div className="t-over" style={{ marginBottom: 6 }}>
                    What drives them
                  </div>
                  <Bullets items={persona.motivations} />
                </div>
              )}

              {persona.likely_objections?.length > 0 && (
                <div>
                  <div className="t-over" style={{ marginBottom: 6 }}>
                    Expect pushback like
                  </div>
                  <Bullets items={persona.likely_objections} iconColor="var(--warning)" />
                </div>
              )}
            </div>
          </div>
        )}

        {blueprint.required_beats?.length > 0 && (
          <Block title="Moments this scenario will contain">
            <Bullets items={blueprint.required_beats} icon={Zap} />
          </Block>
        )}

        {blueprint.success_criteria?.length > 0 && (
          <Block title="What a strong run looks like">
            <Bullets
              items={blueprint.success_criteria}
              icon={CheckCircle2}
              iconColor="var(--success)"
            />
          </Block>
        )}

        {(blueprint.failure_modes?.length > 0 ||
          blueprint.content_constraints?.length > 0) && (
          <div style={{ marginTop: 16 }}>
            {blueprint.failure_modes?.length > 0 && (
              <AccordionItem title="Common ways this goes wrong">
                <Bullets
                  items={blueprint.failure_modes}
                  icon={AlertTriangle}
                  iconColor="var(--warning)"
                />
              </AccordionItem>
            )}
            {blueprint.content_constraints?.length > 0 && (
              <AccordionItem title="Boundaries this scenario respects">
                <Bullets items={blueprint.content_constraints} icon={Flag} />
              </AccordionItem>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  )
}
