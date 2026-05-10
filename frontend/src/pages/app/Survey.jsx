import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { RotateCcw, BarChart2, Loader2, CheckCircle2 } from 'lucide-react';
import { getMyProfile } from '@/lib/api/survey';
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute';
import { fadeInUp, staggerContainer, buttonMotion } from '@/lib/animations';
import PageHead from '@/components/ui/PageHead';
import Card from '@/components/ui/Card';
import SurveyIntro from './survey/SurveyIntro';
import SurveyForm from './survey/SurveyForm';

// Three UI states for this page
const VIEW = { LOADING: 'loading', INTRO: 'intro', FORM: 'form', TAKEN: 'taken' };

export default function Survey() {
  const { isLoading: authLoading } = useProtectedRoute();
  const [view, setView] = useState(VIEW.LOADING);
  const [existingProfile, setExistingProfile] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    getMyProfile()
      .then((profile) => {
        if (profile) {
          setExistingProfile(profile);
          setView(VIEW.TAKEN);
        } else {
          setView(VIEW.INTRO);
        }
      })
      .catch(() => setView(VIEW.INTRO));
  }, [authLoading]);

  if (view === VIEW.LOADING || authLoading) {
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

  if (view === VIEW.FORM) {
    return <SurveyForm initialAnswers={{}} />;
  }

  if (view === VIEW.TAKEN) {
    const updated = new Date(existingProfile.updated_at).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    return (
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="page page-read"
      >
        <PageHead
          eyebrow="Big Five Inventory"
          title="Assessment complete"
          sub={`Last submitted ${updated}`}
        />

        <motion.div variants={fadeInUp}>
          <Card style={{ padding: 32 }}>
            <div className="t-over" style={{ color: 'var(--success)', marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={12} strokeWidth={1.8} />
              Profile ready
            </div>
            <div className="t-h2" style={{ marginBottom: 6 }}>Your profile is ready.</div>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 22, lineHeight: 1.6 }}>
              You've already completed the personality assessment. Your profile is powering your
              personalised training scenarios. You can review your results or retake the assessment.
            </p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link to="/survey/results" className="btn btn-primary">
                <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <BarChart2 size={14} strokeWidth={1.8} />
                  View your results
                </span>
              </Link>
              <motion.button
                {...buttonMotion}
                type="button"
                onClick={() => setView(VIEW.FORM)}
                className="btn btn-secondary"
              >
                <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <RotateCcw size={14} strokeWidth={1.8} />
                  Retake assessment
                </span>
              </motion.button>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    );
  }

  // Default: INTRO state
  return <SurveyIntro onBegin={() => setView(VIEW.FORM)} />;
}
