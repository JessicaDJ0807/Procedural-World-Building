import { useState } from 'react'
import { ObjectViewerPage } from './pages/ObjectViewerPage'
import './App.css'

type PageId = 'objects'

// One entry per week of the course; newest last.
const PAGES: { id: PageId; week: string; title: string }[] = [
  { id: 'objects', week: 'Week 1', title: '3D Objects' },
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
        <ObjectViewerPage />
      </main>
    </div>
  )
}

export default App
