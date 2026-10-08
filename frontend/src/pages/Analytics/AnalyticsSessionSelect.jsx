import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

// How many sessions one reveal adds. The list grows a step at a time rather
// than unrolling every session at once - a learner with a hundred of them got a
// dropdown a hundred entries long the moment they clicked "see more".
const REVEAL_STEP = 5

export default function AnalyticsSessionSelect({
  value,
  options = [],
  onChange,
  label = 'Session',
  minWidthClass = 'min-w-[220px]',
  // How many sessions exist behind the ones loaded so far, and how to ask for
  // the next page. Without these the control still works - it just reveals
  // only what it was handed.
  totalCount = null,
  onLoadMore = null,
  loadingMore = false,
  // When set, adds a top "no session selected" entry (value '') so the user can
  // switch back to their overall/all-sessions view. e.g. "All Sessions".
  allOptionLabel = null,
  allOptionSub = 'Overall view across all your sessions',
}) {
  const [open, setOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(REVEAL_STEP)
  const containerRef = useRef(null)

  const selected = useMemo(
    () => options.find((option) => String(option.id) === String(value)) || null,
    [options, value]
  )
  // The "all sessions" entry is active whenever no real session is selected.
  const isAllSelected = Boolean(allOptionLabel) && !value

  const visibleOptions = options.slice(0, visibleCount)
  // What is left: the rest of what is loaded, plus whatever the server still
  // holds. Reported as one number, because the split is not the reader's
  // problem.
  const loadedRemaining = Math.max(0, options.length - visibleOptions.length)
  const unloadedRemaining = Math.max(0, (totalCount ?? options.length) - options.length)
  const hiddenCount = loadedRemaining + unloadedRemaining
  const canOpen = options.length > 0 || Boolean(allOptionLabel)

  const revealMore = () => {
    setVisibleCount((current) => current + REVEAL_STEP)
    // Fetch ahead only when the reveal would run past what is loaded.
    if (onLoadMore && options.length - visibleCount <= REVEAL_STEP && unloadedRemaining > 0) {
      onLoadMore()
    }
  }

  // Close on outside click or Escape; collapse the "see more" list on close.
  useEffect(() => {
    if (!open) {
      setVisibleCount(REVEAL_STEP)
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
                onClick={revealMore}
                disabled={loadingMore}
                className="w-full border-t border-border px-3 py-2 text-left text-xs font-medium text-primary hover:bg-muted disabled:opacity-60"
              >
                {loadingMore
                  ? 'Loading…'
                  : `Show ${Math.min(REVEAL_STEP, hiddenCount)} more (${hiddenCount} left)`}
              </button>
            )}

            {/* Says where the end is. A list that just stops looks like all
                there is. */}
            {hiddenCount === 0 && totalCount > REVEAL_STEP && (
              <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                All {totalCount} sessions shown
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
