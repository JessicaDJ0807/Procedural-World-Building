import { useCallback, useEffect, useState } from 'react'
import { ExploreViewport, type Telemetry } from './ExploreViewport'
import { WORLDS, type WorldSpec } from './worlds'
import './explore.css'

const EMPTY: Telemetry = {
  x: 0, y: 0, z: 0, chunk: '0, 0', fps: 0, triangles: 0, instances: 0, buildMs: 0,
}

/**
 * Pick a world, then fly it.
 *
 * Two states and nothing between them. A presentation wants the fewest clicks
 * between opening the page and being inside a world, and anything resembling a
 * loading step is a thing that can go wrong in front of an audience.
 */
export function ExplorePage() {
  const [world, setWorld] = useState<WorldSpec | null>(null)
  const [locked, setLocked] = useState(false)
  const [lockToken, setLockToken] = useState(0)
  const [telemetry, setTelemetry] = useState<Telemetry>(EMPTY)
  const [hud, setHud] = useState(false)
  const [mode, setMode] = useState<'fly' | 'survey'>('fly')

  const enter = (next: WorldSpec) => {
    setWorld(next)
    setTelemetry(EMPTY)
    setMode('fly')
    // Deliberately does not ask for the pointer: the world opens behind the
    // curtain, and the click on the curtain is the gesture that takes it.
    setLocked(false)
  }

  // Escape releases the pointer by itself, which leaves the overlay up. A
  // second Escape is what leaves the world, so neither is a trap.
  useEffect(() => {
    if (!world) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) setWorld(null)
      if (event.key === 'F1' || (event.key === 'h' && !locked)) {
        event.preventDefault()
        setHud((v) => !v)
      }
      // M works whether or not the pointer is locked, so the overview is one
      // key away from anywhere — including mid-flight, which is the case that
      // matters when someone asks "where is that".
      if (event.key === 'm' || event.key === 'M') {
        event.preventDefault()
        setMode((v) => (v === 'fly' ? 'survey' : 'fly'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [world, locked])

  const onTelemetry = useCallback((t: Telemetry) => setTelemetry(t), [])
  const onLockChange = useCallback((value: boolean) => setLocked(value), [])

  if (!world) {
    return (
      <div className="explore-chooser">
        <div className="explore-chooser-inner">
          <h1 className="explore-title">Explore</h1>
          <p className="explore-lede">
            Three worlds from one generator. Every difference between them is a number
            in a spec — the terrain, the scatter and the renderer are the same code.
          </p>

          <div className="explore-cards">
            {WORLDS.map((entry) => (
              <article className={`explore-card is-${entry.id}`} key={entry.id}>
                <div className="explore-card-swatch" aria-hidden="true">
                  {entry.stops.map((stop) => (
                    <span key={stop} style={{ background: stop }} />
                  ))}
                </div>
                <h2>{entry.name}</h2>
                <p>{entry.blurb}</p>
                <button type="button" className="explore-enter" onClick={() => enter(entry)}>
                  Explore
                </button>
              </article>
            ))}
          </div>

          <p className="explore-note">
            <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to walk · mouse to look ·{' '}
            <kbd>Shift</kbd> to go faster · <kbd>R</kbd> and <kbd>F</kbd> to rise and drop,{' '}
            <kbd>G</kbd> back to the ground · <kbd>M</kbd> for the overview ·{' '}
            <kbd>Esc</kbd> to release the pointer, again to leave.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="explore-stage">
      <ExploreViewport
        world={world}
        onTelemetry={onTelemetry}
        onLockChange={onLockChange}
        lockToken={lockToken}
        mode={mode}
      />

      {!locked && mode === 'fly' && (
        // Click-to-explore, because pointer lock needs a gesture and a browser
        // that has just released the pointer will refuse an immediate re-lock.
        <button type="button" className="explore-curtain" onClick={() => setLockToken((n) => n + 1)}>
          <span className="explore-curtain-name">{world.name}</span>
          <span className="explore-curtain-cta">Click to explore</span>
          <span className="explore-curtain-look">{world.look}</span>
          <span className="explore-curtain-keys">
            <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>Shift</kbd> faster ·{' '}
            <kbd>R</kbd><kbd>F</kbd> fly, <kbd>G</kbd> land · <kbd>M</kbd> overview ·{' '}
            <kbd>Esc</kbd> again to leave
          </span>
        </button>
      )}

      {locked && mode === 'fly' && <div className="explore-reticle" aria-hidden="true" />}

      {hud && (
        <div className="explore-hud">
          <span>{world.name}</span>
          <span>
            {telemetry.x.toFixed(0)}, {telemetry.y.toFixed(0)}, {telemetry.z.toFixed(0)}
          </span>
          <span>chunk {telemetry.chunk}</span>
          <span>{telemetry.fps.toFixed(0)} fps</span>
          <span>{telemetry.triangles.toLocaleString()} tris</span>
          <span>{telemetry.instances.toLocaleString()} instances</span>
          <span>build {telemetry.buildMs.toFixed(1)} ms</span>
        </div>
      )}

      {!locked && (
        <div className="explore-actions">
          <button
            type="button"
            className={`explore-action${mode === 'survey' ? ' is-active' : ''}`}
            onClick={() => setMode((v) => (v === 'fly' ? 'survey' : 'fly'))}
          >
            {mode === 'survey' ? 'Back to the ground' : 'Overview'} <kbd>M</kbd>
          </button>
          {/* Esc genuinely does this: the handler leaves the world only while
              the pointer is released, which is exactly when this row is shown. */}
          <button type="button" className="explore-action" onClick={() => setWorld(null)}>
            Leave world <kbd>Esc</kbd>
          </button>
        </div>
      )}

      {mode === 'survey' && (
        <div className="explore-survey-note">
          <strong>{world.name}</strong> from 4,200 units across — the same height
          function the ground is built from, sampled coarsely. The pin is where you
          were standing.
        </div>
      )}
    </div>
  )
}
