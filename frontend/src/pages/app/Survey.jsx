import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Brain, RotateCcw, BarChart2, Loader2 } from 'lucide-react';
import { getMyProfile } from '@/lib/api/survey';
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute';
import { fadeInUp, staggerContainer, buttonMotion } from '@/lib/animations';
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
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (view === VIEW.FORM) {
    return <SurveyForm initialAnswers={{}} />;
  }

  if (view === VIEW.TAKEN) {
    return (
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="mx-auto max-w-lg space-y-4"
      >
        <motion.div variants={fadeInUp} className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Assessment complete
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated{' '}
            {new Date(existingProfile.updated_at).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </motion.div>

        <motion.div
          variants={fadeInUp}
          className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden"
        >
          <div className="h-1.5 bg-gradient-to-r from-primary to-violet-500" />
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-violet-500/10">
                <Brain className="size-5 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                You've already completed the personality assessment. Your profile is powering
                your personalised training scenarios.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                to="/survey/results"
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <BarChart2 className="size-4" />
                View your results
              </Link>
              <motion.button
                {...buttonMotion}
                type="button"
                onClick={() => setView(VIEW.FORM)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <RotateCcw className="size-4" />
                Retake assessment
              </motion.button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  // Default: INTRO state
  return <SurveyIntro onBegin={() => setView(VIEW.FORM)} />;
}
