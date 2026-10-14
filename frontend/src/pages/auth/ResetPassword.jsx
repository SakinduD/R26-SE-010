import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import AuthCard from '@/components/ui/auth-card';
import AnimatedInput from '@/components/ui/animated-input';
import LoadingButton from '@/components/ui/loading-button';
import { newPasswordSchema } from '@/lib/validation/auth';
import { getApiError, updatePassword } from '@/lib/api/auth';
import { fadeInUp, staggerContainer } from '@/lib/animations';

export default function ResetPassword() {
  const navigate = useNavigate();
  // Set by AuthCallback from the Supabase recovery link
  const accessToken = useLocation().state?.accessToken;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(newPasswordSchema) });

  const onSubmit = async (data) => {
    try {
      await updatePassword({ access_token: accessToken, password: data.password });
      toast.success('Password updated. Please sign in with your new password.');
      navigate('/signin', { replace: true });
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  if (!accessToken) {
    return (
      <AuthCard
        title="Reset link invalid"
        description="This link is missing, expired or was already used"
      >
        <div className="py-2 text-center space-y-4">
          <Link to="/forgot-password" className="inline-block text-sm text-primary hover:underline">
            Request a new reset link
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password" description="Choose a new password for your account">
      <motion.form
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-4"
      >
        <motion.div variants={fadeInUp}>
          <AnimatedInput
            label="New password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register('password')}
          />
        </motion.div>

        <motion.div variants={fadeInUp}>
          <AnimatedInput
            label="Confirm password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
        </motion.div>

        <motion.div variants={fadeInUp} className="pt-1">
          <LoadingButton isLoading={isSubmitting} type="submit" className="w-full">
            Update password
          </LoadingButton>
        </motion.div>
      </motion.form>
    </AuthCard>
  );
}
