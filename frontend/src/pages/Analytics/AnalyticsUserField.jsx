import React from 'react'

export default function AnalyticsUserField({
  label = 'User',
  userId,
  userLabel,
  isAuthenticated,
  onChange,
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-muted/40"
        value={isAuthenticated ? userLabel : userId}
        onChange={(event) => onChange(event.target.value)}
        disabled={isAuthenticated}
        title={isAuthenticated ? `Internal user id: ${userId}` : undefined}
      />
    </label>
  )
}
