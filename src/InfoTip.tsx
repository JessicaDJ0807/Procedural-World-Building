import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type InfoTipProps = {
  /** What the term means. Plain prose — this is the explanation, not a label. */
  text: string
  children: ReactNode
}

const GAP = 10 // between the trigger and the box
const MARGIN = 8 // smallest distance the box keeps from the window edge

/**
 * Hover explanation for a control.
 *
 * Rendered into a portal with fixed positioning rather than next to its
 * trigger, because the sidebar scrolls: `overflow-y: auto` clips any absolutely
 * positioned child, so an in-place tooltip would be cut off by the very panel
 * it belongs to.
 *
 * The box sits to the LEFT of its trigger. The sidebar is only 296px wide and
 * hard against the right edge of the window, so that is the only side with room
 * for a readable line length.
 */
export function InfoTip({ text, children }: InfoTipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const id = useId()

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setAnchor({ top: rect.top, right: window.innerWidth - rect.left + GAP })
  }
  const hide = () => setAnchor(null)

  // The box is placed from its trigger's top, then nudged up if that would run
  // it off the bottom — which its own height is the only way to know.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!anchor || !box) return
    const height = box.getBoundingClientRect().height
    const overflow = anchor.top + height + MARGIN - window.innerHeight
    if (overflow > 0) box.style.top = `${Math.max(MARGIN, anchor.top - overflow)}px`
  }, [anchor])

  return (
    <>
      <span
        ref={triggerRef}
        className="infotip-trigger"
        // Focusable so the explanation is reachable without a pointer, and
        // described-by only while open so a screen reader is not told about a
        // tooltip that is not showing.
        tabIndex={0}
        aria-describedby={anchor ? id : undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(event) => {
          if (event.key === 'Escape') hide()
        }}
      >
        {children}
      </span>

      {anchor &&
        createPortal(
          <span
            ref={boxRef}
            id={id}
            role="tooltip"
            className="infotip-box"
            style={{ top: anchor.top, right: anchor.right }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  )
}
