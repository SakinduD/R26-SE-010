import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Card from '@/components/ui/Card'

/**
 * Small confirm dialog built on the app's own tokens.
 *
 * Deliberately not @/components/ui/alert-dialog: that one is Tailwind-styled
 * base-ui and would look foreign next to these Card/Banner surfaces.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const reduceMotion = useReducedMotion()
  const confirmRef = useRef(null)
  const previouslyFocused = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    previouslyFocused.current = document.activeElement
    confirmRef.current?.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused.current?.focus?.()
    }
  }, [open, busy, onCancel])

  const duration = reduceMotion ? 0 : 0.18

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration }}
          onClick={() => !busy && onCancel?.()}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: 'oklch(0 0 0 / 0.5)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-desc"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            transition={{ duration }}
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 420 }}
          >
            <Card variant="elevated">
              <div id="confirm-dialog-title" className="t-h3" style={{ margin: 0 }}>
                {title}
              </div>
              {description && (
                <p
                  id="confirm-dialog-desc"
                  className="t-cap"
                  style={{ marginTop: 8, lineHeight: 1.55 }}
                >
                  {description}
                </p>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'flex-end',
                  marginTop: 20,
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onCancel}
                  disabled={busy}
                >
                  <span className="btn-label">{cancelLabel}</span>
                </button>
                <button
                  ref={confirmRef}
                  type="button"
                  className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
                  onClick={onConfirm}
                  disabled={busy}
                >
                  <span className="btn-label">{busy ? 'Working…' : confirmLabel}</span>
                </button>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
