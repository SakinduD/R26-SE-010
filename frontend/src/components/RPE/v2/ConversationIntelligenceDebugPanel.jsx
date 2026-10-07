// Dev-only readout of conversationIntelligenceV2's state — never rendered
// in production (import.meta.env.DEV is statically false there, so Vite
// drops this whole branch/import from the build). Matches the existing
// EnvironmentDebugPanel pattern (SceneEnvironmentV2.jsx). Deliberately
// plain/unstyled-fancy — this is an inspector, not a feature.
export default function ConversationIntelligenceDebugPanel({ intelligence, interaction }) {
  if (!import.meta.env.DEV || !intelligence) return null

  const memory = intelligence.memory || {}
  const list = (arr) => (arr && arr.length ? arr.join(', ') : '—')

  const rows = [
    ['Scenario objective', intelligence.scenarioObjective || '—'],
    ['NPC objective', intelligence.npcObjective || '—'],
    ['Phase', intelligence.phase || '—'],
    ['User intent', intelligence.userIntent || '—'],
    ['Communication quality', intelligence.communicationQuality || '—'],
    ['Trust direction', intelligence.relationshipImpact.trust || '—'],
    ['Tension direction', intelligence.relationshipImpact.tension || '—'],
    ['Clarity direction', intelligence.relationshipImpact.clarity || '—'],
    ['Emotion', `${intelligence.emotionTransition.from || '—'} → ${intelligence.emotionTransition.to || '—'}`],
    ['Repeated NPC line?', intelligence.isRepeatedNpcLine ? 'yes' : 'no'],
    ['Unresolved items', list(memory.unresolvedItems)],
    ['Commitments', list(memory.commitments)],
    ['Agreed deadlines', list(memory.agreedDeadlines)],
    ['Requested items', list(memory.requestedItems)],
    ['User constraints', list(memory.userConstraints)],
    ['Recent topics', list(memory.recentTopics)],
    // interactionType/interactionTarget/artifactStatus — resolveInteraction()'s
    // render decision (lib/rpe/interaction.js), surfaced here rather than
    // inferred, so this panel never drifts from what actually renders.
    // artifactStatus is always "—" for now: no backend endpoint computes it
    // yet, and this panel never fabricates one from message text.
    ['Interaction type', interaction?.type || '—'],
    ['Interaction target', interaction?.target || '—'],
    ['Artifact status', interaction?.artifactStatus || '—'],
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
