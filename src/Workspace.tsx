import { useCallback, useRef, useState, type ReactNode } from 'react'

type Bounds = { min: number; max: number; preferred: number }

const LEFT: Bounds = { min: 170, max: 420, preferred: 220 }
const RIGHT: Bounds = { min: 240, max: 560, preferred: 320 }

/** The canvas is the subject; neither panel may squeeze it below this. */
const MIN_CANVAS = 300

const KEY = (topic: string) => `pwb:panels:${topic}`

type Widths = { left: number; right: number }

const clamp = (value: number, { min, max }: Bounds) => Math.min(max, Math.max(min, value))

/**
 * Per topic, not global: Topic 2 has far more controls than Topic 1, so one
 * shared width would be wrong for both. localStorage can throw in a private
 * window and comes back empty after a cleared cache, so every access is
 * guarded and the defaults have to stand on their own.
 */
function readWidths(topic: string): Widths {
  const fallback = { left: LEFT.preferred, right: RIGHT.preferred }
  try {
    const raw = localStorage.getItem(KEY(topic))
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return fallback
    const { left, right } = parsed as Partial<Widths>
    return {
      left: typeof left === 'number' && Number.isFinite(left) ? clamp(left, LEFT) : fallback.left,
      right:
        typeof right === 'number' && Number.isFinite(right) ? clamp(right, RIGHT) : fallback.right,
    }
  } catch {
    return fallback
  }
}

function writeWidths(topic: string, widths: Widths) {
  try {
    localStorage.setItem(KEY(topic), JSON.stringify(widths))
  } catch {
    // Private windows and blocked site data both throw. A width that does not
    // survive a reload is a far smaller problem than a page that will not load.
  }
}

type WorkspaceProps = {
  /** Storage key and nothing else — widths are remembered per topic. */
  topic: string
  library: ReactNode
  inspector: ReactNode
  /** The viewport, which takes whatever the two panels leave. */
  children: ReactNode
}

export function Workspace({ topic, library, inspector, children }: WorkspaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Keyed by topic so switching topics re-reads that topic's widths; without
  // the key the component would keep the previous topic's state.
  const [widths, setWidths] = useState<Widths>(() => readWidths(topic))
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)

  // Available width is a runtime limit on top of the static bounds: on a narrow
  // window, two panels at their maximum would leave no canvas at all.
  const limit = useCallback(
    (side: 'left' | 'right', value: number, other: number) => {
      const bounds = side === 'left' ? LEFT : RIGHT
      const total = containerRef.current?.clientWidth ?? Infinity
      const room = Math.max(bounds.min, total - other - MIN_CANVAS)
      return Math.min(clamp(value, bounds), room)
    },
    [],
  )

  const apply = (side: 'left' | 'right', next: number) =>
    setWidths((current) => {
      const other = side === 'left' ? current.right : current.left
      const value = limit(side, next, other)
      return side === 'left' ? { ...current, left: value } : { ...current, right: value }
    })

  const onPointerDown = (side: 'left' | 'right') => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    setDragging(side)

    const move = (e: PointerEvent) => {
      const box = containerRef.current?.getBoundingClientRect()
      if (!box) return
      apply(side, side === 'left' ? e.clientX - box.left : box.right - e.clientX)
    }
    const up = () => {
      handle.releasePointerCapture(event.pointerId)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      setDragging(null)
      // Written on release rather than per frame: a drag fires hundreds of
      // moves and localStorage is synchronous.
      setWidths((current) => {
        writeWidths(topic, current)
        return current
      })
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  const onKeyDown = (side: 'left' | 'right') => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 1 : 16
    const current = side === 'left' ? widths.left : widths.right
    // Left panel grows rightward, right panel grows leftward — the same key has
    // to mean "wider" on both or the dividers fight each other.
    const delta =
      event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : null
    if (delta === null) return
    event.preventDefault()
    const next = side === 'left' ? current + delta : current - delta
    apply(side, next)
    writeWidths(topic, side === 'left' ? { ...widths, left: next } : { ...widths, right: next })
  }

  const reset = (side: 'left' | 'right') => () => {
    const next =
      side === 'left'
        ? { ...widths, left: LEFT.preferred }
        : { ...widths, right: RIGHT.preferred }
    setWidths(next)
    writeWidths(topic, next)
  }

  const divider = (side: 'left' | 'right', label: string) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      className={`workspace-divider${dragging === side ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown(side)}
      onKeyDown={onKeyDown(side)}
      onDoubleClick={reset(side)}
      title="Drag to resize · double-click to reset"
    />
  )

  return (
    <div
      ref={containerRef}
      className={`workspace${dragging ? ' is-dragging' : ''}`}
      // While dragging, the cursor must not flicker as it crosses the canvas,
      // and a drag over text must not select it.
      style={dragging ? { cursor: 'col-resize', userSelect: 'none' } : undefined}
    >
      <div className="workspace-library" style={{ width: widths.left }}>
        {library}
      </div>
      {divider('left', 'Resize the worlds panel')}
      <div className="workspace-canvas">{children}</div>
      {divider('right', 'Resize the controls panel')}
      <div className="workspace-inspector" style={{ width: widths.right }}>
        {inspector}
      </div>
    </div>
  )
}
