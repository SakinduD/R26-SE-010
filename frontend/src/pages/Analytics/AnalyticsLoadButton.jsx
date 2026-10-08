import React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../../components/ui/Button'

/**
 * The one Load button used across every Feedback & Predictive Analytics page.
 * Keeps a single look and behaviour: primary style, 40px tall to line up with
 * the session dropdowns, a refresh icon, and a spinner while data is loading.
 */
export default function AnalyticsLoadButton({
  onClick,
  loading = false,
  children = 'Load Results',
  className = 'h-10',
}) {
  return (
    <Button
      type="button"
      variant="primary"
      onClick={onClick}
      loading={loading}
      className={className}
    >
      <span className="inline-flex items-center gap-1.5">
        <RefreshCw size={14} strokeWidth={1.8} />
        {children}
      </span>
    </Button>
  )
}
