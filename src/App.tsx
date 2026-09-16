import { useEffect, useState, type ReactElement } from 'react'
import { NoisePage } from './pages/NoisePage'
import { ObjectViewerPage } from './pages/ObjectViewerPage'
import { VoxelPage } from './pages/VoxelPage'
import './App.css'

type PageId = 'objects' | 'noise' | 'voxels'

// One entry per week of the course; newest last.
const PAGES: { id: PageId; week: string; title: string; render: () => ReactElement }[] = [
  { id: 'objects', week: 'Week 1', title: '3D Objects', render: () => <ObjectViewerPage /> },
  { id: 'noise', week: 'Week 2', title: 'Noise', render: () => <NoisePage /> },
  { id: 'voxels', week: 'Week 3', title: 'Voxels', render: () => <VoxelPage /> },
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
        <nav className="week-nav">
          {PAGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`week-link${page === entry.id ? ' is-active' : ''}`}
              aria-current={page === entry.id ? 'page' : undefined}
              onClick={() => setPage(entry.id)}
            >
              <span className="week-label">{entry.week}</span>
              <span className="week-title">{entry.title}</span>
            </button>
          ))}
        </nav>
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
