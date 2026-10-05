import { useEffect, useState, type ReactElement } from 'react'
import { AuthBar } from './AuthBar'
import { NoisePage } from './pages/NoisePage'
import { ObjectViewerPage } from './pages/ObjectViewerPage'
import { ShaderPage } from './pages/ShaderPage'
import { VoxelPage } from './pages/VoxelPage'
import './App.css'

type PageId = 'objects' | 'maps' | 'voxels' | 'shaders'

// One entry per topic, newest last.
//
// Topics rather than weeks: the course meets weekly but not every week
// produces a page — some are lectures — so a "Week 3" label would drift
// further from the calendar with every gap, and numbering it honestly would
// mean leaving holes. A topic is the unit of work, and it never has gaps.
const PAGES: { id: PageId; topic: string; title: string; render: () => ReactElement }[] = [
  { id: 'objects', topic: 'Topic 1', title: 'Objects', render: () => <ObjectViewerPage /> },
  { id: 'maps', topic: 'Topic 2', title: 'Maps', render: () => <NoisePage /> },
  { id: 'voxels', topic: 'Topic 3', title: 'Voxels', render: () => <VoxelPage /> },
  { id: 'shaders', topic: 'Topic 4', title: 'Shaders', render: () => <ShaderPage /> },
]

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
  const [page, setPage] = useState<PageId>(PAGES[PAGES.length - 1].id)
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

  return (
    <div className={`app-shell${focused ? ' is-focused' : ''}`}>
      <header className="app-nav">
        <span className="app-brand">Procedural World Building</span>
        <nav className="topic-nav">
          {PAGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`topic-link${page === entry.id ? ' is-active' : ''}`}
              aria-current={page === entry.id ? 'page' : undefined}
              onClick={() => setPage(entry.id)}
            >
              <span className="topic-label">{entry.topic}</span>
              <span className="topic-title">{entry.title}</span>
            </button>
          ))}
        </nav>
        <AuthBar />
      </header>

      <main className="app-page">
        {PAGES.find((entry) => entry.id === page)?.render()}
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
