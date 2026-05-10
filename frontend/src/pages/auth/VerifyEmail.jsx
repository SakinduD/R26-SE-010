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
        style={{ padding: '8px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 280 }}
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--success-soft)',
            border: '1px solid oklch(0.700 0.150 165 / 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--success)',
          }}
        >
          <CheckCircle2 size={28} strokeWidth={1.8} />
        </motion.div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="t-h2">Email verified</h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Your email has been confirmed. You can now sign in to your account.
          </p>
        </div>

        <Link to="/signin" className="btn btn-primary btn-lg" style={{ width: '100%' }}>
          <span className="btn-label">Sign in</span>
        </Link>
      </motion.div>
    </AuthCard>
  );
}
