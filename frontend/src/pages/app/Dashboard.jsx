import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Brain, ArrowRight, Clock } from 'lucide-react';
import { useAuth } from '@/lib/auth/context';
import { fadeInUp, staggerContainer } from '@/lib/animations';

export default function Dashboard() {
  const { user } = useAuth();
  const displayName = user?.display_name || user?.email?.split('@')[0] || 'there';

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="space-y-8"
    >
      {/* Greeting */}
      <motion.div variants={fadeInUp} className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Welcome back, {displayName} 👋
        </h1>
        <p className="text-sm text-muted-foreground">
          Here's where you left off on your training journey.
        </p>
      </motion.div>

      {/* Assessment CTA */}
      <motion.div variants={fadeInUp}>
        <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4 max-w-lg">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Brain className="size-5 text-primary" />
            </div>
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">
                Personality assessment
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                You haven't taken the Big Five assessment yet. Complete it to unlock
                adaptive training scenarios tailored to your personality.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pl-14">
            <Link
              to="/survey"
              className="group flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-all duration-200"
            >
              Take the assessment
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" />
              ~10 minutes
            </span>
          </div>
        </div>
      </motion.div>

      {/* Account info */}
      <motion.div variants={fadeInUp}>
        <div className="rounded-xl border border-border/50 bg-muted/30 p-5 max-w-lg space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Your account
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{user?.email}</span>
            </div>
            {user?.display_name && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{user.display_name}</span>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
