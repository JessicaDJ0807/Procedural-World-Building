import { ProjectLayout } from './ProjectLayout'
import type { Route } from '../routes'

type ProjectOverviewProps = { navigate: (route: Route) => void }

const INPUTS = [
  { name: 'Building geometry', detail: 'corners, window frames, ledges, balconies, roof edges' },
  { name: 'Sunlight', detail: 'which walls face the sun, and what shades them' },
  { name: 'Moisture', detail: 'where rain lands, runs, and collects on the roofs' },
]

const STAGES = [
  { name: 'Growth rules', detail: 'three species — ivy, moss, a flowering vine — each scoring the building by its own needs' },
  { name: 'Vegetation spreads over time', detail: 'a step at a time, from seeds at the foot of the wall, competing for space' },
  { name: 'The building gradually changes', detail: 'some walls and roofs disappear under leaves; others stay bare' },
]

const QUESTIONS = [
  'How does facade geometry guide vine growth?',
  'Do edges, corners, ledges and windows change the pattern?',
  'How do sunlight and moisture change where vegetation survives?',
  'Can simple local rules create believable organic growth?',
]

const FUTURE = [
  'More than one building, so they can shade and shelter each other',
  'Seasonal change — growth in spring, die-back in winter',
  'Plants that die back where they cannot live, so the wall settles instead of filling',
  'Plants that change their surroundings — shading the wall, holding water against it',
  'Abandoned or reclaimed architecture, where the plants have had decades',
]

/**
 * The idea, the question, and how the system answers it.
 *
 * Written in the first person because it is a statement of intent, not
 * documentation; the mechanism is on Progress and in docs/. The two figures
 * are the same run seen two ways — the building, and which species holds each
 * cell — because "the environment sorts the plants" is easier to see than to
 * read.
 */
export function ProjectOverview({ navigate }: ProjectOverviewProps) {
  const explore = () => navigate({ section: 'project', page: 'explore' })
  const progress = () => navigate({ section: 'project', page: 'progress' })

  return (
    <ProjectLayout
      wide
      title="Green Architecture"
      lede={
        <>
          <p>
            I’m interested in what happens when architecture is not static. Instead of manually
            placing plants on a building, I want to explore how vegetation could gradually grow
            across it based on the building’s shape and its environment.
          </p>
        </>
      }
      aside={
        <>
          <p className="project-question">
            How do geometry, sunlight, and moisture influence where plants grow?
          </p>
          <div className="project-actions">
            <button type="button" className="project-button is-primary" onClick={explore}>
              Watch it grow
            </button>
            <button type="button" className="project-button" onClick={progress}>
              See the experiments
            </button>
          </div>
        </>
      }
    >
      <section className="project-section" aria-labelledby="pair-heading">
        <h2 id="pair-heading">One run, two ways of looking at it</h2>
        <div className="figure-pair">
          <figure className="project-figure">
            <img src="/green/species-final.jpg" alt="An L-shaped five-storey building with a two-storey wing, covered in three kinds of plant: a pale flowering vine on the sunlit fronts and the roofs, dark ivy in the shadow of the inside corner, and yellow-green moss on the wing's shaded west wall." />
            <figcaption>The building after 900 steps of the Balanced preset, with all three species growing.</figcaption>
          </figure>
          <figure className="project-figure">
            <img src="/green/species-map.jpg" alt="The same building with each cell coloured by the species holding it: pink vine on the sunlit faces and roofs, green ivy in the shade, yellow moss on the wing's west wall." />
            <figcaption>
              The same moment, coloured by species. Nobody placed these territories: the vine took
              the walls facing the sun and the roofs, ivy the shadow of the inside corner, moss the
              wing’s shaded west wall.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="project-section" aria-labelledby="system-heading">
        <h2 id="system-heading">The system</h2>
        <div className="flow" role="list">
          <div className="flow-inputs" role="listitem">
            {INPUTS.map((input, index) => (
              <div className="flow-input-wrap" key={input.name}>
                {index > 0 && (
                  <span className="flow-plus" aria-hidden="true">
                    +
                  </span>
                )}
                <div className="flow-node is-input">
                  <strong>{input.name}</strong>
                  <span>{input.detail}</span>
                </div>
              </div>
            ))}
          </div>
          {STAGES.map((stage) => (
            <div className="flow-step" role="listitem" key={stage.name}>
              <span className="flow-arrow" aria-hidden="true" />
              <div className="flow-node">
                <strong>{stage.name}</strong>
                <span>{stage.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="project-columns">
        <section className="project-section" aria-labelledby="explore-heading">
          <h2 id="explore-heading">What I want to explore</h2>
          <ul className="question-list">
            {QUESTIONS.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>

        <section className="project-section" aria-labelledby="scope-heading">
          <h2 id="scope-heading">Current scope</h2>
          <p>
            One building and three species. The building is simple on purpose: it is there to give
            growth something to respond to — a sheltered inside corner, walls that face different
            ways, windows to route around, ledges that hold water, two flat roofs, and a terrace
            where a wall rises from a roof.
          </p>
          <p>
            Ivy likes shade and follows edges; moss needs a wet, dark wall and spreads in patches; a
            flowering vine wants sun and tolerates drought. They start from seeds at the foot of the
            walls, climb onto the roofs, and compete for every cell, and the same seed and settings
            always grow the same building.
          </p>
        </section>
      </div>

      <section className="project-section project-future" aria-labelledby="future-heading">
        <h2 id="future-heading">
          Possible future direction <span className="project-tag">Not built</span>
        </h2>
        <ul className="question-list is-muted">
          {FUTURE.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>
    </ProjectLayout>
  )
}
