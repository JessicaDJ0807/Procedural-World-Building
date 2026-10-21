import { ProjectLayout } from './ProjectLayout'
import type { Route } from '../routes'

type ProjectProgressProps = { navigate: (route: Route) => void }

const PIPELINE = [
  { name: 'Building', detail: 'An L-shaped block five floors tall, a two-floor wing beside it, windows, ledges, balconies, two flat roofs.' },
  { name: 'Surface cells', detail: '15,792 cells of 0.25 units on every wall and roof, each with its position, facing and eight neighbours — found by stepping across the surface, so walls, corners and roof edges join with no special cases.' },
  { name: 'Fields', detail: 'Sunlight, moisture and geometry: one number per cell, each from a rule short enough to say in a sentence.' },
  { name: 'Suitability', detail: 'moisture × light, weighted toward features — once per species, by its own needs. A product, so a cell must be acceptable on every count.' },
  { name: 'Growth', detail: 'Tips of three species score their eight neighbours, grow, branch, stall or die, and compete for cells. Seeded, so every run can be repeated.' },
  { name: 'Vegetation', detail: 'Instanced stems, a leaf shape per species, flowers on the vine; every leaf its own shade. Five draw calls.' },
]

type Phase = {
  number: string
  title: string
  lede: string
  experiments: string[]
  learning: string
  figures: { src: string; alt: string }[]
  /** Where to see what is left of it. */
  see?: { label: string; route: Route }
}

/**
 * How Wildform emerged, phase by phase. No dates: the course meets weekly but
 * the phases don't line up with weeks, and the git history has the real ones.
 * Each phase is told by what it tried and what it taught — the lesson is the
 * reason for the next phase. Figures are from the app: the Playground topics'
 * own captures, the Site, the archived midterm, and Build.
 */
const PHASES: Phase[] = [
  {
    number: '01',
    title: 'Procedural Foundations',
    lede: 'Technique studies in the Playground, then three generated worlds put together from them.',
    experiments: [
      'Noise terrain: layered noise, domain warping, thermal and hydraulic erosion',
      'Shaders: four GPU simulations and stylised shading',
      'Voxels: density fields and four meshers',
      'Scattering: a rule-driven distribution of trees, bushes and rocks',
      'Roads, rivers and vector fields shaping terrain',
      'Three generated environments — Volcanic Inferno, Frozen Archipelago, Verdant River Valley',
    ],
    learning: 'Procedural generation could create environments, but the project still lacked a clear player goal.',
    figures: [
      { src: '/project/progress-terrain.jpg', alt: 'A noise map beside the terrain it raises: green lowlands, pale peaks, blue water.' },
      { src: '/project/progress-voxels.jpg', alt: 'A volcano meshed from a voxel density field, its crater open at the top.' },
      { src: '/project/progress-shaders.jpg', alt: 'Terraced terrain drawn with a stylised contour shader.' },
      { src: '/project/progress-scatter.jpg', alt: 'A valley with a lake, trees and rocks scattered by slope and height.' },
    ],
    see: { label: 'Open the Playground', route: { section: 'playground', page: 'flow' } },
  },
  {
    number: '02',
    title: 'Site Simulation',
    lede: 'A pivot to plants growing over architecture — first an invented building, then Roosevelt Island and Cornell Tech.',
    experiments: [
      'Real geographic data: 68 buildings, parks, roads and sidewalks from NYC Open Data',
      'Building massing cut into growth cells, walls and roofs alike',
      'Vegetation growth by one rule, three species sorted by their needs',
      'Sunlight from the real sun path, moisture from rain on walls and roofs',
      'Plant–environment relationships: die-back through a simulated year',
      'Procedural façades whose glass, seams and louvers decide where a plant can hold',
    ],
    learning: 'A technically interesting simulation was not automatically an interesting experience.',
    figures: [
      { src: '/green/species-final.jpg', alt: 'The invented L-shaped building covered by three species: vine on the sunlit fronts, ivy in the shaded corner, moss on the wing.' },
      { src: '/project/campus-final.jpg', alt: 'The Cornell Tech campus at golden hour after four simulated years, the shorter buildings green along their seams, the Graduate Hotel mostly bare.' },
    ],
    see: { label: 'Open the Site', route: { section: 'project', page: 'site' } },
  },
  {
    number: '03',
    title: 'Living Architecture',
    lede: 'Plants began changing architecture rather than only covering it.',
    experiments: [
      'Plant collisions: two species growing over each other in layers',
      'A Living Platform grown out of the wall where they meet, whose shade changes where each can grow — the midterm prototype',
      'Mutation nodes growing bridges, balconies, scaffolds, terraces and canopies, shaped by the plants and the space around them',
      'Vegetation drawn at three levels of detail — masses, stems, leaves',
    ],
    learning: 'Plant interactions could become a procedural architectural grammar.',
    figures: [
      { src: '/project/progress-living-platform.jpg', alt: 'The midterm prototype at step 870: a slab grown out of the invented building’s front at the third floor, labelled Living Platform formed.' },
      { src: '/project/build-close.jpg', alt: 'A living bridge meeting the stepping-stone tower in Build, with Draper curtains hanging from it.' },
    ],
    see: { label: 'Open the archived midterm prototype', route: { section: 'project', page: 'explore' } },
  },
  {
    number: '04',
    title: 'Wildform',
    lede: 'The current direction: a game. The player builds, plants and sets the weather; the plants do the rest.',
    experiments: [
      'Building with a limited budget of rigid blocks, after Townscaper',
      'Planting growth behaviors where they will matter',
      'Manipulating environmental conditions: rain and the sun’s direction',
      'Letting living architecture emerge, then adapting the building to the outcome',
      'A goal: join two buildings too far apart for plants alone',
      'Growth vocabulary: Climber, Spreader, Draper — and Layered, the interaction state',
    ],
    learning: 'How much control should the player have over a system whose value comes from emergence?',
    figures: [{ src: '/project/build-hero.jpg', alt: 'Build after 1,100 steps: two buildings joined by living bridges through a stepping-stone tower, with Draper curtains and ground cover.' }],
    see: { label: 'Play Build', route: { section: 'project', page: 'build' } },
  },
]

