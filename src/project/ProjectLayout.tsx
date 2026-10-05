import type { ReactNode } from 'react'
import './project.css'

type ProjectLayoutProps = {
  title: string
  /** One line under the title. The page's own argument for existing. */
  lede: string
  children: ReactNode
}

/**
 * The reading shell for the Project pages that are read rather than driven.
 *
 * Its whole job is to be the opposite of `Workspace`. A Playground topic fills
 * the window edge to edge and puts a control within reach of every pixel,
 * because the thing being studied is the parameter space. These pages are
 * argument, not instrument: a measured column, generous margins, and room
 * above the first line.
 *
 * It owns its own scrolling. `#root` is `overflow: hidden` so the viewports can
 * size themselves against a fixed box, which means any page that runs past the
 * window has to make a scroll container or silently lose the overflow.
 *
 * The Demo does not use this — it is an instrument, and borrows `Workspace`
 * from the Playground instead.
 */
export function ProjectLayout({ title, lede, children }: ProjectLayoutProps) {
  return (
    <div className="project-scroll">
      <div className="project-page">
        <header className="project-head">
          <h1 className="project-title">{title}</h1>
          <p className="project-lede">{lede}</p>
        </header>
        {children}
      </div>
    </div>
  )
}
