import { useMemo, useReducer, useState } from 'react'
import { ProjectLayout } from '../project/ProjectLayout'
import type { Route } from '../routes'
import { KIND_NAMES } from '../build/living'
import { Town } from '../build/town'
import { BEHAVIOR_NAMES, COATS, WALK_SPEED, sendTo, standingOn, type Behavior, type Inhabitant } from './agent'
import { POSES, POSE_NAMES, HEIGHT, type Pose } from './inhabitantMesh'
import { SCENARIOS, StudioSim } from './scenarios'
import { StudioViewport, type Overlays } from './StudioViewport'
import './inhabitants.css'

type Plate = { id: string; name: string; blurb: string }
const PLATES: Plate[] = [{ id: 'portrait', name: 'Portrait', blurb: 'One inhabitant on a plinth: its proportions, colours and every animation.' }, ...SCENARIOS]

/** What each behavior means, in a line: the page's legend and the inspector's gloss. */
const BEHAVIOR_TEXT: Record<Behavior, string> = {
  idle: 'Resting between walks, or waiting with exploring off.',
  exploring: 'Walking to a random spot in its own region.',
  discovering: 'A living structure joined its region: it walks over to see it.',
  travelling: 'Walking to a place it was sent.',
  'no-route': 'Sent somewhere it can’t reach — another region, or bare wall.',
  stranded: 'The growth under it withered, and nothing walkable is near.',
}

/** Buildings named by where they stand: "the west building", or just "the building" when there is one. */
function buildingNames(sim: StudioSim): Map<number, string> {
  const town = sim.game.town
  const masses = town.masses()
  const sum = new Map<number, { x: number; n: number }>()
  for (let x = 0; x < 14; x++)
    for (let z = 0; z < 14; z++)
      for (let y = 0; y < 8; y++) {
        if (!town.filled(x, y, z)) continue
        const m = masses[Town.index(x, y, z)]
        const s = sum.get(m) ?? { x: 0, n: 0 }
        s.x += x
        s.n++
        sum.set(m, s)
      }
  const sorted = [...sum].sort((a, b) => a[1].x / a[1].n - b[1].x / b[1].n)
  const names = new Map<number, string>()
  sorted.forEach(([m], k) => names.set(m, sorted.length === 1 ? 'the building' : k === 0 ? 'the west building' : k === sorted.length - 1 ? 'the east building' : 'the middle building'))
  return names
}

/**
 * Inhabitants: a studio for the creatures that live on the green. A
 * portrait, and four test scenes run with the same agents, navigation and
 * models as Play (scenarios.ts) — inspected live, and sent about by
 * clicking. Nothing here touches a saved world.
 */
