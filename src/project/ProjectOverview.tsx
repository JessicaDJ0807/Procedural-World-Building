import { ProjectLayout } from './ProjectLayout'
import type { Route } from '../routes'

type Reference = {
  src: string
  /** What the reference informs — the reason it is on the board at all. */
  role: string
  alt: string
  /** Who made it, and where it was found. These are other artists' images. */
  credit: { name: string; href: string }
}

type World = {
  id: 'volcanic' | 'frozen' | 'verdant'
  name: string
  line: string
  goals: string[]
  hero: Reference
  supporting: [Reference, Reference]
}

/**
 * The three worlds as a presentation board.
 *
 * Each reference carries the job it does — landscape, atmosphere, lava
 * behaviour — because a wall of mood images says nothing about what is being
 * built. The labels are the argument; the images are the evidence for it.
 *
 * Paths are into `public/`, so the same files serve the app and the README.
 */
const WORLDS: World[] = [
  {
    id: 'volcanic',
    name: 'Volcanic Caldera',
    line: 'A ridged caldera, with lava draining down from its crater.',
    goals: [
      'A volcano that dominates the horizon',
      'Lava that runs in channels, not scattered pools',
      'Dark rock and a warm, ember-lit atmosphere',
    ],
    hero: {
      src: '/inspiration/volcanic/volcanic_2.jpg',
      role: 'Landscape',
      alt: 'A smoking volcano above dark rock cliffs, with lava falls pouring into a glowing lava lake.',
      credit: { name: 'Chandler Whalen, ArtStation', href: 'https://cdnb.artstation.com/p/assets/images/images/024/858/779/large/chandler-whalen-volcanic-02.jpg?1583772124' },
    },
    supporting: [
      {
        src: '/inspiration/volcanic/volcanic_3.jpg',
        role: 'Atmosphere',
        alt: 'A dark rocky path at night lit by drifting embers and a glowing red stone.',
      credit: { name: 'Chandler Whalen, ArtStation', href: 'https://cdna.artstation.com/p/assets/images/images/024/858/788/large/chandler-whalen-volcanic-03.jpg?1583772145' },
      },
      {
        src: '/inspiration/volcanic/volcanic_1.jpg',
        role: 'Lava behaviour',
        alt: 'Top-down view of bright lava flows spreading across cracked black basalt under smoke.',
      credit: { name: 'Tribes of Midgard', href: 'https://www.tribesofmidgard.com/wp-content/uploads/2022/08/Volcanic_Biome_1920x1080.jpg' },
      },
    ],
  },
  {
    id: 'frozen',
    name: 'Frozen Archipelago',
    line: 'Terraced islands rising out of a cold, flooded sea.',
    goals: [
      'Islands shaped as stepped ice shelves',
      'Ice meeting open water at the coast',
      'Floating ice and a pale, hazy horizon',
    ],
    hero: {
      src: '/inspiration/frozen/frozen_1.jpg',
      role: 'Landscape',
      alt: 'A snowy plain with a huge slab of blue ice and frosted blue and red alien plants.',
      credit: { name: 'KK Design, Unreal Engine forums', href: 'https://forums.unrealengine.com/t/kk-design-scifi-arctic-biome/2673463' },
    },
    supporting: [
      {
        src: '/inspiration/frozen/frozen_2.jpeg',
        role: 'Ice and water',
        alt: 'An ice cave opening onto still blue water, with icicles hanging from the roof.',
      credit: { name: 'KK Design, Unreal Engine forums', href: 'https://forums.unrealengine.com/t/kk-design-scifi-arctic-biome/2673463' },
      },
      {
        src: '/inspiration/frozen/frozen_3.jpg',
        role: 'Floating ice',
        alt: 'Broken ice sheets floating on deep blue water, seen from above.',
      credit: { name: 'IT Happy Studios', href: 'https://ithappystudios.com/wp-content/uploads/2025/06/4-ice-submarine-arctic-platformer-environment-scaled.webp' },
      },
    ],
  },
  {
    id: 'verdant',
    name: 'Verdant Valley',
    line: 'A river valley, where vegetation follows the water.',
    goals: [
      'A river that finds its own way downhill',
      'Trees and plants placed by water and slope',
      'Stylized low-poly detail, then settlements',
    ],
    hero: {
      src: '/inspiration/verdant/verdant_2.jpg',
      role: 'Landscape and ecology',
      alt: 'A stylized green valley with a waterfall, a shallow stream, trees and grazing deer.',
      credit: { name: 'Palia, via Nintendo Everything', href: 'https://nintendoeverything.com/palia-free-to-play-adventure-sim-announced-for-switch/' },
    },
    supporting: [
      {
        src: '/inspiration/verdant/verdant_3.jpg',
        role: 'Low-poly detail',
        alt: 'A low-poly camp beside a river, with pine trees, tents, a campfire and snowy peaks.',
      credit: { name: 'Facebook', href: 'https://scontent-lga3-2.xx.fbcdn.net/v/t39.30808-6/677785598_1611527590110550_8246218706645560836_n.jpg?stp=dst-jpg_tt6&cstp=mx1920x1080&ctp=s1920x1080&_nc_cat=107&ccb=1-7&_nc_sid=aa7b47&_nc_ohc=dswjiWvXcKQQ7kNvwFxAsTT&_nc_oc=AdpjhOfVI2ygb3_rPXTmDo669u1eIu4dT8WqXmeOMGkES8_iRUGgly9fobO8jrJ3-gg&_nc_zt=23&_nc_ht=scontent-lga3-2.xx&_nc_gid=CvxG64LT9d3XRks3sStf7Q&_nc_ss=7b2a8&oh=00_AQP_qzFqU7rH3o8m-W6jwiLe1oQDqsrXWPbS0tHb5hIXBA&oe=6ACBB2E2' },
      },
      {
        src: '/inspiration/verdant/verdant_1.jpeg',
        role: 'Architecture',
        alt: 'A miniature stone castle with many spires, surrounded by rounded green trees.',
      credit: { name: 'Tiny Glade, via r/pcgaming', href: 'https://www.reddit.com/r/pcgaming/comments/1ftzmdm/tiny_glade_players_are_remaking_fantasy_worlds_in/' },
      },
    ],
  },
]

