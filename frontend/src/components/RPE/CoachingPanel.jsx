// REDESIGN: bg-white/bg-gray/bg-blue/bg-green/bg-orange → semantic tokens (dark-mode safe)
import { CheckCircle, Target } from 'lucide-react'
import { cn } from '@/lib/utils'

const RATING_STYLE = {
  excellent:  { cls: 'bg-success/10 text-success',   label: 'Excellent'   },
  good:       { cls: 'bg-info/10 text-info',          label: 'Good'        },
  needs_work: { cls: 'bg-warning/10 text-warning',    label: 'Needs Work'  },
}

export default function CoachingPanel({ coachingAdvice, truncated = false, onExpand }) {
  if (!coachingAdvice) return null

  const { overall_rating, summary, advice = [], strengths = [], focus_areas = [] } = coachingAdvice
  const rating = RATING_STYLE[overall_rating] ?? RATING_STYLE.needs_work

  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-5">

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">Coaching Advice</h3>
        <span className={cn('text-xs font-semibold rounded-full px-3 py-1', rating.cls)}>
          {rating.label}
        </span>
      </div>

      <div className="border-l-4 border-info/40 pl-3 py-1 bg-info/5 rounded-r-lg">
        <p className="italic text-t-secondary text-sm">{summary}</p>
      </div>

      {!truncated && advice.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">Your 3 Action Points</p>
          <ol className="space-y-3">
            {advice.map((point, i) => (
              <li key={i} className="flex gap-3 items-start">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <p className="text-sm text-foreground leading-relaxed">{point}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {truncated && (
        <button
          onClick={onExpand}
          className="text-sm text-primary hover:underline font-medium"
        >
          See full coaching →
        </button>
      )}

      {!truncated && (strengths.length > 0 || focus_areas.length > 0) && (
        <div className="grid grid-cols-2 gap-4 pt-1">
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-success flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" /> Strengths
            </p>
            <ul className="space-y-1">
              {strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-t-secondary">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
                  {s}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-warning flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5" /> Focus Areas
            </p>
            <ul className="space-y-1">
              {focus_areas.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-t-secondary">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
