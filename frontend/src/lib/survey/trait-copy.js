/**
 * Plain-English trait descriptions for the OCEAN model.
 * Framing is neutral and non-judgmental — neuroticism = "emotional sensitivity", not anxiety.
 */

export const TRAIT_META = {
  openness: {
    label: 'Openness',
    letter: 'O',
    description: 'Curiosity, creativity, and appetite for new experiences.',
    trainingNote: {
      low:  'Your training uses clear, structured scenarios with concrete goals — no ambiguity.',
      mid:  'Your training balances familiar frameworks with occasional novel challenges.',
      high: 'Your training leans into abstract thinking, creative prompts, and open-ended scenarios.',
    },
    levelLabel: {
      low:  'Practical & Structured',
      mid:  'Balanced',
      high: 'Imaginative & Curious',
    },
  },
  conscientiousness: {
    label: 'Conscientiousness',
    letter: 'C',
    description: 'Self-discipline, organization, and goal-directed behaviour.',
    trainingNote: {
      low:  'Your training uses shorter sessions with frequent check-ins to keep momentum.',
      mid:  'Your training has clear milestones with moderate flexibility.',
      high: 'Your training trusts you to self-direct — longer sessions, ambitious targets.',
    },
    levelLabel: {
      low:  'Flexible & Spontaneous',
      mid:  'Balanced',
      high: 'Organised & Reliable',
    },
  },
  extraversion: {
    label: 'Extraversion',
    letter: 'E',
    description: 'Social energy, assertiveness, and outward expressiveness.',
    trainingNote: {
      low:  'Your training paces gradually, with encouragement built into every step.',
      mid:  'Your training mixes solo reflection with interactive exercises.',
      high: 'Your training is fast-paced, socially intense, and direct in feedback.',
    },
    levelLabel: {
      low:  'Reflective & Reserved',
      mid:  'Balanced',
      high: 'Outgoing & Assertive',
    },
  },
  agreeableness: {
    label: 'Agreeableness',
    letter: 'A',
    description: 'Warmth, cooperation, and sensitivity to others.',
    trainingNote: {
      low:  'Your training uses debate-style scenarios where holding firm is the goal.',
      mid:  'Your training covers both collaborative and competitive interaction styles.',
      high: 'Your training focuses on assertiveness techniques and boundary-setting.',
    },
    levelLabel: {
      low:  'Direct & Competitive',
      mid:  'Balanced',
      high: 'Warm & Cooperative',
    },
  },
  neuroticism: {
    label: 'Emotional Sensitivity',
    letter: 'N',
    description: 'How readily you experience emotional highs and lows under pressure.',
    trainingNote: {
      low:  'Your training dives straight into high-pressure scenarios — you handle them well.',
      mid:  'Your training builds pressure gradually, with debrief moments between challenges.',
      high: 'Your training starts gentle, with a friendly AI coach and positive reinforcement throughout.',
    },
    levelLabel: {
      low:  'Calm & Steady',
      mid:  'Balanced',
      high: 'Emotionally Attuned',
    },
  },
};

export const OCEAN_ORDER = [
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'neuroticism',
];

/** Tailwind classes per level, used consistently across all trait displays. */
export const LEVEL_STYLES = {
  low:  { badge: 'bg-warning/10 text-warning',  bar: 'from-amber-400 to-amber-500' },
  mid:  { badge: 'bg-muted text-muted-foreground', bar: 'from-secondary/70 to-secondary' },
  high: { badge: 'bg-success/10 text-success',   bar: 'from-primary to-violet-400' },
};
