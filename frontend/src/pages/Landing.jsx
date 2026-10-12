import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, Brain, Activity, Target, Swords, ScanFace, BarChart3,
  ShieldCheck, LayoutDashboard, Mic, Video, Send, Gauge, MessageSquare, LogOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { fadeInUp, staggerContainer } from '@/lib/animations';
import { useAuth } from '@/lib/auth/context';
import logoMark from '@/assets/brand/logo-mark.png';
import npcPortrait from '@/assets/profileimg/female/female_01.png';

const PREVIEW_INTERVAL_MS = 3000;

// One card per real module in the app, in the order a learner meets them.
const MODULES = [
  {
    icon: Brain,
    title: 'Personality snapshot',
    description: '44 validated Big Five (BFI-44) statements build your OCEAN profile in about five minutes.',
  },
  {
    icon: Activity,
    title: 'Communication baseline',
    description: 'A short warm-up conversation records how you sound and look today, so progress is measured, not guessed.',
  },
  {
    icon: Target,
    title: 'Personalised training plan',
    description: 'Tell it what you want to get better at. The plan is shaped around your goal and your personality.',
  },
  {
    icon: Swords,
    title: 'Practice Lab',
    description: 'Live role-play with an AI character that reacts to what you say: negotiations, conflict, tough feedback.',
  },
  {
    icon: ScanFace,
    title: 'Multimodal analysis',
    description: 'Real-time nudges on tone, pacing, eye contact and expression while the conversation is still happening.',
  },
  {
    icon: BarChart3,
    title: 'Skill twin & analytics',
    description: 'Trends, blind spots and recommendations that build up over sessions into a picture of how you communicate.',
  },
];

const STEPS = [
  ['Survey', 'Build your profile'],
  ['Baseline', 'Record a warm-up'],
  ['Practice', 'Live role-play'],
  ['Insight', 'Review & improve'],
];

const PREVIEW_NUDGES = [
  { tone: 'var(--success)', text: 'Good pace. Keep it steady.' },
  { tone: 'var(--warning)', text: 'Try holding eye contact a little longer.' },
];

function Brand() {
  return (
    <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }} aria-label="EmpowerZ home">
      <div className="sb-mark" style={{ width: 28, height: 28, fontSize: 14 }}>
        <img src={logoMark} alt="" />
      </div>
      <span className="sb-brand-text">EmpowerZ</span>
    </Link>
  );
}

function ArrowLabel({ children }) {
  return (
    <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {children}
      <ArrowRight size={16} strokeWidth={1.8} />
    </span>
  );
}

// Signed-in users only ever see "Go to dashboard"; nothing renders until the
// stored session has been checked, so the guest buttons never flash first.
function HeaderActions({ isLoading, isAuthenticated, user, signOut }) {
  if (isLoading) return <div style={{ height: 36 }} aria-hidden />;
  if (isAuthenticated) {
    const initial = (user?.display_name || user?.email || 'U').charAt(0).toUpperCase();
    // Already on "/", so clearing the user is enough: the page re-renders as the guest view.
    const handleSignOut = async () => {
      await signOut();
      toast.success('Signed out');
    };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="topbar-avatar" title={user?.email} aria-hidden>{initial}</div>
        <button type="button" onClick={handleSignOut} className="btn btn-ghost">
          <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <LogOut size={15} strokeWidth={1.8} />
            <span className="lp-hide-xs">Sign out</span>
          </span>
        </button>
        <Link to="/dashboard" className="btn btn-primary">
          <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <LayoutDashboard size={15} strokeWidth={1.8} />
            Go to dashboard
          </span>
        </Link>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Link to="/signin" className="btn btn-ghost"><span className="btn-label">Sign in</span></Link>
      <Link to="/signup" className="btn btn-primary"><span className="btn-label">Get started</span></Link>
    </div>
  );
}

function HeroActions({ isLoading, isAuthenticated }) {
  if (isLoading) return <div style={{ height: 44 }} aria-hidden />;
  if (isAuthenticated) {
    return (
      <>
        <Link to="/dashboard" className="btn btn-primary btn-lg"><ArrowLabel>Go to dashboard</ArrowLabel></Link>
        <Link to="/roleplay" className="btn btn-secondary btn-lg"><span className="btn-label">Open Practice Lab</span></Link>
      </>
    );
  }
  return (
    <>
      <Link to="/signup" className="btn btn-primary btn-lg"><ArrowLabel>Get started free</ArrowLabel></Link>
      <Link to="/signin" className="btn btn-secondary btn-lg"><span className="btn-label">Sign in</span></Link>
    </>
  );
}

