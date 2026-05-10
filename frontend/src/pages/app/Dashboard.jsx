import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Brain, ArrowRight, CheckCircle2, Clock, ClipboardList, Mic, Target } from 'lucide-react';
import { useAuth } from '@/lib/auth/context';
import { fadeInUp, staggerContainer } from '@/lib/animations';
import { getMyProfile } from '@/lib/api/survey';
import { getMyBaseline } from '@/lib/api/baseline';
import { TRAIT_META, OCEAN_ORDER } from '@/lib/survey/trait-copy';
import PageHead from '@/components/ui/PageHead';
import Card from '@/components/ui/Card';
import StatCard from '@/components/ui/StatCard';
import EmptyState from '@/components/ui/EmptyState';
import ScoreBarRow from '@/components/ui/ScoreBarRow';
import KeyValuePair from '@/components/ui/KeyValuePair';
import Button from '@/components/ui/Button';

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

// undefined = loading, null = not taken/not found, object = exists
function BaselineStatusRow({ baseline }) {
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

export default function Dashboard() {
  const { user } = useAuth();
  const displayName = user?.display_name || user?.email?.split('@')[0] || 'there';
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = not taken
  const [baseline, setBaseline] = useState(undefined); // undefined = loading, null = none

  useEffect(() => {
    getMyProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
    getMyBaseline()
      .then(setBaseline)
      .catch(() => setBaseline(null));
  }, []);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // Profile completion summary for the StatCard row
  const profileComplete =
    profile === undefined ? '…' : profile ? '100' : '0';

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="page page-wide"
    >
      <PageHead
        eyebrow={today}
        title={`Welcome back, ${displayName}.`}
        sub="Your training is calibrated to your current profile. Continue where you left off."
      />

      {/* Top stat row */}
      <motion.div variants={fadeInUp} className="grid-3" style={{ marginBottom: 16 }}>
        <StatCard
          label="OCEAN Profile"
          value={profileComplete}
          unit="%"
          hint={
            profile === undefined
              ? 'Loading…'
              : profile
                ? 'Complete · BFI-44'
                : 'Take the assessment'
          }
        />
        <StatCard
          label="Training Plan"
          value={profile ? 'Active' : '—'}
          mono={false}
          hint={profile ? 'Generated from profile' : 'Generate after assessment'}
        />
        <StatCard
          label="Sessions this week"
          value={0}
          hint="vs last week"
        />
      </motion.div>

      {/* Main two-column area */}
      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        {/* Profile card or empty state */}
        {profile ? (
          <OceanSummaryCard profile={profile} />
        ) : profile === undefined ? (
          <Card>
            <div className="t-over" style={{ marginBottom: 8 }}>Personality profile</div>
            <div className="t-body" style={{ color: 'var(--text-tertiary)' }}>Loading your profile…</div>
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon={ClipboardList}
              title="Begin assessment to unlock your training plan"
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

        {/* Continue training card */}
        <Card variant="accent">
          <div className="t-over" style={{ marginBottom: 8, color: 'var(--accent)' }}>Continue training</div>
          <div className="t-h3" style={{ marginBottom: 4 }}>
            {profile ? 'Start your next session' : 'Profile required'}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>
            {profile
              ? 'Your training plan is calibrated to your OCEAN profile.'
              : 'Complete the assessment to unlock personalised practice scenarios.'}
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
          <KeyValuePair k="Voice baseline" v={profile ? <BaselineStatusRow baseline={baseline} /> : '—'} />
          <KeyValuePair k="First role-play" v={profile ? 'Pending' : '—'} />
          <KeyValuePair k="Multimodal session" v={profile ? 'Pending' : '—'} />
        </Card>
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
