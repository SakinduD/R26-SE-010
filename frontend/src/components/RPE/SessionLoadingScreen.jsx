import { useEffect, useState } from 'react'

/*
 * SessionLoadingScreen.jsx
 * Full-screen takeover shown while the 3D avatar loads underneath it. The
 * avatar (TalkingHeadAvatar) is already mounted and loading in the same
 * frame — this doesn't delay that, it just gives the wait somewhere to look
 * other than a bare spinner, and rotates a few tips while it does.
 */
const TIPS = [
  'Speak naturally. The mic listens for a pause and sends what you said automatically.',
  "Stuck for words? Tap the chat bubble in the corner to read back what's been said, or type instead.",
  'Trust and tension are tracked live, turn by turn. How you respond shapes where the conversation goes.',
  "Acknowledging the other side's point before making yours tends to de-escalate tension fast.",
  "A tense moment won't end the session early. That's your chance to practise recovering, not avoiding it.",
  'A clear, specific ask usually lands better than a vague complaint. Try naming exactly what you need.',
  'Taking a breath before you respond is fine, just like a real conversation.',
]

export default function SessionLoadingScreen({ scenarioTitle, npcRole, visible }) {
  const [tipIndex, setTipIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 1200)
    return () => clearInterval(id)
  }, [])

  return (
    <div className={`rpe-load${visible ? '' : ' rpe-load-hide'}`} aria-hidden={!visible}>
      <div className="rpe-load-inner">
        <div className="rpe-load-ring">
          <div className="rpe-load-ring-arc" />
        </div>

        <p className="rpe-load-eyebrow">Preparing your scenario</p>
        <h1 className="rpe-load-title">{scenarioTitle || 'Loading role-play'}</h1>
        {npcRole && <p className="rpe-load-sub">Getting {npcRole} ready to meet you</p>}

        <div className="rpe-load-tip" key={tipIndex}>
          <span className="rpe-load-tip-label">Tip</span>
          <p>{TIPS[tipIndex]}</p>
        </div>
      </div>

      <style>{`
        .rpe-load{
          --bg:         #0D1117;
          --surface:    #161B22;
          --border:     #30363D;
          --primary:    #4493F8;
          --accent:     #7C3AED;
          --text-hi:    #F0F6FC;
          --text-med:   #8B949E;
          --quote-text: #C9D1D9;

          position:fixed; inset:0; z-index:100;
          display:flex; align-items:center; justify-content:center;
          background:radial-gradient(120% 100% at 50% 0%, rgba(124,58,237,0.10) 0%, transparent 55%), var(--bg);
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
          opacity:1; transition:opacity .45s cubic-bezier(0.22,1,0.36,1), visibility .45s;
        }
        .rpe-load-hide{ opacity:0; visibility:hidden; pointer-events:none; }
        @media (prefers-reduced-motion: reduce){
          .rpe-load *{ animation-duration:0.001ms !important; }
        }

        .rpe-load-inner{ width:min(420px, 88vw); text-align:center; display:flex; flex-direction:column; align-items:center; }

        .rpe-load-ring{ position:relative; width:64px; height:64px; margin-bottom:28px; }
        .rpe-load-ring-arc{
          position:absolute; inset:0; border-radius:50%;
          border:3px solid var(--border); border-top-color:var(--primary);
          animation:rpeLoadSpin 0.9s linear infinite;
        }
        @keyframes rpeLoadSpin{ to{ transform:rotate(360deg); } }

        .rpe-load-eyebrow{
          font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
          color:var(--accent); margin:0 0 10px;
        }
        .rpe-load-title{
          font-size:24px; font-weight:750; letter-spacing:-0.015em; color:var(--text-hi); margin:0 0 6px;
        }
        .rpe-load-sub{ font-size:13.5px; color:var(--text-med); margin:0 0 40px; }

        .rpe-load-tip{
          background:var(--surface); border:1px solid var(--border); border-radius:14px;
          padding:16px 20px; width:100%; text-align:left;
          animation:rpeLoadTipIn .4s cubic-bezier(0.22,1,0.36,1);
        }
        @keyframes rpeLoadTipIn{ from{ opacity:0; transform:translateY(6px); } to{ opacity:1; transform:none; } }
        .rpe-load-tip-label{
          display:block; font-size:10px; font-weight:700; letter-spacing:.12em; text-transform:uppercase;
          color:var(--primary); margin-bottom:6px;
        }
        .rpe-load-tip p{ margin:0; font-size:13.5px; line-height:1.6; color:var(--quote-text); }

        :root[data-theme="light"] .rpe-load{
          --bg:         #F5F3FD;
          --surface:    #FFFFFF;
          --border:     #D9CFF5;
          --primary:    #3D6FE0;
          --accent:     #6B3FD6;
          --text-hi:    #241E38;
          --text-med:   #5E5678;
          --quote-text: #3A3352;
        }
      `}</style>
    </div>
  )
}
