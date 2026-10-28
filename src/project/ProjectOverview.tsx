import { ProjectLayout } from './ProjectLayout'
import type { Route } from '../routes'
import { WILD_SPECIES } from '../wildform/species'
import { DRAPER_SWATCH } from '../build/draperMesh'

type ProjectOverviewProps = { navigate: (route: Route) => void }

/** The core loop, as the player meets it. */
const LOOP = ['build', 'plant', 'grow', 'interact', 'mutate', 'adapt']

/** What the player does, in order. */
const ACTIONS = [
  'construct a starting structure from a limited budget of rigid blocks',
  'place plants where they will matter',
  'live through the seasons — or, in the Lab, set the rain and the sun themselves',
  'run the growth, and watch the plants interact',
  'see living architecture grow where they meet',
  'modify the building, and grow again',
]

const BEHAVIOURS = [
  { name: 'Climber', arrow: '↑', swatch: WILD_SPECIES[0].look.swatch, text: 'Climbs surfaces and follows architectural edges.' },
  { name: 'Spreader', arrow: '↔', swatch: WILD_SPECIES[1].look.swatch, text: 'Expands across surfaces and seeks light.' },
  { name: 'Draper', arrow: '↓', swatch: DRAPER_SWATCH, text: 'Hangs from elevated edges and grows downward with gravity.' },
]

/** What living architecture grows today, in Build. */
const OUTCOMES = ['bridges', 'balconies', 'scaffolds', 'terraces', 'canopies', 'suspended walkways', 'hanging pods', 'root columns']

/** Not built: environments that would change the constraints. */
const FUTURE = ['Mountain — slopes and height to bridge', 'Beach — wind, sand and salt', 'Wetland — standing water and soft ground', 'Dense urban site — little light, tight gaps between buildings']

/**
 * What Wildform is, for someone arriving cold: the idea in a line, what the
 * player does, the plant behaviours, what their meeting grows, the current
 * challenge, and where it could go. The figures are captured from Build —
 * the stepping-stone run from docs/project/build.md at step 1,100 — and from
 * the Site. History belongs on Progress, reasons on Decisions.
 */
