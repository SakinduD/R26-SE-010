import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import AuthCard from '@/components/ui/auth-card';

export default function VerifyEmail() {
  return (
    <AuthCard>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="py-4 text-center space-y-5"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 280 }}
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10"
        >
          <CheckCircle2 className="size-7 text-success" />
        </motion.div>

        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-foreground">Email verified!</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your email has been confirmed. You can now sign in to your account.
          </p>
        </div>

        <Link
          to="/signin"
          className="inline-flex items-center justify-center w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Sign in
        </Link>
      </motion.div>
    </AuthCard>
  );
}