export function InhabitantsPage({ navigate }: { navigate: (route: Route) => void }) {
  const [plateId, setPlateId] = useState('portrait')
  const [epoch, setEpoch] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [selected, setSelected] = useState(1)
  const [overlays, setOverlays] = useState<Overlays>({ labels: false, path: false, walkable: false })
  const [coat, setCoat] = useState(0)
  const [pose, setPose] = useState<Pose>('idle')
  const [resetToken, setResetToken] = useState(0)
  const [follow, setFollow] = useState(true)
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const plate = PLATES.find((p) => p.id === plateId)!
  // A fresh game for each scenario and each reset: never saved, never shared with Play.
  const sim = useMemo(() => {
    const sc = SCENARIOS.find((s) => s.id === plateId)
    return sc ? new StudioSim(sc) : null
    // epoch: a reset builds the scenario again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plateId, epoch])
  const agent = sim?.agents.find((a) => a.id === selected) ?? sim?.agents[0]
  const names = useMemo(() => (sim ? buildingNames(sim) : new Map<number, string>()), [sim])

  const choose = (id: string) => {
    setPlateId(id)
    setSelected(1)
    setPlaying(true)
  }
  const toggle = (k: keyof Overlays) => setOverlays((o) => ({ ...o, [k]: !o[k] }))

  const where = (a: Inhabitant) => {
    if (!sim) return ''
    const s = standingOn(a, sim.nav)
    if (s.structure >= 0) {
      const kind = sim.game.living.find((l) => l.id === s.structure)?.kind
      return kind ? `crossing a ${KIND_NAMES[kind].replace('living ', '')}` : 'on living architecture'
    }
    if (s.mass >= 0) return `on ${names.get(s.mass) ?? 'a building'}`
    return 'nowhere walkable'
  }
  const placeOfCell = (cell: number) => {
    if (!sim) return ''
    const p = sim.nav.placeOf(cell)
    if (p.structure >= 0) {
      const kind = sim.game.living.find((l) => l.id === p.structure)?.kind
      return kind ? `the ${KIND_NAMES[kind].replace('living ', '')}` : 'living architecture'
    }
    return p.mass >= 0 ? (names.get(p.mass) ?? 'a building') : 'somewhere'
  }

  const region = agent && sim && agent.cell >= 0 ? sim.nav.region[agent.cell] : -1
  const moving = !!agent && agent.next >= 0

  return (
    <ProjectLayout
      wide
      title="Inhabitants"
      lede={
        <>
          <p className="project-tagline">The Little Lives of Wildform</p>
          <p>
            Wildform’s architecture doesn’t exist in isolation. Its inhabitants explore the spaces around them, respond to
            changes in the environment, and discover new paths as living structures emerge. This studio lets us examine
            their design and behavior.
          </p>
        </>
      }
    >
      <section className="project-section studio" aria-label="Studio">
        <nav className="studio-index" aria-label="Scenes">
          {PLATES.map((p, k) => (
            <button key={p.id} type="button" className={`studio-tab${p.id === plateId ? ' is-active' : ''}`} aria-pressed={p.id === plateId} onClick={() => choose(p.id)}>
              <span className="studio-num">{String(k).padStart(2, '0')}</span>
              <span className="studio-tab-name">{p.name}</span>
            </button>
          ))}
        </nav>

        <div className="studio-body">
          <div className="studio-stage">
            <StudioViewport
              sim={sim}
              portrait={{ coat, pose }}
              playing={playing}
              selected={agent?.id ?? 1}
              overlays={overlays}
              follow={follow && !!sim}
              resetToken={resetToken}
              onPick={(cell) => {
                if (sim && agent) {
                  sendTo(agent, sim.nav, cell)
                  tick()
                }
              }}
              onTick={tick}
            />
            <div className="studio-plate">
              <strong>{plate.name}</strong>
              <span>{plate.blurb}</span>
            </div>
            {sim && (
              <div className="studio-overlays" role="group" aria-label="Overlays">
                {(
                  [
                    ['labels', 'Labels'],
                    ['path', 'Route'],
                    ['walkable', 'Walkable'],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={overlays[k]} className={overlays[k] ? 'is-active' : ''} onClick={() => toggle(k)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {overlays.walkable && sim && (
              <div className="studio-legend">
                <span><i style={{ background: '#5aa05a' }} />Reachable from where {agent ? `#${agent.id}` : 'it'} stands</span>
                <span><i style={{ background: '#c0584a' }} />Walkable, but another region</span>
              </div>
            )}
            <div className="studio-controls">
              {sim ? (
                <>
                  <button type="button" className="studio-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
                    {playing ? '❚❚' : '▶'}
                  </button>
                  <button type="button" onClick={() => (setEpoch((e) => e + 1), setPlaying(true))}>
                    Reset scene
                  </button>
                  <span className="studio-chips" role="radiogroup" aria-label="Inhabitant">
                    {sim.agents.map((a) => (
                      <button key={a.id} type="button" role="radio" aria-checked={agent?.id === a.id} className={agent?.id === a.id ? 'is-active' : ''} onClick={() => setSelected(a.id)}>
                        <i style={{ background: COATS[a.coat].body }} />#{a.id}
                      </button>
                    ))}
                  </span>
                  <label className="studio-check">
                    <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                    Follow
                  </label>
                  {agent && (
                    <label className="studio-check">
                      <input
                        type="checkbox"
                        checked={agent.autoExplore}
                        onChange={(e) => {
                          agent.autoExplore = e.target.checked
                          tick()
                        }}
                      />
                      Explore on its own
                    </label>
                  )}
                  {sim.scenario.growth && (
                    <span className="studio-step">
                      Step {sim.game.sim.step} · {sim.game.living.some((l) => l.matured) ? 'the bridge has matured' : sim.game.living.length ? 'a bridge is growing — matures 300 steps after it forms' : 'no structure yet'}
                    </span>
                  )}
                  <span className="studio-hint">Click the scene to send #{agent?.id} there</span>
                </>
              ) : (
                <>
                  <span className="studio-chips" role="radiogroup" aria-label="Coat">
                    {COATS.map((c, k) => (
                      <button key={c.name} type="button" role="radio" aria-checked={coat === k} className={coat === k ? 'is-active' : ''} onClick={() => setCoat(k)}>
                        <i style={{ background: c.body }} />
                        {c.name}
                      </button>
                    ))}
                  </span>
                  <span className="studio-chips" role="radiogroup" aria-label="Animation">
                    {POSES.map((p) => (
                      <button key={p} type="button" role="radio" aria-checked={pose === p} className={pose === p ? 'is-active' : ''} onClick={() => setPose(p)}>
                        {POSE_NAMES[p]}
                      </button>
                    ))}
                  </span>
                </>
              )}
              <button type="button" className="studio-reset" onClick={() => (setFollow(false), setResetToken((t) => t + 1))}>
                Reset view
              </button>
            </div>
          </div>

          <aside className="studio-inspector" aria-label="Inspector" aria-live="off">
            {sim && agent ? (
              <>
                <p className="studio-who">
                  <i style={{ background: COATS[agent.coat].body }} />
                  Inhabitant #{agent.id} <span>· {COATS[agent.coat].name}</span>
                </p>
                <p className={`studio-behavior is-${agent.behavior}`}>{BEHAVIOR_NAMES[agent.behavior]}</p>
                <p className="studio-why">{agent.why}.</p>
                <dl className="studio-facts">
                  <dt>Where</dt>
                  <dd>{where(agent)}</dd>
                  <dt>Destination</dt>
                  <dd>{agent.destination >= 0 ? placeOfCell(agent.destination) : '—'}</dd>
                  <dt>Route</dt>
                  <dd>
                    {agent.behavior === 'no-route'
                      ? 'None'
                      : agent.destination >= 0
                        ? `Yes — ${agent.path.length + (moving ? 1 : 0)} cells to go`
                        : '—'}
                  </dd>
                  <dt>Speed</dt>
                  <dd>{moving ? `${WALK_SPEED} units/s · a storey in ${(3 / WALK_SPEED).toFixed(0)} s` : 'Still'}</dd>
                  <dt>Region</dt>
                  <dd>
                    {region >= 0
                      ? `${sim.nav.regionSize[region].toLocaleString()} walkable cells · ${sim.nav.regionMasses[region].size} ${sim.nav.regionMasses[region].size === 1 ? 'building' : 'buildings'} · ${sim.nav.regionStructures[region].size} ${sim.nav.regionStructures[region].size === 1 ? 'structure' : 'structures'}`
                      : '—'}
                  </dd>
                </dl>
                <p className="studio-gloss">{BEHAVIOR_TEXT[agent.behavior]}</p>
                <details className="studio-details">
                  <summary>Technical details</summary>
                  <dl>
                    <dt>Cell / next</dt>
                    <dd>
                      {agent.cell} / {agent.next} ({agent.t.toFixed(2)})
                    </dd>
                    <dt>Position</dt>
                    <dd>{agent.pos.map((n) => n.toFixed(2)).join(', ')}</dd>
                    <dt>Up</dt>
                    <dd>{agent.up.map((n) => n.toFixed(2)).join(', ')}</dd>
                    <dt>In behavior for</dt>
                    <dd>{agent.age.toFixed(1)} s</dd>
                    <dt>Known structures</dt>
                    <dd>{[...agent.known].join(', ') || 'none'}</dd>
                    <dt>Walked · replans</dt>
                    <dd>
                      {agent.walked.toFixed(1)} units · {agent.replans}
                    </dd>
                    <dt>Graph</dt>
                    <dd>
                      {sim.nav.walkableCount.toLocaleString()} walkable of {sim.nav.building.count.toLocaleString()} cells · {sim.nav.regionSize.length} regions · rebuilt {sim.rebuilds}×
                    </dd>
                    <dt>Game</dt>
                    <dd>step {sim.game.sim.step} · its own, never saved</dd>
                  </dl>
                </details>
              </>
            ) : (
              <>
                <p className="studio-who">The inhabitant</p>
                <p className="studio-gloss">
                  {HEIGHT.toFixed(1)} growth units tall — about a third of a storey. Pick a scene to watch one live: its behavior,
                  where it’s going, and why.
                </p>
                <ul className="studio-legend-list">
                  {(Object.keys(BEHAVIOR_NAMES) as Behavior[]).map((b) => (
                    <li key={b}>
                      <strong>{BEHAVIOR_NAMES[b]}</strong> {BEHAVIOR_TEXT[b]}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        </div>

        <div className="studio-text">
          <div>
            <h3>Appearance</h3>
            <p>
              A small round creature about a third of a storey tall: a soft egg of a body in its coat colour, a paler
              belly, dark eyes with a glint, rosy cheeks, stubby feet, and a leaf sprouting from its head — the game’s own
              ivy leaf — so it reads as part of the plants. A handful of simple shapes keeps it legible at the game’s
              distance. Four coats — Moss, Lichen, Blossom, Bark — tell them apart; all four behave alike.
            </p>
          </div>
          <div>
            <h3>Behavior</h3>
            <p>
              One small state machine: idle, exploring, discovering, travelling, no route, stranded. Each state is entered
              for a reason the inhabitant records, shown above as its “why”. They rest a few seconds, wander their region,
              and when a living structure joins it, walk over to see. They don’t eat, talk or work.
            </p>
          </div>
          <div>
            <h3>Navigation</h3>
            <p>
              They walk the cells the plants grow over — walls, roofs, the decks of living architecture — but only where
              something grows, or on a mature structure. Bare wall and the lawn are off-limits. Connected walkable cells form
              regions; a route never leaves one. The graph is rebuilt as the world changes, so a bridge maturing merges
              two regions, and winter’s withering can split one.
            </p>
          </div>
          <div>
            <h3>Relationship with Wildform</h3>
            <p>
              They make the consequences of growth visible: two buildings are separate worlds to them until the plants
              join them. In Play and the Lab they arrive as the green spreads — one for every 120 walkable cells, up to six
              — and can be hidden from the world menu (Show Inhabitants) without stopping them.
            </p>
          </div>
          <div>
            <h3>Not built yet</h3>
            <p>
              Ideas, not features: inhabitants that favour certain plants or structures, that gather where it’s sheltered,
              or that help seed new growth; a route the player can ask for. Today they only walk, rest, discover, and say
              when they can’t get somewhere.
            </p>
          </div>
        </div>
      </section>

      <section className="project-section studio-note" aria-labelledby="studio-note-heading">
        <h2 id="studio-note-heading">How this studio works</h2>
        <p>
          Every scene is a real game of Wildform, set up from a recipe like the Architecture page’s — two of them are its
          bridge recipes — and grown, then walked by the same agents, navigation and models that live in Play. Nothing is
          scripted: whether an inhabitant can cross is whether the graph joins the two sides. Each scene’s game is its own,
          made fresh on every reset and never saved, so nothing here reaches your worlds.
        </p>
        <div className="project-actions">
          <button type="button" className="project-button" onClick={() => navigate({ section: 'project', page: 'architecture' })}>
            How the structures form
          </button>
          <button type="button" className="project-button is-primary" onClick={() => navigate({ section: 'project', page: 'play' })}>
            Meet them in Play
          </button>
        </div>
      </section>
    </ProjectLayout>
  )
}