type Figure = { src?: string; alt: string }

type Experiment = {
  title: string
  rules: string
  /** What happened, with the numbers that show it. */
  result: string
  figure: Figure
}

/**
 * Seed 1, ivy alone with the Balanced settings, step 300 — captured from
 * Explore's Corner view with exactly these settings, and the numbers measured
 * on the same runs. Ivy is the original single plant. "×" is the mean of a
 * field over grown cells divided by its mean over every growable cell: 1 means
 * growth ignored that field, below 1 means it avoided high values.
 */
const EXPERIMENTS: Experiment[] = [
  {
    title: 'Growth without environmental rules',
    rules: 'Moisture off · Sunlight off · Geometry off',
    result:
      'Every cell is equally good, so it is a race: 93.5% of the building covered by step 300, walls and roofs alike. This is the baseline every other run is compared with.',
    figure: { src: '/green/exp-1-none.jpg', alt: 'The building, walls and roofs, almost entirely covered in an even layer of ivy.' },
  },
  {
    title: 'Add moisture',
    rules: 'Moisture on',
    result:
      'Coverage drops to 73.1%, with grown cells 1.10× wetter than average — and 0.79× as lit, because the driest cells are the flat roofs, which are also the sunniest. Before the roofs existed this rule barely mattered at 50% rain; now it keeps ivy off the roofs.',
    figure: { src: '/green/exp-2-moisture.jpg', alt: 'The walls mostly covered, the roofs largely bare except near their edges.' },
  },
  {
    title: 'Add sunlight',
    rules: 'Sunlight on',
    result:
      '43.6% covered, and grown cells receive 0.60× the average light. Ivy prefers 35% light, so it avoids the sunlit fronts and the roofs and fills the shadow the wing throws into the inside corner.',
    figure: { src: '/green/exp-3-sunlight.jpg', alt: 'Ivy concentrated in the shaded inside corner and on the shaded walls, the sunlit faces and roofs left bare.' },
  },
  {
    title: 'Add geometry preference',
    rules: 'Geometry on, edge preference 45%',
    result:
      '60.3% covered, with grown cells 1.21× richer in features — window frames, ledges, corners, and now the edges of the roofs, the sides of the rooftop units and the line where the wall above the terrace meets it.',
    figure: { src: '/green/exp-4-geometry.jpg', alt: 'Ivy following ledges, window frames and roof edges, the middles of the roofs bare.' },
  },
  {
    title: 'Combined system',
    rules: 'All three on',
    result:
      'Only 15.7% covered by step 300, because the rules multiply: a cell has to be wet enough, lit right and near enough to a feature. Grown cells are 1.29× wetter, 0.36× as lit and 1.28× richer in features. Alone, moisture and sunlight still reach 91% and 80% by step 900 and geometry 100% (ten seeds); combined, 46.5%.',
    figure: { src: '/green/exp-5-combined.jpg', alt: 'A few strands of ivy in the shaded inside corner, most of the building still bare.' },
  },
]

