import { ProjectLayout } from './ProjectLayout'
import { PLAYGROUND, type Route } from '../routes'

type Stage = {
  /** The technique, as the study called it. */
  from: string
  /** What the project gets out of it. */
  to: string
  what: string
  contribution: string
  /** The measurement or finding that came out of the study, if there was one. */
  finding?: string
  explore?: { label: string; route: Route }
  done: boolean
}

/**
 * The chain, not the changelog.
 *
 * Ordered by what depends on what rather than by when it was built, because
 * that is the relationship the page exists to show: erosion is third because it
 * needs a noise field to cut, not because it happened in week three. The dates
 * are in the git history, which is a better place for them.
 */
const STAGES: Stage[] = [
  {
    from: 'Render loop and materials',
    to: 'Everything else can be drawn',
    what: 'A primitive on screen, a standard material, and image-based lighting from an environment cubemap generated at runtime rather than loaded from a file. Orientation held as a quaternion so dragging never gimbal-locks.',
    contribution:
      'The least visible contribution and the one every other system sits on. The split it established — advancing state and presenting it are separate passes — is what the project still runs on, and getting it wrong is what made Topic 4 ship a bug where every slider moved its label and nothing repainted.',
    explore: { label: 'Objects', route: { section: 'playground', page: 'objects' } },
    done: true,
  },
  {
    from: 'Noise',
    to: 'A terrain foundation',
    what: 'Value noise sampled on a lattice and interpolated, then stacked as fBm — each octave double the frequency of the last, at a fraction of its weight.',
    contribution:
      'Produces the heightfield that every later stage reads. The project exposes this as two controls, Landmass scale and Ruggedness, which is the whole octave stack reduced to the two questions worth asking of it.',
    finding:
      'Six octaves, not two. Measured against a structure function, two octaves four apart score 0.960 for straightness where real topography sits above 0.99; six score 0.990.',
    explore: { label: 'Maps', route: { section: 'playground', page: 'maps' } },
    done: true,
  },
  {
    from: 'Domain warp',
    to: 'Ground that looks like it has a history',
    what: 'The field displaced sideways by a second noise field before anything reads it, so straight ridges bend.',
    contribution:
      "One control, Meander. It changes the picture completely at almost no cost to the terrain's statistics, which is unusual enough among these operations to be worth its own dial.",
    finding:
      'Free only while it stays small. At 10 cells the Hurst exponent holds at 0.75 and straightness at 0.989; at 40 it drops to 0.65 and 0.971, because displacing features that far shears the fine octaves apart. The project stops the control at 12.',
    explore: { label: 'Maps', route: { section: 'playground', page: 'maps' } },
    done: true,
  },
  {
    from: 'Hydraulic erosion',
    to: 'Natural landforms',
    what: 'Droplets released on the terrain, each following the slope, picking up material where it can carry more and dropping it where it cannot. Channels emerge from nothing but that rule.',
    contribution:
      'The step that makes the difference between a noise field and terrain, and the reason the project generates rather than just samples. Exposed as Weathering — rain per cell — with the droplet itself fixed to the preset the study measured.',
    finding:
      'More erosion is not better. Channel concentration — the share of all wear landing in the busiest tenth of cells — peaks at about 0.47 at 0.3 droplets per cell and decays to 0.26 by 24, with relief going the same way: 93% kept, then 76%, then 55%. The default sits at the peak.',
    explore: { label: 'Maps', route: { section: 'playground', page: 'maps' } },
    done: true,
  },
  {
    from: 'Colour ramps',
    to: 'Height that can be read',
    what: 'Palettes interpolated in OKLab rather than sRGB, fitted to the field rather than to a fixed range.',
    contribution:
      "Makes the sea level control work without a second system: the terrain palette's lowest stops are already the two blues, so raising the floor flat to the waterline colours it as water for free.",
    finding:
      'OKLab is worth the trouble. The hypsometric ramp resolves about 165 distinguishable steps against 74 for the multiplied single-hue ramp it replaced.',
    explore: { label: 'Maps', route: { section: 'playground', page: 'maps' } },
    done: true,
  },
  {
    from: 'Signed distance functions and CSG',
    to: 'Caves and overhangs',
    what: 'Solids as functions rather than stored grids, combined with booleans — union, intersection, subtraction, hard or smoothly blended.',
    contribution:
      "Gives the terrain an inside. The project reads its heightfield as a distance field and subtracts a gyroid tunnel network from it, so one world is both a surface and a solid. This is the point where two topics first have to agree on the same data rather than each owning their own.",
    finding:
      'The heightfield SDF is not a true distance field — its value is a vertical gap, not the shortest one, so it reads short on a steep slope. That is why the subtraction is a hard boolean: a blend assumes a unit gradient and bites unevenly where that fails.',
    explore: { label: 'Voxels', route: { section: 'playground', page: 'voxels' } },
    done: true,
  },
  {
    from: 'Meshing',
    to: 'Triangles the GPU can draw',
    what: 'Four ways back from a field to a surface — greedy blocks, marching cubes, surface nets and dual contouring — which differ on one axis: where a vertex is allowed to be.',
    contribution:
      'Surface nets meshes the cave solid. It was chosen over dual contouring because the terrain has no sharp edges to preserve, which is the only thing dual contouring buys, and over marching cubes because it emits far fewer triangles for the same surface.',
    explore: { label: 'Voxels', route: { section: 'playground', page: 'voxels' } },
    done: true,
  },
  {
    from: 'Surface shading',
    to: 'Appearance and atmosphere',
    what: 'Six fragment shaders over one fixed terrain, with geometry, light and camera held still so the strategies can actually be compared. Plus a lighting model built for a dark ground, Fresnel, and distance haze.',
    contribution:
      'Not wired into the demo yet — the one gap on this page. The strategies live inside a full-screen GPU pipeline built around that one fixed terrain, so they cannot be pointed at a different mesh; using them here means lifting the material out of the pipeline rather than calling it. Until then the demo renders with the standard material from Topic 1.',
    finding:
      'What read as wet plastic was the ground, not the specular. A near-black background makes any muted surface glow by contrast; a few percent of lightness and a warm hue fixed more than the lighting changes did.',
    explore: { label: 'Shaders', route: { section: 'playground', page: 'shaders' } },
    done: false,
  },
  {
    from: 'GPU simulation',
    to: 'Weather and water that move',
    what: 'Four ping-pong simulations holding their state in floating-point textures: ripples, reaction–diffusion, hydraulic erosion and fish schooling.',
    contribution:
      "Also not wired in. The erosion simulation is the interesting one for the project — it does on the GPU what the CPU droplet pass does between frames, which is the obvious route to erosion you can watch happen rather than wait for. Nothing in the demo uses it today.",
    finding:
      'The display pass, not the simulation, is the expensive part for three of the four studies — so the cost of adding one of these to the project is mostly the cost of drawing it.',
    explore: { label: 'Shaders', route: { section: 'playground', page: 'shaders' } },
    done: false,
  },
]

