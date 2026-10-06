import { NoiseViewport } from '../NoiseViewport'
import { ProjectLayout } from './ProjectLayout'
import { useWorld } from './useWorld'
import { defaultWorld } from './world'
import type { Route } from '../routes'

type System = {
  name: string
  topic: string
  /** Where it sits in the pipeline, in one line. */
  role: string
  /** What it actually contributes, named concretely enough to be checkable. */
  parts: string[]
  state: 'in the demo' | 'partly wired' | 'not yet wired'
  to: Route
}

/**
 * The four systems, and how much of each is really in the demo.
 *
 * The `state` field is the point of this table. It would be easy to list four
 * techniques and imply all four are integrated; three are, to different
 * depths, and the shading study is not. Saying so is more useful than the
 * version that reads better.
 */
const SYSTEMS: System[] = [
  {
    name: 'Objects',
    topic: 'Topic 1',
    role: 'The foundation everything else draws on.',
    parts: [
      'the render loop, which separates advancing state from presenting it',
      'the standard material model and runtime-generated environment lighting',
      'camera gating, so a still scene stops submitting frames',
    ],
    state: 'in the demo',
    to: { section: 'playground', page: 'objects' },
  },
  {
    name: 'Maps',
    topic: 'Topic 2',
    role: 'Generates the terrain. Every other system reads what this produces.',
    parts: [
      'a six-octave fBm stack, composited layer by layer',
      'domain warp, which bends the stack sideways before anything erodes it',
      'droplet hydraulic erosion — the step that turns noise into landforms',
      'thermal collapse, which fails any slope past the talus angle',
      'hypsometric colour ramps interpolated in OKLab',
    ],
    state: 'in the demo',
    to: { section: 'playground', page: 'maps' },
  },
  {
    name: 'Voxels',
    topic: 'Topic 3',
    role: 'Turns the terrain into a solid, so it can have an inside.',
    parts: [
      'the heightfield read as a signed distance function',
      'CSG subtraction, carving a gyroid tunnel network out of the rock',
      'surface nets, meshing the result back into triangles',
    ],
    state: 'partly wired',
    to: { section: 'playground', page: 'voxels' },
  },
  {
    name: 'Shaders',
    topic: 'Topic 4',
    role: 'Decides how the surface looks once its shape is settled.',
    parts: [
      'eight fragment-shader strategies over one fixed terrain',
      'a lighting model built for a dark ground',
      'Fresnel and distance haze',
      'four GPU simulations: ripples, reaction–diffusion, erosion, schooling',
    ],
    state: 'not yet wired',
    to: { section: 'playground', page: 'shaders' },
  },
]

const STATE_LABEL: Record<System['state'], string> = {
  'in the demo': 'In the demo',
  'partly wired': 'Partly wired',
  'not yet wired': 'Not yet wired',
}

type ProjectOverviewProps = { navigate: (route: Route) => void }

export function ProjectOverview({ navigate }: ProjectOverviewProps) {
  // The same generator the Demo runs, at its defaults. A captured image would
  // be a claim about the code rather than the code's own output, and would go
  // stale the first time a default moved.
  const { world, ramp } = useWorld(defaultWorld())

  return (
    <ProjectLayout
      title="One terrain, every technique"
      lede="A single procedurally generated world, assembled from the techniques each Playground topic takes apart. The Playground asks how one technique behaves; the project asks what happens when they all have to agree on the same ground."
    >
      <section className="project-hero">
        <div className="project-hero-view">
          <NoiseViewport
            mode="surface"
            resolution={world.resolution}
            field={world.height}
            heightScale={defaultWorld().relief}
            selected={null}
            ramp={ramp}
            overlay={null}
            spin={0}
            wireframe={false}
          />
        </div>
        <p className="project-caption">
          Live, not a screenshot — {world.resolution}² cells, {world.droplets.toLocaleString()}{' '}
          droplets of rain, generated in {world.ms.toFixed(0)} ms. Drag to orbit.
        </p>
      </section>

      <div className="project-actions">
        <button
          type="button"
          className="project-button is-primary"
          onClick={() => navigate({ section: 'project', page: 'demo' })}
        >
          Open interactive demo
        </button>
        <button
          type="button"
          className="project-button"
          onClick={() => navigate({ section: 'project', page: 'progress' })}
        >
          See how it got here
        </button>
      </div>

      <section className="project-section">
        <h2>What this is</h2>
        <p>
          The course works one technique at a time, and each one is easiest to
          understand in isolation — which is exactly what the Playground is for. But
          a technique studied alone never has to survive contact with the others.
          Erosion that looks right on its own heightfield has to still look right
          when that heightfield becomes the roof of a cave system, and a palette
          chosen to read as land and sea has to hold once the sea is a clamped floor
          rather than a colour band.
        </p>
        <p>
          The project is the place those arguments happen. It generates one world and
          makes every system work from it, so a change to the terrain is a change to
          everything downstream of it rather than to a demo of its own.
        </p>
      </section>

      <section className="project-section">
        <h2>Systems</h2>
        <p className="project-note">
          Four techniques, at three different depths of integration. The status on
          each is what is actually wired into the demo today, not what the topic can
          do on its own page.
        </p>

        <div className="project-grid">
          {SYSTEMS.map((system) => (
            <article className="project-card" key={system.name}>
              <header className="project-card-head">
                <div>
                  <h3>{system.name}</h3>
                  <span className="project-card-topic">{system.topic}</span>
                </div>
                <span
                  className={`project-status is-${system.state.replace(/ /g, '-')}`}
                  title={
                    system.state === 'not yet wired'
                      ? 'The technique exists and works on its own page, but the demo does not use it yet.'
                      : undefined
                  }
                >
                  {STATE_LABEL[system.state]}
                </span>
              </header>

              <p className="project-card-role">{system.role}</p>

              <ul className="project-list">
                {system.parts.map((part) => (
                  <li key={part}>{part}</li>
                ))}
              </ul>

              <button
                type="button"
                className="project-button is-quiet"
                onClick={() => navigate(system.to)}
              >
                Explore {system.name}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="project-section">
        <h2>Where it stands</h2>
        <p>
          The terrain pipeline runs end to end: noise, warp, rain, slope collapse and
          sea level, all from the project's own controls rather than from Topic 2's.
          The solid is real but shallow — the heightfield becomes a distance field and
          tunnels are subtracted from it, meshed with surface nets, which is a genuine
          composition of Topics 2 and 3 on one world.
        </p>
        <p>
          The shading study is the honest gap. Its eight strategies live inside a
          full-screen GPU pipeline built around one fixed terrain, so they cannot
          simply be pointed at a different mesh; wiring them in means lifting the
          material out of that pipeline rather than calling it. That is the next piece
          of work, and it is named as such on{' '}
          <button
            type="button"
            className="project-inline-link"
            onClick={() => navigate({ section: 'project', page: 'progress' })}
          >
            Progress
          </button>{' '}
          rather than glossed over here.
        </p>
      </section>
    </ProjectLayout>
  )
}
