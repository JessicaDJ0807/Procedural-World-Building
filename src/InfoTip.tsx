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
 * ## Which side it opens on
 *
 * The left, when there is room, and the right when there is not.
 *
 * It used to open left unconditionally, and the reason was written down: every
 * tooltip lived in the inspector, which is a narrow column hard against the
 * right edge of the window, so left was the only side with room for a readable
 * line. That stopped being true when the worlds library — on the *left* — grew
 * headings of its own. A 280px box opening leftward from a trigger 16px in from
 * the window edge is entirely off-screen, which is exactly what it did.
 *
 * So the side is measured rather than assumed. Left stays the preference, so
 * nothing moves for the inspector tips that were already correct.
 */
export function InfoTip({ text, children }: InfoTipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number; right: number } | null>(null)
  const id = useId()

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setAnchor({ top: rect.top, left: rect.left, right: rect.right })
  }
  const hide = () => setAnchor(null)

  /**
   * Placed from its own measured size, which is the only way to know whether a
   * side has room. This runs before paint, so the box is never seen at the
   * position React first committed it to.
   */
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!anchor || !box) return
    const { width, height } = box.getBoundingClientRect()

    const fitsLeft = anchor.left - GAP - width >= MARGIN
    const fitsRight = anchor.right + GAP + width <= window.innerWidth - MARGIN
    // Neither side fits on a narrow window; clamping is better than choosing a
    // side and letting half the text leave the screen.
    const left = fitsLeft
      ? anchor.left - GAP - width
      : fitsRight
        ? anchor.right + GAP
        : Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN))

    const overflow = anchor.top + height + MARGIN - window.innerHeight
    const top = overflow > 0 ? Math.max(MARGIN, anchor.top - overflow) : anchor.top

    box.style.left = `${left}px`
    box.style.top = `${top}px`
    box.style.visibility = 'visible'
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
            // Hidden rather than positioned until measured. `visibility` still
            // lays the box out, so its width is readable; `display: none` would
            // measure zero and the side could never be chosen.
            style={{ top: 0, left: 0, visibility: 'hidden' }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  )
}