type ProjectProgressProps = { navigate: (route: Route) => void }

/** Topic numbers come from the route table, so they cannot drift out of step. */
const topicOf = (route: Route) =>
  route.section === 'playground'
    ? PLAYGROUND.find((entry) => entry.id === route.page)?.topic
    : undefined

export function ProjectProgress({ navigate }: ProjectProgressProps) {
  const wired = STAGES.filter((stage) => stage.done).length

  return (
    <ProjectLayout
      title="How the experiments became a project"
      lede="Each Playground topic exists to answer one question about one technique. This is what each answer contributes to the world the project builds — in dependency order, not chronological order."
    >
      <p className="project-note">
        {wired} of {STAGES.length} stages are wired into the demo. The two that are not
        say so, rather than being left off the list.
      </p>

      <ol className="project-chain">
        {STAGES.map((stage) => {
          const explore = stage.explore
          return (
          <li className={`project-stage${stage.done ? '' : ' is-pending'}`} key={stage.from}>
            <div className="project-stage-arrow" aria-hidden="true" />

            <div className="project-stage-body">
              <h2 className="project-stage-title">
                {stage.from}
                <span className="project-stage-arrow-glyph" aria-hidden="true">
                  →
                </span>
                <span className="project-stage-to">{stage.to}</span>
              </h2>

              {!stage.done && <span className="project-status is-not-yet-wired">Not yet wired</span>}

              <p className="project-stage-what">{stage.what}</p>

              <p className="project-stage-contribution">
                <span className="project-stage-label">Contributes</span>
                {stage.contribution}
              </p>

              {stage.finding && (
                <p className="project-stage-finding">
                  <span className="project-stage-label">Found</span>
                  {stage.finding}
                </p>
              )}

              {explore && (
                <button
                  type="button"
                  className="project-button is-quiet"
                  onClick={() => navigate(explore.route)}
                >
                  Open {explore.label}
                  {topicOf(explore.route) && (
                    <span className="project-button-note">{topicOf(explore.route)}</span>
                  )}
                </button>
              )}
            </div>
          </li>
          )
        })}
      </ol>

      <section className="project-section">
        <h2>What comes next</h2>
        <p>
          Two things, in order. Lifting Topic 4's surface shading out of its
          full-screen pipeline so the project's own mesh can use it — that is the
          difference between a world that is shaped procedurally and one that also
          looks it. Then the GPU erosion simulation, which would turn Weathering from
          a number you set into a process you watch.
        </p>
        <p>
          Beyond those, the demo's worlds are built into the page. The saved-world
          infrastructure the Playground topics use would carry them per account with
          no new machinery, which is the cheapest of the three and the least
          interesting.
        </p>
        <div className="project-actions">
          <button
            type="button"
            className="project-button is-primary"
            onClick={() => navigate({ section: 'project', page: 'demo' })}
          >
            Open the demo
          </button>
        </div>
      </section>
    </ProjectLayout>
  )
}
