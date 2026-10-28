import { ProjectLayout } from './ProjectLayout'
import type { Route } from '../routes'

type ProjectDecisionsProps = { navigate: (route: Route) => void }

type Figure = { src: string; alt: string; caption?: string }

type Decision = {
  title: string
  /** The decision in one sentence. */
  summary: string
  /** The rule as built, in words, then as it is computed. */
  rule: string
  formula: string
  why: string
  /** What came first, and what was wrong with it. */
  before: string
  /** Measurements that show the rule doing what it is for. */
  evidence: string[]
  /** What is still a judgement — the thing to discuss. */
  question: string
  figures: Figure[]
  /** Where to see it for yourself. */
  see: { label: string; route: Route }
}

/** A design decision, written for critique: the question, what was decided, and why. */
type DesignDecision = {
  title: string
  question?: string
  /** What came before, and what was wrong with it — when there was one. */
  earlier?: string
  problem?: string
  decision: string
  /** A list under the decision, when it has parts. */
  parts?: string[]
  why?: string
  principle?: string
  /** Still open — the thing to push on in a review. */
  discuss?: string
  future?: boolean
}

/**
 * The decisions behind Wildform's pivots, in the order they were made. These
 * are design decisions, not implementation details; the measured ones they
 * rest on are in docs/project/build.md and on Progress. The growth-model
 * decisions from phase 02 follow, kept as they were written.
 */
const DESIGN: DesignDecision[] = [
  {
    title: 'Simulation → gameplay',
    question: 'Is watching vegetation grow enough?',
    decision: 'No. Growth became the mechanism underneath a playable build → plant → grow → adapt loop.',
    why: 'The player needs goals and consequential decisions rather than only observing a simulation. The site simulation answered real questions — which walls green, and why — but there was nothing for a visitor to decide.',
    discuss: 'Does a goal (join two buildings) narrow the experience too far, or is it what makes the growth matter?',
  },
  {
    title: 'Unlimited building → constrained building',
    question: 'Should players have Townscaper-like unlimited freedom?',
    decision: 'Simple, expressive modular building — the rules decide walls, roofs, arches — but from a budget of 30 rigid blocks.',
    why: 'Freedom makes construction expressive; constraints make choices meaningful. With the two buildings first four columns apart, the plants joined them without a block spent and there was no decision to make; at eight apart, the player has to choose what to build.',
    discuss: 'Three blocks of thirty win today — a stepping-stone tower. Should the budget tighten, or the challenge ask for more?',
  },
  {
    title: 'The player designs conditions, not outcomes',
    decision: 'The player controls:',
    parts: ['the starting architecture', 'where each plant starts', 'the environment — rain and the sun’s direction'],
    why: 'Living architecture emerges procedurally from how the plants meet. The player can make a bridge likely, not draw one.',
    principle: 'The player controls the conditions, but not the exact final form.',
  },
  {
    title: 'A vocabulary of plant behaviors',
    decision: 'Each plant is a behavior, defined by the direction it grows:',
    parts: ['Climber — vertical, attachment-driven', 'Spreader — horizontal, light-seeking', 'Draper — downward, gravity-driven', 'Layered — the derived overlap state, not a species'],
    why: 'Separate behaviors make placement a real choice: planting a Climber or a Spreader decides which way growth goes, and where they overlap is what the mutation rules read. Draper adds the direction that was missing, and the elevated edges — roofs, ledges, living decks — that nothing else used.',
    discuss: 'Draper isn’t in the mutation rules yet. What should a Draper meeting another behavior grow?',
  },
  {
    title: 'Generic balcony → living mutations',
    question: 'What should happen when plants interact?',
    earlier: 'The midterm prototype spawned a standard rectangular platform where the plants met.',
    problem: 'It looked prefab rather than grown — the same slab wherever it formed.',
    decision: 'Architecture derives from the meeting:',
    parts: ['which behaviors met, and how deep their layers are', 'the geometry where they collided', 'the direction they were growing', 'nearby architecture in reach', 'the free space in front'],
    why: 'A bridge reaches for another building, a balcony curls out from the wall, a scaffold climbs past the roof — each a set of curves, so no two come out alike.',
  },
  {
    title: 'Roosevelt Island → baseline + future environments',
    decision: 'Keep Roosevelt Island as the real-site application, while the game becomes a general sandbox that starts on a simple lawn.',
    why: 'A real campus is too large and too fixed to learn the game on; a lawn makes every effect readable. The Site keeps the same environmental logic at full scale.',
    parts: ['Mountain', 'Beach', 'Wetland', 'Dense urban conditions'],
    future: true,
  },
]