/**
 * One pipeline, three outcomes — what each stage does in each world today.
 *
 * Every cell is something the explorable worlds actually do, read off their
 * specs in `src/explore/worlds.ts`: the same five stages and the same code,
 * with different numbers. That is the claim the table exists to make.
 */
const PIPELINE: { stage: string; cells: Record<World['id'], string> }[] = [
  {
    stage: 'Terrain',
    cells: {
      volcanic: 'Ridged noise, and a 210-unit cone with a crater cut into it',
      frozen: 'Noise terraced into shelves, around a central massif',
      verdant: 'Rolling ground, mountains held back from the valley',
    },
  },
  {
    stage: 'Environment',
    cells: {
      volcanic: 'Seven lava channels drain outward from the crater',
      frozen: 'The sea floods half the world, leaving islands',
      verdant: 'A river traced downhill and carved into its bed',
    },
  },
  {
    stage: 'Surface',
    cells: {
      volcanic: 'Lava, scorched ground, ash, basalt',
      frozen: 'Ocean, coastal ice, blue ice, snow',
      verdant: 'Water, wet bank, grass, exposed rock',
    },
  },
  {
    stage: 'Placement',
    cells: {
      volcanic: 'Basalt pillars and boulders',
      frozen: 'Icebergs and rocks',
      verdant: 'Trees crowding the damp ground, rocks on slopes',
    },
  },
  {
    stage: 'Atmosphere',
    cells: {
      volcanic: 'Dark sky, ember-brown haze',
      frozen: 'Pale, cold fog',
      verdant: 'Soft daylight haze',
    },
  },
]

type LayerStatus = 'In place' | 'In progress' | 'Next'

/** Built in this order, and marked honestly — a status is what Explore does today. */
const LAYERS: { name: string; detail: string; status: LayerStatus }[] = [
  {
    name: 'Landscape',
    detail: 'Noise, shaping and landmarks, streamed as terrain chunks',
    status: 'In place',
  },
  {
    name: 'Water, lava and ice',
    detail: 'Lava channels, sea level and a downhill river; ice does not move yet',
    status: 'In progress',
  },
  {
    name: 'Surface materials',
    detail: 'Ground coloured by environment, animated water; shaders from Topic 4 next',
    status: 'In progress',
  },
  {
    name: 'Procedural placement',
    detail: 'Rule-based scatter of trees, rocks and pillars; paths and settlements next',
    status: 'In progress',
  },
  {
    name: 'Atmosphere and polish',
    detail: 'Fog and sky in place; embers, snowfall and particles to come',
    status: 'Next',
  },
]

