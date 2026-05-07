import React from 'react'

export default function AnalyticsSessionSelect({
  value,
  options = [],
  onChange,
  label = 'Session',
  minWidthClass = 'min-w-[220px]',
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        className={`h-10 ${minWidthClass} rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary`}
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.length ? null : <option value="">No session yet</option>}
        {options.map((option) => (
          <option key={`${option.source}-${option.id}`} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
