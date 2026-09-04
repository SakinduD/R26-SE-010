import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import TalkingHeadAvatar from '@/components/RPE/TalkingHeadAvatar'
import SceneEnvironmentV2, { EnvironmentDebugPanel } from '@/components/RPE/SceneEnvironmentV2'
import ResponseChoiceCardsV2 from '@/components/RPE/ResponseChoiceCardsV2'
import ContentRequestInputV2 from '@/components/RPE/ContentRequestInputV2'
import SessionTopBar from '@/components/RPE/v2/SessionTopBar'
import NPCDialogue from '@/components/RPE/v2/NPCDialogue'
import ConversationStateIndicatorV2 from '@/components/RPE/v2/ConversationStateIndicatorV2'
import ConversationIntelligenceDebugPanel from '@/components/RPE/v2/ConversationIntelligenceDebugPanel'
import TrustIndicator from '@/components/RPE/v2/TrustIndicator'
import { NPC_AVATAR_OPTIONS } from '@/lib/rpe/npcAvatars'
import '@/pages/RPE/RolePlaySessionV2.css'

const MOCK_INTELLIGENCE = {
  scenarioObjective: 'Deliver the requested report by 5pm with missing data sources, assumptions, and final numbers clearly documented.',
  npcObjective: null,
  phase: 'constraint',
  userIntent: 'assertive_statement',
  communicationQuality: 'accountable',
  relationshipImpact: { trust: 'up', tension: 'down', clarity: 'up' },
  emotionTransition: { from: 'frustrated', to: 'neutral' },
  isRepeatedNpcLine: false,
}

const MOCK_CHOICE_OPTIONS = [
  { label: "I'll send the final report by 3 PM", text: "I'll have the final report over to you by 3 PM today.", quality: 'strong' },
  { label: 'Send a one-page summary first', text: "I can get you a one-page summary in the next hour, full report by end of day.", quality: 'adequate' },
  { label: 'Send the working document', text: "I'll forward the working document now so you can see where things stand.", quality: 'weak' },
]
const MOCK_CONTENT = { prompt: 'Paste the exact paragraph you\'re referring to.', contentType: 'paragraph' }
const MOCK_DIRECT = { prompt: "What's the exact filename?", contentType: 'filename' }

/*
 * EnvironmentPreviewDev — dev-only harness for visually tuning
 * SceneEnvironmentV2 + the avatar composition fix against the real stage
 * CSS (imports RolePlaySessionV2.css directly and reuses its exact
 * `.rps2-*` classes), without needing a logged-in session or a live
 * TalkingHead/rpeService conversation. Not part of the RPE session flow —
 * no session id, no scoring, no backend calls beyond the avatar's own
 * static .glb model.
 *
 * Registered in App.jsx behind `import.meta.env.DEV` only — Vite strips
 * the whole route from a production build, so this never ships.
 */

const SESSION_STATES = ['manual', 'speaking', 'processing', 'choice', 'complete']
const EMOTIONS = ['neutral', 'happy', 'surprised', 'frustrated', 'sad', 'skeptical', 'angry', 'thinking']
const CONVERSATION_STATES = [
  'ready', 'listening', 'transcribing', 'review', 'processing', 'reacting',
  'speaking', 'choice', 'content', 'directInput', 'error',
]
const MOCK_LINE = "Don't waffle. Send the document now."

