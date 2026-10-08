import { useRef } from 'react'
import gsap from 'gsap'
import { AlertTriangle, TrendingDown, TrendingUp, Minus, Sparkles, User, Bot } from 'lucide-react'
import { useGsapScope } from './useGsapScope'

const DIRECTION_META = {
  up:   { Icon: TrendingUp,   label: 'Trust went up',        tone: 'success' },
  down: { Icon: TrendingDown, label: 'Trust dropped',        tone: 'danger'  },
  flat: { Icon: Minus,        label: 'Trust held steady',    tone: 'neutral' },
}

const FLAG_META = {
  passive:    { label: 'Read as passive',    tone: 'warning' },
  aggressive: { label: 'Read as aggressive', tone: 'danger'  },
  too_short:  { label: 'Very short reply',   tone: 'neutral' },
  too_long:   { label: 'Ran long',           tone: 'neutral' },
}

function flagMeta(flag) {
  if (FLAG_META[flag]) return FLAG_META[flag]
  if (flag.startsWith('behavior:')) return { label: flag.slice('behavior:'.length).replace(/_/g, ' '), tone: 'accent' }
  return { label: flag.replace(/_/g, ' '), tone: 'neutral' }
}

// Turn detail shown when a TrustJourney node is selected. Every field here
// is real: user_input/npc_response come from the session's own turn log
// (joined onto the feedback data by turn number — see FeedbackDashboard),
// trust/delta come from viz_payload, flags come from turn_metrics. The
// "strongest"/"improvement" narrative only renders on the two turns the
// backend's coaching LLM actually picked — every other turn simply doesn't
// get an invented coaching sentence.
export default function JourneyDetail({
  turnLabel,
  trustValue,
  direction,
  userInput,
  npcResponse,
  flags = [],
  isStrongest,
  strongestNote,
  isImprovement,
  improvementOriginal,
  improvementSuggested,
}) {
  const panelRef = useRef(null)
  const scopeRef = useGsapScope(({ instant }) => {
    if (instant) { gsap.set(panelRef.current, { opacity: 1, y: 0 }); return }
    gsap.fromTo(panelRef.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out' })
  }, [turnLabel])

  const dir = DIRECTION_META[direction] ?? DIRECTION_META.flat

  return (
    <div className="jd-wrap" ref={(el) => { scopeRef.current = el; panelRef.current = el }}>
      <div className="jd-head">
        <span className="jd-turn">{turnLabel === 'Start' ? 'Start of conversation' : `Turn ${turnLabel}`}</span>
        <span className={`jd-delta ${dir.tone}`}>
          <dir.Icon size={13} strokeWidth={2.2} /> {dir.label} · Trust {trustValue}
        </span>
      </div>

      {userInput ? (
        <>
          <div className="jd-convo">
            <div className="jd-bubble-row you">
              <span className="jd-avatar you"><User size={13} strokeWidth={2.2} /></span>
              <div className="jd-bubble you">
                <p className="jd-label">You</p>
                <p className="jd-text">{userInput}</p>
              </div>
            </div>
            {npcResponse && (
              <div className="jd-bubble-row them">
                <span className="jd-avatar them"><Bot size={13} strokeWidth={2.2} /></span>
                <div className="jd-bubble them">
                  <p className="jd-label">Them</p>
                  <p className="jd-text">{npcResponse}</p>
                </div>
              </div>
            )}
          </div>
          {flags.length > 0 && (
            <div className="jd-flags">
              {flags.map((f) => {
                const m = flagMeta(f)
                return <span key={f} className={`jd-flag ${m.tone}`}>{m.label}</span>
              })}
            </div>
          )}
        </>
      ) : (
        <p className="jd-text muted">This is where the conversation began — trust started at {trustValue}.</p>
      )}

      {isStrongest && strongestNote && (
        <div className="jd-callout success">
          <Sparkles size={14} strokeWidth={2} />
          <div>
            <p className="jd-callout-heading">Your strongest moment</p>
            <p className="jd-callout-text">{strongestNote}</p>
          </div>
        </div>
      )}

      {isImprovement && improvementSuggested && (
        <div className="jd-callout warning">
          <AlertTriangle size={14} strokeWidth={2} />
          <div>
            <p className="jd-callout-heading">Worth a second look</p>
            {improvementOriginal && <p className="jd-callout-text muted">Original: "{improvementOriginal}"</p>}
            <p className="jd-callout-text">Try instead: "{improvementSuggested}"</p>
          </div>
        </div>
      )}

      <style>{`
        .jd-wrap{
          margin-top:20px; background:var(--surface); border:1px solid var(--border); border-radius:18px;
          padding:22px 24px 24px; display:flex; flex-direction:column; gap:16px;
          box-shadow:0 12px 32px rgba(17,12,34,0.06);
        }
        .jd-head{
          display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;
          padding-bottom:14px; border-bottom:1px solid var(--border);
        }
        .jd-turn{ font-size:12.5px; font-weight:750; letter-spacing:.03em; color:var(--text-hi); }
        .jd-delta{
          display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:650;
          padding:4px 11px; border-radius:100px;
        }
        .jd-delta.success{ color:var(--success); background:var(--success-glow); }
        .jd-delta.danger{  color:var(--danger);  background:var(--danger-glow); }
        .jd-delta.neutral{ color:var(--text-med); background:var(--surface-hi); }

        .jd-convo{ display:flex; flex-direction:column; gap:10px; }
        .jd-bubble-row{ display:flex; align-items:flex-start; gap:10px; }
        .jd-avatar{
          flex-shrink:0; width:26px; height:26px; border-radius:50%;
          display:flex; align-items:center; justify-content:center; margin-top:2px;
        }
        .jd-avatar.you{ background:var(--accent-glow); color:var(--accent); }
        .jd-avatar.them{ background:var(--surface-hi); color:var(--text-med); }
        .jd-bubble{ flex:1; min-width:0; border-radius:14px; padding:10px 14px; }
        .jd-bubble.you{ background:var(--accent-glow); border:1px solid rgba(124,58,237,0.16); }
        .jd-bubble.them{ background:var(--surface-hi); border:1px solid var(--border); }
        .jd-label{ font-size:9.5px; font-weight:750; letter-spacing:.08em; text-transform:uppercase; color:var(--text-low); margin:0 0 3px; }
        .jd-bubble.you .jd-label{ color:var(--accent); }
        .jd-text{ font-size:13.5px; line-height:1.55; color:var(--text-hi); margin:0; }
        .jd-text.muted{ color:var(--text-med); font-style:italic; }

        .jd-flags{ display:flex; flex-wrap:wrap; gap:6px; }
        .jd-flag{
          font-size:10.5px; font-weight:650; padding:4px 11px; border-radius:100px; text-transform:capitalize;
        }
        .jd-flag.neutral{ background:var(--surface-hi); color:var(--text-med); }
        .jd-flag.warning{ background:var(--warning-glow); color:var(--warning); }
        .jd-flag.danger{  background:var(--danger-glow);  color:var(--danger); }
        .jd-flag.accent{  background:var(--accent-glow);  color:var(--accent); }

        .jd-callout{ display:flex; gap:10px; align-items:flex-start; border-radius:12px; padding:14px 16px; }
        .jd-callout.success{ background:var(--success-glow); color:var(--success); }
        .jd-callout.warning{ background:var(--warning-glow); color:var(--warning); }
        .jd-callout svg{ flex-shrink:0; margin-top:2px; }
        .jd-callout-heading{ font-size:11.5px; font-weight:700; margin:0 0 4px; color:var(--text-hi); }
        .jd-callout-text{ font-size:12.5px; line-height:1.5; margin:0; color:var(--text-hi); }
        .jd-callout-text.muted{ color:var(--text-med); font-style:italic; margin-bottom:4px; }
      `}</style>
    </div>
  )
}
