import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import Card from '@/components/ui/Card'
import { Button } from '../../components/ui/Button'

/**
 * What an analytics page shows when it has nothing real to show.
 *
 * These pages used to fall back to a hard-coded sample profile — plausible
 * scores, streaks and blind spots that belonged to nobody. A small warning
 * banner sat above them, but the figures themselves looked exactly like a
 * learner's own record, and a screenshot of that page is indistinguishable from
 * real results.
 *
 * Showing nothing is the honest answer. A learner reading a number here has to
 * be able to trust that it came from their own sessions.
 */
export default function AnalyticsUnavailable({
  status,
  onRetry,
  subject = 'this data',
}) {
  const loading = status === 'loading'
  const failed = status === 'error'

  return (
    <Card>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 10,
          padding: '44px 24px',
        }}
      >
        {failed && <AlertTriangle size={22} strokeWidth={1.7} style={{ color: 'var(--danger-text)' }} />}

        <div className="t-h3">
          {loading
            ? 'Loading…'
            : failed
              ? `${subject.charAt(0).toUpperCase()}${subject.slice(1)} could not be loaded`
              : `Nothing to show yet`}
        </div>

        <p className="t-cap" style={{ maxWidth: 420, lineHeight: 1.65 }}>
          {loading
            ? 'Reading your recorded sessions.'
            : failed
              ? 'No figures are shown, because an invented number would be worse than none. Try again in a moment.'
              : 'Complete a practice session, then load your results.'}
        </p>

        {!loading && onRetry && (
          <Button type="button" variant="secondary" onClick={onRetry} className="mt-2">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={14} strokeWidth={1.8} />
              Try again
            </span>
          </Button>
        )}
      </div>
    </Card>
  )
}
