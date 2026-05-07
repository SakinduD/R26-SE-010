import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import AuthCard from '@/components/ui/auth-card';
import AnimatedInput from '@/components/ui/animated-input';
import LoadingButton from '@/components/ui/loading-button';
import { signUpSchema } from '@/lib/validation/auth';
import { useAuth } from '@/lib/auth/context';
import { getApiError } from '@/lib/api/auth';
import { fadeInUp, staggerContainer } from '@/lib/animations';
import { cn } from '@/lib/utils';

function getPasswordStrength(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-zA-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return score;
}

function PasswordStrengthBar({ password }) {
  const strength = getPasswordStrength(password);
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const barColors = [
    '',
    'bg-destructive',
    'bg-warning',
    'bg-yellow-500',
    'bg-success',
  ];

  if (!password) return null;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-all duration-500',
              i <= strength ? barColors[strength] : 'bg-muted'
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{labels[strength]}</p>
    </div>
  );
}

export default function SignUp() {
  const navigate = useNavigate();
  const { signUp } = useAuth();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(signUpSchema) });

  const password = watch('password') || '';

  const onSubmit = async (data) => {
    try {
      // Omit empty display_name so the backend treats it as optional
      const payload = { ...data };
      if (!payload.display_name?.trim()) delete payload.display_name;
      await signUp(payload);
      toast.success('Account created! Welcome aboard.');
      navigate('/dashboard');
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  return (
    <AuthCard
      title="Create your account"
      description="Start your adaptive training journey"
      footer={
        <span>
          Already have an account?{' '}
          <Link to="/signin" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </span>
      }
    >
      <motion.form
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-4"
      >
        <motion.div variants={fadeInUp}>
          <AnimatedInput
            label="Your name (optional)"
            type="text"
            placeholder="Alex Johnson"
            error={errors.display_name?.message}
            {...register('display_name')}
          />
        </motion.div>

        <motion.div variants={fadeInUp}>
          <AnimatedInput
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
        </motion.div>

        <motion.div variants={fadeInUp}>
          <AnimatedInput
            label="Password"
            type="password"
            placeholder="Min. 8 characters"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordStrengthBar password={password} />
        </motion.div>

        <motion.div variants={fadeInUp} className="pt-1">
          <LoadingButton isLoading={isSubmitting} type="submit" className="w-full">
            Create account
          </LoadingButton>
        </motion.div>
      </motion.form>
    </AuthCard>
  );
}
