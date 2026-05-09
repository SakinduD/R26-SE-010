import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import AuthCard from '@/components/ui/auth-card';
import AnimatedInput from '@/components/ui/animated-input';
import LoadingButton from '@/components/ui/loading-button';
import { signInSchema } from '@/lib/validation/auth';
import { useAuth } from '@/lib/auth/context';
import { getApiError } from '@/lib/api/auth';
import { fadeInUp, staggerContainer } from '@/lib/animations';

export default function SignIn() {
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(signInSchema) });

  const onSubmit = async (data) => {
    try {
      await signIn(data);
      navigate('/dashboard');
    } catch (err) {
      toast.error(getApiError(err) || 'Incorrect email or password.');
    }
  };

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to continue your training"
      footer={
        <span>
          Don't have an account?{' '}
          <Link to="/signup" className="text-primary hover:underline font-medium">
            Sign up
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
            placeholder="••••••••"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <div className="mt-1.5 text-right">
            <Link
              to="/forgot-password"
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              Forgot password?
            </Link>
          </div>
        </motion.div>

        <motion.div variants={fadeInUp} className="pt-1">
          <LoadingButton isLoading={isSubmitting} type="submit">
            Sign in
          </LoadingButton>
        </motion.div>
      </motion.form>
    </AuthCard>
  );
}
