import { motion } from 'framer-motion';

export default function BackgroundGradient() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Subtle dot grid */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
        style={{
          backgroundImage:
            'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Orb 1 — top-left violet */}
      <motion.div
        className="absolute w-[500px] h-[500px] rounded-full bg-violet-500/10 blur-3xl"
        animate={{ x: [0, 80, 0], y: [0, -60, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
        style={{ top: '5%', left: '10%' }}
      />

      {/* Orb 2 — bottom-right indigo */}
      <motion.div
        className="absolute w-[400px] h-[400px] rounded-full bg-indigo-500/10 blur-3xl"
        animate={{ x: [0, -70, 0], y: [0, 50, 0] }}
        transition={{ duration: 34, repeat: Infinity, ease: 'easeInOut' }}
        style={{ bottom: '10%', right: '8%' }}
      />
    </div>
  );
}
