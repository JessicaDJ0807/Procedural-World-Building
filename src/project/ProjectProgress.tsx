import { ProjectLayout } from './ProjectLayout'
import { PLAYGROUND, type PlaygroundId, type Route } from '../routes'

type Status = 'In Explore' | 'Partly' | 'Next'

type Stage = {
  topic: PlaygroundId
  /** The technique the Playground topic takes apart. */
  technique: string
  /** What the explorable worlds actually use of it today. Checkable against src/explore. */
  inExplore: string
  /** What it gives the worlds, or will. */
  contributes: string
  /** The part that is not there yet, said plainly rather than left off. */
  gap?: string
  status: Status
}

/**
 * Each Playground topic, and what it really contributes to the worlds.
 *
 * The status is the point. It would be easy to list seven techniques beside
 * three worlds and imply all seven are in them; two are fully, three in part,
 * and two not yet. Every "In Explore" line here can be found in src/explore.
 */
const STAGES: Stage[] = [
  {
    topic: 'objects',
    technique: 'The render loop, the standard material and runtime lighting',
    inExplore:
      'Every world runs on the same loop — one that stops drawing when nothing moves — with standard materials under a sun and a sky-coloured hemisphere fill.',
    contributes: 'The ground everything else is drawn on.',
    status: 'In Explore',
  },
  {
    topic: 'maps',
    technique: 'Layered noise, shaping, domain warp, erosion and colour ramps',
    inExplore:
      'The terrain of all three worlds: layered noise that never repeats, ridged and terraced shaping, domain warp, and landmarks — the volcano, the massif — built into the height function itself.',
    contributes: 'The shape of each world, and why they differ before anything else is added.',
    gap: 'Not droplet erosion. Droplets run across a whole grid, so terrain streamed in chunks cannot be eroded without seams; the lava channels and the river are carved by rule instead.',
    status: 'Partly',
  },
  {
    topic: 'voxels',
    technique: 'Solids as distance functions, combined with CSG and meshed',
    inExplore: 'Nothing yet — the worlds are height fields, so they have no inside.',
    contributes: 'Caves and overhangs: lava tubes under the caldera, ice caves at the coast.',
    gap: 'An earlier integration page combined Topic 2’s erosion with Topic 3’s caves on one terrain. It was retired with the Demo page and is kept in the git history.',
    status: 'Next',
  },
  {
    topic: 'shaders',
    technique: 'Surface shading strategies, animated water, Fresnel and haze',
    inExplore:
      'The water: a standard material with a rippling normal and drifting streaks added in its shader, so it lights and fogs like the land around it. Distance fog on every world.',
    contributes: 'How each world looks once its shape is settled.',
    gap: 'Topic 4’s slope, height and noise strategies are not on the terrain yet; it is coloured by vertex.',
    status: 'Partly',
  },
  {
    topic: 'distributions',
    technique: 'Placement from elevation, slope, distance to water and clustering',
    inExplore:
      'Every world’s scatter: height and slope windows, a clumping field so stands have edges, and nothing placed underwater. Topic 5 uses the same tree and rock geometry.',
    contributes: 'Trees, rocks, pillars and icebergs — where things grow, and why there.',
    status: 'In Explore',
  },
  {
    topic: 'paths',
    technique: 'Splines projected onto terrain, shaping it and shaped by it',
    inExplore:
      'Verdant Valley’s river: traced downhill, its water level only ever falling, its channel carved into the ground.',
    contributes: 'Rivers now; roads and paths between places later.',
    gap: 'No roads yet — they wait for settlements to connect.',
    status: 'Partly',
  },
  {
    topic: 'flow',
    technique: 'Particles carried by a vector field, drawn as trails',
    inExplore: 'Nothing yet.',
    contributes: 'Atmosphere without geometry: embers over the caldera, drifting snow, mist on the river.',
    status: 'Next',
  },
]

const topicOf = (id: PlaygroundId) => PLAYGROUND.find((entry) => entry.id === id)

type ProjectProgressProps = { navigate: (route: Route) => void }

export function ProjectProgress({ navigate }: ProjectProgressProps) {
  const count = (status: Status) => STAGES.filter((stage) => stage.status === status).length

  return (
    <ProjectLayout
      title="From experiments to worlds"
      lede="Each Playground topic takes one technique apart. This is what each one contributes to the three worlds — what Explore uses today, and what is still to come."
    >
      <p className="progress-summary">
        <span className="progress-count is-in-explore">{count('In Explore')} in Explore</span>
        <span className="progress-count is-partly">{count('Partly')} partly</span>
        <span className="progress-count is-next">{count('Next')} next</span>
      </p>

      <ol className="project-chain">
        {STAGES.map((stage) => {
          const topic = topicOf(stage.topic)
          const statusClass = `is-${stage.status.toLowerCase().replace(/ /g, '-')}`
          return (
            <li className={`project-stage ${statusClass}`} key={stage.topic}>
              <div className="project-stage-arrow" aria-hidden="true" />

              <div className="project-stage-body">
                <div className="project-stage-head">
                  <h2 className="project-stage-title">
                    <span className="project-stage-topic">{topic?.topic}</span>
                    {topic?.title}
                  </h2>
                  <span className={`project-status ${statusClass}`}>{stage.status}</span>
                </div>

                <p className="project-stage-what">{stage.technique}</p>

                <dl className="project-stage-facts">
                  <div>
                    <dt>In Explore</dt>
                    <dd>{stage.inExplore}</dd>
                  </div>
                  <div>
                    <dt>Contributes</dt>
                    <dd>{stage.contributes}</dd>
                  </div>
                  {stage.gap && (
                    <div>
                      <dt>Not yet</dt>
                      <dd>{stage.gap}</dd>
                    </div>
                  )}
                </dl>

                <button
                  type="button"
                  className="project-button is-quiet"
                  onClick={() => navigate({ section: 'playground', page: stage.topic })}
                >
                  Open {topic?.title}
                </button>
              </div>
            </li>
          )
        })}
      </ol>

      <section className="project-section">
        <h2>What comes next</h2>
        <ol className="next-steps">
          <li>Topic 4’s surface shading on the terrain, so each world’s ground is shaded rather than only coloured.</li>
          <li>Particles from Topic 7 for atmosphere — embers, snow, mist.</li>
          <li>Caves from Topic 3, under the caldera and along the frozen coast.</li>
          <li>Settlements, then roads from Topic 6 to connect them.</li>
        </ol>
        <div className="project-actions">
          <button
            type="button"
            className="project-button is-primary"
            onClick={() => navigate({ section: 'project', page: 'explore' })}
          >
            Explore the worlds
          </button>
        </div>
      </section>
    </ProjectLayout>
  )
}
