import { ProjectLayout } from './ProjectLayout'
import type { Route } from '../routes'

/**
 * How it works: every mechanism behind Wildform, in the order the data flows —
 * from a block the player places to the living architecture the plants grow,
 * and back. The long form, with every formula, is docs/project/how-it-works.md;
 * every number here is the code's own constant or was measured.
 */

type Stage = {
  id: string
  title: string
  /** The technique, named. */
  technique: string
  /** What it does, in a sentence. */
  summary: string
  /** How, step by step. */
  how: string[]
  /** Key numbers. */
  numbers: string[]
  code: string[]
}

const STAGES: Stage[] = [
  {
    id: 'blocks',
    title: 'Blocks',
    technique: 'Voxel grid · flood fill · union–find',
    summary: 'The player builds on a voxel grid; the game works out which blocks form separate buildings, and whether living architecture joins them.',
    how: [
      'A 14 × 14 grid, 8 storeys tall, one byte per cell; the two existing buildings are locked.',
      'A block takes the colour of the one it was placed against; Undo keeps a stack of edits.',
      'A flood fill over the six face neighbours gives every connected group of blocks — a building — an id.',
      'A mature structure whose ends are in different buildings is a living connection; a union–find over those says whether west and east are joined. Joining them with blocks doesn’t count.',
    ],
    numbers: ['14 × 14 × 8 grid', '30-block budget', 'goal: join two buildings 8 columns apart'],
    code: ['src/build/town.ts', 'src/build/game.ts'],
  },
  {
    id: 'rules',
    title: 'Building rules',
    technique: 'Deterministic adjacency rules (Townscaper-style)',
    summary: 'Each block becomes part of a house according to its neighbours, so the same click reads differently in different places.',
    how: [
      'Walls only on sides facing open air, each with a framed window; one ground-floor side of a house gets a door.',
      'Roofs by the neighbours at the same height: none → a hip roof; along one axis → a gable along the row; along both → a flat roof terrace with parapets.',
      'An arch under a block spanning between two others; stilts under any other overhang; a stone footing; string courses between storeys — the ledges the Spreader favours.',
      'Not Wave Function Collapse: WFC chooses at random among several modules that fit, propagating constraints. Here each neighbourhood has exactly one answer — no search, no randomness — so a player can predict what a click builds.',
    ],
    numbers: ['a full grid (1,568 cells) rebuilds in a few ms', 'one module per neighbourhood'],
    code: ['src/build/townMesh.ts'],
  },
  {
    id: 'cells',
    title: 'Growth cells',
    technique: 'Surface sampling · nearest-neighbour graph · stitched patches',
    summary: 'Plants don’t grow on meshes but on cells sampled over every surface, joined into one graph.',
    how: [
      'Every open wall and flat roof is sampled into 0.25-unit cells — a block face is 12 × 12. Each cell has a position, a normal, flags (glass, window frame, ledge, edge, shelter) and eight neighbours.',
      'Neighbours: step one cell along the surface in each of eight directions and take the nearest cell. No special cases — corners and wall-to-roof joins fall out of the rule.',
      'Pitched roofs and every mature living structure become patches of cells laid on the surface as drawn, stitched to the nearest cells beside them — so growth moves from wall to eave to ridge, and from wall to a bridge’s deck.',
      'Each patch cell knows its kind (roof slope, ridge, eave, deck top, rim, underside, support), how much rain its slope keeps, and how much each plant likes it.',
    ],
    numbers: ['cell 0.25 units', 'neighbour reach 0.2', 'stitch reach 0.45', 'glass is the only ungrowable surface'],
    code: ['src/build/townBuilding.ts', 'src/green/building.ts', 'src/build/surfaces.ts'],
  },
  {
    id: 'fields',
    title: 'Fields',
    technique: 'Ray-cast sunlight · runoff simulation · BFS feature field',
    summary: 'Every cell gets light, water and something-to-hold values, computed from the geometry and the weather.',
    how: [
      'Sun at 38° elevation from the weather’s direction. Direct light is Lambert (n·L); shadows are exact rays toward the sun tested against every building footprint edge — not a shadow map. Overhangs shade the wall below.',
      'Moisture: each wall column is walked top to bottom carrying runoff — rain, rising damp at the foot, ledges that catch it, evaporation in sun — draining onto roofs below; then wicked sideways.',
      'Geometry: a breadth-first search from window frames, ledges and edges (two steps deep), and a falloff from corners. Mature structures add support where their frame touches a wall.',
      'Each plant combines them its own way: moisture match × light match (against its preference) × how much it likes the surface, weighted by how much it needs something to hold.',
    ],
    numbers: ['sun elevation 38°', 'default sun −58°, rain 0.55', 'flat roof direct light ≈ 0.78', 'ledges keep 35% of runoff'],
    code: ['src/wildform/world.ts', 'src/green/fields.ts'],
  },
  {
    id: 'growth',
    title: 'Growth',
    technique: 'Agent-based growth on a graph · seeded RNG',
    summary: 'Climber and Spreader spread by tips that walk the cell graph, one step at a time, by weighted choice.',
    how: [
      'Each step, a tip scores its neighbours: suitability, plus the plant’s pull up (Climber 0.85) or sideways (Spreader 0.55), keeping straight, a ledge bonus, minus crowding, plus noise. It grows into the best with probability rising with suitability², and may branch.',
      'So the Climber’s upward, edge-following habit and the Spreader’s sideways, sun-seeking spread come only from those weights.',
      'A cell holds up to three layers; a plant never grows onto its own kind. A covered layer gets 75% of the light per layer above.',
      'A layer whose conditions drop well below what it grew in withers; a Climber takes everything grown from it.',
      'One seeded generator drives all randomness: the same world and actions grow the same plants. Editing doesn’t reset growth — layers are carried onto the rebuilt building by position.',
    ],
    numbers: ['Climber: light 0.5, 30 tips', 'Spreader: light 0.85, 22 tips', '3 layers a cell', 'wither from a 0.12 drop'],
    code: ['src/wildform/growth.ts', 'src/wildform/species.ts', 'src/wildform/sim.ts'],
  },
  {
    id: 'draper',
    title: 'The Draper',
    technique: 'Gravity-led strands from edges',
    summary: 'A plant that hangs: its strands spend most of their length in open air, so it is its own model.',
    how: [
      'Anchored on an edge — a roof eave, a string course, an overhang, a mature structure’s deck.',
      'Each strand is laid out in small steps straight down, swaying along the edge and clinging to a wall where there is one; it ends at its reach, the lawn (where it roots) or a block (where it rests).',
      'A new strand every 24 steps, up to nine: a curtain, longest in the middle. Best in part sun and moderate moisture; denser over Climber (a veil).',
      'An established Draper spreads onto a nearby mature deck edge and starts a new curtain — at most twice.',
    ],
    numbers: ['strand step 0.22', 'reach up to 10 units', '9 strands (×1.5 as a veil)'],
    code: ['src/build/draper.ts', 'src/build/draperMesh.ts'],
  },
  {
    id: 'grammar',
    title: 'Mutation grammar',
    technique: 'Rule grammar: what met → what grows; context → its shape',
    summary: 'Where plants meet and pile up, a mutation node forms, and the kind of meeting decides the kind of structure.',
    how: [
      'What met is read from a cell’s stack: Climber + Spreader (two layers), Climber + Layered, Spreader + Layered. The Draper meets through its curtain: the cells behind its strands, its edge, what its strands reached below.',
      'A node forms when enough cells of one meeting gather within 1.2 units, established (25 steps old) and off the ground, clear of other structures; checked every 10 steps, rarest first.',
      'Climber + Spreader → bridge (a building within five columns) or balcony · Climber + Layered → scaffold · Spreader + Layered → terrace or canopy · Climber + Draper → suspended walkway · Spreader + Draper → hanging pod · Draper + Layered → root column.',
    ],
    numbers: ['6 cells for Climber + Spreader, 2 for layered', '≥ 1.8 units up', '5 units apart', '8 structures, 3 balconies at most'],
    code: ['src/build/living.ts', 'src/build/draperLiving.ts', 'src/build/game.ts'],
  },
  {
    id: 'living',
    title: 'Living architecture',
    technique: 'Curve planning · Bézier, helix, catenary · swept surfaces · staged growth',
    summary: 'Nothing is a prefab: each structure is planned as curves from its node and context, swept into geometry, and grown in stages.',
    how: [
      'Planning casts from the node — along the wall’s facing, toward the Spreader’s heading, fanned ±20° and ±40°, a storey up or down — for the nearest face of another building.',
      'A bridge is a quadratic Bézier; a scaffold, helical rails; a walkway sags on a catenary under cables; a pod is open hoops round a teardrop; a root column, strands spiralling round an axis.',
      'Decks are Catmull–Rom curves swept with a domed section; rails, roots and cables are tubes.',
      'It grows over simulation steps: knot, frame, surface, stone, leaves. At maturity (step 300) it casts shade, gives climbers support, and its surfaces become growth cells — architecture growing on architecture.',
    ],
    numbers: ['stages 0–30–150–300–380–520 steps', 'matures at step 300'],
    code: ['src/build/living.ts', 'src/build/livingMesh.ts'],
  },
  {
    id: 'seasons',
    title: 'Seasons',
    technique: 'Step-derived weather schedule · shader tint · particles',
    summary: 'In Play the year turns on its own, setting the rain, sun and warmth the fields and growth read.',
    how: [
      'Four 500-step seasons; the season comes from the step alone, so a saved world returns in its season with nothing extra saved. Changes blend over 150 steps.',
      'Warmth is the one new growth rule: below 1, a tip idles a step with probability 1 − warmth.',
      'The look follows: leaf shaders pull toward the season’s colour — the town’s plants and the forest’s broadleaves fully, the shrubs, saplings, ferns and grass by their own amounts, conifers only a touch; the lawn, sky and light tint; rain (scaled by the real rain), snow, autumn leaves and petals fall; leaves drop where growth withers, in autumn’s colours in autumn.',
    ],
    numbers: ['winter warmth 0.15', 'tuned over 10 seeds: goal rate unchanged (4 of 10)', 'winter costs about a third of the plants'],
    code: ['src/game/seasons.ts', 'src/game/seasonLook.ts', 'src/build/seasonFx.ts'],
  },
  {
    id: 'inhabitants',
    title: 'Inhabitants',
    technique: 'Walkable graph · flood-fill regions · A* · utility AI · state machine',
    summary: 'Creatures that walk only where plants grow or on mature structures — so what they can reach is the plants’ doing — and choose where to go from their needs, their nature and the weather.',
    how: [
      'The walkable graph is the growth cells with something growing on them, plus mature structure surfaces.',
      'A flood fill splits it into regions; two buildings are separate until growth or a structure joins them. Routes are A* within a region.',
      'What it wants: a utility system scores four goals — explore, rest, seek shelter, observe — from its needs (energy, comfort, curiosity), its nature (curious, cautious) and the game’s weather, over places it can reach: cover from the building’s own surfaces, sunlight from the growth model, height, and what each structure is for.',
      'How it goes about it: a state machine — idle, exploring, discovering, travelling, resting, observing, no route, stranded — whose transitions are one table every change is checked against, and the Inhabitants page draws its graph from.',
    ],
    numbers: ['graph rebuild 1–2 ms', 'a decision ~0.03 ms', 'curious 47% exploring, cautious 0%', 'one per 120 walkable cells, up to 6'],
    code: ['src/inhabitants/nav.ts', 'src/inhabitants/mind.ts', 'src/inhabitants/agent.ts', 'src/inhabitants/population.ts'],
  },
  {
    id: 'landscape',
    title: 'Landscape',
    technique: 'Masked, domain-warped Perlin terrain · ridged noise · a carved stream · A*-routed paths · seeded scatter',
    summary: 'The land round the town: a clearing in a shallow hollow with a stream at the ridge’s foot and a footpath in from the forest, rolling hills and a ridge beyond, varied ground, a forest round it, and grass, shrubs, ferns, saplings, rocks and flowers — scenery the simulation never reads.',
    how: [
      'Height is the town’s ground plus two octaves of domain-warped Perlin noise (the coordinates pushed about by a slower noise first, so the rolls bend instead of sitting on a lattice), under a smoothstep mask that is exactly zero within 3 units of the grid — so every block, root and leaf stands where it always did.',
      'Three 0–1 fields: elevation; moisture, wetter in hollows; fertility, best at moderate moisture on flat ground. They blend the ground’s colour — olive where dry, cooler where wet, earth where poor — and decide where things grow.',
      'Decorations are scattered on a seeded jittered grid, each kept with probability suitability × density, clustered by noise, with minimum spacing for the larger kinds and a quiet margin round the buildings. A middle layer at the forest’s edge: saplings, groups of young trees, tall shrubs and ferns, so the meadow turns into forest gradually. Instanced meshes, never clickable.',
      'The town sits in a shallow hollow: the ground lifts gently from inside the clearing’s edge to a rim about 2 units up, its height noise round the circle and open along the valley — so the trees at the edge stand above the buildings and close the view, without making an arena. Moisture, colour and the conifers’ odds read the relief without the rim, so it stays green meadow slope.',
      'Landforms from ridged noise, (1 − |n|)², sharp where the noise crosses zero: a ridgeline behind the scene whose crest wanders, with peaks and saddles and a gentle front and steep back; a lower spur; shallow troughs far out; and an open valley kept clear of trees. (As smooth Gaussians they read as isolated domes.)',
      'Beyond the meadow, a forest: the clearing’s edge is noise sampled round a circle (13–21 units out), a forest field breaks into groves and gaps, and trees are scattered as tight or loose Gaussian groves, visited nearest-first so the cap is spent where the trees are seen. Six families — broad and slender deciduous trees, short firs, tall spires, and crooked and weeping accents. Each grove has a leading family, drawn with odds that favour conifers on high ground but move with a slow noise field, and 50–85% of its trees follow it; the rest are companions — so stands are mixed and no side of the clearing is all one kind.',
      'A stream springs on the ridge’s slope and leaves by the valley: laid out by bearing, meandered by noise, drawn toward low ground, wider round bends and into pools, its water never rising downstream and held below the ground on both sides. It is cut into the terrain — a bowl under the water, a small lip at its edge, banks wider where the cut is deeper — drawn by a bank mesh finer than the lawn, and its translucent water’s flecks and ripples move along the stream’s own phase, quicker through narrows.',
      'Footpaths are routed by A* over a grid priced by slope², each to one building’s outer side, never into the gap between them or near the water — so nothing on the ground joins the buildings — then rounded, meandered and laid as ragged ribbons on the lawn’s drawn surface. A meadow patch field gathers taller grass, lobed patches of ground cover and one-colour wildflower drifts; four accents — a fallen log, mossy stones, mushrooms, a flowering shrub — each mark a quarter of the clearing; nothing stands on the protected ground round the buildings.',
      'Saved as a seed and a density; the land regenerates exactly. Decorations can be hidden (a display preference) without changing the world.',
    ],
    numbers: ['mask 0 within 3 units, 1 by 14', 'clearing 13–21 units', 'ridge up to 4.8 high, 42 out', '2,600 trees, six families (medium)', 'rim ~2 units up at its crest', 'stream 156–162 units, ≥ 9.6 off the grid', 'no path in the gap between the buildings', 'land built in ~875 ms; 3.5 M triangles a frame'],
    code: ['src/build/landscape.ts', 'src/build/features.ts', 'src/build/landscapeDecor.ts', 'src/build/lawn.ts'],
  },
  {
    id: 'rendering',
    title: 'Rendering',
    technique: 'GPU instancing · age shaders · fBm sky · render on demand',
    summary: 'three.js / WebGL, built so growth animates on the GPU and nothing is drawn while nothing moves.',
    how: [
      'Leaves and stems are instanced meshes; each instance carries its birth step, and a vertex shader opens leaves and thickens stems with age — no geometry rebuilt as plants grow.',
      'The sky is a shader dome with fBm clouds; ground cover is a tile grid broken into patches by value noise, a leaf per tile fixed by a hash so leaves never jump.',
      'The render loop draws only while something moves; idle, nothing is drawn. Shadow maps refresh only while a structure is still growing.',
    ],
    numbers: ['leaves open over 30 steps', 'ground tiles 0.5 units', '0 frames drawn when idle'],
    code: ['src/wildform/wildVegetation.ts', 'src/green/vegetation.ts', 'src/build/sky.ts', 'src/build/groundCover.ts', 'src/renderLoop.ts'],
  },
  {
    id: 'saving',
    title: 'Saving',
    technique: 'State, not scene · chunked Firestore snapshots',
    summary: 'A world is saved as its state and rebuilt on load through the same path an edit takes.',
    how: [
      'Saved: the town, the structures as planned, the Drapers, every plant layer (22 bytes each) and tip, the weather, seed and step. No meshes, no cells.',
      'Loading runs town → building rules → cells → fields → growth laid back by position, so the loaded world is the same simulation: its next 400 steps match the original’s.',
      'Stored in Firestore in 800,000-character chunks; a new snapshot is written before the world points at it, so a failed save never breaks a world.',
    ],
    numbers: ['22 bytes a layer', '800,000-character chunks', 'identical for 400 steps after a reload'],
    code: ['src/build/worldState.ts', 'src/firebase/worlds.ts'],
  },
]