type ProjectOverviewProps = { navigate: (route: Route) => void }

export function ProjectOverview({ navigate }: ProjectOverviewProps) {
  const explore = () => navigate({ section: 'project', page: 'explore' })
  const progress = () => navigate({ section: 'project', page: 'progress' })

  return (
    <ProjectLayout
      wide
      title="Three worlds, one generator"
      lede="A procedural world generator that grows three distinct environments — volcanic, frozen and verdant — from one shared system, built up a layer at a time."
      aside={
        <div className="project-actions">
          <button type="button" className="project-button is-primary" onClick={explore}>
            Explore the worlds
          </button>
          <button type="button" className="project-button" onClick={progress}>
            See the process
          </button>
        </div>
      }
    >
      <section className="project-section" aria-labelledby="worlds-heading">
        <h2 id="worlds-heading">The worlds</h2>
        <div className="board">
          {WORLDS.map((world) => (
            <article className={`board-world is-${world.id}`} key={world.id}>
              <figure className="board-hero">
                <img src={world.hero.src} alt={world.hero.alt} />
                <figcaption>
                  {world.hero.role}
                  <Credit credit={world.hero.credit} />
                </figcaption>
              </figure>

              <div className="board-body">
                <h3 className="board-name">{world.name}</h3>
                <p className="board-line">{world.line}</p>
                <ul className="board-goals">
                  {world.goals.map((goal) => (
                    <li key={goal}>{goal}</li>
                  ))}
                </ul>
              </div>

              <div className="board-refs">
                {world.supporting.map((ref) => (
                  <figure className="board-ref" key={ref.src}>
                    <img src={ref.src} alt={ref.alt} loading="lazy" />
                    <figcaption>
                      {ref.role}
                      <Credit credit={ref.credit} />
                    </figcaption>
                  </figure>
                ))}
              </div>
            </article>
          ))}
        </div>
        <p className="project-credit">
          Reference images are other artists' work, collected as inspiration and credited
          under each — not output of this project.
        </p>
      </section>

      <section className="project-section" aria-labelledby="pipeline-heading">
        <h2 id="pipeline-heading">One pipeline, three worlds</h2>
        <p className="project-note">
          These are not three separate scenes. The same five stages, in the same code, run
          for every world — only the numbers change.
        </p>
        <div className="pipeline-wrap">
          <table className="pipeline">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Stage</span>
                </th>
                {WORLDS.map((world) => (
                  <th scope="col" key={world.id} className={`is-${world.id}`}>
                    {world.name.split(' ')[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PIPELINE.map((row, index) => (
                <tr key={row.stage}>
                  <th scope="row">
                    <span className="pipeline-step">{index + 1}</span>
                    {row.stage}
                  </th>
                  {WORLDS.map((world) => (
                    <td key={world.id}>{row.cells[world.id]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="project-section" aria-labelledby="layers-heading">
        <h2 id="layers-heading">Built in layers</h2>
        <p className="project-note">
          One layer at a time, each standing on the one before — not everything at once.
        </p>
        <ol className="layers">
          {LAYERS.map((layer, index) => (
            <li className="layer" key={layer.name}>
              <span className="layer-index">{index + 1}</span>
              <h3 className="layer-name">{layer.name}</h3>
              <p className="layer-detail">{layer.detail}</p>
              <span className={`layer-status is-${layer.status.toLowerCase().replace(/ /g, '-')}`}>
                {layer.status}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="project-section project-closing">
        <p>Walk all three, in the browser.</p>
        <button type="button" className="project-button is-primary" onClick={explore}>
          Explore the worlds
        </button>
      </section>
    </ProjectLayout>
  )
}

/** The source under a reference image: small, quiet, and a real link out. */
function Credit({ credit }: { credit: Reference['credit'] }) {
  return (
    <a className="board-credit" href={credit.href} target="_blank" rel="noreferrer">
      {credit.name}
    </a>
  )
}
