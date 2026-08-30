/*
 * ResponseChoiceCards.jsx
 * Shown instead of the mic/manual-text input for the one turn where the NPC
 * has just asked the user to hand over something concrete (a document,
 * report, form, evidence) — free-text/voice is a poor fit for describing a
 * document out loud, so the user taps one of 2-3 example replies instead.
 * The chosen option's text is sent through the normal turn pipeline, so the
 * existing trust/escalation/emotion scoring reacts to it exactly like any
 * other message.
 *
 * Every card renders identically regardless of the option's `quality` —
 * that field is bookkeeping only, never a visible hint. The point is the
 * user judges quality themselves, the same as a real handoff.
 */
export default function ResponseChoiceCards({ options, onChoose }) {
  if (!options || options.length === 0) return null

  return (
    <div className="rpe-choice">
      <p className="rpe-choice-prompt">How do you respond?</p>
      <div className="rpe-choice-grid">
        {options.map((option, i) => (
          <button
            key={i}
            type="button"
            className="rpe-choice-card"
            onClick={() => onChoose(option)}
          >
            <span className="rpe-choice-label">{option.label}</span>
            <span className="rpe-choice-text">{option.text}</span>
          </button>
        ))}
      </div>

      <style>{`
        .rpe-choice{
          width:100%; max-width:640px; display:flex; flex-direction:column; align-items:center; gap:12px;
          animation: rpeChoiceIn .35s cubic-bezier(0.22,1,0.36,1);
        }
        @keyframes rpeChoiceIn{ from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:none; } }
        .rpe-choice-prompt{
          margin:0; font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
          color:var(--text-med, #8B949E);
        }
        .rpe-choice-grid{ display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; width:100%; }
        @media (max-width:640px){ .rpe-choice-grid{ grid-template-columns:1fr; } }

        .rpe-choice-card{
          display:flex; flex-direction:column; gap:6px; text-align:left; cursor:pointer;
          background:var(--choice-card-bg, rgba(22,27,34,0.85)); backdrop-filter:blur(4px); border:1px solid var(--border, #30363D);
          border-radius:12px; padding:12px 14px; color:var(--text-hi, #F0F6FC);
          transition:border-color .2s ease, transform .2s ease, background .2s ease;
        }
        .rpe-choice-card:hover, .rpe-choice-card:focus-visible{
          border-color:var(--primary, #4493F8); background:var(--choice-card-hover-bg, rgba(68,147,248,0.1)); transform:translateY(-2px);
          outline:none;
        }
        .rpe-choice-label{ font-size:12.5px; font-weight:700; }
        .rpe-choice-text{ font-size:12px; line-height:1.5; color:var(--text-med, #8B949E); }
      `}</style>
    </div>
  )
}