/** The techniques, named, and where each lives. */
const TECHNIQUES: [string, string][] = [
  ['Voxel grid, flood fill, union–find', 'The town, its buildings, the goal'],
  ['Deterministic adjacency rules', 'Blocks into walls, windows, roofs, arches'],
  ['Surface sampling and a nearest-neighbour cell graph', 'Where plants can grow, and how they step'],
  ['Exact ray-cast shadows; runoff simulation; BFS features', 'Light, water and something to hold'],
  ['Agent-based growth with weighted choice', 'Climber and Spreader'],
  ['Gravity-led strands', 'The Draper'],
  ['A rule grammar over meetings and context', 'What living architecture grows'],
  ['Bézier, helix and catenary curves; swept surfaces', 'Its geometry'],
  ['Flood-fill regions, A*, a state machine', 'Inhabitants'],
  ['Seeded random generator', 'Every run reproducible'],
  ['Masked, warped Perlin terrain; ridged landforms; a carved stream; A*-routed paths; seeded scatter', 'The landscape round the town'],
  ['GPU instancing and age shaders; fBm and value noise', 'Rendering growth, sky and ground'],
  ['State-not-scene serialisation', 'Saving and loading'],
]

const LOOP = ['blocks', 'rules', 'cells', 'fields', 'growth', 'grammar', 'living']
const ALONGSIDE = ['draper', 'seasons', 'inhabitants', 'landscape', 'rendering', 'saving']

