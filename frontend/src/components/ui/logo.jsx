const sizes = { sm: 'text-lg', md: 'text-xl', lg: 'text-2xl' };

export default function Logo({ size = 'md' }) {
  return (
    <span
      className={`${sizes[size]} font-semibold tracking-tight bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent select-none`}
    >
      Adaptive Coach
    </span>
  );
}
