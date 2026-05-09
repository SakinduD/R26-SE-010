import React from 'react'
import { UserCircle } from 'lucide-react'

export default function AnalyticsUserBadge({ isAuthenticated, userLabel }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
      <UserCircle className="h-3 w-3 text-secondary" />
      {isAuthenticated ? `Signed in: ${userLabel}` : 'Demo mode'}
    </span>
  )
}
