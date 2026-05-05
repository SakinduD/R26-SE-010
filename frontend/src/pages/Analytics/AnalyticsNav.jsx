import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  AlertTriangle,
  BrainCircuit,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  Radar,
} from 'lucide-react'

const NAV_ITEMS = [
  { to: '/analytics-dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/analytics-feedback', label: 'Feedback', icon: ClipboardCheck },
  { to: '/analytics-skill-twin', label: 'Skill Twin', icon: Radar },
  { to: '/analytics-predictions', label: 'Predictions', icon: BrainCircuit },
  { to: '/analytics-progress-trends', label: 'Trends', icon: LineChart },
  { to: '/analytics-blind-spots', label: 'Blind Spots', icon: AlertTriangle },
  { to: '/analytics-recommendations', label: 'Recommendations', icon: Lightbulb },
  { to: '/analytics-session-report', label: 'Report', icon: FileText },
]

export default function AnalyticsNav() {
  return (
    <nav className="border-b border-border bg-card/30">
      <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-3 md:px-6">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium transition',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground',
              ].join(' ')
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
