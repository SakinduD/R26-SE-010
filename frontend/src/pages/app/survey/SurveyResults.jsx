import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Loader2 } from 'lucide-react';
import { getMyProfile } from '@/lib/api/survey';
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute';
import { TRAIT_META, OCEAN_ORDER } from '@/lib/survey/trait-copy';
import { fadeInUp, staggerContainer } from '@/lib/animations';
import PageHead from '@/components/ui/PageHead';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import ScoreBar from '@/components/ui/ScoreBar';
import CountUp from '@/components/ui/CountUp';

const LEVEL_VARIANT = { HIGH: 'accent', MID: 'neutral', LOW: 'info' };

function TraitCard({ traitKey, traitData, index }) {
  const meta = TRAIT_META[traitKey];
  const { score, level } = traitData;
  const [armed, setArmed] = useState(false);

  // Stagger the animation slightly so the bars + counters fire in sequence
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 120 + index * 80);
    return () => clearTimeout(t);
  }, [index]);

  return (
    <motion.div variants={fadeInUp}>
      <Card>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            gap: 18,
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <div className="letter-chip" style={{ width: 44, height: 44, fontSize: 18 }}>
            {meta.letter}
          </div>
          <div>
            <div className="t-h3">{meta.label}</div>
            <div className="t-cap">{meta.description}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              className="score-num fg"
              style={{ fontSize: 36, lineHeight: 1, fontWeight: 500 }}
            >
              {armed ? <CountUp to={Math.round(score)} duration={700} /> : 0}
            </div>
            <div style={{ marginTop: 6 }}>
              <Badge variant={LEVEL_VARIANT[level] ?? 'neutral'}>
                {meta.levelLabel?.[level] ?? level}
              </Badge>
            </div>
          </div>
        </div>

        <ScoreBar value={armed ? score : 0} gradient />

        <p
          style={{
            margin: '16px 0 0',
            fontSize: 14,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}
        >
          {meta.meaning ?? meta.description}
        </p>

        <div className="divider" style={{ margin: '16px 0' }} />

        <div className="t-cap" style={{ marginBottom: 4 }}>
          What this means for your training
        </div>
        <div className="fg" style={{ fontSize: 14, lineHeight: 1.6 }}>
          {meta.trainingNote?.[level] ?? ''}
        </div>
      </Card>
    </motion.div>
  );
}

const DECISION_KEY = 'empowerz:baseline:decision'

export default function SurveyResults() {
  const navigate = useNavigate();
  const { isLoading: authLoading } = useProtectedRoute();

  function handleStartBaseline() {
    const decision = localStorage.getItem(DECISION_KEY)
    if (decision === 'consented') navigate('/baseline')
    else if (decision === 'skipped') navigate('/training-plan')
    else navigate('/baseline/consent')
  }
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    getMyProfile()
      .then((p) => {
        if (!p) {
          navigate('/survey');
          return;
        }
        setProfile(p);
        setLoading(false);
      })
      .catch(() => {
        navigate('/survey');
      });
  }, [authLoading, navigate]);

  if (loading || authLoading) {
    return (
      <div
        style={{
          display: 'flex',
          minHeight: '50vh',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Loader2 size={24} strokeWidth={1.6} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    );
  }

  const updated = new Date(profile.updated_at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="page"
    >
      <PageHead
        eyebrow="Big Five Inventory"
        title="Your OCEAN profile"
        sub={`Last updated ${updated}`}
      />

      <div className="col stagger" style={{ gap: 16 }}>
        {OCEAN_ORDER.map((key, i) => (
          <TraitCard
            key={key}
            traitKey={key}
            traitData={profile.scores[key]}
            index={i}
          />
        ))}
      </div>

      <motion.div
        variants={fadeInUp}
        style={{ display: 'flex', gap: 8, marginTop: 28, flexWrap: 'wrap' }}
      >
        <button type="button" onClick={handleStartBaseline} className="btn btn-primary btn-lg">
          <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Start voice baseline
            <ArrowRight size={14} strokeWidth={1.8} />
          </span>
        </button>
        <Link to="/training-plan" className="btn btn-secondary btn-lg">
          <span className="btn-label">Skip to training plan</span>
        </Link>
        <Link to="/dashboard" className="btn btn-ghost btn-lg">
          <span className="btn-label">Back to dashboard</span>
        </Link>
      </motion.div>
    </motion.div>
  );
}
