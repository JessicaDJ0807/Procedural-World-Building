import type { ReactNode } from 'react'
import './project.css'

type ProjectLayoutProps = {
  title: string
  /** Under the title: the page's own argument for existing. A line, or a few paragraphs. */
  lede: ReactNode
  /**
   * A wider page, for a board of images rather than a column of prose. The
   * Overview lays three worlds side by side, which a reading measure of 880px
   * would squeeze into thumbnails.
   */
  wide?: boolean
  /** Anything that belongs in the header after the lede — actions, a note. */
  aside?: ReactNode
  children: ReactNode
}

/**
 * The reading shell for the Project pages that are read rather than driven.
 *
 * Its whole job is to be the opposite of `Workspace`. A Playground topic fills
 * the window edge to edge and puts a control within reach of every pixel,
 * because the thing being studied is the parameter space. These pages are
 * argument, not instrument: a measured column, generous margins, and room
 * above the first line. Explore, the one Project page that is driven, has its
 * own full-window stage instead.
 *
 * It owns its own scrolling. `#root` is `overflow: hidden` so the viewports can
 * size themselves against a fixed box, which means any page that runs past the
 * window has to make a scroll container or silently lose the overflow.
 */
export function ProjectLayout({ title, lede, wide = false, aside, children }: ProjectLayoutProps) {
  return (
    <div className="project-scroll">
      <div className={`project-page${wide ? ' is-wide' : ''}`}>
        <header className="project-head">
          <h1 className="project-title">{title}</h1>
          {typeof lede === 'string' ? <p className="project-lede">{lede}</p> : <div className="project-lede">{lede}</div>}
          {aside}
        </header>
        {children}
      </div>
    </div>
  )
}
