import { useCallback, useMemo, useRef, useState } from 'react'
import { InfoTip } from '../InfoTip'
import { Slider } from '../Slider'
import { sunDirection } from '../green/fields'
import { WILD_SPECIES } from '../wildform/species'
import { BuildViewport, DRAPER, type GameReport, type SurfaceView, type Tool } from './BuildViewport'
import { DRAPER_SWATCH } from './draperMesh'
import { BuildGame } from './game'
import { WorldMenu, type WorldSession } from './WorldMenu'
import { COMBO_NAMES, type Combo, type Kind } from './living'
import { BUDGET } from './town'
import '../study/study.css'
import '../green/green.css'
import '../wildform/wildform.css'
import './build.css'

const SPEEDS = [1, 4, 16]
/** Events shown before "Show history". */
const RECENT = 3

/** The plant behaviours the player can place, in the order they are listed. */
const BEHAVIOURS = [
  { id: 0, name: 'Climber', arrow: '↑', note: 'climbs, follows edges', swatch: WILD_SPECIES[0].look.swatch },
  { id: 1, name: 'Spreader', arrow: '↔', note: 'spreads, seeks light', swatch: WILD_SPECIES[1].look.swatch },
  { id: DRAPER, name: 'Draper', arrow: '↓', note: 'hangs from edges, follows gravity', swatch: DRAPER_SWATCH },
]

/** Remembers, per browser, that the first-visit card was dismissed. */
const INTRO_KEY = 'wildform.build.intro-dismissed'

function introDismissed(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return false
  }
}

/** Layered's swatch: the amber of growth over growth. */
const LAYERED_SWATCH = '#e0a352'

/** What each combination grows — the architectural outcome first, its recipe second. */
const OUTCOMES: { combo: Combo; name: string; kinds: Kind[]; rule: string }[] = [
  {
    combo: 'climber+spreader',
    name: 'Bridge / Balcony',
    kinds: ['bridge', 'balcony'],
    rule: 'Six cells of Climber and Spreader grown together, established and at least 1.8 units up the wall. A bridge if another building is within five columns of its face; otherwise a balcony (three at most).',
  },
  {
    combo: 'climber+layered',
    name: 'Scaffold',
    kinds: ['scaffold'],
    rule: 'A Climber grown over two layers, in two cells together: a helical scaffold up past the roof, with an arm across if another building is in reach.',
  },
  {
    combo: 'spreader+layered',
    name: 'Terrace / Canopy',
    kinds: ['terrace', 'canopy'],
    rule: 'A Spreader grown over two layers, in two cells together: a terrace if the roof is within a storey, else a canopy; it spans to another building in reach.',
  },
]

const KIND_LABEL: Record<Kind, [string, string]> = {
  bridge: ['bridge', 'bridges'],
  balcony: ['balcony', 'balconies'],
  scaffold: ['scaffold', 'scaffolds'],
  terrace: ['terrace', 'terraces'],
  canopy: ['canopy', 'canopies'],
}

const KIND_TITLE: Record<Kind, string> = { bridge: 'Bridge', balcony: 'Balcony', scaffold: 'Scaffold', terrace: 'Terrace', canopy: 'Canopy' }

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/** What the rain slider means for the plants, in words. */
function rainNote(rain: number): string {
  if (rain < 0.2) return 'Dry — growth slows, and stressed plants wither'
  if (rain < 0.45) return 'Light rain — moisture gathers low on the walls'
  if (rain < 0.7) return 'Moderate moisture'
  return 'Wet — moisture reaches high up the walls'
}

/**
 * Which walls the sun lights, from the growth model's sun: east and west as
 * the game names its two buildings, front and back as seen from where the
 * camera starts (the front walls face +z).
 */
function sunNote(azimuth: number): string {
  const [x, , z] = sunDirection(azimuth)
  const faces: string[] = []
  if (x < -0.3) faces.push('west')
  if (x > 0.3) faces.push('east')
  if (z > 0.3) faces.push('front')
  if (z < -0.3) faces.push('back')
  const list = faces.length === 2 ? `${faces[0]}- and ${faces[1]}-facing` : `${faces[0]}-facing`
  return `${list[0].toUpperCase()}${list.slice(1)} walls in sun`
}

