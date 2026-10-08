import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Joyride, STATUS } from 'react-joyride';
import { Brain, ArrowRight, CheckCircle2, Clock, ClipboardList, Lock, Mic, Target } from 'lucide-react';
import { useAuth } from '@/lib/auth/context';
import { fadeInUp, staggerContainer } from '@/lib/animations';
import { getMyProfile } from '@/lib/api/survey';
import { getMyBaseline } from '@/lib/api/baseline';
import { rpeService } from '@/services/rpe/rpeService';
import { mcaService } from '@/services/mca/mcaService';
import { TRAIT_META, OCEAN_ORDER } from '@/lib/survey/trait-copy';
import PageHead from '@/components/ui/PageHead';
import Card from '@/components/ui/Card';
import StatCard from '@/components/ui/StatCard';
import EmptyState from '@/components/ui/EmptyState';
import ScoreBarRow from '@/components/ui/ScoreBarRow';
import KeyValuePair from '@/components/ui/KeyValuePair';
import Button from '@/components/ui/Button';
import { useAchievements } from '@/lib/achievements/AchievementsContext';
import { showAchievementToasts } from '@/components/achievements/AchievementToast';
import { joyrideOptions, joyrideStyles } from '@/lib/tour/joyrideTheme';
import { useOnceTour } from '@/lib/tour/useOnceTour';

// First-visit walkthrough of the dashboard — gated by localStorage so it only
// ever runs once per browser. Only starts once isLoading is false (below),
// since every target here is inside the stat row / two main panels that
// don't exist yet during the loading skeleton.
const TOUR_SEEN_KEY = 'ez_tour_dashboard_seen';

const dashboardTourSteps = [
  {
    target: '[data-tour="dash-welcome"]',
    title: 'Your training hub',
    content: "Everything about your progress lives here — your profile, your plan, and quick links back into practice.",
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="dash-stats"]',
    title: 'At a glance',
    content: 'How complete your personality profile is, whether your training plan is active, and how many practice sessions you\'ve logged this week.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="dash-profile"]',
    title: 'Your personality profile',
    content: 'Once you take the assessment, your OCEAN traits show up here — this is what tailors every practice scenario to you specifically.',
    placement: 'right',
  },
  {
    target: '[data-tour="dash-continue"]',
    title: 'Jump back in',
    content: 'Your fastest way back into training, plus the milestones below — assessment, then voice baseline, then multimodal, then role-play. Each one becomes available once the step before it is done, so "Not yet" just means that one\'s next in line.',
    placement: 'left',
  },
]