const PRESETS: { name: string; result: string; figure: Figure }[] = [
  { name: 'Balanced', result: '72.0% — ivy 35.4, moss 10.4, vine 26.2', figure: { src: '/green/preset-balanced.jpg', alt: 'Flowering vine across the sunlit fronts, ivy in the shadow of the inside corner, growth on the terrace.' } },
  { name: 'Wet + shaded', result: '83.5% — ivy 42.6, moss 15.0, vine 25.9', figure: { src: '/green/preset-wet.jpg', alt: 'Dense ivy in the shadow and along the ledges, the vine on the sunlit faces.' } },
  { name: 'Dry + sunny', result: '10.5% — ivy 4.1, moss 0.7, vine 5.7', figure: { src: '/green/preset-dry.jpg', alt: 'Low growth at the foot of the walls only.' } },
  { name: 'Architecture-driven', result: '46.7% — ivy 8.7, moss 18.3, vine 19.7', figure: { src: '/green/preset-architecture-driven.jpg', alt: 'Strands of all three species following corners, ledges, window frames and roof edges.' } },
]

const SPECIES_ROWS = [
  { name: 'Ivy', needs: 'Shade (35%), steady moisture, edges', grows: 'Climbs in strands; 48 tips', result: '24.4% of the building; 0.47× the average light, 1.20× wetter' },
  { name: 'Moss', needs: 'Deep shade (15%), a lot of water', grows: 'Spreads sideways into patches; 16 tips', result: '13.2%; 1.34× wetter, 0.33× the light, mean height 3.1 units' },
  { name: 'Flowering vine', needs: 'Sun (80%), a third of ivy’s water', grows: 'Climbs fast in long runs; flowers on older growth', result: '23.9%; 1.55× the light, 0.92× as wet — and 14.6% of its cells on roofs' },
]

/** Share of each surface held by each species: Balanced, step 900, mean of ten seeds. */
const WALLS = [
  { wall: 'Main front (faces the sun)', ivy: 7, moss: 7, vine: 35 },
  { wall: 'Wing front (faces the sun)', ivy: 3, moss: 1, vine: 52 },
  { wall: 'East wing’s front (faces the sun)', ivy: 2, moss: 0, vine: 54 },
  { wall: 'East (partly lit)', ivy: 14, moss: 1, vine: 52 },
  { wall: 'Inside corner’s side face', ivy: 23, moss: 26, vine: 3 },
  { wall: 'Back (faces away)', ivy: 61, moss: 24, vine: 0 },
  { wall: 'Wing back (faces away)', ivy: 29, moss: 54, vine: 0 },
  { wall: 'Wing west (faces away)', ivy: 24, moss: 59, vine: 3 },
  { wall: 'Wall above the terrace', ivy: 49, moss: 8, vine: 3 },
  { wall: 'Terrace (wing roof)', ivy: 11, moss: 2, vine: 31 },
  { wall: 'Main roof', ivy: 4, moss: 0, vine: 24 },
]

