/** Reusable framer-motion variants — keep animations subtle and consistent. */

export const fadeInUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.35, ease: 'easeOut' },
};

export const staggerContainer = {
  initial: {},
  animate: { transition: { staggerChildren: 0.06 } },
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.3, ease: 'easeOut' },
};

export const slideInRight = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  transition: { duration: 0.35, ease: 'easeOut' },
};

/** Shared hover/tap props for interactive elements. */
export const buttonMotion = {
  whileHover: { scale: 1.01 },
  whileTap: { scale: 0.99 },
  transition: { duration: 0.15 },
};
