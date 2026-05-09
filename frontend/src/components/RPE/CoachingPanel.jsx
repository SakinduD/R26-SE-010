import { cn } from '@/lib/utils'

const RATING_STYLE = {
  excellent:  { cls: 'bg-green-100 text-green-700',   label: 'Excellent'   },
  good:       { cls: 'bg-blue-100 text-blue-700',     label: 'Good'        },
  needs_work: { cls: 'bg-orange-100 text-orange-700', label: 'Needs Work'  },
}

/**
 * CoachingPanel
 * Props:
 *   coachingAdvice: { overall_rating, summary, advice[], strengths[], focus_areas[] }
 *   truncated?: boolean — if true, hide advice list (used in Overview section)
 *   onExpand?: () => void — called when "See full coaching →" clicked
 */
export default function CoachingPanel({ coachingAdvice, truncated = false, onExpand }) {
  if (!coachingAdvice) return null

  const { overall_rating, summary, advice = [], strengths = [], focus_areas = [] } = coachingAdvice
  const rating = RATING_STYLE[overall_rating] ?? RATING_STYLE.needs_work

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Coaching Advice</h3>
        <span className={cn('text-xs font-semibold rounded-full px-3 py-1', rating.cls)}>
          {rating.label}
        </span>
      </div>

      {/* Summary line */}
      <div className="border-l-4 border-blue-300 pl-3 py-1 bg-blue-50 rounded-r-lg">
        <p className="italic text-gray-600 text-sm">{summary}</p>
      </div>

      {/* Advice — hidden when truncated */}
      {!truncated && advice.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-700">Your 3 Action Points</p>
          <ol className="space-y-3">
            {advice.map((point, i) => (
              <li key={i} className="flex gap-3 items-start">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <p className="text-sm text-gray-700 leading-relaxed">{point}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Truncated "see full" link */}
      {truncated && (
        <button
          onClick={onExpand}
          className="text-sm text-blue-600 hover:underline font-medium"
        >
          See full coaching →
        </button>
      )}

      {/* Strengths + Focus Areas — always visible */}
      {!truncated && (strengths.length > 0 || focus_areas.length > 0) && (
        <div className="grid grid-cols-2 gap-4 pt-1">
          {/* Strengths */}
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-green-700">✅ Strengths</p>
            <ul className="space-y-1">
              {strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                  {s}
                </li>
              ))}
            </ul>
          </div>

          {/* Focus Areas */}
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-orange-600">🎯 Focus Areas</p>
            <ul className="space-y-1">
              {focus_areas.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
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