/**
 * Every number here is from the runs documented in docs/project/ — the
 * Explore experiments (Progress page, green-architecture.md) and the campus
 * (roosevelt-island.md) — at the seed and step named there. Nothing new is
 * measured on this page; it gathers the decisions in one place to argue with.
 */
const DECISIONS: Decision[] = [
  {
    title: 'One growth rule for every plant',
    summary: 'All three species grow by the same rule: a tip steps from cell to cell across the building, and the environment decides whether it may enter.',
    rule:
      'Every surface is cut into cells. Growth starts from seeds at the foot of the walls; each tip scores its eight neighbours, tries the best, and enters it with a chance that rises with the square of that cell’s suitability — never below a cutoff. A tip that fails stalls and may give up; a grown tip sometimes branches; new tips only start on grown cells, so growth stays connected.',
    formula: 'suitability = moisture match × light match × (1 − w + w·geometry)\nP(enter) = (0.05 + 0.95 · suitability²) · vigour,  only if suitability > 0.1',
    why: 'The three fields are multiplied, not added, so a cell has to be acceptable on every count — wet enough, lit right, and near something to hold. That is what makes the environment decide where a plant goes rather than only how fast it fills the wall.',
    before:
      'The first rule let a tip enter with a chance that rose linearly with suitability. A tip that fails tries again, so any chance at all is eventually a certainty: it filled 94% of the wall by step 600, and the cells it grew into had exactly the façade’s average moisture, light and geometry. The environment changed the speed, never the pattern.',
    evidence: [
      'Each field alone still fills 92–100% of the wall by step 900; only their product is selective — 64%.',
      'Sunlight is the strongest single rule (grown cells get 0.61× the façade’s light); moisture barely matters at 50% rain until the dry, sunny roofs appear.',
      'Without dying, the rules set the order, not the end: 57% covered by step 900, 92% by step 3,000.',
    ],
    question: 'Is “eventually everything reachable fills” acceptable for a simulation about where plants grow — or should the rule itself, not die-back, stop growth on poor cells?',
    figures: [
      { src: '/green/exp-1-none.jpg', alt: 'The invented building almost entirely covered in an even layer of ivy.', caption: 'No environmental rules: a race, 93.5% covered by step 300.' },
      { src: '/green/exp-5-combined.jpg', alt: 'A few strands of ivy in the shaded inside corner, most of the building bare.', caption: 'All three fields multiplied: 15.7%, all of it in the shade and along edges.' },
    ],
    see: { label: 'Open the Site', route: { section: 'project', page: 'site' } },
  },
  {
    title: 'Species differ only in what they need',
    summary: 'Ivy, moss and the flowering vine share the rule above; each has its own light preference, water need, liking for edges and urge to climb. Whoever reaches a cell first keeps it.',
    rule:
      'Light is measured in hours of direct sun and divided by 8, so a species’ preference lands on the terms a gardener uses: moss wants about 1.2 h (shade), ivy 2.8 h (part sun), the vine 6.4 h (full sun). Nobody tells a species where to go; each simply finds some cells more suitable than others, and the race does the rest.',
    formula: 'light match = clamp(1 − 1.1 · |light − preference|, 0.08, 1),  light = sun hours ÷ 8\n            ivy   moss   vine\nlight pref  0.35  0.15   0.80\nwater need  0.50  0.85   0.30\nedges       0.45  0.20   0.50',
    why: 'One rule with different needs means territories emerge rather than being drawn. If the vine ends up on the sunny walls, it is because the sun is there — which is the claim the project wants to be able to make.',
    before:
      'The first moss branched freely with 32 tips: it took 43.5% of the wall and pushed ivy to 11.9%, which is not what moss does. With a third of the branching, 16 tips and a higher water need it settled at 13%. An edge preference of 0.9 wiped a whole species out in 9 runs of 30 once three competed; the presets now stay at or below 0.7.',
    evidence: [
      'On the campus, on a fixed June day, the vine holds 95.9% of full-sun walls and ivy 70.8% of part-sun walls — sorted by light class on their own.',
      'On a fixed December day moss holds 76.9% of the shaded walls and is the largest species.',
      'On the invented building the vine grows at 1.88× the average light, moss at 1.26× the moisture and 0.37× the light.',
    ],
    question: 'First arrival keeps a cell forever. Should a better-suited species be able to take over a cell from a worse-suited one, or is first come, first served closer to how walls actually green?',
    figures: [
      { src: '/project/species-june.jpg', alt: 'The campus after 6,000 steps in June by species: sunlit walls lavender with flowering vine, ivy green in the shaded gaps.', caption: 'The campus in June, by species: vine on the sun, ivy in the shade.' },
      { src: '/green/species-map.jpg', alt: 'The invented building with each cell coloured by species: vine on the sunlit faces, ivy in the shade, moss at the foot of the west wall.', caption: 'The same sorting on the invented building.' },
    ],
    see: { label: 'Open the Site', route: { section: 'project', page: 'site' } },
  },
  {
    title: 'Light comes from the real sun',
    summary: 'On the campus, a cell’s light is how many hours of direct sun it gets on a clear day at 40.76° N — traced every half hour, with a shadow ray through every building on the island.',
    rule:
      'Three days are traced: the June solstice, the equinox and the December solstice. Over a simulated year (2,400 steps) each cell’s hours are interpolated between them by the sun’s declination and refreshed twelve times a year; warmth follows a month behind the sun and slows growth to a tenth in deep winter. The scene you see is lit by the real sun for the day showing, late in the afternoon.',
    formula: 'light = min(1, direct-sun hours ÷ 8)\nyear: hours interpolated by declination between 21 Dec, 20 Mar, 21 Jun\nvigour = 0.1 + 0.9 · warmth',
    why: 'The building is real, so its shade should be too: The House shades its neighbours, the gaps between buildings get little sun, and Verizon goes from 36% of its walls in full sun in June to 1% in December. A made-up sun would have made the species’ territories made up as well.',
    before:
      'The invented building of phase 02 has one fixed sun at 38°, enough to show the rules working. Tracing every day of the year was the alternative to three days; the year’s light changes smoothly with the sun’s declination, so three traced days interpolate it, and the tracing runs once, in a background worker, when the page opens.',
    evidence: [
      '71% of campus walls get 6 h or more of sun in June, 27% in December.',
      '8 North Loop Road, at the foot of The House, has no wall cell reaching 3 h in December.',
      'Sunrise and sunset in the scene come within a minute of published New York times.',
    ],
    question: 'The sky is always clear and only direct sun counts, so a north wall reads zero light where in reality the sky lights it. Is that acceptable for comparing walls with each other — and when does diffuse light have to come in?',
    figures: [
      { src: '/project/sun-june.jpg', alt: 'The campus painted by hours of direct sun on 21 June: nearly every wall pale, six hours or more.', caption: '21 June: hours of direct sun.' },
      { src: '/project/sun-december.jpg', alt: 'The same view on 21 December: walls tan and brown, black shadow between the buildings.', caption: '21 December: the same walls.' },
    ],
    see: { label: 'Open the Site', route: { section: 'project', page: 'site' } },
  },
  {
    title: 'Plants die back where they can’t live',
    summary: 'A grown cell can wither if its species is poorly suited to it right now. Roots survive; a climber’s stem takes everything above it when it goes.',
    rule:
      'Every 25 steps, each grown cell is checked: the further its suitability falls below one half, the likelier it dies. Seeds never die. A climber’s cells hang from the cell they grew from, so when a stem dies everything grown from it goes too — which is why a winter can strip a whole wall.',
    formula: 'h = max(0, 1 − env ÷ 0.5)\nP(die per step) = 0.01 · h²     (swept every 25 steps)',
    why: 'Without dying, a summer’s mistake is permanent: the vine climbs into walls that are only sunny in June and keeps them through every winter. Dying is what makes the end state reflect the whole year, not the best week of it.',
    before:
      'The rate and threshold were chosen from four settings run over four years. The gentlest, 0.004 with a threshold of 0.35, left summer and winter within 0.3 points of each other — die-back that does nothing visible. On a fixed day it changes little either (91.9% to 89.0% in June): it is the turning year that sends plants into walls they can’t keep.',
    evidence: [
      'Over ten years, the share of grown wall held by the species suited to it rises from 73% to 85–89%.',
      'Each winter cuts the vine back out of part-sun walls (39% → 28%) and off shaded ones (to 0.1%); ivy keeps them.',
      'Coverage breathes about 3 points a year instead of only ever rising.',
    ],
    question: 'Death here depends only on light and water. Frost, drought years, pruning and the plant’s own age aren’t in it. Which of those matters most for the story the project tells?',
    figures: [
      { src: '/project/year4-september.jpg', alt: 'The campus by species at the end of year 4’s summer: vine across the sunlit walls and up The House’s west face.', caption: 'Year 4, September: the vine up The House’s west face.' },
      { src: '/project/year4-march.jpg', alt: 'The same view six months later: The House’s west face cut back to bare.', caption: 'The following March: that face cut back to bare.' },
    ],
    see: { label: 'Open the Site', route: { section: 'project', page: 'site' } },
  },
  {
    title: 'The surface decides where a plant can hold',
    summary: 'Each building has a procedural façade, and every piece of it is a surface type that means something to a plant: glass can’t be grown on, a seam is a path, a ledge holds water, smooth metal gives little grip.',
    rule:
      'Façade rules per building — floor height, bay width, window size, louver spacing — classify every cell into one of thirteen surface types, and build the visible windows, fins and louvers from the same layout, so the glass a plant avoids is exactly the glass you see. Each type multiplies each species’ suitability and can add moisture or shade.',
    formula: '               ivy   moss  vine\nglass           0     0     0\nsmooth metal   0.40  0.15  0.45\nseam / frame   1.00  0.60  0.95\nlouver         0.80  0.45  1.00\nledge          1.00  0.90  1.00',
    why: 'A footprint says nothing about a building’s face, so at first every wall was the same surface and the buildings greened alike (48–69%). Architecture is half of the project’s question; the façade is where it reaches the plant.',
    before:
      'The first coefficients were too harsh: with the vine at 0.55 on panels and 0.3 on metal, entering — which goes with suitability squared — fell to roughly a third, and the vine almost vanished (29.6% of the campus to 3.5%). Softened, it holds about a quarter.',
    evidence: [
      'Buildings now spread from 17% to 56% covered, and the order changes.',
      'The Graduate Hotel falls from 66% to 17%: it is 39% glass and 19% smooth metal, and its fins are separate lines between glass — half of them fill, against 96% of The House’s connected grid of seams.',
      'Glass 0%; louvers 84%; the Tata roof garden 92%; moss gathers at damp bases and in shaded recesses.',
    ],
    question: 'The coefficients are design choices, not measurements. Which ones would a horticulturist argue with first — and would a trellis on the glass tower be the design response the simulation should test?',
    figures: [
      { src: '/project/surface-surfaces.jpg', alt: 'The House and the Graduate Hotel in the Surfaces view: The House’s seams a dense orange grid, the Graduate’s fins separate lines between glass panels.', caption: 'Surfaces: The House (left) is a grid of seams; the Graduate Hotel, fins between glass.' },
      { src: '/project/surface-final.jpg', alt: 'The same view after four years: The House densely covered along its grid, the Graduate Hotel with thin strands hanging from its fins.', caption: 'Four years later: the grid fills, the fins barely.' },
    ],
    see: { label: 'Open the Site', route: { section: 'project', page: 'site' } },
  },
]

