import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * AuthCard — wrapper for sign-in / sign-up / forgot-password forms.
 * Restyled to use prototype .card + .violet-halo classes (no shadow).
 * Original API preserved: { title, description, children, footer, className }.
 */
export default function AuthCard({ title, description, children, footer, className }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={cn('card violet-halo', className)}
      style={{ position: 'relative', padding: 32 }}
    >
      {(title || description) && (
        <div style={{ marginBottom: 24, position: 'relative' }}>
          {title && <div className="t-h2">{title}</div>}
          {description && (
            <p
              style={{
                marginTop: 6,
                fontSize: 14,
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
              }}
            >
              {description}
            </p>
          )}
        </div>
      )}

      <div style={{ position: 'relative' }}>{children}</div>

      {footer && (
        <div
          style={{
            marginTop: 24,
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--text-tertiary)',
            position: 'relative',
          }}
        >
          {footer}
        </div>
      )}
    </motion.div>
  );
}
