import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export default function AuthCard({ title, description, children, footer, className }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={cn(
        'rounded-2xl border border-border/60',
        'bg-card text-card-foreground',
        'shadow-xl dark:shadow-black/40',
        'p-8',
        className
      )}
    >
      {(title || description) && (
        <div className="mb-7">
          {title && (
            <h1 className="text-[1.4rem] font-semibold tracking-tight text-foreground leading-snug">
              {title}
            </h1>
          )}
          {description && (
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              {description}
            </p>
          )}
        </div>
      )}

      {children}

      {footer && (
        <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
      )}
    </motion.div>
  );
}
