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
    --bg:            #080B11;
    --surface:       rgba(255, 255, 255, 0.035);
    --surface-hi:    rgba(255, 255, 255, 0.07);
    --border:        rgba(255, 255, 255, 0.09);
    --accent:        #A855F7;
    --accent-glow:   rgba(168, 85, 247, 0.16);
    --success:       #34D399;
    --success-glow:  rgba(16, 185, 129, 0.16);
    --warning:       #FBBF24;
    --warning-glow:  rgba(245, 158, 11, 0.16);
    --danger:        #F87171;
    --danger-glow:   rgba(239, 68, 68, 0.16);
    --text-hi:       #F8FAFC;
    --text-med:      #94A3B8;
    --text-low:      #64748B;
    --quote-text:    #E2E8F0;
    --header-backdrop: rgba(10, 14, 23, 0.82);
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
  }
  :root[data-theme="light"] .rpe-cinema{
    --bg:            #F8FAFC;
    --surface:       #FFFFFF;
    --surface-hi:    #F1F5F9;
    --border:        #E2E8F0;
    --accent:        #7C3AED;
    --accent-glow:   rgba(124, 58, 237, 0.12);
    --success:       #059669;
    --success-glow:  rgba(5, 150, 105, 0.12);
    --warning:       #D97706;
    --warning-glow:  rgba(217, 119, 6, 0.14);
    --danger:        #DC2626;
    --danger-glow:   rgba(220, 38, 38, 0.12);
    --text-hi:       #0F172A;
    --text-med:      #475569;
    --text-low:      #64748B;
    --quote-text:    #1E293B;
    --header-backdrop: rgba(255, 255, 255, 0.88);
  }
`

// .pill / .btn-c — shared across FeedbackDashboard and SessionComplete
export const FEEDBACK_COMPONENT_STYLES = `
  .rpe-cinema .pill{
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11.5px; font-weight: 700; padding: 5px 12px;
    border-radius: 100px; text-transform: capitalize; flex-shrink: 0;
    border: 1px solid transparent;
  }
  .rpe-cinema .pill.success{ color: var(--success); background: var(--success-glow); border-color: rgba(16, 185, 129, 0.3); }
  .rpe-cinema .pill.warning{ color: var(--warning); background: var(--warning-glow); border-color: rgba(245, 158, 11, 0.3); }
  .rpe-cinema .pill.danger{  color: var(--danger);  background: var(--danger-glow);  border-color: rgba(239, 68, 68, 0.3); }
  .rpe-cinema .pill.accent{  color: var(--accent);  background: var(--accent-glow);  border-color: rgba(168, 85, 247, 0.3); }
  .rpe-cinema .pill.neutral{ color: var(--text-med); background: var(--surface-hi);   border-color: var(--border); }

  .rpe-cinema .chip{
    font-size: 11.5px; font-weight: 650; padding: 5px 14px;
    border-radius: 100px; text-transform: capitalize;
    border: 1px solid transparent;
  }
  .rpe-cinema .chip.accent{ color: var(--accent); background: var(--accent-glow); border-color: rgba(168, 85, 247, 0.3); }

  .rpe-cinema .btn-c{
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 13px; font-weight: 700; padding: 11px 20px;
    border-radius: 12px; cursor: pointer; border: 1px solid transparent;
    font-family: inherit;
    transition: all .2s var(--ease);
  }
  .rpe-cinema .btn-c.primary{
    background: linear-gradient(135deg, #7C3AED 0%, #A855F7 100%);
    color: #FFFFFF;
    box-shadow: 0 8px 24px -4px rgba(124, 58, 237, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.15);
  }
  .rpe-cinema .btn-c.primary:hover{
    filter: brightness(1.1);
    transform: translateY(-1.5px);
    box-shadow: 0 12px 28px -4px rgba(124, 58, 237, 0.6);
  }
  .rpe-cinema .btn-c.secondary{
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.1);
    color: #F8FAFC;
    backdrop-filter: blur(12px);
  }
  .rpe-cinema .btn-c.secondary:hover{
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
    transform: translateY(-1px);
  }
  .rpe-cinema .btn-c.secondary:disabled{ opacity: .35; cursor: default; transform: none; }
  .rpe-cinema .btn-c.ghost{ background: transparent; color: var(--text-med); }
  .rpe-cinema .btn-c.ghost:hover{ color: var(--text-hi); background: var(--surface-hi); }
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
