import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Loader2 } from 'lucide-react';
import { getMyProfile } from '@/lib/api/survey';
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute';
import { TRAIT_META, OCEAN_ORDER, LEVEL_STYLES } from '@/lib/survey/trait-copy';
import { fadeInUp, staggerContainer } from '@/lib/animations';
import { cn } from '@/lib/utils';

function TraitCard({ traitKey, traitData, index }) {
  const meta = TRAIT_META[traitKey];
  const { score, level } = traitData;
  const styles = LEVEL_STYLES[level];

  return (
    <motion.div
      variants={fadeInUp}
      className="rounded-xl border border-border/60 bg-card p-5 shadow-sm space-y-3.5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">
              {meta.letter}
            </span>
            <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
          </div>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-2xl font-bold tabular-nums text-foreground">
            {Math.round(score)}
          </span>
          <span className="text-xs text-muted-foreground">/100</span>
        </div>
      </div>

      {/* Score bar */}
      <div className="space-y-1.5">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <motion.div
            className={cn('h-full rounded-full bg-gradient-to-r', styles.bar)}
            initial={{ width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: index * 0.1 + 0.3 }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', styles.badge)}>
            {meta.levelLabel[level]}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">{score.toFixed(1)}</span>
        </div>
      </div>

      {/* Training note */}
      <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
        <span className="font-medium text-foreground">Your training: </span>
        {meta.trainingNote[level]}
      </p>
    </motion.div>
  );
}

export default function SurveyResults() {
  const navigate = useNavigate();
  const { isLoading: authLoading } = useProtectedRoute();
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
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="mx-auto max-w-xl space-y-6"
    >
      {/* Header */}
      <motion.div variants={fadeInUp} className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Your personality profile
        </h1>
        <p className="text-sm text-muted-foreground">
          Based on the Big Five Inventory · Last updated{' '}
          {new Date(profile.updated_at).toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
          })}
        </p>
      </motion.div>

      {/* OCEAN trait cards */}
      {OCEAN_ORDER.map((key, i) => (
        <TraitCard
          key={key}
          traitKey={key}
          traitData={profile.scores[key]}
          index={i}
        />
      ))}

      {/* CTA */}
      <motion.div variants={fadeInUp} className="pt-2 pb-8 space-y-3">
        <Link
          to="/baseline"
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Start baseline voice session
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link
          to="/training-plan"
          className="group flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-card px-5 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all duration-200"
        >
          Skip to training plan
        </Link>
        <Link
          to="/dashboard"
          className="group flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-xs text-muted-foreground hover:text-foreground transition-all duration-200"
        >
          Continue to dashboard
        </Link>
      </motion.div>
    </motion.div>
  );
}
