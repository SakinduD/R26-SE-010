import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Full-width submit button that shows a spinner while isLoading is true.
 */
export default function LoadingButton({
  isLoading = false,
  children,
  className,
  disabled,
  variant = 'primary',
  ...props
}) {
  const variants = {
    primary:
      'bg-primary text-primary-foreground hover:bg-primary/90',
    outline:
      'border border-border bg-background text-foreground hover:bg-muted',
  };

  return (
    <motion.button
      whileHover={!isLoading && !disabled ? { scale: 1.01 } : {}}
      whileTap={!isLoading && !disabled ? { scale: 0.99 } : {}}
      transition={{ duration: 0.15 }}
      disabled={disabled || isLoading}
      className={cn(
        'w-full h-10 rounded-lg text-sm font-medium',
        'transition-all duration-200',
        'disabled:pointer-events-none disabled:opacity-60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        variants[variant],
        className
      )}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          <span>Please wait…</span>
        </span>
      ) : (
        children
      )}
    </motion.button>
  );
}