// Static mock of a live session, built from the same pieces the real
// session screens use (webcam-frame, corner brackets, nudges, score bars).
function SessionPreview() {
  return (
    <div className="card card-elevated lp-preview">
      <div className="between" style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <span className="live-pulse t-over" style={{ color: 'var(--text-secondary)' }}>
          <span className="lp-dot" /> Live session
        </span>
        <span className="badge badge-accent">Negotiation</span>
      </div>

      <div className="webcam-frame lp-frame">
        <span className="corner-bracket cb-tl" />
        <span className="corner-bracket cb-tr" />
        <span className="corner-bracket cb-bl" />
        <span className="corner-bracket cb-br" />
        <div className="lp-face">
          <ScanFace size={56} strokeWidth={1} />
        </div>
        <div className="lp-nudges">
          {PREVIEW_NUDGES.map((n) => (
            <div key={n.text} className="lp-nudge">
              <span className="lp-nudge-dot" style={{ background: n.tone }} />
              {n.text}
            </div>
          ))}
        </div>
        <div className="lp-devices">
          <span className="lp-device"><Video size={12} /> Cam</span>
          <span className="lp-device"><Mic size={12} /> Mic</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
        {[['Clarity', 78], ['Confidence', 64]].map(([label, value]) => (
          <div key={label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="t-cap">{label}</span>
              <span className="score-num t-cap" style={{ color: 'var(--text-primary)' }}>{value}</span>
            </div>
            <div className="score-bar">
              <div className="score-bar-fill" style={{ width: `${value}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Static mock of the Practice Lab session screen (RolePlaySessionV2): office
// backdrop, live timer + scenario title, the learner's camera in the corner,
// the NPC centre-stage, their line, the compact TRUST readout and voice dock.
function RolePlayPreview() {
  return (
    <div className="card card-elevated lp-preview">
      <div className="lp-rp-stage">
        <div className="lp-rp-top">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <span className="lp-rp-pill"><span className="lp-rp-live" /> Live · 00:05</span>
            <div className="lp-rp-title">
              <img src={npcPortrait} alt="" className="lp-rp-avatar" />
              <div style={{ minWidth: 0 }}>
                <div className="lp-rp-title-text">Handling a difficult manager</div>
                <div className="lp-rp-sub">manager_pressure · beginner</div>
              </div>
            </div>
          </div>
          <div className="lp-rp-pip">
            <ScanFace size={22} strokeWidth={1.2} />
            <span className="lp-rp-you"><span className="lp-rp-live" style={{ background: 'var(--success)' }} /> You</span>
          </div>
        </div>

        <div className="lp-rp-coach"><span className="lp-rp-live" style={{ background: 'var(--success)' }} /> Live coaching</div>

        <div className="lp-rp-npc-figure" />

        <div className="lp-rp-bottom">
          <div className="lp-rp-state"><span className="lp-rp-live" style={{ background: 'var(--text-tertiary)' }} /> Listening</div>
          <div className="lp-rp-role">Aggressive manager</div>
          <div className="lp-rp-line">“I need that report on my desk by 5pm. No excuses.”</div>
          <div className="lp-rp-trust">Trust <strong>50</strong></div>
        </div>
      </div>

      <div className="lp-rp-dock">
        <span className="lp-rp-mic"><Mic size={13} /></span>
        <span className="lp-rp-wave">{[6, 12, 9, 14, 7, 11, 5].map((h, i) => <i key={i} style={{ height: h }} />)}</span>
        <span className="lp-rp-listening">Listening…</span>
        <span className="lp-rp-send"><Send size={12} /></span>
      </div>
      <div className="lp-rp-links">
        <span><MessageSquare size={11} /> Transcript</span>
        <span><Gauge size={11} /> Signals</span>
        <span>End session</span>
      </div>
    </div>
  );
}

const PREVIEWS = [
  { key: 'live', label: 'Live analysis', Component: SessionPreview },
  { key: 'roleplay', label: 'Practice Lab', Component: RolePlayPreview },
];

// Crossfades between the previews on a timer. Both stay mounted in the same
// grid cell so the card never changes height mid-swap. Pauses on hover and
// doesn't auto-advance for users who prefer reduced motion.
function PreviewRotator() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (paused || reduce) return undefined;
    const id = setInterval(() => setActive((i) => (i + 1) % PREVIEWS.length), PREVIEW_INTERVAL_MS);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="lp-rotator" aria-hidden>
        {PREVIEWS.map(({ key, Component }, i) => (
          <motion.div
            key={key}
            className="lp-rotator-slide"
            initial={false}
            animate={{ opacity: i === active ? 1 : 0, y: i === active ? 0 : 8 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            style={{ pointerEvents: i === active ? 'auto' : 'none' }}
          >
            <Component />
          </motion.div>
        ))}
      </div>
      <div className="lp-rotator-tabs" role="tablist" aria-label="Product previews">
        {PREVIEWS.map(({ key, label }, i) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={i === active}
            className="chip"
            data-active={i === active}
            onClick={() => setActive(i)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  const { user, isAuthenticated, isLoading, signOut } = useAuth();
  const firstName = user?.display_name?.split(' ')[0] || user?.email?.split('@')[0];

  return (
    <div className="lp">
      <style>{LANDING_CSS}</style>

      <header className="lp-header">
        <Brand />
        <HeaderActions isLoading={isLoading} isAuthenticated={isAuthenticated} user={user} signOut={signOut} />
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <motion.div variants={staggerContainer} initial="initial" animate="animate" className="lp-hero-copy">
          <motion.div variants={fadeInUp}>
            {isAuthenticated ? (
              <span className="t-over" style={{ color: 'var(--accent)' }}>Welcome back{firstName ? `, ${firstName}` : ''}</span>
            ) : (
              <span className="t-over" style={{ color: 'var(--accent)' }}>EmpowerZ · Research preview</span>
            )}
          </motion.div>

          <motion.h1 variants={fadeInUp} className="t-display lp-title">
            Train soft skills the way your{' '}
            <span className="lp-gradient-text">mind learns.</span>
          </motion.h1>

          <motion.p variants={fadeInUp} className="t-body-lg lp-lede">
            AI training that gets to know your personality, puts you through live role-play with a virtual
            character, and gives you detailed feedback on how you actually did: voice, expressions, everything.
          </motion.p>

          <motion.div variants={fadeInUp} className="lp-actions">
            <HeroActions isLoading={isLoading} isAuthenticated={isAuthenticated} />
          </motion.div>

          <motion.div variants={fadeInUp} className="lp-trust">
            <span className="chip chip-static"><ShieldCheck size={13} /> Face tracking runs on your device</span>
            <span className="chip chip-static"><Brain size={13} /> Big Five based</span>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
        >
          <PreviewRotator />
        </motion.div>
      </section>

      {/* Modules */}
      <section className="lp-section">
        <div className="lp-section-head">
          <span className="t-over">What's inside</span>
          <h2 className="t-h2" style={{ margin: 0 }}>One loop, from profile to practice to progress</h2>
        </div>
        <motion.div
          variants={staggerContainer}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-60px' }}
          className="grid-3"
        >
          {MODULES.map(({ icon: Icon, title, description }) => (
            <motion.div key={title} variants={fadeInUp} className="card card-interactive lp-module">
              <div className="lp-icon"><Icon size={16} strokeWidth={1.6} /></div>
              <div className="t-h3" style={{ fontSize: 17, marginBottom: 6 }}>{title}</div>
              <p className="t-body" style={{ color: 'var(--text-secondary)', margin: 0 }}>{description}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* How it works */}
      <section className="lp-section">
        <div className="card lp-steps-card">
          <div className="t-over" style={{ marginBottom: 20 }}>How it works</div>
          <ol className="lp-steps">
            {STEPS.map(([label, sub], i) => (
              <li key={label} className="lp-step">
                <div className="score-num lp-step-num">{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <div className="fg" style={{ fontWeight: 500 }}>{label}</div>
                  <div className="t-cap">{sub}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="lp-section" style={{ paddingBottom: 64 }}>
        <div className="card card-accent violet-halo lp-cta">
          <div>
            <h2 className="t-h2" style={{ margin: '0 0 6px' }}>
              {isAuthenticated ? 'Pick up where you left off' : 'Ready for your first conversation?'}
            </h2>
            <p className="t-body" style={{ color: 'var(--text-secondary)', margin: 0 }}>
              {isAuthenticated
                ? 'Your plan, sessions and progress are waiting on your dashboard.'
                : 'Create a free account and start with a five-minute personality snapshot.'}
            </p>
          </div>
          {!isLoading && (
            <Link to={isAuthenticated ? '/dashboard' : '/signup'} className="btn btn-primary btn-lg">
              <ArrowLabel>{isAuthenticated ? 'Go to dashboard' : 'Get started free'}</ArrowLabel>
            </Link>
          )}
        </div>
      </section>

      <footer className="lp-footer">
        <span className="t-cap">EmpowerZ · A SLIIT Research Project · 2026</span>
        <div style={{ display: 'flex', gap: 18 }}>
          <span className="t-cap">Research</span>
          <span className="t-cap">Privacy</span>
          <span className="t-cap">Contact</span>
        </div>
      </footer>
    </div>
  );
}

const LANDING_CSS = `
.lp { position: relative; min-height: 100vh; background: var(--bg-canvas); color: var(--text-primary); overflow-x: hidden; }
.lp::before {
  content: ""; position: absolute; inset: -200px 0 auto 0; height: 720px; pointer-events: none;
  background: radial-gradient(ellipse 60% 50% at 70% 30%, var(--accent-soft), transparent 70%);
}
.lp > * { position: relative; }
.lp-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 24px; max-width: 1180px; margin: 0 auto; }
.lp-hero > * { min-width: 0; }
.lp-hero { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 48px; align-items: center; max-width: 1180px; margin: 0 auto; padding: 56px 24px 48px; }
.lp-hero-copy { display: flex; flex-direction: column; gap: 22px; min-width: 0; }
.lp-title { margin: 0; font-size: clamp(38px, 6vw, 60px); }
.lp-gradient-text { background: var(--gradient-accent); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lp-lede { font-size: 17px; color: var(--text-secondary); max-width: 560px; margin: 0; line-height: 1.6; }
.lp-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.lp-trust { display: flex; gap: 8px; flex-wrap: wrap; }

.lp-preview { padding: 18px; box-shadow: 0 24px 60px -24px var(--accent-muted); }
.lp-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
.lp-frame { display: flex; align-items: center; justify-content: center; }
.lp-face { color: var(--accent); opacity: 0.55; }
.lp-nudges { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; width: max-content; max-width: 86%; }
.lp-nudge { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; font-size: 11px; color: var(--text-primary); background: oklch(0.185 0.018 264 / 0.85); border: 1px solid var(--border-subtle); backdrop-filter: blur(6px); }
.lp-nudge-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.lp-devices { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; }
.lp-device { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 999px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); background: var(--accent-soft); border: 1px solid var(--accent-muted); }

.lp-rotator { display: grid; grid-template-columns: minmax(0, 1fr); }
.lp-rotator-slide { grid-area: 1 / 1; display: flex; min-width: 0; }
.lp-rotator-slide > .card { min-width: 0; }
.lp-rotator-slide > .card { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
.lp-rotator-tabs { display: flex; justify-content: center; gap: 8px; margin-top: 14px; }
/* Practice Lab mock: always the dark immersive look, like the real session screen. */
.lp-rp-stage {
  position: relative; aspect-ratio: 16 / 10; min-height: 230px; border-radius: var(--radius-lg); overflow: hidden;
  border: 1px solid var(--border-subtle); color: #fff; display: flex; flex-direction: column; justify-content: space-between; padding: 10px 12px;
  background:
    linear-gradient(180deg, rgb(10 11 20 / 0.35) 0%, rgb(10 11 20 / 0.15) 40%, rgb(12 13 22 / 0.92) 82%),
    url('/rpe-background/rpe-env-manager-office-sm.webp') center / cover, #14151f;
}
.lp-rp-top { position: relative; z-index: 2; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.lp-rp-pill { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: 10px; background: rgb(0 0 0 / 0.45); border: 1px solid rgb(255 255 255 / 0.08); }
.lp-rp-live { width: 6px; height: 6px; border-radius: 50%; background: var(--success); flex-shrink: 0; }
.lp-rp-title { display: flex; align-items: center; gap: 8px; }
.lp-rp-avatar { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.lp-rp-title-text { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-rp-sub { font-size: 9px; color: rgb(255 255 255 / 0.7); }
.lp-rp-pip { position: relative; width: 84px; aspect-ratio: 4 / 3; flex-shrink: 0; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: rgb(255 255 255 / 0.55); background: linear-gradient(135deg, #3b3a44, #22222b); border: 1px solid rgb(255 255 255 / 0.15); }
.lp-rp-you { position: absolute; left: 5px; bottom: 4px; display: inline-flex; align-items: center; gap: 4px; font-size: 8px; font-weight: 700; text-transform: uppercase; }
.lp-rp-coach { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 2; display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 9px; background: rgb(0 0 0 / 0.45); }
.lp-rp-npc-figure {
  position: absolute; left: 50%; bottom: 33%; transform: translateX(-50%); width: 20%; aspect-ratio: 1 / 1.1; z-index: 1;
  background:
    radial-gradient(circle at 50% 30%, #e6c3a1 0 15%, transparent 15.5%),
    radial-gradient(ellipse 25% 29% at 50% 30%, #b9946b 0 97%, transparent 100%),
    radial-gradient(ellipse 44% 40% at 50% 100%, #e8dfb2 0 97%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent 100%); mask-image: linear-gradient(180deg, #000 70%, transparent 100%);
  filter: drop-shadow(0 8px 20px rgb(0 0 0 / 0.45));
}
.lp-rp-bottom { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center; }
.lp-rp-state { display: inline-flex; align-items: center; gap: 5px; font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase; color: rgb(255 255 255 / 0.75); }
.lp-rp-role { font-size: 8px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgb(255 255 255 / 0.85); }
.lp-rp-line { font-size: 12px; font-weight: 600; }
.lp-rp-trust { font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase; color: rgb(255 255 255 / 0.6); }
.lp-rp-trust strong { font-size: 11px; color: #fff; letter-spacing: 0; margin-left: 3px; }
.lp-rp-dock { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 5px; border-radius: 999px; background: var(--bg-input); border: 1px solid var(--accent-muted); box-shadow: 0 0 0 3px var(--accent-soft); }
.lp-rp-mic, .lp-rp-send { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.lp-rp-mic { background: var(--accent); color: #fff; }
.lp-rp-send { background: var(--bg-elevated); color: var(--text-tertiary); }
.lp-rp-wave { flex: 1; display: flex; align-items: center; justify-content: center; gap: 3px; }
.lp-rp-wave i { width: 3px; border-radius: 2px; background: var(--accent); animation: lp-wave 1.1s ease-in-out infinite; }
.lp-rp-wave i:nth-child(2n) { animation-delay: -0.4s; }
.lp-rp-wave i:nth-child(3n) { animation-delay: -0.75s; }
@keyframes lp-wave { 0%, 100% { transform: scaleY(0.5); } 50% { transform: scaleY(1.15); } }
@media (prefers-reduced-motion: reduce) { .lp-rp-wave i { animation: none; } }
.lp-rp-listening { font-size: 11px; color: var(--accent); }
.lp-rp-links { display: flex; justify-content: center; gap: 16px; margin-top: 8px; font-size: 10px; color: var(--text-tertiary); }
.lp-rp-links span { display: inline-flex; align-items: center; gap: 4px; }

.lp-section { max-width: 1180px; margin: 0 auto; padding: 32px 24px; }
.lp-section-head { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.lp-module { height: 100%; }
.lp-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; color: var(--accent); background: var(--accent-soft); border: 1px solid var(--accent-muted); }

.lp-steps-card { padding: 28px; }
.lp-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.lp-step { display: flex; align-items: center; gap: 12px; padding: 8px 4px; }
.lp-step-num { width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; color: var(--accent); background: var(--bg-input); border: 1px solid var(--border-subtle); }

.lp-cta { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 32px; flex-wrap: wrap; }
.lp-footer { border-top: 1px solid var(--border-subtle); padding: 20px 24px; max-width: 1180px; margin: 0 auto; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }

@media (max-width: 900px) {
  .lp-hero { grid-template-columns: minmax(0, 1fr); gap: 36px; padding-top: 32px; }
  .lp-steps { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 520px) {
  .lp-header, .lp-hero, .lp-section, .lp-footer { padding-left: 16px; padding-right: 16px; }
  .lp-header .topbar-avatar, .lp-hide-xs { display: none; }
  .lp-steps { grid-template-columns: 1fr; }
  .lp-cta { padding: 24px; }
  .lp-actions .btn { flex: 1 1 100%; justify-content: center; }
  .lp-rp-pip { width: 64px; }
  .lp-rp-coach { display: none; }
  .lp-rp-npc-figure { bottom: 40%; width: 18%; }
}
`;