/** Numbers chosen, not measured: the places to push. */
const ASSUMPTIONS = [
  { name: 'Entry cutoff', value: 'suitability 0.1', note: 'Below it a cell is never entered.' },
  { name: 'Light scale', value: '8 h of sun = full light', note: 'Puts the species’ defaults on gardeners’ shade / part sun / full sun.' },
  { name: 'Die-back', value: 'rate 0.01, threshold 0.5', note: 'Chosen from four settings over four years.' },
  { name: 'Winter', value: 'growth slows to a tenth', note: 'Warmth is a cosine a month behind the sun, not temperature data.' },
  { name: 'Surface multipliers', value: 'per species, per surface', note: 'Design coefficients for glass, metal, seams, louvers, ledges…' },
  { name: 'Façades', value: 'from published descriptions', note: 'Plausible proportions, not surveyed drawings.' },
]

/**
 * The main design decisions, one card each: the rule, why, what came first,
 * the evidence, and the open question — gathered so they can be discussed
 * without reading the whole notebook. The depth stays in Progress and docs/.
 */
export function ProjectDecisions({ navigate }: ProjectDecisionsProps) {
  return (
    <ProjectLayout
      wide
      title="Decisions"
      lede="The design decisions behind Wildform’s pivots — each with the question it answered, what was decided, and why — and what is still open for discussion."
    >
      <section className="project-section" aria-label="Design decisions">
        <div className="design-decisions">
          {DESIGN.map((d, i) => (
            <article className="design-decision" key={d.title} aria-labelledby={`design-${i + 1}`}>
              <h3 id={`design-${i + 1}`}>
                <span className="experiment-index">{i + 1}</span>
                {d.title}
              </h3>
              <dl>
                {d.question && (
                  <div>
                    <dt>Question</dt>
                    <dd>{d.question}</dd>
                  </div>
                )}
                {d.earlier && (
                  <div>
                    <dt>Earlier version</dt>
                    <dd>{d.earlier}</dd>
                  </div>
                )}
                {d.problem && (
                  <div>
                    <dt>Problem</dt>
                    <dd>{d.problem}</dd>
                  </div>
                )}
                <div>
                  <dt>{d.earlier ? 'Current direction' : 'Decision'}</dt>
                  <dd>
                    {d.decision}
                    {d.parts && !d.future && (
                      <ul>
                        {d.parts.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
                {d.why && (
                  <div>
                    <dt>Why</dt>
                    <dd>{d.why}</dd>
                  </div>
                )}
                {d.principle && (
                  <div className="is-principle">
                    <dt>Principle</dt>
                    <dd>{d.principle}</dd>
                  </div>
                )}
                {d.future && d.parts && (
                  <div>
                    <dt>
                      Future environments <span className="project-tag">Not built</span>
                    </dt>
                    <dd>
                      {d.parts.join(' · ')} — each would bring its own constraints to build and grow against.
                    </dd>
                  </div>
                )}
                {d.discuss && (
                  <div>
                    <dt>To discuss</dt>
                    <dd>{d.discuss}</dd>
                  </div>
                )}
              </dl>
            </article>
          ))}
        </div>
        <div className="project-actions">
          <button type="button" className="project-button is-primary" onClick={() => navigate({ section: 'project', page: 'play' })}>
            Try them in the game
          </button>
          <button type="button" className="project-button" onClick={() => navigate({ section: 'project', page: 'progress' })}>
            How the project evolved
          </button>
        </div>
      </section>

      <section className="project-section project-archive-head" aria-labelledby="model-heading">
        <h2 id="model-heading">The growth model underneath</h2>
        <p className="project-note">
          Five decisions from the site-simulation phase that still shape what grows where — the rule, why it is that way,
          what came first, the evidence, and the question still open. The Site runs this model; its sunlight, moisture and
          geometry fields are the ones the game’s plants read.
        </p>
      </section>

      <nav className="decision-index" aria-label="Growth-model decisions">
        <ol>
          {DECISIONS.map((d, i) => (
            <li key={d.title}>
              <a href={`#decision-${i + 1}`}>
                <span className="experiment-index">{i + 1}</span>
                {d.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {DECISIONS.map((d, i) => (
        <section className="project-section decision-card" id={`decision-${i + 1}`} key={d.title} aria-labelledby={`decision-${i + 1}-heading`}>
          <h2 id={`decision-${i + 1}-heading`}>
            <span className="experiment-index">{i + 1}</span>
            {d.title}
          </h2>
          <p className="decision-summary">{d.summary}</p>
          <div className="figure-pair">
            {d.figures.map((f) => (
              <figure className="project-figure" key={f.src}>
                <img src={f.src} alt={f.alt} loading="lazy" />
                {f.caption && <figcaption>{f.caption}</figcaption>}
              </figure>
            ))}
          </div>
          <dl className="decision-facts">
            <div>
              <dt>The rule</dt>
              <dd>
                <p>{d.rule}</p>
                <pre className="decision-formula">{d.formula}</pre>
              </dd>
            </div>
            <div>
              <dt>Why</dt>
              <dd>{d.why}</dd>
            </div>
            <div>
              <dt>What came first</dt>
              <dd>{d.before}</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>
                <ul>
                  {d.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div className="decision-question">
              <dt>Open question</dt>
              <dd>{d.question}</dd>
            </div>
          </dl>
          <div className="project-actions">
            <button type="button" className="project-button" onClick={() => navigate(d.see.route)}>
              {d.see.label}
            </button>
          </div>
        </section>
      ))}

      <section className="project-section" aria-labelledby="assumptions-heading">
        <h2 id="assumptions-heading">Chosen, not measured</h2>
        <p className="project-note">
          The numbers above that are judgements rather than measurements — the first places to push in a discussion.
        </p>
        <div className="table-wrap">
          <table className="project-table">
            <thead>
              <tr>
                <th scope="col">Assumption</th>
                <th scope="col">Set to</th>
                <th scope="col">Why it is there</th>
              </tr>
            </thead>
            <tbody>
              {ASSUMPTIONS.map((a) => (
                <tr key={a.name}>
                  <th scope="row">{a.name}</th>
                  <td>{a.value}</td>
                  <td>{a.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="project-actions">
          <button type="button" className="project-button is-primary" onClick={() => navigate({ section: 'project', page: 'progress' })}>
            The experiments behind these, in Progress
          </button>
        </div>
      </section>
    </ProjectLayout>
  )
}
