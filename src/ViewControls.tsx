import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Display-only controls, floated over the viewport instead of taking sidebar
 * width for good.
 *
 * The split it enforces: the right sidebar answers "how is this made", this
 * answers "how am I looking at it". A control belongs here only if changing it
 * leaves the generated world identical.
 *
 * An eye rather than a gear — a gear reads as application settings, and none of
 * these are.
 */
export function ViewControls({ children, label = 'View' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    // pointerdown rather than click: a drag that starts outside should dismiss
    // immediately, not wait for a mouseup that may never land on the document.
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="view-controls" ref={wrapRef}>
      <button
        type="button"
        className={`view-button${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label={`${label} options`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M1.8 10S4.9 4.6 10 4.6 18.2 10 18.2 10 15.1 15.4 10 15.4 1.8 10 1.8 10Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="10" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <span>{label}</span>
      </button>

      {open && (
        <div className="view-popover" role="group" aria-label={`${label} options`}>
          {children}
        </div>
      )}
    </div>
  )
}