/** Compact OCEAN summary shown once the user has a profile. */
function OceanSummaryCard({ profile }) {
  const updated = new Date(profile.updated_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return (
    <Card>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <div className="t-over">Personality profile</div>
          <div className="t-cap">Last updated {updated}</div>
        </div>
        <Link
          to="/survey/results"
          className="t-cap"
          style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          View full profile
          <ArrowRight size={12} strokeWidth={1.8} />
        </Link>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {OCEAN_ORDER.map((key) => {
          const { score, level } = profile.scores[key];
          const meta = TRAIT_META[key];
          return (
            <ScoreBarRow
              key={key}
              letter={meta.letter}
              label={meta.label}
              value={score}
              level={level}
              gradient
            />
          );
        })}
      </div>

      <div style={{ marginTop: 18 }}>
        <Link to="/survey" className="t-cap" style={{ color: 'var(--text-tertiary)' }}>
          Retake assessment →
        </Link>
      </div>
    </Card>
  );
}

const LOCKED_ROW = (
  <span style={{ fontSize: 12, color: 'var(--text-quaternary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <Lock size={10} strokeWidth={2} />
    Not yet
  </span>
);

// undefined = loading, null = not taken/not found, object = exists.
// locked = an earlier step in the assessment → baseline → multimodal →
// role-play flow isn't done yet, so this one isn't actionable regardless of
// its own state.
function BaselineStatusRow({ baseline, locked = false }) {
  if (locked) return LOCKED_ROW;
  if (baseline === undefined) {
    return <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>…</span>;
  }
  if (!baseline) {
    return (
      <Link
        to="/baseline/consent"
        style={{ fontSize: 12, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Mic size={10} strokeWidth={2} />
        Start baseline
        <ArrowRight size={10} strokeWidth={2} />
      </Link>
    );
  }
  if (baseline.mca_session_id === 'skipped') {
    return (
      <Link
        to="/baseline"
        style={{ fontSize: 12, color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        Skipped · redo?
        <ArrowRight size={10} strokeWidth={2} />
      </Link>
    );
  }
  return (
    <span style={{ fontSize: 12, color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <CheckCircle2 size={11} strokeWidth={2} />
      Complete
    </span>
  );
}

// state: undefined = loading, false = not done yet, true = done
function MilestoneStatusRow({ state, to, locked = false }) {
  if (locked) return LOCKED_ROW;
  if (state === undefined) {
    return <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>…</span>;
  }
  if (!state) {
    return (
      <Link
        to={to}
        style={{ fontSize: 12, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        Pending
        <ArrowRight size={10} strokeWidth={2} />
      </Link>
    );
  }
  return (
    <span style={{ fontSize: 12, color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <CheckCircle2 size={11} strokeWidth={2} />
      Complete
    </span>
  );
}

/** Same footprint as StatCard (padding:16, label/value/hint stack) so the
 *  real content doesn't jump around once loading resolves. */
function StatCardSkeleton() {
  return (
    <Card style={{ padding: 16 }}>
      <div className="skel" style={{ height: 10, width: 90, marginBottom: 10 }} />
      <div className="skel" style={{ height: 26, width: 60, marginBottom: 10 }} />
      <div className="skel" style={{ height: 10, width: 120 }} />
    </Card>
  );
}

/** Generic loading placeholder for the two main dashboard panels — a title
 *  bar plus a handful of content lines, last one shorter for a natural look. */
function PanelSkeleton({ lines = 4 }) {
  return (
    <Card>
      <div className="skel" style={{ height: 11, width: 140, marginBottom: 18 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skel"
          style={{ height: 14, width: i === lines - 1 ? '55%' : '90%', marginBottom: i === lines - 1 ? 0 : 12 }}
        />
      ))}
    </Card>
  );
}

// Module scope, resets on a full page reload: ensures the achievement toast
// fires at most once per tab even if Dashboard unmounts and remounts (e.g.
// the learner navigates away and back) while the same unseen-badge batch
// (computed once, shared via AchievementsContext) is still current.
let hasShownAchievementToastThisSession = false;

export default function Dashboard() {
  const { user } = useAuth();
  const displayName = user?.display_name || user?.email?.split('@')[0] || 'there';
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = not taken
  const [baseline, setBaseline] = useState(undefined); // undefined = loading, null = none
  const [rpeSessions, setRpeSessions] = useState(undefined); // undefined = loading, [] = none yet
  const [mcaSessions, setMcaSessions] = useState(undefined); // undefined = loading, [] = none yet

  useEffect(() => {
    getMyProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
    getMyBaseline()
      .then(setBaseline)
      .catch(() => setBaseline(null));
    rpeService
      .getMyRpeSessions()
      .then(setRpeSessions)
      .catch(() => setRpeSessions([]));
    mcaService
      .getMySessions()
      .then(setMcaSessions)
      .catch(() => setMcaSessions([]));
  }, []);

  // "First role-play" is done once any role-play session has been started;
  // "Multimodal session" specifically means a completed *live* MCA session
  // (mode "ai" is the baseline chat, already tracked by its own milestone).
  const hasRoleplay =
    rpeSessions === undefined ? undefined : rpeSessions.length > 0;
  const hasMultimodalSession =
    mcaSessions === undefined
      ? undefined
      : mcaSessions.some((s) => s.mode === 'live' && s.status === 'completed');

  const sessionsThisWeek =
    rpeSessions === undefined || mcaSessions === undefined
      ? undefined
      : (() => {
          const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const isThisWeek = (startedAt) =>
            startedAt && new Date(startedAt).getTime() >= weekAgo;
          return (
            rpeSessions.filter((s) => isThisWeek(s.started_at)).length +
            mcaSessions.filter((s) => isThisWeek(s.started_at)).length
          );
        })();

  // Achievement toast — the unseen-badge diff itself is computed once for
  // the whole app shell (AchievementsProvider, shared with the Topbar
  // notification bell); this effect just decides *when* to show it: the
  // first time Dashboard is on screen after that diff becomes available.
  const { unseenBadges } = useAchievements();
  useEffect(() => {
    if (hasShownAchievementToastThisSession || unseenBadges.length === 0) return;
    hasShownAchievementToastThisSession = true;
    showAchievementToasts(unseenBadges);
  }, [unseenBadges]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // Gates the stat row and the two main panels behind a skeleton until every
  // async piece they read has resolved — previously each one rendered its
  // own "…"/"Loading…" placeholder independently, so the page showed a
  // half-populated dashboard for a moment on every load instead of either a
  // clean loading state or the real numbers.
  const isLoading =
    profile === undefined || baseline === undefined || rpeSessions === undefined || mcaSessions === undefined

  // See useOnceTour for how "only once" is actually guaranteed.
  const [runTour, stopTour] = useOnceTour({
    storagePrefix: TOUR_SEEN_KEY,
    email: user?.email,
    ready: !isLoading,
  })

  const handleTourCallback = (data) => {
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(data.status)) {
      stopTour()
    }
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="page page-wide"
    >
      <Joyride
        steps={dashboardTourSteps}
        run={runTour}
        continuous
        showSkipButton
        showProgress
        callback={handleTourCallback}
        options={joyrideOptions}
        styles={joyrideStyles}
      />

      <PageHead
        data-tour="dash-welcome"
        eyebrow={today}
        title={`Welcome back, ${displayName}.`}
        sub="Your training is calibrated to your current profile. Continue where you left off."
      />

      {/* Top stat row */}
      <motion.div variants={fadeInUp} className="grid-3" style={{ marginBottom: 16 }} data-tour="dash-stats">
        {isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="OCEAN Profile"
              value={profile ? '100' : '0'}
              unit="%"
              hint={profile ? 'Complete · BFI-44' : 'Take the assessment'}
            />
            <StatCard
              label="Training Plan"
              value={
                profile ? (
                  'Active'
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Lock size={20} strokeWidth={1.8} />
                    Not yet
                  </span>
                )
              }
              mono={false}
              hint={profile ? 'Generated from profile' : 'Available after the assessment'}
            />
            <StatCard label="Sessions this week" value={sessionsThisWeek} hint="Role-play + multimodal" />
          </>
        )}
      </motion.div>

      {/* Main two-column area */}
      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        {isLoading ? (
          <>
            <PanelSkeleton lines={5} />
            <PanelSkeleton lines={6} />
          </>
        ) : (
          <>
            {/* Profile card or empty state */}
            <div data-tour="dash-profile">
              {profile ? (
                <OceanSummaryCard profile={profile} />
              ) : (
                <Card>
                  <EmptyState
                    icon={ClipboardList}
                    title="Begin assessment to build your training plan"
                    description="44 statements. About 5 minutes. Results power your personalised AI training scenarios."
                    action={
                      <Link to="/survey" className="btn btn-primary btn-lg">
                        <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          Take the assessment
                          <ArrowRight size={14} strokeWidth={1.8} />
                        </span>
                      </Link>
                    }
                  />
                </Card>
              )}
            </div>

            {/* Continue training card */}
            <Card variant="accent" data-tour="dash-continue">
              <div className="t-over" style={{ marginBottom: 8, color: 'var(--accent)' }}>Continue training</div>
              <div className="t-h3" style={{ marginBottom: 4 }}>
                {profile ? 'Start your next session' : 'Profile required'}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>
                {profile
                  ? 'Your training plan is calibrated to your OCEAN profile.'
                  : 'Complete the assessment for personalised practice scenarios.'}
              </p>

              {profile ? (
                <Link to="/training-plan" className="btn btn-primary">
                  <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Target size={14} strokeWidth={1.8} />
                    Open training plan
                  </span>
                </Link>
              ) : (
                <Link to="/survey" className="btn btn-primary">
                  <span className="btn-label">Begin assessment</span>
                </Link>
              )}

              <div className="divider" style={{ margin: '20px 0 14px' }} />
              <div className="t-over" style={{ marginBottom: 8 }}>Next milestones</div>
              {/* This mirrors the system's actual required order — assessment
                  → voice baseline → multimodal → role-play — so each row only
                  ever unlocks once everything before it is genuinely done,
                  rather than showing every unstarted step as a bare "—". */}
              <KeyValuePair
                k="Voice baseline"
                v={<BaselineStatusRow baseline={baseline} locked={!profile} />}
              />
              <KeyValuePair
                k="Multimodal session"
                v={<MilestoneStatusRow state={hasMultimodalSession} to="/multimodal-analysis" locked={!profile || !baseline} />}
              />
              <KeyValuePair
                k="First role-play"
                v={<MilestoneStatusRow state={hasRoleplay} to="/roleplay" locked={!profile || !baseline || !hasMultimodalSession} />}
              />
            </Card>
          </>
        )}
      </motion.div>

      {/* Account info */}
      <motion.div variants={fadeInUp}>
        <Card>
          <div className="t-over" style={{ marginBottom: 12 }}>Your account</div>
          <KeyValuePair k="Email" v={user?.email || '—'} />
          {user?.display_name && <KeyValuePair k="Name" v={user.display_name} />}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={12} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} />
            <span className="t-cap">~5 minutes to complete the assessment</span>
            <span style={{ flex: 1 }} />
            {profile === null && (
              <Link to="/survey">
                <Button variant="secondary" size="sm">
                  <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Brain size={12} strokeWidth={1.8} />
                    Take assessment
                  </span>
                </Button>
              </Link>
            )}
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