export default function EnvironmentPreviewDev() {
  const [environmentId, setEnvironmentId] = useState(null)
  const [sessionState, setSessionState] = useState('manual')
  const [npcEmotion, setNpcEmotion] = useState('neutral')
  const [trust, setTrust] = useState(50)
  const [tension, setTension] = useState(0)
  const [avatarIndex, setAvatarIndex] = useState(0)
  const avatar = NPC_AVATAR_OPTIONS[avatarIndex]
  const [interactionPreview, setInteractionPreview] = useState('none')
  const [conversationState, setConversationState] = useState('ready')
  const [trustDirection, setTrustDirection] = useState(null)
  const [submitFailed, setSubmitFailed] = useState(false)
  const [showNudge, setShowNudge] = useState(false)

  return (
    <div className="rps2-root" data-voice-state={sessionState}>
      <SessionTopBar duration="04:32" onBack={() => {}} isFullscreen={false} onToggleFullscreen={() => {}} />

      <div className="rps2-stage" data-tension={tension >= 3 ? 'elevated' : undefined}>
        <SceneEnvironmentV2
          environmentId={environmentId}
          npcEmotion={npcEmotion}
          npcSpeaking={sessionState === 'speaking'}
          trust={trust}
          tension={tension}
          sessionState={sessionState}
        />

        <div className={`rps2-avatar-layer${sessionState === 'speaking' ? ' rps2-speaking' : ''}`}>
          <TalkingHeadAvatar
            className="rps2-avatar-fill"
            avatarUrl={avatar.url}
            avatarBody={avatar.body}
            ttsVoice={avatar.ttsVoice}
          />
        </div>

        <div className="rps2-npc-identity">
          <span className="rps2-npc-photo-fallback">🧑‍💼</span>
          <div className="rps2-npc-text">
            <span className="rps2-scenario-title">The Impossible Client</span>
            <span className="rps2-npc-role">Dismissive Client · Intermediate</span>
          </div>
        </div>

        <EnvironmentDebugPanel value={environmentId} onChange={setEnvironmentId} />
        <ConversationIntelligenceDebugPanel intelligence={MOCK_INTELLIGENCE} />

        {showNudge && (
          <div className="rps2-nudge-stack">
            <div className="rps2-nudge">
              <Sparkles size={13} strokeWidth={2} className="rps2-nudge-sparkle" aria-hidden />
              <span>Take your time! Pauses help gather ideas.</span>
              <button type="button" className="rps2-nudge-dismiss" onClick={() => setShowNudge(false)} aria-label="Dismiss">
                <X size={11} strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rps2-scene-transition">
        <ConversationStateIndicatorV2
          state={conversationState === 'error' ? null : conversationState}
          errorMessage={conversationState === 'error' ? 'Something went wrong sending your response.' : null}
          onRetry={() => setConversationState('ready')}
        />

        <AnimatePresence mode="wait">
          {!['choice', 'content', 'directInput'].includes(conversationState) && (
            <NPCDialogue key={conversationState} text={MOCK_LINE} npcName="Micromanaging Boss" npcEmotion={npcEmotion} />
          )}
        </AnimatePresence>
      </div>

      <div className="rps2-panel">
        <div className="rps2-panel-inner rps2-trust-zone">
          <TrustIndicator value={trust} direction={trustDirection} />
        </div>
      </div>

      {interactionPreview !== 'none' && (
        <div className="rps2-panel">
          <div className="rps2-panel-inner">
            <div className="rps2-choice-zone">
              {interactionPreview === 'choice' && (
                <ResponseChoiceCardsV2 options={MOCK_CHOICE_OPTIONS} onChoose={() => {}} submitFailed={submitFailed} />
              )}
              {interactionPreview === 'content' && (
                <ContentRequestInputV2 prompt={MOCK_CONTENT.prompt} contentType={MOCK_CONTENT.contentType} onSubmit={() => {}} submitFailed={submitFailed} />
              )}
              {interactionPreview === 'direct' && (
                <ContentRequestInputV2 prompt={MOCK_DIRECT.prompt} contentType={MOCK_DIRECT.contentType} onSubmit={() => {}} submitFailed={submitFailed} />
              )}
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          position: 'fixed', bottom: 12, left: 12, zIndex: 100,
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: '12px 14px', borderRadius: 12,
          background: 'rgba(10,11,14,0.85)', border: '1px solid rgba(255,255,255,0.12)',
          color: '#fff', fontSize: 11, fontFamily: 'monospace', width: 260,
        }}
      >
        <strong style={{ fontSize: 10, letterSpacing: '.08em', opacity: 0.6 }}>DEV PREVIEW — SessionState</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {SESSION_STATES.map((s) => (
            <button key={s} onClick={() => setSessionState(s)} style={btn(sessionState === s)}>{s}</button>
          ))}
        </div>
        <strong style={{ fontSize: 10, letterSpacing: '.08em', opacity: 0.6 }}>Interaction (mock)</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {['none', 'choice', 'content', 'direct'].map((k) => (
            <button key={k} onClick={() => setInteractionPreview(k)} style={btn(interactionPreview === k)}>{k}</button>
          ))}
        </div>
        <strong style={{ fontSize: 10, letterSpacing: '.08em', opacity: 0.6 }}>Conversation state</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {CONVERSATION_STATES.map((s) => (
            <button key={s} onClick={() => setConversationState(s)} style={btn(conversationState === s)}>{s}</button>
          ))}
        </div>
        <strong style={{ fontSize: 10, letterSpacing: '.08em', opacity: 0.6 }}>Coaching nudge</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <button onClick={() => setShowNudge((v) => !v)} style={btn(showNudge)}>showNudge: {String(showNudge)}</button>
        </div>
        <strong style={{ fontSize: 10, letterSpacing: '.08em', opacity: 0.6 }}>Simulate submit failure</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <button onClick={() => setSubmitFailed((v) => !v)} style={btn(submitFailed)}>submitFailed: {String(submitFailed)}</button>
        </div>
        <strong style={{ fontSize: 10, letterSpacing: '.08em', opacity: 0.6 }}>Trust direction</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {[null, 'up', 'down', 'flat'].map((d) => (
            <button key={d ?? 'none'} onClick={() => setTrustDirection(d)} style={btn(trustDirection === d)}>{d ?? 'none'}</button>
          ))}
        </div>
        <strong style={{ fontSize: 10, letterSpacing: '.08em', opacity: 0.6 }}>Emotion</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {EMOTIONS.map((e) => (
            <button key={e} onClick={() => setNpcEmotion(e)} style={btn(npcEmotion === e)}>{e}</button>
          ))}
        </div>
        <label>Trust {trust}
          <input type="range" min="0" max="100" value={trust} onChange={(e) => setTrust(+e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>Tension {tension}
          <input type="range" min="0" max="5" value={tension} onChange={(e) => setTension(+e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>Avatar {avatar.label}
          <input type="range" min="0" max={NPC_AVATAR_OPTIONS.length - 1} value={avatarIndex} onChange={(e) => setAvatarIndex(+e.target.value)} style={{ width: '100%' }} />
        </label>
      </div>
    </div>
  )
}

function btn(active) {
  return {
    fontSize: 10.5, padding: '3px 8px', borderRadius: 100, cursor: 'pointer',
    background: active ? '#9B9DFF' : 'rgba(255,255,255,0.08)',
    color: active ? '#0B0C0F' : '#fff',
    border: '1px solid rgba(255,255,255,0.14)',
  }
}
