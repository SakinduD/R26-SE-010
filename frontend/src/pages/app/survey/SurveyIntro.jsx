import React from 'react';
import { motion } from 'framer-motion';
import { Brain, Clock, ListChecks, Sparkles, ArrowRight } from 'lucide-react';
import { fadeInUp, staggerContainer, buttonMotion } from '@/lib/animations';

const FEATURES = [
  { icon: Clock,       text: 'Takes about 5 minutes' },
  { icon: ListChecks,  text: '44 short statements — agree or disagree on a 1–5 scale' },
  { icon: Brain,       text: 'No right or wrong answers — honest is best' },
  { icon: Sparkles,    text: 'Results power your personalised AI training scenarios' },
];

export default function SurveyIntro({ onBegin }) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="mx-auto max-w-lg"
    >
      {/* Hero card */}
      <motion.div
        variants={fadeInUp}
        className="rounded-2xl border border-border/60 bg-card shadow-md overflow-hidden"
      >
        {/* Gradient banner */}
        <div className="h-2 bg-gradient-to-r from-primary to-violet-500" />

        <div className="p-7 space-y-6">
          {/* Icon + title */}
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-violet-500/10">
              <Brain className="size-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Personality Assessment
              </h1>
              <p className="text-sm text-muted-foreground">
                Big Five Inventory — 44 statements
              </p>
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            This assessment identifies your personality profile across five core dimensions.
            Your results are used to personalise every training scenario — so an introvert and
            an extravert working on the same skill get completely different experiences.
          </p>

          {/* Feature list */}
          <ul className="space-y-2.5">
            {FEATURES.map(({ icon: Icon, text }) => (
              <motion.li
                key={text}
                variants={fadeInUp}
                className="flex items-center gap-3 text-sm text-muted-foreground"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/60">
                  <Icon className="size-3.5 text-primary" />
                </span>
                {text}
              </motion.li>
            ))}
          </ul>

          {/* CTA */}
          <motion.button
            {...buttonMotion}
            onClick={onBegin}
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-md hover:shadow-lg hover:opacity-95 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Begin assessment
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </motion.button>
        </div>
      </motion.div>

      <motion.p
        variants={fadeInUp}
        className="mt-4 text-center text-xs text-muted-foreground"
      >
        Your answers are private and only used to personalise your training.
      </motion.p>
    </motion.div>
  );
}