const DECISIONS = [
  {
    title: 'The environment has to decide where, not just how fast',
    body: 'The first growth rule let a tip enter any cell with a probability that rose with suitability. On the original building, Balanced filled 94% of the wall by step 600 (Wet 91%, Architecture-driven 95%), and the cells it grew into had exactly the facade’s average moisture, light and geometry. A tip that fails tries again, so any chance at all is eventually a certainty. Entering is now gated on suitability squared with a hard cutoff, and a stalled tip can give up — so a poor cell fills late, and one under the cutoff never does.',
  },
  {
    title: 'From a strip of wall to cells with neighbours',
    body: 'The walls began as one grid unrolled around the building, where a corner was just the next column. A roof cannot be a column, and the line where a wall stands on a roof is neither a row nor a column, so every surface is now cells that find their neighbours by stepping across the surface. On the original building, ivy alone reproduced the single-plant runs cell for cell when species were added (fifteen runs hashed); the roof and wing changed the building, so every figure here was measured again.',
  },
  {
    title: 'Roofs are the vine’s, and the wall above the terrace is ivy’s',
    body: 'A flat roof faces the sky: under the 38° sun it reads 0.79 for light against the walls’ 0.38, and dries to 0.25 against 0.50. The sun-loving vine holds 24–31% of the roofs, ivy 4–11%. Water collects along a roof’s edges (0.38 at the terrace’s edges, 0.29 across the terrace as a whole), and the wall rising from the terrace drains onto it — but that wall faces away from the sun, and ivy holds 49% of it.',
  },
  {
    title: 'Moss had to be held back',
    body: 'The first moss branched freely and carried 32 tips. Under Balanced on the original building it took 43.5% of the wall and pushed ivy down to 11.9%, which is not what moss does. With a third of the branching, 16 tips and a higher moisture need it settled at 13.0%. On the current building it holds 13.2% — and 54–59% of the wing’s shaded back and west walls.',
  },
  {
    title: 'The rules set the order, not yet the end state',
    body: 'Run long enough and growth keeps going: ivy alone at the Balanced settings covers 54% by step 900 and 78% by 3,000. With all three species, Balanced reached 100% on two seeds of three by about step 5,500, and even Dry + sunny was at 60–78% after 20,000 steps and still growing. The fields decide which surfaces go green first and which species takes them; the figures here are a moment in a season, not an equilibrium.',
  },
  {
    title: 'Play stops itself when growth does',
    body: 'Growth never ends on its own — some tip is always alive — so Play used to step and redraw forever. It now pauses after 600 steps without a new cell. Over twelve runs of 20,000 steps (four presets, three seeds), it paused in eight, each time where growth had essentially finished: seven of the eight had already grown 99.9% or more of their final cells, the worst 97.9%. The other four never paused — all three Dry + sunny seeds and one Balanced seed are still growing at 20,000 steps, Dry by more than twenty cells per thousand. A slow season, not a stalled one.',
  },
  {
    title: 'An L, not a box',
    body: 'A rectangular building never shades itself, so the sunlight field would only ever have said “this wall faces the sun or it doesn’t”. The L has an inside corner, and the wing’s shadow into it is still the strongest pattern in the results.',
  },
  {
    title: 'Edge preference 70%, not 100%',
    body: 'At 100%, plain wall scores zero: a seed not beside a corner can never leave the ground. With ivy alone on the original building, one seed in ten grew nothing and 90% fixed it; with three species, 90% wiped a species out in 9 of 30 runs and 80% in none. With the wing and roofs added, 80% lost a species in 3 of 30 and 70% in none, with growth still 1.23× toward features. The counts are small and noisy — 60% lost 2 of 30 — so 70% is a setting that held, not a threshold.',
  },
  {
    title: 'Only thirsty plants are held to the foot of the wall',
    body: 'Under Dry + sunny, moss never rises above 2.25 units and ivy keeps 80% of its cells on the ground floor: the rising-damp term in the moisture field is the only water left, and it is a band at the base. The vine, which needs a third as much water, climbs to 5–8 units. None of this was written as a rule; it falls out of moisture need meeting one field.',
  },
  {
    title: 'The flowers were in the scene and invisible',
    body: 'Sized like the leaves’ details, a flower came out 0.10–0.15 units across: four to six pixels from the default camera, where a unit is about 43 pixels, lost among leaves twice that size. Typecheck, lint and build were all clean. It was found by looking at a screenshot, and the flowers are now 0.26–0.36 units across.',
  },
]

