// Dev-only readout of conversationIntelligenceV2's state — never rendered
// in production (import.meta.env.DEV is statically false there, so Vite
// drops this whole branch/import from the build). Matches the existing
// EnvironmentDebugPanel pattern (SceneEnvironmentV2.jsx). Deliberately
// plain/unstyled-fancy — this is an inspector, not a feature.
export default function ConversationIntelligenceDebugPanel({ intelligence }) {
  if (!import.meta.env.DEV || !intelligence) return null

  const rows = [
    ['Scenario objective', intelligence.scenarioObjective || '—'],
    ['NPC objective', intelligence.npcObjective || '— (not exposed by backend)'],
    ['Phase', intelligence.phase || '—'],
    ['User intent', intelligence.userIntent || '—'],
    ['Communication quality', intelligence.communicationQuality || '—'],
    ['Trust direction', intelligence.relationshipImpact.trust || '—'],
    ['Tension direction', intelligence.relationshipImpact.tension || '—'],
    ['Clarity direction', intelligence.relationshipImpact.clarity || '—'],
    ['Emotion', `${intelligence.emotionTransition.from || '—'} → ${intelligence.emotionTransition.to || '—'}`],
    ['Repeated NPC line?', intelligence.isRepeatedNpcLine ? 'yes' : 'no'],
  ]

  return (
    <div className="rps2-intel-debug">
      <span className="rps2-intel-debug-title">Conversation intelligence (dev)</span>
      {rows.map(([label, value]) => (
        <div key={label} className="rps2-intel-debug-row">
          <span>{label}</span><span>{String(value)}</span>
        </div>
      ))}
    </div>
  )
}
