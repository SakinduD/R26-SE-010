import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import AuthCard from '@/components/ui/auth-card';
import AnimatedInput from '@/components/ui/animated-input';
import LoadingButton from '@/components/ui/loading-button';
import { passwordResetSchema } from '@/lib/validation/auth';
import { requestPasswordReset } from '@/lib/api/auth';

export default function ForgotPassword() {
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(passwordResetSchema) });

  const onSubmit = async (data) => {
    // Always show success — never reveal whether the email is registered
    try {
      await requestPasswordReset(data.email);
    } catch {}
    setSubmitted(true);
  };

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we'll send you a reset link"
    >
      <AnimatePresence mode="wait">
        {!submitted ? (
          <motion.form
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -8 }}
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
          >
            <AnimatedInput
              label="Email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              error={errors.email?.message}
              {...register('email')}
            />
            <LoadingButton isLoading={isSubmitting} type="submit">
              Send reset link
            </LoadingButton>
            <div className="text-center">
              <Link
                to="/signin"
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                Back to sign in
              </Link>
            </div>
          </motion.form>
        ) : (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="py-4 text-center space-y-5"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 280 }}
              className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10"
            >
              <CheckCircle2 className="size-7 text-success" />
            </motion.div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Check your inbox</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                If that email is registered, you'll receive a password reset link
                shortly.
              </p>
            </div>

            <Link
              to="/signin"
              className="inline-block text-sm text-primary hover:underline"
            >
              ← Back to sign in
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthCard>
  );
}
