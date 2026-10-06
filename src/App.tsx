import { useEffect, useState, type ReactElement } from 'react'
import { AuthBar } from './AuthBar'
import { NoisePage } from './pages/NoisePage'
import { ObjectViewerPage } from './pages/ObjectViewerPage'
import { DistributionPage } from './pages/DistributionPage'
import { PathPage } from './pages/PathPage'
import { ShaderPage } from './pages/ShaderPage'
import { VoxelPage } from './pages/VoxelPage'
import { ExplorePage } from './explore/ExplorePage'
import { ProjectDemo } from './project/ProjectDemo'
import { ProjectOverview } from './project/ProjectOverview'
import { ProjectProgress } from './project/ProjectProgress'
import {
  DEFAULT_PLAYGROUND,
  DEFAULT_PROJECT,
  PLAYGROUND,
  PROJECT,
  SECTIONS,
  sameRoute,
  useRoute,
  type PlaygroundId,
  type ProjectId,
  type Route,
} from './routes'
import './App.css'

const PLAYGROUND_PAGES: Record<PlaygroundId, () => ReactElement> = {
  objects: () => <ObjectViewerPage />,
  maps: () => <NoisePage />,
  voxels: () => <VoxelPage />,
  shaders: () => <ShaderPage />,
  distributions: () => <DistributionPage />,
  paths: () => <PathPage />,
}

const PROJECT_PAGES: Record<ProjectId, (navigate: (route: Route) => void) => ReactElement> = {
  overview: (navigate) => <ProjectOverview navigate={navigate} />,
  demo: () => <ProjectDemo />,
  explore: () => <ExplorePage />,
  progress: (navigate) => <ProjectProgress navigate={navigate} />,
}

/**
 * Controls that must not swallow the shortcut.
 *
 * A letter key means something inside a select (type-ahead) or a text field, so
 * H there has to type rather than hide. Range and checkbox inputs ignore letters
 * anyway, and keep focus after a drag, so the shortcut stays live in the case
 * where it is most likely to be wanted.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'SELECT' || tag === 'TEXTAREA') return true
  if (tag !== 'INPUT') return false
  return !['range', 'checkbox', 'radio', 'button'].includes((target as HTMLInputElement).type)
}

function App() {
  const [route, navigate] = useRoute()
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Leave browser and OS chords alone.
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      if (event.key === 'h' || event.key === 'H') {
        event.preventDefault()
        setFocused((current) => !current)
      } else if (event.key === 'Escape') {
        // Always an exit, never an entrance: a key that only ever restores the
        // UI is what makes hiding it safe to try.
        setFocused(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Each section remembers nothing: Playground opens on its newest topic and
  // the Project on its Overview. A remembered sub-page would mean the same
  // click leading somewhere different depending on history, and these two are
  // front doors rather than places you were in the middle of.
  const enter = (section: (typeof SECTIONS)[number]['id']) =>
    navigate(section === 'playground' ? DEFAULT_PLAYGROUND : DEFAULT_PROJECT)

  const sub =
    route.section === 'playground'
      ? PLAYGROUND.map((entry) => ({
          route: { section: 'playground', page: entry.id } as Route,
          label: entry.topic,
          title: entry.title,
          hint: undefined as string | undefined,
        }))
      : PROJECT.map((entry) => ({
          route: { section: 'project', page: entry.id } as Route,
          // Project pages carry no topic number — the project is not a topic.
          label: undefined as string | undefined,
          title: entry.title,
          hint: entry.blurb,
        }))

  return (
    <div className={`app-shell${focused ? ' is-focused' : ''}`}>
      <header className="app-nav">
        <span className="app-brand">Procedural World Building</span>

        {/* The only two destinations at this level. Topic tabs never appear
            here: mixing them would put "Shaders" and "Project" side by side as
            if they were the same kind of thing. */}
        <nav className="section-nav" aria-label="Sections">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`section-link${route.section === section.id ? ' is-active' : ''}`}
              aria-current={route.section === section.id ? 'true' : undefined}
              title={section.hint}
              onClick={() => enter(section.id)}
            >
              {section.title}
            </button>
          ))}
        </nav>

        <AuthBar />
      </header>

      <nav
        className={`app-subnav is-${route.section}`}
        aria-label={route.section === 'playground' ? 'Topics' : 'Project pages'}
      >
        {sub.map((entry) => (
          <button
            key={`${entry.route.section}-${entry.route.page}`}
            type="button"
            className={`topic-link${sameRoute(route, entry.route) ? ' is-active' : ''}`}
            aria-current={sameRoute(route, entry.route) ? 'page' : undefined}
            title={entry.hint}
            onClick={() => navigate(entry.route)}
          >
            {entry.label && <span className="topic-label">{entry.label}</span>}
            <span className="topic-title">{entry.title}</span>
          </button>
        ))}
      </nav>

      <main className="app-page">
        {route.section === 'playground'
          ? PLAYGROUND_PAGES[route.page]()
          : PROJECT_PAGES[route.page](navigate)}
      </main>

      {/* Hiding every control with no visible way back would be a trap, so a
          reminder stays on screen — bright at first, then faint enough to
          ignore, and bright again on hover. */}
      {focused && (
        <button type="button" className="focus-hint" onClick={() => setFocused(false)}>
          <kbd>H</kbd> show controls
        </button>
      )}
    </div>
  )
}

export default App