/**
 * Build: the gameplay prototype. The player builds part of the architecture,
 * from a budget of blocks, and plants; the plants grow over it, and where
 * they meet they grow living architecture — bridges, scaffolds, terraces —
 * that the player can build on and around in turn.
 *
 *   build → plant → grow → plants meet → living architecture → build again
 *
 * The sidebar reads as the game's interface, top to bottom: the goal, what
 * the player is doing (mode), what they place (plant behaviour), what has
 * emerged from the plants meeting (interaction), the conditions, time, the
 * living architecture grown, and — lowest — the event log.
 */
export function BuildPage() {
  const game = useMemo(() => new BuildGame(), [])
  const [tool, setTool] = useState<Tool>('build')
  const [species, setSpecies] = useState(0)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(4)
  const [stepToken, setStepToken] = useState(0)
  const [revision, setRevision] = useState(0)
  const [report, setReport] = useState<GameReport | null>(null)
  const [env, setEnv] = useState(game.env)
  const [history, setHistory] = useState(false)
  const [surfaceView, setSurfaceView] = useState<SurfaceView>('off')
  const [intro, setIntro] = useState(() => !introDismissed())
  const dismissIntro = () => {
    setIntro(false)
    try {
      window.localStorage.setItem(INTRO_KEY, '1')
    } catch {
      // Private window or blocked storage: the card just comes back next visit.
    }
  }
  const changed = () => setRevision((r) => r + 1)
  const session = useRef<WorldSession | null>(null)
  const onSession = useCallback((s: WorldSession) => {
    session.current = s
  }, [])
  /** A world was opened or a new one started: paused, the scene redrawn, the controls showing its weather. */
  const onReplaced = useCallback(() => {
    setRunning(false)
    setEnv(game.env)
    setHistory(false)
    setRevision((r) => r + 1)
  }, [game])
  const setEnvironment = (patch: Partial<typeof env>) => {
    game.setEnvironment(patch)
    setEnv(game.env)
    changed()
  }

  const left = report?.left ?? BUDGET
  const coverage = (id: number) => (!report ? null : id === DRAPER ? report.draperCoverage : report.bySpecies[id])
  // The four steps to the goal, for the progress strip.
  const planted = !!report && (report.bySpecies[0] + report.bySpecies[1] > 0 || report.drapers > 0)
  const steps = [
    { label: 'Plant', done: planted },
    { label: 'Node', done: (report?.structures ?? 0) > 0 },
    { label: 'Mature', done: (report?.matured ?? 0) > 0 },
    { label: 'Join', done: !!report?.joined },
  ]
  const events = report?.events ?? []
  const shown = history ? events.slice().reverse() : events.slice(-RECENT).reverse()
  const behaviour = BEHAVIOURS.find((b) => b.id === species)!

  return (
    <div className="workspace green-workspace build-workspace">
      <div className="workspace-canvas">
        <BuildViewport game={game} tool={tool} species={species} running={running} speed={speed} stepToken={stepToken} revision={revision} surfaceView={surfaceView} onReport={setReport} />
        {intro && !report?.goal && (
          <div className="build-intro" role="note">
            <p>
              <strong>Goal:</strong> connect the structures using living architecture. Build what you need, then let plants
              complete what you don’t.
            </p>
            <button type="button" aria-label="Dismiss" onClick={dismissIntro}>
              Got it
            </button>
          </div>
        )}
        <div className="build-hint">
          {tool === 'build' && (
            <span>
              <strong>Click</strong> to place a block · <strong>right-click</strong> to remove
            </span>
          )}
          {tool === 'remove' && (
            <span>
              <strong>Click</strong> a block to remove it
            </span>
          )}
          {tool === 'plant' && species !== DRAPER && (
            <span>
              <strong>Click</strong> a wall, roof or mature structure to plant a {behaviour.name}
            </span>
          )}
          {tool === 'plant' && species === DRAPER && (
            <span>
              <strong>Click</strong> a wall, roof or mature living structure — the Draper hangs from the nearest edge
            </span>
          )}
          <span>
            <strong>Drag</strong> to rotate · <strong>right-drag</strong> to move · <strong>scroll</strong> to zoom
          </span>
        </div>
      </div>
      <div className="workspace-inspector green-inspector">
        <aside className="control-sidebar build-sidebar" aria-label="Build controls">
          <WorldMenu game={game} changes={report?.changes ?? game.changes} onReplaced={onReplaced} onSession={onSession} />
          {/* ---- Goal ---- */}
          <section className="build-section">
            <h3 className="control-group">
              <InfoTip text="The two buildings stand eight columns apart; a living bridge reaches about five. Bring them within reach with blocks — a wing, or a stepping-stone between — and let the plants make the connection. If blocks join them, they become one building, and it doesn't count.">
                Goal
              </InfoTip>
            </h3>
            {report?.goal ? (
              <div className="build-done" role="status">
                <strong>✓ Goal complete</strong>
                <span>
                  West ↔ East connected, with {report.placed} of {BUDGET} blocks
                </span>
              </div>
            ) : (
              <>
                <p className="build-goal">Join the two buildings with living architecture</p>
                <ol className="build-steps" aria-label="Progress">
                  {steps.map((s) => (
                    <li key={s.label} className={s.done ? 'is-done' : ''}>
                      <span aria-hidden="true" />
                      {s.label}
                    </li>
                  ))}
                </ol>
              </>
            )}
            <dl className="build-stats">
              <div>
                <dt>Living connections</dt>
                <dd>{report?.connections ?? 0}</dd>
              </div>
              <div>
                <dt>West ↔ East joined</dt>
                <dd className={report?.joined ? 'is-yes' : ''}>{report?.joined ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
            {report?.merged && <p className="build-warn">Blocks have made them one building — the living link must do the joining.</p>}
            {!report?.goal && !report?.merged && <p className="build-tip">Plant Climber and Spreader together on walls facing the other building: where they meet up the wall, a bridge can grow.</p>}
          </section>

          {/* ---- Mode ---- */}
          <section className="build-section">
            <h3 className="control-group">
              <InfoTip text="Build places a block, Remove takes one away, Plant places the plant behavior chosen below. Right-click removes in any mode. Blocks are rigid architecture: immediate, but each costs one from the budget. The two existing buildings are free, and stay.">
                Mode
              </InfoTip>
            </h3>
            <div className="build-modes" role="radiogroup" aria-label="Mode">
              {(['build', 'remove', 'plant'] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={tool === t} className={`build-mode${tool === t ? ' is-active' : ''}`} onClick={() => setTool(t)}>
                  {t === 'build' ? 'Build' : t === 'remove' ? 'Remove' : 'Plant'}
                </button>
              ))}
            </div>
            <div className="build-budget">
              <span>
                Blocks <strong>{left}</strong> / {BUDGET}
              </span>
              <span className="build-budget-bar" aria-hidden="true">
                <span style={{ width: `${(left / BUDGET) * 100}%` }} />
              </span>
            </div>
            <div className="build-actions">
              <button
                type="button"
                disabled={!report?.canUndo}
                onClick={() => {
                  if (game.undo()) changed()
                }}
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => {
                  game.clearBlocks()
                  changed()
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (session.current && !(await session.current.confirmDiscard('Restart'))) return
                  setRunning(false)
                  game.restart()
                  changed()
                }}
              >
                Restart
              </button>
            </div>
          </section>

          {/* ---- Plant behaviour ---- */}
          <section className="build-section">
            <h3 className="control-group build-group-head">
              <InfoTip text="What the Plant mode places. Climber and Spreader are planted on a wall, a roof of any pitch, or a mature living structure — anywhere but glass, with a note on how well the surface suits them; a Draper anchors on the nearest edge above the click — a roof, a ledge, or a mature living structure — and hangs. Coverage is the share of the building's growable surface each holds; for the Draper, the surface its curtains hang over (a curtain in open air, under a deck, counts none).">
                Plant behavior
              </InfoTip>
              <span className="build-col-head">Coverage</span>
            </h3>
            <div className="build-rows" role="radiogroup" aria-label="Plant behavior">
              {BEHAVIOURS.map((b) => {
                const selected = species === b.id
                const c = coverage(b.id)
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`build-row is-pickable${selected ? ' is-selected' : ''}${selected && tool === 'plant' ? ' is-armed' : ''}`}
                    style={{ ['--row-accent' as string]: b.swatch }}
                    title={b.id === DRAPER && report ? `${report.drapers} planted · ${report.strands} strands · ${report.rooted} rooted in the lawn` : undefined}
                    onClick={() => {
                      setSpecies(b.id)
                      setTool('plant')
                    }}
                  >
                    <span className="build-row-swatch" style={{ background: b.swatch }} aria-hidden="true" />
                    <span className="build-row-text">
                      <span className="build-row-name">
                        {b.name} <span className="build-row-arrow" aria-hidden="true">{b.arrow}</span>
                      </span>
                      <span className="build-row-note">{b.note}</span>
                    </span>
                    <span className="build-row-value">{c === null ? '—' : pct(c)}</span>
                  </button>
                )
              })}
            </div>
            {tool !== 'plant' && <p className="build-tip">Choosing a plant switches to Plant mode.</p>}
          </section>

          {/* ---- Interaction ---- */}
          <section className="build-section">
            <h3 className="control-group build-group-head">
              <InfoTip text="Not a plant to place: what forms where plants grow over each other. Layered growth is what the mutation rules read — enough of it, and a mutation node forms.">Interaction</InfoTip>
              <span className="build-col-head">Coverage</span>
            </h3>
            <div className="build-rows">
              <div className="build-row is-derived">
                <span className="build-row-swatch" style={{ background: LAYERED_SWATCH }} aria-hidden="true" />
                <span className="build-row-text">
                  <span className="build-row-name">Layered</span>
                  <span className="build-row-note">overlap · accumulated growth</span>
                </span>
                <span className="build-row-value">{report ? pct(report.layered) : '—'}</span>
              </div>
            </div>
            <div className="build-recent">
              <span className="build-recent-label">Recent mutation</span>
              {report?.lastMutation ? (
                <span>
                  {COMBO_NAMES[report.lastMutation.combo]} → <strong>{KIND_TITLE[report.lastMutation.kind]}</strong>
                  <span className="build-recent-step"> · step {report.lastMutation.step.toLocaleString()}</span>
                </span>
              ) : (
                <span className="build-muted">None yet</span>
              )}
            </div>
          </section>

          {/* ---- Environment ---- */}
          <section className="build-section">
            <h3 className="control-group">Environment</h3>
            <Slider label="Rain" value={env.rain} display={`${Math.round(env.rain * 100)}%`} min={0} max={1} step={0.01} onChange={(v) => setEnvironment({ rain: v })} />
            <p className="build-env-note">{rainNote(env.rain)}</p>
            <Slider label="Sun direction" value={env.sunAzimuth} display={`${Math.round(env.sunAzimuth)}°`} min={-180} max={180} step={1} onChange={(v) => setEnvironment({ sunAzimuth: v })} />
            <p className="build-env-note">{sunNote(env.sunAzimuth)}</p>
          </section>

          {/* ---- Growth ---- */}
          <section className="build-section">
            <h3 className="control-group">Growth</h3>
            <div className="build-transport">
              <button type="button" className={`build-play${running ? ' is-running' : ''}`} onClick={() => setRunning((r) => !r)}>
                <span aria-hidden="true">{running ? '❚❚' : '▶'}</span> {running ? 'Pause' : 'Play'}
              </button>
              <button type="button" className="build-step" disabled={running} onClick={() => setStepToken((t) => t + 1)}>
                Step
              </button>
              <span className="build-stepcount">
                Step <strong>{(report?.step ?? 0).toLocaleString()}</strong>
              </span>
            </div>
            <div className="build-speed">
              <span>Speed</span>
              <div className="segmented" role="radiogroup" aria-label="Speed">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={speed === s} className={`segmented-option${speed === s ? ' is-active' : ''}`} onClick={() => setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* ---- Living architecture ---- */}
          <section className="build-section">
            <h3 className="control-group">
              <InfoTip text="Where layered growth gathers, a mutation node forms, and a structure grows from it in stages: a knot, a frame, a surface, maturity — when it becomes usable, casts shade and gives climbers support — then vegetation. What grows depends on what met there, and on the walls, plants and space around it.">
                Living architecture
              </InfoTip>
            </h3>
            <ul className="build-outcomes">
              {OUTCOMES.map((o) => {
                const parts = o.kinds.filter((k) => report?.byKind[k]).map((k) => `${report!.byKind[k]} ${KIND_LABEL[k][report!.byKind[k] === 1 ? 0 : 1]}`)
                return (
                  <li key={o.combo}>
                    <span className="build-outcome-name">{o.name}</span>
                    <strong className="build-outcome-count">{report?.byCombo[o.combo] ?? 0}</strong>
                    <span className="build-outcome-recipe">
                      {COMBO_NAMES[o.combo]}
                      {o.kinds.length > 1 && parts.length > 0 && ` · ${parts.join(', ')}`}
                    </span>
                  </li>
                )
              })}
            </ul>
            <details className="build-rules-toggle">
              <summary>View mutation rules</summary>
              <ul>
                {OUTCOMES.map((o) => (
                  <li key={o.combo}>
                    <strong>{COMBO_NAMES[o.combo]}</strong> → {o.name.toLowerCase()}. {o.rule}
                  </li>
                ))}
                <li>A structure matures 300 steps after its node: from then it shades the plants under it and gives Climbers support.</li>
              </ul>
            </details>
          </section>

          {/* ---- Events ---- */}
          <section className="build-section is-quiet">
            <h3 className="control-group">Events</h3>
            {events.length ? (
              <>
                <ol className={`build-events${history ? ' is-history' : ''}`}>
                  {shown.map((e, k) => (
                    <li key={`${k}-${e.step}-${e.text}`}>
                      <span className="build-event-step">{e.step.toLocaleString()}</span>
                      <span>{e.text}</span>
                    </li>
                  ))}
                </ol>
                {events.length > RECENT && (
                  <button type="button" className="build-history" aria-expanded={history} onClick={() => setHistory((h) => !h)}>
                    {history ? 'Show recent ▴' : `Show history (${events.length}) ▾`}
                  </button>
                )}
              </>
            ) : (
              <p className="build-muted">Nothing yet. Plant both species on a wall that faces the other building, then press Play.</p>
            )}
          </section>

          {/* ---- Debug: surface suitability ---- */}
          <section className="build-section is-quiet">
            <h3 className="control-group">
              <InfoTip text="Every growth cell as a dot, coloured by how well it suits one behavior: red poor, yellow fair, green good; grey is glass. Climber and Spreader show the suitability their growth reads — light, moisture, geometry and the surface's slope. Draper shows how good a hanging anchor each place is. Plants are hidden while it shows.">
                Surface view
              </InfoTip>
            </h3>
            <div className="segmented" role="radiogroup" aria-label="Surface view">
              {(['off', 'climber', 'spreader', 'draper'] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={surfaceView === v} className={`segmented-option${surfaceView === v ? ' is-active' : ''}`} onClick={() => setSurfaceView(v)}>
                  {v === 'off' ? 'Off' : v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            {surfaceView !== 'off' && (
              <p className="build-view-legend">
                <span className="build-view-ramp" aria-hidden="true" />
                <span>poor</span>
                <span>good</span>
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
