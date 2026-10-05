import { useState, type ReactNode } from 'react'
import { InfoTip } from './InfoTip'

/**
 * A collapsible sidebar group.
 *
 * Only Topic 2 needs it — six sections of controls is more than fits on screen,
 * and scrolling past four of them to reach erosion is the whole problem. Open
 * by default, so nothing is hidden from someone who does not know it is there.
 */
export function ControlSection({
  title,
  info,
  defaultOpen = true,
  children,
}: {
  title: string
  info?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`control-section${open ? ' is-open' : ''}`}>
      <h3 className="control-group control-section-head">
        <button
          type="button"
          className="control-section-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="control-section-caret" aria-hidden="true">
            ▸
          </span>
          {info ? <InfoTip text={info}>{title}</InfoTip> : title}
        </button>
      </h3>
      {open && <div className="control-section-body">{children}</div>}
    </section>
  )
}