export function ProjectHowItWorks({ navigate }: { navigate: (route: Route) => void }) {
  const go = (id: string) => document.getElementById(`how-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const titleOf = (id: string) => STAGES.find((s) => s.id === id)!.title
  return (
    <ProjectLayout
      wide
      title="How it works"
      lede={
        <>
          <p className="project-tagline">Every mechanism, in the order the data flows</p>
          <p>
            From a block the player places to the living architecture the plants grow, and back again. Each stage names its
            technique, how it works, its key numbers and the code that runs it. The numbers are the code’s own constants or
            were measured.
          </p>
        </>
      }
    >
      <section className="project-section" aria-labelledby="how-pipeline-heading">
        <h2 id="how-pipeline-heading">The pipeline</h2>
        <ol className="how-pipeline" aria-label="The stages, in order">
          {LOOP.map((id, k) => (
            <li key={id}>
              <button type="button" onClick={() => go(id)}>
                <span className="how-num">{k + 1}</span>
                {titleOf(id)}
              </button>
            </li>
          ))}
        </ol>
        <p className="how-loop-note">
          ↺ A structure that matures becomes new growth cells, shade and support — so stage 7 feeds stages 3 and 4, and
          architecture grows on architecture.
        </p>
        <p className="how-alongside">
          Alongside:{' '}
          {ALONGSIDE.map((id) => (
            <button key={id} type="button" onClick={() => go(id)}>
              {titleOf(id)}
            </button>
          ))}
        </p>
      </section>

      <section className="project-section" aria-labelledby="how-techniques-heading">
        <h2 id="how-techniques-heading">The techniques at a glance</h2>
        <table className="how-table">
          <thead>
            <tr>
              <th>Technique</th>
              <th>What it makes</th>
            </tr>
          </thead>
          <tbody>
            {TECHNIQUES.map(([t, w]) => (
              <tr key={t}>
                <td>{t}</td>
                <td>{w}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {STAGES.map((s) => {
        const loopIndex = LOOP.indexOf(s.id)
        return (
          <section key={s.id} id={`how-${s.id}`} className="project-section how-stage" aria-labelledby={`how-${s.id}-h`}>
            <p className="how-kicker">{loopIndex >= 0 ? `Stage ${loopIndex + 1}` : 'Alongside'} · {s.technique}</p>
            <h2 id={`how-${s.id}-h`}>{s.title}</h2>
            <p className="how-summary">{s.summary}</p>
            <ul className="how-steps">
              {s.how.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
            <div className="how-meta">
              <ul className="how-numbers" aria-label="Key numbers">
                {s.numbers.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <p className="how-code">
                {s.code.map((c) => (
                  <code key={c}>{c}</code>
                ))}
              </p>
            </div>
          </section>
        )
      })}

      <section className="project-section" aria-labelledby="how-more-heading">
        <h2 id="how-more-heading">More</h2>
        <p>
          The full account, with every formula, is <code>docs/project/how-it-works.md</code> in the repository; each stage
          also has its own chapter in <code>docs/project/</code>.
        </p>
        <div className="project-actions">
          <button type="button" className="project-button" onClick={() => navigate({ section: 'project', page: 'build' })}>
            Take it apart in the Lab
          </button>
          <button type="button" className="project-button" onClick={() => navigate({ section: 'project', page: 'architecture' })}>
            See what it grows
          </button>
          <button type="button" className="project-button is-primary" onClick={() => navigate({ section: 'project', page: 'play' })}>
            Play
          </button>
        </div>
      </section>
    </ProjectLayout>
  )
}
