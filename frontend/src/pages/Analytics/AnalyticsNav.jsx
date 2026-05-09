import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/analytics-dashboard', label: 'Overview' },
  { to: '/analytics-feedback', label: 'Feedback' },
  { to: '/analytics-skill-twin', label: 'Skill Twin' },
  { to: '/analytics-predictions', label: 'Predictions' },
  { to: '/analytics-progress-trends', label: 'Trends' },
  { to: '/analytics-blind-spots', label: 'Blind Spots' },
  { to: '/analytics-recommendations', label: 'Recommendations' },
  { to: '/analytics-session-report', label: 'Report' },
]

export default function AnalyticsNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeItem =
    NAV_ITEMS.find((item) => location.pathname === item.to) ||
    NAV_ITEMS.find((item) => location.pathname.startsWith(item.to)) ||
    NAV_ITEMS[0]

  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>View</span>
      <select
        className="h-10 min-w-44 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-primary"
        value={activeItem.to}
        onChange={(event) => navigate(event.target.value)}
      >
        {NAV_ITEMS.map(({ to, label }) => (
          <option key={to} value={to}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}
