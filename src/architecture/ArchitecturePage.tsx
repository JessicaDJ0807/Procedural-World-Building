import { useEffect, useMemo, useRef, useState } from 'react'
import { ProjectLayout } from '../project/ProjectLayout'
import type { Route } from '../routes'
import { KIND_NAMES, MATURE_AT, STAGES, type Kind } from '../build/living'
import { RECIPES, grow, hostOf, measure, type Specimen } from './specimens'
import { SpecimenViewport } from './SpecimenViewport'
import { GROWTH_COLOURS, STRUCTURE_COLOURS, type ViewMode } from './views'
import './architecture.css'

type Entry = {
  kind: Kind
  name: string
  epithet: string
  recipe: string
  origin: string
  conditions: string
  construction: string
  variation: string
  impact: string
  /** The Draper's forms: how each differs from the wall's form it is nearest to. */
  versus?: { name: string; text: string }
}

/** Written from build/living.ts — its thresholds and proportions — in plain words. */
const ENTRIES: Entry[] = [
  {
    kind: 'bridge',
    name: 'Bridge',
    epithet: 'An arch grown across the gap between two buildings',
    recipe: 'Climber + Spreader',
    origin: 'A Climber and a Spreader grown over each other on a wall — two layers, one of each. The Climber brings the upward path, the Spreader the sideways reach.',
    conditions:
      'Six such cells close together, their growth at least 25 steps old on average, at least two-thirds of a storey up. Then the growth looks outward — straight out, turned toward the Spreader’s heading, fanned 20° and 40° either side, level and a storey up or down — for another building within five columns.',
    construction:
      'A knot swells at the node; rails, a keel and roots draw out along their length; the deck fills in as two halves from either end that meet in the middle; the raw fibre turns to stone; leaves open from the node outward.',
    variation:
      'The gap sets the span, and the arch rises an eighth of whatever it spans, so a longer bridge rises higher. The Spreader’s heading bows it sideways and chooses which face it aims for.',
    impact:
      'Once mature (300 steps after the node) its deck shades the wall and ground beneath it, the walls its roots grip become support for climbing, and its deck, rims and underside become new surfaces. A bridge between two separate buildings is a living connection — the game’s goal.',
  },
  {
    kind: 'balcony',
    name: 'Balcony',
    epithet: 'A pod reaching out from a single wall',
    recipe: 'Climber + Spreader, nothing in reach',
    origin: 'The same meeting as a bridge: a Climber and a Spreader grown over each other.',
    conditions: 'Everything a bridge needs, but no other building within five columns. With nothing to reach, the growth makes a place to stand. At most three grow in a game.',
    construction:
      'The knot, then two root braces climbing from the wall below and the frame along the pod’s edges; the deck fills from the wall out to its upturned lip; it matures to stone and grows leaves, some hanging from the rim.',
    variation:
      'It reaches out along the wall’s facing plus the Spreader’s heading, and curls sideways the way the Spreader leaned — so the same wall grows a balcony swung one way or the other, or straight out. Free space sets how far: 2 to 4.2 units.',
    impact: 'A sheltered ledge on a bare wall: shade under it, its braces something to climb, its deck and rim new ground for the Spreader and for Drapers to hang from. It joins nothing, so it is never a connection.',
  },
  {
    kind: 'scaffold',
    name: 'Scaffold',
    epithet: 'A spiral tower climbing past the roof',
    recipe: 'Climber + Layered',
    origin: 'A Climber grown over a cell already two layers deep — Climber, Spreader, Climber. The plant on top climbs, so what grows is vertical.',
    conditions: 'Two such cells together, established and up off the ground.',
    construction:
      'Three rails spiral up from below the node to a storey above the roof, narrowing as they rise; ties reach back into the wall each storey; stair pads fill in about every third of a storey, then a crown deck on top.',
    variation:
      'It leans the way the Climber was growing. From the crown it looks for another building within four columns, down to two storeys below: one in reach gets an arm across — up to a taller neighbour or down to a lower roof; none, and it stands alone.',
    impact: 'A climbing frame first: rails and ties are support, so Climbers follow it up and over the roof. Its pads and crown are small decks; an arm that reaches another building is a connection.',
  },
  {
    kind: 'terrace',
    name: 'Terrace',
    epithet: 'A broad deck grown out at roof level',
    recipe: 'Spreader + Layered, near the roof',
    origin: 'A Spreader grown over a cell two layers deep — Spreader, Climber, Spreader. The spreading plant on top makes it horizontal.',
    conditions: 'Two such cells together, established, with the roof within about a storey above (3.5 units). The deck is raised to the roof line.',
    construction:
      'The knot, then four ribs out from the wall and, if it stands free, two trunk-like columns down to the ground; the domed, fan-shaped deck fills from the wall outward; it matures and grows leaves.',
    variation:
      'A neighbour within reach and it spans across, narrower; none, and it reaches as far as the free space allows, widening toward its far edge, on columns. Those are the two outcomes found — in every layout searched, a free terrace forms at the roof line of a two-storey block.',
    impact: 'The largest open surface a meeting makes: flat and lit, the Spreader’s best ground. It extends the roof, shades a broad patch below, and its columns give Climbers a way up from the lawn.',
  },
  {
    kind: 'canopy',
    name: 'Canopy',
    epithet: 'A spreading shelter held out from the wall',
    recipe: 'Spreader + Layered, far below the roof',
    origin: 'The same layered meeting as a terrace — a Spreader on top of two layers.',
    conditions: 'When the roof is more than about a storey above, the deck doesn’t climb to it: it grows just above the node, about four-tenths of a storey up.',
    construction: 'As a terrace: ribs, columns where it stands free, the domed deck filling outward, maturing, leaves.',
    variation: 'Its height follows the node, so it can hang low on a short block or high on a tall one; a neighbour within reach and it spans to it, otherwise it stands on columns.',
    impact: 'Mainly shade: a darker, sheltered band of wall and ground beneath, where shade-tolerant growth gains on the light-seekers. Its top is new open ground, its columns new paths up.',
  },
  {
    kind: 'walkway',
    name: 'Suspended Walkway',
    epithet: 'A deck slung from cables, roof to roof',
    recipe: 'Climber + Draper',
    origin: 'A Draper’s curtain hanging over a wall the Climber has grown up — at least four Climber cells behind its strands. The Climber brings the path up; the Draper brings what hangs.',
    conditions:
      'The Draper established — hung 200 steps, five strands — from an edge at least 5.5 units up, a second storey’s eave or higher, with another building within five columns, level or up to two storeys above or below. With nothing in reach, nothing forms: the curtain stays a veil.',
    construction:
      'Masts rise at both ends; two cables draw out between their tops, sagging; hangers drop from them to a thin deck that fills in beneath; the Draper’s strands trail from the deck’s edges. Then it matures to stone and grows leaves, like the rest.',
    variation:
      'It lands on the neighbour’s roof, just in from the edge, when that roof is within two storeys — so the same curtain slings a level walkway, a descent to a low roof or a climb to a taller one. The deck sags below the line between its ends by a twentieth of the span and a little more.',
    impact:
      'A connection, like a bridge, when it joins two buildings — it counts toward the game’s goal. Its narrow deck shades little. Masts and roots are support for climbing, the deck a new strip of ground; the cables carry nothing for plants.',
    versus: {
      name: 'Bridge',
      text: 'A bridge arches up off the wall at its own level and holds itself up: a deck 0.3–0.4 units thick, rising an eighth of its span. A walkway hangs: a deck 0.14 thick, sagging below its ends, held from above by cables and masts — and it takes height in its stride, up or down two storeys, roof to roof.',
    },
  },
  {
    kind: 'pod',
    name: 'Hanging Pod',
    epithet: 'A woven basket hung under an edge',
    recipe: 'Spreader + Draper',
    origin: 'A Draper’s curtain under an edge where the Spreader has spread — at least three Spreader cells on the edge, on the roof beside it, or just under it. The Spreader makes the cap above; the Draper lets the enclosure down.',
    conditions:
      'The Draper established, hung from an edge at least 4.5 units up, with room below: every hoop, rib and the floor clear of blocks and at least half a unit above the lawn. Without that room, nothing forms. The cap grows only where it has room too.',
    construction:
      'Under the cap, seven hoops — open arcs, widest a third of the way down, gathered to a point 3.1–3.5 units below — with ribs between and a floor across the belly; hangers hold it from the edge; strands trail beneath.',
    variation:
      'The middle hoops part into a mouth facing away from the wall. Its width, 2.5–2.9 units, and depth vary with its seed. It hangs wherever a curtain meets a spread edge: a two-storey eave, high on a tower, under a lower wing.',
    impact: 'A pocket: shade inside and under it, off the ground, and a floor that becomes new ground — the hoops’ tops too — for the plants to carry on into. It joins nothing.',
    versus: {
      name: 'Canopy',
      text: 'A canopy is a roof held out over open ground: one broad deck, lit above, shaded below, often standing on columns. A pod encloses: hoops round a space, a floor inside, hung from above rather than held out — and it never touches the ground.',
    },
  },
  {
    kind: 'column',
    name: 'Root Column',
    epithet: 'Hanging strands twisted into a support',
    recipe: 'Draper + Layered',
    origin: 'A Draper hanging from living architecture — itself grown from layered growth — or over a wall where at least three cells hold three layers. The mass above, and the Draper’s direction: down.',
    conditions:
      'Three of its strands grown all the way to the lawn or a roof below, and a drop of at least 2.5 units. Clear of other structures, except the one it hangs from: a column is meant to hold that up.',
    construction:
      'Six strands spiral round an axis from the edge to where they landed, narrow in the middle and flaring at the foot into six buttress roots; a capital of five strands grips the edge; bracket shelves grow out on alternating sides, one a storey; a few strands still trail from the top.',
    variation:
      'Under a living deck it stands free and holds the deck up; on a wall it stands half a unit off the face, a living pilaster; on a lower roof its foot joins that roof — and if that is another building, the column is a connection.',
    impact: 'Support from top to bottom: its trunk is a climbing route from the ground to the structure above, its shelves small decks along the way. It turns the Draper’s descent into a way back up.',
    versus: {
      name: 'Scaffold',
      text: 'A scaffold climbs: three light rails spiral up from the wall past the roof, an open frame to grow on. A root column descends and bears: one twisted trunk let down from above to the ground and flared into roots — a support, not a climbing frame.',
    },
  },
]