export function ProjectOverview({ navigate }: ProjectOverviewProps) {
  const go = (page: 'play' | 'site' | 'progress' | 'decisions') => () => navigate({ section: 'project', page })

  return (
    <ProjectLayout
      wide
      title="Wildform"
      lede={
        <>
          <p className="project-tagline">Grow architecture by shaping how plants behave.</p>
          <p>
            Wildform is a procedural building game where players construct the starting architecture, plant different
            growth behaviors, and shape environmental conditions. Plants grow, interact, and generate new living
            structures that the player does not directly design.
          </p>
        </>
      }
      aside={
        <>
          <p className="project-question">The player controls the conditions, but not the exact final form.</p>
          <div className="project-actions">
            <button type="button" className="project-button is-primary" onClick={go('play')}>
              Play
            </button>
            <button type="button" className="project-button" onClick={go('site')}>
              See it at campus scale
            </button>
            <button type="button" className="project-button" onClick={go('decisions')}>
              The design decisions
            </button>
          </div>
        </>
      }
    >
      <section className="project-section" aria-label="The game, after 1,100 steps">
        <figure className="project-figure">
          <img
            src="/project/build-hero.jpg"
            alt="The game after 1,100 steps: two buildings on a lawn joined by living bridges through a one-column stepping-stone tower. Teal Draper curtains hang from the roof edges and from under the west bridge; Climber and Spreader cover the tower and the east building; patchy ground cover spreads from their feet."
          />
          <figcaption>
            The game after 1,100 steps. The player placed three blocks — a stepping-stone tower — and planted; the plants
            grew the two bridges that join the buildings.
          </figcaption>
        </figure>
      </section>

      <section className="project-section" aria-labelledby="loop-heading">
        <h2 id="loop-heading">How it plays</h2>
        <ol className="loop-chain" aria-label="The core loop">
          {LOOP.map((step) => (
            <li key={step}>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="project-columns">
          <div>
            <p>Players begin with limited rigid building blocks and several procedural plant behaviors. They can:</p>
            <ul className="question-list">
              {ACTIONS.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
          <div>
            <p>
              The player does not directly design the final architecture. They decide where the rigid blocks go, where
              each plant starts, and when to act as the year turns — and the plants decide the rest.
            </p>
            <p>
              Building and growing are one loop, not two modes: editing the town mid-growth carries every plant onto the
              new building, and the new walls are open to growth.
            </p>
          </div>
        </div>
      </section>

      <section className="project-section" aria-labelledby="behaviour-heading">
        <h2 id="behaviour-heading">Growth behaviors</h2>
        <div className="behaviour-grid">
          {BEHAVIOURS.map((b) => (
            <div className="behaviour-card" key={b.name} style={{ ['--behaviour' as string]: b.swatch }}>
              <span className="behaviour-arrow" aria-hidden="true">
                {b.arrow}
              </span>
              <strong>{b.name}</strong>
              <span>{b.text}</span>
            </div>
          ))}
          <div className="behaviour-card is-derived">
            <span className="behaviour-arrow" aria-hidden="true">
              ≋
            </span>
            <strong>Layered</strong>
            <span>Not a plant species: a derived state, where one plant has grown over another and growth accumulates.</span>
          </div>
        </div>
      </section>

      <section className="project-section" aria-labelledby="living-heading">
        <h2 id="living-heading">Living architecture</h2>
        <div className="figure-pair is-text-first">
          <div>
            <p>
              When compatible growth meets — enough Climber and Spreader together, a plant grown over layered growth, or a
              Draper’s curtain hanging over Climber, Spreader or layered growth — a mutation node forms, and architecture grows from it: {OUTCOMES.join(', ')}. Which one, and its shape, come
              from what met there, the way the plants were growing, the walls nearby and the space in front.
            </p>
            <p>
              Once mature, a structure is part of the building: it shades the plants under it, gives Climbers something to
              climb, and gives Drapers an edge to hang from — new conditions for the next round of growth.
            </p>
          </div>
          <figure className="project-figure">
            <img
              src="/project/build-close.jpg"
              alt="Close on a living bridge where it meets the stepping-stone tower: a fibrous deck on root braces, Draper curtains hanging under it and down the west building's façade, the tower covered in Climber and Spreader."
            />
            <figcaption>A living bridge at the tower, with Draper curtains hanging from its deck and the façade beside it.</figcaption>
          </figure>
        </div>
      </section>

      <div className="project-columns">
        <section className="project-section" aria-labelledby="goal-heading">
          <h2 id="goal-heading">The current challenge</h2>
          <p className="project-question is-inline">
            Use limited rigid construction and procedural growth to connect separated buildings with living architecture.
          </p>
          <p>
            Two buildings stand eight columns apart on a lawn; a living bridge reaches about five. Blocks have to bring them
            within reach — and if blocks join them outright, they become one building and it doesn’t count.
          </p>
          <div className="project-actions">
            <button type="button" className="project-button is-primary" onClick={go('play')}>
              Try it
            </button>
          </div>
        </section>

        <section className="project-section" aria-labelledby="scale-heading">
          <h2 id="scale-heading">At campus scale</h2>
          <p>
            <strong>Site</strong> takes the same environment rules — moisture, the geometry of every wall — to a real place:
            the six Cornell Tech buildings on Roosevelt Island, from NYC Open Data, with procedural façades, the real sun
            and a simulated year. The game’s behaviors and living architecture are the next step there.
          </p>
          <div className="project-actions">
            <button type="button" className="project-button" onClick={go('site')}>
              Open the Site
            </button>
            <button type="button" className="project-button" onClick={go('progress')}>
              How it got here
            </button>
          </div>
        </section>
      </div>

      <section className="project-section project-future" aria-labelledby="future-heading">
        <h2 id="future-heading">
          Future environments <span className="project-tag">Not built</span>
        </h2>
        <p className="project-note">
          The lawn is a baseline: flat, open, evenly lit. Other environments would bring their own constraints to build and
          grow against.
        </p>
        <ul className="question-list is-muted">
          {FUTURE.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>
    </ProjectLayout>
  )
}
