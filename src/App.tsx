import { useState } from 'react'
import { NoisePage } from './pages/NoisePage'
import { ObjectViewerPage } from './pages/ObjectViewerPage'
import './App.css'

type PageId = 'objects' | 'noise'

// One entry per week of the course; newest last.
const PAGES: { id: PageId; week: string; title: string }[] = [
  { id: 'objects', week: 'Week 1', title: '3D Objects' },
  { id: 'noise', week: 'Week 2', title: 'Noise' },
]

function App() {
  const [page, setPage] = useState<PageId>(PAGES[PAGES.length - 1].id)

  return (
    <div className="app-shell">
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
        {page === 'objects' ? <ObjectViewerPage /> : <NoisePage />}
      </main>
    </div>
  )
}

export default App
