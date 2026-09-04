// Shared design tokens for the RPE feedback flow (FeedbackDashboard,
// SessionComplete, and everything under components/RPE/feedback/).
//
// This was previously the exact same CSS custom-property block, hand
// copy-pasted into both page files — a color tweak in one place silently
// didn't apply to the other. Both pages now embed this one string once at
// their root (`.rpe-cinema`); every component under feedback/ just reads
// `var(--token)` and never redefines the palette itself.
//
// Deliberately kept as its own bespoke dark-first "cinema" palette rather
// than migrating onto the app-wide Tailwind/OKLCH token system used
// elsewhere (Dashboard, GamifiedProgress, PostSessionReport) — this is the
// light-lavender identity the feedback flow already had, just no longer
// duplicated.
export const FEEDBACK_THEME_VARS = `
  .rpe-cinema{
    --bg:            #0D1117;
    --surface:       #161B22;
    --surface-hi:    #21262D;
    --border:        #30363D;
    --accent:        #7C3AED;
    --accent-glow:   rgba(124,58,237,0.15);
    --success:       #3FB950;
    --success-glow:  rgba(63,185,80,0.15);
    --warning:       #D29922;
    --warning-glow:  rgba(210,153,34,0.15);
    --danger:        #F85149;
    --danger-glow:   rgba(248,81,73,0.15);
    --text-hi:       #F0F6FC;
    --text-med:      #8B949E;
    --text-low:      #484F58;
    --quote-text:      #C9D1D9;
    --header-backdrop: rgba(13,17,23,0.92);
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
  }
  :root[data-theme="light"] .rpe-cinema{
    --bg:            #F5F3FD;
    --surface:       #FFFFFF;
    --surface-hi:    #EFEAFB;
    --border:        #D9CFF5;
    --accent:        #6B3FD6;
    --accent-glow:   rgba(107,63,214,0.12);
    --success:       #1E8E4A;
    --success-glow:  rgba(30,142,74,0.12);
    --warning:       #B4790E;
    --warning-glow:  rgba(180,121,14,0.14);
    --danger:        #D93B32;
    --danger-glow:   rgba(217,59,50,0.12);
    --text-hi:       #241E38;
    --text-med:      #5E5678;
    --text-low:      #8D84A8;
    --quote-text:      #3A3352;
    --header-backdrop: rgba(245,243,253,0.92);
  }
`

// .pill / .btn-c — shared across FeedbackDashboard and SessionComplete
// (previously each page hand-copied its own near-identical version of
// these; a color or padding tweak in one didn't apply to the other). Both
// pages embed this alongside FEEDBACK_THEME_VARS, same pattern.
export const FEEDBACK_COMPONENT_STYLES = `
  .rpe-cinema .pill{ display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:650; padding:4px 11px; border-radius:100px; text-transform:capitalize; flex-shrink:0; }
  .rpe-cinema .pill.success{ color:var(--success); background:var(--success-glow); }
  .rpe-cinema .pill.warning{ color:var(--warning); background:var(--warning-glow); }
  .rpe-cinema .pill.danger{  color:var(--danger);  background:var(--danger-glow); }
  .rpe-cinema .pill.accent{  color:var(--accent);  background:var(--accent-glow); }
  .rpe-cinema .pill.neutral{ color:var(--text-med); background:var(--surface-hi); }

  .rpe-cinema .chip{ font-size:11.5px; font-weight:600; padding:5px 12px; border-radius:100px; text-transform:capitalize; }
  .rpe-cinema .chip.accent{ color:var(--accent); background:var(--accent-glow); }

  .rpe-cinema .btn-c{ display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:650; padding:10px 18px; border-radius:10px; cursor:pointer; border:1px solid transparent; font-family:inherit; transition:filter .2s var(--ease), border-color .2s var(--ease), background .2s var(--ease), transform .15s var(--ease); }
  .rpe-cinema .btn-c.primary{ background:linear-gradient(135deg, var(--accent), #9B6BFF); color:#fff; box-shadow:0 8px 22px var(--accent-glow); }
  .rpe-cinema .btn-c.primary:hover{ filter:brightness(1.08); transform:translateY(-1px); }
  .rpe-cinema .btn-c.secondary{ background:var(--surface-hi); border-color:var(--border); color:var(--text-hi); }
  .rpe-cinema .btn-c.secondary:hover{ border-color:var(--text-med); }
  .rpe-cinema .btn-c.secondary:disabled{ opacity:.4; cursor:default; }
  .rpe-cinema .btn-c.ghost{ background:transparent; color:var(--text-med); }
  .rpe-cinema .btn-c.ghost:hover{ color:var(--text-hi); background:var(--surface-hi); }
`

// Semantic status tone for a 0-100 trust-style score — used anywhere a
// score needs a Needs improvement/On track/Strong/Excellent read, not just
// a bare number. Thresholds match the trust-tone logic already used across
// RPE (getTrustTone in the old SessionComplete).
export function scoreStatus(value, { max = 100 } = {}) {
  if (value == null) return { tone: 'neutral', label: 'Not enough data' }
  const pct = (value / max) * 100
  if (pct >= 80) return { tone: 'success', label: 'Excellent' }
  if (pct >= 60) return { tone: 'accent',  label: 'Strong' }
  if (pct >= 40) return { tone: 'warning', label: 'On track' }
  return { tone: 'danger', label: 'Needs improvement' }
}

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}
