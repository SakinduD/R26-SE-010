import React from 'react';
import { motion } from 'framer-motion';
import { Brain, Clock, ListChecks, Sparkles, ArrowRight, Check } from 'lucide-react';
import { fadeInUp, staggerContainer, buttonMotion } from '@/lib/animations';
import PageHead from '@/components/ui/PageHead';
import Card from '@/components/ui/Card';

const FEATURES = [
  { icon: Clock,      text: 'Takes about 5 minutes' },
  { icon: ListChecks, text: '44 short statements — agree or disagree on a 1–5 scale' },
  { icon: Brain,      text: 'No right or wrong answers — honest is best' },
  { icon: Sparkles,   text: 'Results power your personalised AI training scenarios' },
];

export default function SurveyIntro({ onBegin }) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="page page-read"
    >
      <PageHead
        eyebrow="Big Five Inventory — 44 statements"
        title="Personality Assessment"
        sub="This assessment identifies your personality profile across five core dimensions. Results personalise every training scenario — so an introvert and an extravert working on the same skill get completely different experiences."
      />

      <motion.div variants={fadeInUp}>
        <Card style={{ padding: 28 }}>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            {FEATURES.map(({ icon: Icon, text }, i) => (
              <motion.li
                key={text}
                variants={fadeInUp}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '8px 0',
                  borderBottom: i < FEATURES.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    background: 'var(--accent-soft)',
                    border: '1px solid var(--accent-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent)',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={13} strokeWidth={1.8} />
                </span>
                <span className="fg" style={{ fontSize: 14, lineHeight: 1.5 }}>
                  {text}
                </span>
              </motion.li>
            ))}
          </ul>

          <div style={{ marginTop: 22 }}>
            <motion.button
              {...buttonMotion}
              type="button"
              onClick={onBegin}
              className="btn btn-primary btn-lg"
            >
              <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                Begin assessment
                <ArrowRight size={14} strokeWidth={1.8} />
              </span>
            </motion.button>
          </div>

          <div className="t-cap" style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Check size={11} strokeWidth={2} style={{ color: 'var(--success)' }} />
            Your responses are encrypted in transit and at rest, and only used to personalise your training.
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
