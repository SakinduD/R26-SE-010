import { useRef } from 'react'
import gsap from 'gsap'
import { Sparkles, Shield, Award } from 'lucide-react'
import { useGsapScope } from './useGsapScope'
import { scoreStatus } from './feedbackTheme'

// The hero number for the outcome screen, plus an honest one-line interpretation.
export default function OutcomeHero({ finalTrust, interpretation, icon }) {
  const numRef = useRef(null)
  const status = scoreStatus(finalTrust)

  const scopeRef = useGsapScope(({ instant }) => {
    const el = numRef.current
    if (!el || finalTrust == null) return
    if (instant) { el.textContent = String(finalTrust); return }
    const obj = { v: 0 }
    gsap.to(obj, {
      v: finalTrust,
      duration: 1,
      ease: 'power2.out',
      onUpdate: () => { el.textContent = String(Math.round(obj.v)) },
    })
  }, [finalTrust])

  return (
    <div className="oh-wrap" ref={(el) => { scopeRef.current = el }}>
      <div className="oh-hero-card">
        <div className="oh-left">
          <div className="oh-metric-header">
            <span className="oh-label">Final Trust Score</span>
            <span className={`oh-status ${status.tone}`}>{status.label}</span>
          </div>
          <div className="oh-hero">
            <span className="oh-num" ref={numRef}>{finalTrust ?? '—'}</span>
            <span className="oh-unit">/ 100</span>
          </div>
        </div>

        <div className="oh-right">
          <div className="oh-shield-wrap">
            <Shield size={32} className="text-purple-400" strokeWidth={1.8} />
          </div>
        </div>
      </div>

      {interpretation && (
        <div className="oh-interp-card">
          <div className="oh-interp-header">
            <Sparkles size={14} className="text-purple-400" />
            <span className="oh-interp-title">Performance Summary</span>
          </div>
          <p className="oh-interp">{interpretation}</p>
        </div>
      )}

      <style>{`
        .oh-wrap{ display:flex; flex-direction:column; align-items:stretch; gap:16px; margin-top:14px; width:100%; max-width:840px; }
        .oh-hero-card{
          display:flex; align-items:center; justify-content:space-between;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 24px 28px;
          backdrop-filter: blur(16px);
          box-shadow: var(--card-shadow, 0 16px 40px -12px rgba(0, 0, 0, 0.5));
        }
        .oh-left{ display:flex; flex-direction:column; gap:6px; }
        .oh-metric-header{ display:flex; align-items:center; gap:10px; }
        .oh-label{ font-size:11px; font-weight:750; letter-spacing:.08em; text-transform:uppercase; color:var(--text-med); }
        .oh-status{ font-size:11.5px; font-weight:700; padding:2px 10px; border-radius:100px; text-transform:capitalize; }
        .oh-status.success{ color:var(--success); background:var(--success-glow); border:1px solid rgba(16,185,129,0.25); }
        .oh-status.accent{  color:var(--accent); background:var(--accent-glow); border:1px solid rgba(168,85,247,0.25); }
        .oh-status.warning{ color:var(--warning); background:var(--warning-glow); border:1px solid rgba(245,158,11,0.25); }
        .oh-status.danger{  color:var(--danger); background:var(--danger-glow); border:1px solid rgba(239,68,68,0.25); }
        .oh-status.neutral{ color:var(--text-med); background:var(--surface-hi); border:1px solid var(--border); }

        .oh-hero{ display:flex; align-items:baseline; gap:8px; margin-top:2px; }
        .oh-num{ font-size:58px; font-weight:850; letter-spacing:-0.03em; color:var(--text-hi); font-variant-numeric:tabular-nums; line-height:1; }
        .oh-unit{ font-size:18px; font-weight:600; color:var(--text-low); }

        .oh-shield-wrap{
          width: 64px; height: 64px; border-radius: 18px;
          background: var(--accent-glow);
          border: 1px solid rgba(168, 85, 247, 0.25);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 24px var(--accent-glow);
        }

        .oh-interp-card{
          background: var(--surface);
          border: 1px solid var(--border);
          border-left: 3px solid var(--accent);
          border-radius: 0 14px 14px 0;
          padding: 16px 20px;
          display: flex; flex-direction: column; gap: 6px;
          box-shadow: var(--card-shadow, 0 8px 24px -8px rgba(0,0,0,0.2));
        }
        .oh-interp-header{ display:flex; align-items:center; gap:7px; }
        .oh-interp-title{ font-size:11px; font-weight:750; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); }
        .oh-interp{ font-size:13.5px; line-height:1.6; color:var(--text-hi); margin:0; }
      `}</style>
    </div>
  )
}