function ExperimentFigure({ figure }: { figure: Figure }) {
  if (!figure.src) {
    // A slot for a screenshot not yet taken, so the page can be laid out
    // before every run is captured — never a mock-up standing in for one.
    return (
      <div className="figure-slot" role="img" aria-label={`Screenshot to add: ${figure.alt}`}>
        Screenshot to add
      </div>
    )
  }
  return <img src={figure.src} alt={figure.alt} loading="lazy" />
}

/**
 * How the project got to where it is: the pipeline, then one rule at a time.
 *
 * The experiments are ordered so each adds a single term to the model, and each
 * figure was captured from Explore with exactly the settings named under it —
 * so any of them can be reproduced by setting those switches and stepping to
 * 300. Decisions are kept with their reasons, including the ones that changed
 * because a measurement said so.
 */
export function ProjectProgress({ navigate }: ProjectProgressProps) {
  return (
    <ProjectLayout
      wide
      title="Progress"
      lede="Wildform was not the plan from the start. It emerged through iteration: each phase below answered the problem the one before it left open."
    >
      <section className="project-section" aria-label="Timeline">
        <ol className="timeline">
          {PHASES.map((p, k) => (
            <li className={`phase${k === PHASES.length - 1 ? ' is-current' : ''}`} key={p.number}>
              <div className="phase-marker" aria-hidden="true">
                <span className="phase-number">{p.number}</span>
              </div>
              <div className="phase-body">
                <h2>
                  {p.number} — {p.title}
                  {k === PHASES.length - 1 && <span className="project-tag">Current</span>}
                </h2>
                <p className="phase-lede">{p.lede}</p>
                <div className="phase-columns">
                  <div>
                    <ul className="phase-list">
                      {p.experiments.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                    <p className="phase-learning">
                      <span>{k === PHASES.length - 1 ? 'Current design question' : 'Key learning'}</span>
                      {p.learning}
                    </p>
                    {p.see && (
                      <div className="project-actions">
                        <button type="button" className={`project-button${k === PHASES.length - 1 ? ' is-primary' : ''}`} onClick={() => navigate(p.see!.route)}>
                          {p.see.label}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className={`phase-figures${p.figures.length === 1 ? ' is-single' : ''}`}>
                    {p.figures.map((f) => (
                      <img key={f.src} src={f.src} alt={f.alt} loading="lazy" />
                    ))}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="project-section project-archive-head" aria-labelledby="detail-heading">
        <h2 id="detail-heading">Phase 02 in detail: the growth model, rule by rule</h2>
        <p className="project-note">
          The measured record of the site-simulation phase, kept as it was written: the growth model the Site still runs,
          built up one rule at a time on an invented building. Its environment fields — sunlight, moisture, geometry — are
          the ones Build’s plants read today.
        </p>
      </section>

      <section className="project-section" aria-labelledby="pipeline-heading">
        <h2 id="pipeline-heading">The pipeline</h2>
        <ol className="pipeline-steps">
          {PIPELINE.map((stage, index) => (
            <li key={stage.name}>
              <span className="pipeline-index">{index + 1}</span>
              <strong>{stage.name}</strong>
              <span>{stage.detail}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="project-section" aria-labelledby="experiments-heading">
        <h2 id="experiments-heading">Experiments</h2>
        <p className="project-note">
          One rule at a time, with ivy alone — the original single plant — at the Balanced
          settings, seed 1, step 300, from the Corner view. These ran on the first Explore page (three
          species, presets and rule switches), which the midterm prototype replaced; that page is in
          the git history, at commit 1912b17, if any of them needs reproducing.
        </p>
        <ol className="experiments">
          {EXPERIMENTS.map((exp, index) => (
            <li className="experiment" key={exp.title}>
              <figure className="project-figure">
                <ExperimentFigure figure={exp.figure} />
              </figure>
              <div className="experiment-body">
                <h3>
                  <span className="experiment-index">{index + 1}</span>
                  {exp.title}
                </h3>
                <p className="experiment-rules">{exp.rules}</p>
                <p>{exp.result}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="project-section" aria-labelledby="species-heading">
        <h2 id="species-heading">Three species</h2>
        <p className="project-note">
          The same rule, three sets of needs, competing for the same wall: a cell belongs to whichever
          species reaches it first. Nothing tells a species where to go — the walls sort them.
          Balanced preset, step 900; numbers are the mean of ten seeds.
        </p>
        <div className="figure-pair">
          <figure className="project-figure">
            <ExperimentFigure figure={{ src: '/green/species-final.jpg', alt: 'The building from the front-left corner with all three species growing: pale flowering vine on the sunlit front, dark ivy in the inside corner, moss low on the west wall.' }} />
            <figcaption>Seed 1, from the Corner view.</figcaption>
          </figure>
          <figure className="project-figure">
            <ExperimentFigure figure={{ src: '/green/species-map.jpg', alt: 'The same view with each wall cell coloured by species: pink vine on the sunlit faces, green ivy in the shade, yellow moss at the foot of the west wall.' }} />
            <figcaption>
              The Species view of the same moment: <strong>vine</strong> pink, <strong>ivy</strong>{' '}
              green, <strong>moss</strong> yellow.
            </figcaption>
          </figure>
        </div>
        <div className="table-wrap">
          <table className="project-table">
            <thead>
              <tr>
                <th scope="col">Species</th>
                <th scope="col">Needs</th>
                <th scope="col">Grows</th>
                <th scope="col">Where it ended up</th>
              </tr>
            </thead>
            <tbody>
              {SPECIES_ROWS.map((row) => (
                <tr key={row.name}>
                  <th scope="row">{row.name}</th>
                  <td>{row.needs}</td>
                  <td>{row.grows}</td>
                  <td>{row.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="project-table is-numeric">
            <thead>
              <tr>
                <th scope="col">Share of each surface</th>
                <th scope="col">Ivy</th>
                <th scope="col">Moss</th>
                <th scope="col">Vine</th>
              </tr>
            </thead>
            <tbody>
              {WALLS.map((row) => (
                <tr key={row.wall}>
                  <th scope="row">{row.wall}</th>
                  <td>{row.ivy}%</td>
                  <td>{row.moss}%</td>
                  <td>{row.vine}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          The vine holds about half of every wall facing the sun and a quarter or more of each roof,
          and almost none of the walls facing away; moss is on the shaded walls, most of all the
          wing’s. Which species wins a particular surface still varies a lot from seed to seed —
          whoever arrives first keeps the cell — so a single run is one possible building, not the
          answer.
        </p>
      </section>

      <section className="project-section" aria-labelledby="presets-heading">
        <h2 id="presets-heading">The presets at step 900</h2>
        <p className="project-note">Same seed, same starting points, all three species. Only the parameters differ.</p>
        <div className="preset-grid">
          {PRESETS.map((p) => (
            <figure className="project-figure" key={p.name}>
              <ExperimentFigure figure={p.figure} />
              <figcaption>
                <strong>{p.name}</strong> · {p.result}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="project-section" aria-labelledby="decisions-heading">
        <h2 id="decisions-heading">Decisions and findings</h2>
        <dl className="decisions">
          {DECISIONS.map((d) => (
            <div key={d.title}>
              <dt>{d.title}</dt>
              <dd>{d.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="project-section" aria-labelledby="next-heading">
        <h2 id="next-heading">Where phase 02 ended</h2>
        <p>
          Die-back was built on the Site, where the Cornell Tech buildings have a real year of sun to die back through:
          over ten simulated years it moved the share of grown wall held by the species suited to it from 73% to 85–89%.
          The next step this page named — letting the plants change their environment — became phase 03.
        </p>
        <div className="project-actions">
          <button type="button" className="project-button is-primary" onClick={() => navigate({ section: 'project', page: 'decisions' })}>
            Why each pivot happened, in Decisions
          </button>
        </div>
      </section>
    </ProjectLayout>
  )
}
