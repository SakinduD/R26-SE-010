import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

// How many sessions to show before the "See more results" reveal.
const INITIAL_VISIBLE = 5

export default function AnalyticsSessionSelect({
  value,
  options = [],
  onChange,
  label = 'Session',
  minWidthClass = 'min-w-[220px]',
  // When set, adds a top "no session selected" entry (value '') so the user can
  // switch back to their overall/all-sessions view. e.g. "All Sessions".
  allOptionLabel = null,
  allOptionSub = 'Overall view across all your sessions',
}) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const containerRef = useRef(null)

  const selected = useMemo(
    () => options.find((option) => String(option.id) === String(value)) || null,
    [options, value]
  )
  // The "all sessions" entry is active whenever no real session is selected.
  const isAllSelected = Boolean(allOptionLabel) && !value

  const visibleOptions = showAll ? options : options.slice(0, INITIAL_VISIBLE)
  const hiddenCount = options.length - visibleOptions.length
  const canOpen = options.length > 0 || Boolean(allOptionLabel)

  // Close on outside click or Escape; collapse the "see more" list on close.
  useEffect(() => {
    if (!open) {
      setShowAll(false)
      return undefined
    }
    const handleClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false)
    }
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const buttonText = selected
    ? selected.title || selected.friendlyId || selected.label
    : allOptionLabel
      ? allOptionLabel
      : options.length
        ? 'Select a session'
        : 'No session yet'

  const handleSelect = (id) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <div className="grid gap-1 text-xs text-muted-foreground" ref={containerRef}>
      <span>{label}</span>
      <div className={`relative ${minWidthClass}`}>
        <button
          type="button"
          disabled={!canOpen}
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary ${
            canOpen ? '' : 'cursor-not-allowed opacity-60'
          }`}
        >
          <span className="truncate">{buttonText}</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-card shadow-lg"
          >
            {allOptionLabel && (
              <button
                type="button"
                role="option"
                aria-selected={isAllSelected}
                onClick={() => handleSelect('')}
                className={`flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left transition-colors hover:bg-muted ${
                  isAllSelected ? 'bg-muted/60' : ''
                }`}
              >
                <Check
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isAllSelected ? 'text-primary' : 'text-transparent'}`}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{allOptionLabel}</span>
                  {allOptionSub && (
                    <span className="block truncate text-[11px] text-muted-foreground">{allOptionSub}</span>
                  )}
                </span>
              </button>
            )}

            {options.length === 0
              ? !allOptionLabel && <div className="px-3 py-2 text-sm text-muted-foreground">No session yet</div>
              : visibleOptions.map((option) => {
                  const isSelected = String(option.id) === String(value)
                  return (
                    <button
                      type="button"
                      key={`${option.source}-${option.id}`}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(option.id)}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted ${
                        isSelected ? 'bg-muted/60' : ''
                      }`}
                    >
                      <Check
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-primary' : 'text-transparent'}`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {option.title || option.friendlyId || option.label}
                        </span>
                        {option.sublabel && (
                          <span className="block truncate text-[11px] text-muted-foreground">{option.sublabel}</span>
                        )}
                      </span>
                    </button>
                  )
                })}

            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="w-full border-t border-border px-3 py-2 text-left text-xs font-medium text-primary hover:bg-muted"
              >
                See more results ({hiddenCount})
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