const STAGE_NAMES: { key: keyof typeof STAGES; name: string }[] = [
  { key: 'node', name: 'Node' },
  { key: 'frame', name: 'Frame' },
  { key: 'surface', name: 'Surface' },
  { key: 'mature', name: 'Mature' },
  { key: 'leaves', name: 'Vegetation' },
]
const END = STAGES.leaves[1] + 40
/** Steps of formation per second of playback. */
const SPEED = 70

const f1 = (v: number) => (v / 3).toFixed(1)

/** Specimens are real Build games; each grown once (35–120 ms), then kept. */
const cache = new Map<string, Specimen>()
function specimenFor(kind: Kind, index: number): Specimen {
  const key = `${kind}:${index}`
  let s = cache.get(key)
  if (!s) cache.set(key, (s = grow(RECIPES[kind][index])))
  return s
}

/**
 * Living Architecture: an atlas of the structures Build's plants grow.
 * Every specimen is a real Build game grown until the structure forms
 * (specimens.ts); the timeline drives Build's own stages; the Growth view
 * shows the game's own plants at the step the node formed.
 */
export function ArchitecturePage({ navigate }: { navigate: (route: Route) => void }) {
  const [kindIndex, setKindIndex] = useState(0)
  const [variation, setVariation] = useState(0)
  const [mode, setMode] = useState<ViewMode>('material')
  const [age, setAge] = useState(END)
  const [playing, setPlaying] = useState(false)
  const [resetToken, setResetToken] = useState(0)
  const entry = ENTRIES[kindIndex]
  const recipes = RECIPES[entry.kind]
  const spec = useMemo(() => specimenFor(entry.kind, variation), [entry.kind, variation])
  const m = measure(spec.living)

  // Playback: advance the age in real time, stopping at the end.
  const raf = useRef(0)
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      setAge((a) => {
        const next = a + dt * SPEED
        if (next >= END) {
          setPlaying(false)
          return END
        }
        return next
      })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing])

  const choose = (k: number, v = 0) => {
    setKindIndex(k)
    setVariation(v)
    setPlaying(false)
    setAge(END)
  }
  const stage = [...STAGE_NAMES].reverse().find((s) => age >= STAGES[s.key][0]) ?? STAGE_NAMES[0]
  const togglePlay = () => {
    if (!playing && age >= END) setAge(0)
    setPlaying((p) => !p)
  }

  return (
    <ProjectLayout
      wide
      title="Living Architecture"
      lede={
        <>
          <p className="project-tagline">An Atlas of Emergent Forms</p>
          <p>
            Designed through rules, shaped by growth. Each structure emerges where plant behaviors interact, taking form in
            response to its surroundings. Once formed, it becomes new ground for further growth.
          </p>
        </>
      }
    >
      <section className="project-section atlas" aria-label="Catalog">
        <nav className="atlas-index" aria-label="Structures">
          {ENTRIES.map((e, k) => (
            <button key={e.kind} type="button" className={`atlas-tab${k === kindIndex ? ' is-active' : ''}`} aria-pressed={k === kindIndex} onClick={() => choose(k)}>
              <span className="atlas-num">{String(k + 1).padStart(2, '0')}</span>
              <span className="atlas-tab-name">{e.name}</span>
              <span className="atlas-tab-recipe">{e.recipe}</span>
            </button>
          ))}
        </nav>

        <div className="atlas-stage">
          <SpecimenViewport specimen={spec} mode={mode} age={age} resetToken={resetToken} />
          <div className="atlas-plate">
            <span className="atlas-num">
              {String(kindIndex + 1).padStart(2, '0')} · {String.fromCharCode(65 + variation)}
            </span>
            <strong>{entry.name}</strong>
            <span>{recipes[variation].label}</span>
          </div>
          <div className="atlas-modes" role="radiogroup" aria-label="View">
            {(['material', 'structure', 'growth'] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={mode === v} className={mode === v ? 'is-active' : ''} onClick={() => setMode(v)}>
                {v === 'material' ? 'Material' : v === 'structure' ? 'Structure' : 'Growth'}
              </button>
            ))}
          </div>
          {mode !== 'material' && (
            <div className="atlas-legend">
              {mode === 'structure' ? (
                <>
                  <span><i style={{ background: STRUCTURE_COLOURS.deck, outline: '1px solid #c9c3b8' }} />Deck</span>
                  <span><i style={{ background: STRUCTURE_COLOURS.frame }} />Frame</span>
                  <span><i style={{ background: STRUCTURE_COLOURS.roots }} />Roots &amp; columns</span>
                  {m.cables > 0 && <span><i style={{ background: STRUCTURE_COLOURS.cables }} />Cables &amp; strands</span>}
                  {spec.context.length > 0 && <span><i style={{ background: '#d6d2cb', outline: '1px solid #b8b2a8' }} />What it hangs from</span>}
                  <span><i style={{ background: '#d6d2cb', outline: '1px solid #b8b2a8' }} />Supporting building</span>
                </>
              ) : (
                <>
                  <span><i style={{ background: GROWTH_COLOURS.climber }} />Climber</span>
                  <span><i style={{ background: GROWTH_COLOURS.spreader }} />Spreader</span>
                  {spec.growth.strands.length > 0 && <span><i style={{ background: GROWTH_COLOURS.draper }} />Draper</span>}
                  <span><i className="is-ring" style={{ borderColor: GROWTH_COLOURS.meeting }} />The meeting</span>
                  <span className="atlas-legend-note">Plants as they were at step {spec.bornAt}, when the node formed</span>
                </>
              )}
            </div>
          )}

          <div className="atlas-timeline">
            <button type="button" className="atlas-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play formation'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <div className="atlas-track">
              <div className="atlas-bands" aria-hidden="true">
                {/* Build's stage windows overlap so one flows into the next; on the bar
                    each runs from its start to the next one's, so the names don't collide. */}
                {STAGE_NAMES.map((s, k) => {
                  const start = STAGES[s.key][0]
                  const end = k + 1 < STAGE_NAMES.length ? STAGES[STAGE_NAMES[k + 1].key][0] : STAGES[s.key][1]
                  return (
                    <span key={s.key} className={stage.key === s.key ? 'is-current' : ''} style={{ left: `${(start / END) * 100}%`, width: `${((end - start) / END) * 100}%` }} title={s.name}>
                      {end - start >= 60 ? s.name : ''}
                    </span>
                  )
                })}
                <i style={{ left: `${(MATURE_AT / END) * 100}%` }} title="Matures: shades and supports" />
              </div>
              <input
                type="range"
                min={0}
                max={END}
                step={1}
                value={age}
                aria-label="Steps after the node formed"
                onChange={(e) => {
                  setPlaying(false)
                  setAge(Number(e.target.value))
                }}
              />
            </div>
            <span className="atlas-age">
              {stage.name} · step {Math.round(age)}
            </span>
            <button type="button" onClick={() => (setPlaying(false), setAge(0))}>
              Start
            </button>
            <button type="button" onClick={() => (setPlaying(false), setAge(END))}>
              Complete
            </button>
            <button type="button" onClick={() => setResetToken((t) => t + 1)}>
              Reset view
            </button>
          </div>
        </div>

        <div className="atlas-under">
          <div className="atlas-variations" role="radiogroup" aria-label="Variations">
            {recipes.map((r, k) => (
              <button key={r.label} type="button" role="radio" aria-checked={k === variation} className={`atlas-variation${k === variation ? ' is-active' : ''}`} onClick={() => choose(kindIndex, k)}>
                <span className="atlas-num">{String.fromCharCode(65 + k)}</span>
                <span>{r.label}</span>
              </button>
            ))}
          </div>
          <p className="atlas-data">
            {m.length > 0.1 && <span>{f1(m.length)} blocks across</span>}
            {m.height >= 1.5 && <span>rises {f1(m.height)} storeys</span>}
            <span>
              {m.decks} {m.decks === 1 ? 'deck' : 'decks'}
            </span>
            <span>{m.members} frame members</span>
            <span>{m.roots} roots and braces</span>
            {m.cables > 0 && <span>{m.cables} cables and strands</span>}
            {hostOf(spec) && <span>hangs from a {KIND_NAMES[hostOf(spec)!.kind].replace('living ', '')}</span>}
            <span>node formed at step {spec.bornAt}</span>
          </p>
        </div>

        <div className="atlas-text">
          {(
            [
              ['Origin', entry.origin],
              ['Conditions', entry.conditions],
              ['Construction', entry.construction],
              ['Variation', entry.variation],
              ['Impact', entry.impact],
            ] as const
          ).map(([h, t]) => (
            <div key={h}>
              <h3>{h}</h3>
              <p>{t}</p>
            </div>
          ))}
          {entry.versus && (
            <aside className="atlas-versus">
              <h3>Versus the {entry.versus.name}</h3>
              <p>{entry.versus.text}</p>
              <button type="button" className="atlas-versus-link" onClick={() => choose(ENTRIES.findIndex((e) => e.name === entry.versus!.name))}>
                See the {entry.versus.name.toLowerCase()} →
              </button>
            </aside>
          )}
        </div>
      </section>

      <section className="project-section atlas-note" aria-labelledby="atlas-note-heading">
        <h2 id="atlas-note-heading">How these specimens were made</h2>
        <p>
          Each specimen is a real game of Wildform: a few blocks, a Climber and a Spreader planted at the foot of a wall, a world seed
          and the rain — then played, ten steps at a time, until the game formed its first structure. The structure, its timeline
          and the plants in the Growth view are that game’s own. For the Draper’s forms, a Draper is planted too, on the edge a
          player would click — or on the first structure to mature — and the game plays until that form appears; anything that
          formed before it is shown with it, ghosted in the explaining views. The recipes were found by searching layouts and seeds for runs
          where each kind forms first; nothing is modelled or forced, and if a recipe ever grows something else, the page says so
          instead of showing it.
        </p>
        <div className="project-actions">
          <button type="button" className="project-button is-primary" onClick={() => navigate({ section: 'project', page: 'play' })}>
            Grow your own
          </button>
        </div>
      </section>
    </ProjectLayout>
  )
}
