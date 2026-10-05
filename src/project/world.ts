import { DOMAIN, combine, getShape } from '../density'
import { dropletsFor, erodeStep, getPreset, thermalPass, type ErosionParams } from '../erosion'
import { compositeLayers, fbmOctaves, warpField, type NoiseLayer } from '../noise'
import { meshSurfaceNets, type Mesh } from '../mesher'
import type { PaletteName } from '../palette'

/**
 * The project's world, built from the techniques the Playground studies.
 *
 * ## What this module is, and what it deliberately is not
 *
 * Every algorithm here is imported. fBm layering, domain warp, droplet
 * hydraulic erosion, thermal collapse, the gyroid, CSG subtraction, surface
 * nets — all of it belongs to `noise.ts`, `erosion.ts`, `density.ts` and
 * `mesher.ts`, and none of it is reimplemented. What this file adds is the
 * order they run in, and a small set of controls that each move several of
 * their parameters at once.
 *
 * It does repeat the *orchestration* that `NoisePage` performs across its
 * memo chain, rather than that chain being refactored into something both
 * share. That was a deliberate trade: the Demo wants a different mapping from
 * controls to parameters — eight dials instead of thirty — so the shared thing
 * would have had to be parameterised over both, and the cost of getting it
 * wrong lands on Topic 2, which already works. Forty lines of duplicated
 * function calls is the cheaper half of that trade. If a third caller ever
 * appears, extract then.
 *
 * ## The integration
 *
 * The two views are the same world, not two worlds. `generate` produces one
 * heightfield; the surface view renders it directly, and the cave view turns
 * that same array into a signed distance function and subtracts tunnels from
 * it with Topic 3's `combine`. Moving a terrain dial moves both.
 */

export type WorldSettings = {
  /** Which half of the pipeline is on screen. */
  view: 'surface' | 'caves'
  /** Grid edge. The field is resolution² for the surface, resolution³ for caves. */
  resolution: number
  /** fBm octave count. More octaves is finer detail, not more terrain. */
  ruggedness: number
  /** Base frequency of the stack: how many landmasses fit across the map. */
  landmass: number
  /** Domain warp, in cells. Bends the stack sideways before anything erodes it. */
  meander: number
  /** Rain, in droplets per cell. 0 leaves the noise uneroded. */
  weathering: number
  /** Thermal passes per erosion tick. Collapses anything over the talus angle. */
  slopeCollapse: number
  /** Height below which the terrain is flooded flat, as a fraction of its range. */
  seaLevel: number
  /** Vertical exaggeration applied at render time, not baked into the field. */
  relief: number
  /** Hypsometric tints by default — the one palette that reads as land and sea. */
  palette: PaletteName
  /** How much of the volume the tunnel network eats. 0 is solid rock. */
  caveDensity: number
}

export function defaultWorld(): WorldSettings {
  return {
    view: 'surface',
    resolution: 128,
    ruggedness: 6,
    landmass: 2,
    meander: 6,
    weathering: 0.3,
    slopeCollapse: 0,
    seaLevel: 0.28,
    relief: 1.4,
    palette: 'terrain',
    caveDensity: 0.45,
  }
}

/**
 * Named worlds for the left panel.
 *
 * These are scenarios, not Firestore documents: the Demo has no saved-world
 * collection of its own, so nothing here depends on being signed in. See
 * `docs/project/app-structure.md` for why that was left for later.
 */
export type Scenario = {
  value: string
  label: string
  hint: string
  settings: WorldSettings
}

export const SCENARIOS: Scenario[] = [
  {
    value: 'archipelago',
    label: 'Archipelago',
    hint: 'High sea level over a low-frequency stack, so the ridges surface as islands and everything between them floods.',
    settings: { ...defaultWorld(), landmass: 1.6, meander: 9, seaLevel: 0.46, weathering: 0.24, relief: 1.2 },
  },
  {
    value: 'highlands',
    label: 'Eroded highlands',
    hint: 'The default stack with enough rain to cut channels but not enough to strip the relief — 0.3 droplets per cell, where channel concentration peaks.',
    settings: { ...defaultWorld() },
  },
  {
    value: 'badlands',
    label: 'Badlands',
    hint: 'Fine octaves, heavier rain and thermal collapse on. Slopes fail to the talus angle, which rounds the ridges and fans debris into the valleys.',
    settings: {
      ...defaultWorld(),
      ruggedness: 8,
      landmass: 3,
      meander: 3,
      weathering: 0.7,
      slopeCollapse: 6,
      seaLevel: 0.12,
      relief: 1.7,
    },
  },
  {
    value: 'undercroft',
    label: 'Undercroft',
    hint: 'The caves view on a dry, high-relief world. A gyroid network subtracted from the terrain solid, so the tunnels break the surface where the ground is thin.',
    settings: {
      ...defaultWorld(),
      view: 'caves',
      resolution: 72,
      meander: 4,
      weathering: 0.18,
      seaLevel: 0,
      relief: 1.4,
      caveDensity: 0.6,
    },
  },
]

/** Caves sample a cube, so the grid cost is cubed — a far lower ceiling. */
export const RESOLUTIONS: Record<WorldSettings['view'], number[]> = {
  surface: [64, 96, 128, 160],
  caves: [40, 56, 72],
}

/**
 * Erosion runs with one preset's shape, not with eight exposed dials.
 *
 * `gorges` is Topic 2's own default, chosen there against a structure-function
 * sweep. The Demo moves how much rain falls and leaves the character of the
 * droplet alone, because the character is the part that needs a measurement to
 * set responsibly and the amount is the part that reads as a control.
 */
const EROSION: ErosionParams = getPreset('gorges').params

const FBM_SPREAD = 0.6

/** The fBm stack, as `compositeLayers` wants it. Ids are React keys; these never reach React. */
function stack(octaves: number, baseFrequency: number, resolution: number): NoiseLayer[] {
  return fbmOctaves(Math.round(octaves), baseFrequency, 0.5, resolution).map((octave, index) => ({
    id: `octave-${index}`,
    name: `Octave ${index + 1}`,
    enabled: true,
    frequency: octave.frequency,
    spread: FBM_SPREAD,
    seed: index + 1,
    shapingName: 'none' as const,
    shapingParams: {},
    blendName: 'normal' as const,
    opacity: octave.opacity,
  }))
}

/**
 * Flood everything under the waterline to one height.
 *
 * A clamp rather than a recoloured ramp band. Painting the low ground blue
 * leaves it bumpy, and a lake with a textured surface reads as wet ground
 * rather than as water; raising the floor makes it flat, which is the whole
 * visual signal. The terrain palette's lowest stops are already the two blues,
 * so the colour follows for free.
 */
function flood(height: Float32Array, level: number): Float32Array {
  if (level <= 0) return height
  let min = Infinity
  let max = -Infinity
  for (const h of height) {
    if (h < min) min = h
    if (h > max) max = h
  }
  const waterline = min + (max - min) * level
  const out = Float32Array.from(height)
  for (let i = 0; i < out.length; i++) if (out[i] < waterline) out[i] = waterline
  return out
}

export type World = {
  /** resolution², in [0, 1] before relief is applied. */
  height: Float32Array
  resolution: number
  /** Droplets actually run, for the readout. */
  droplets: number
  ms: number
}

/** The fields `generate` reads. Relief, palette and cave density are not among them. */
export type GenerationInputs = Pick<
  WorldSettings,
  'resolution' | 'ruggedness' | 'landmass' | 'meander' | 'weathering' | 'slopeCollapse' | 'seaLevel'
>

export function generate(settings: GenerationInputs): World {
  const started = performance.now()
  const r = settings.resolution

  const composite = warpField(
    compositeLayers(r, 2, stack(settings.ruggedness, settings.landmass, r)),
    r,
    2,
    // Up to about 10 cells the warp changes the picture without measurably
    // changing the roughness — `warpField`'s own note has the Hurst numbers.
    // Past 20 it starts shearing the fine octaves apart, so the control stops
    // short of that rather than exposing the range where it stops being free.
    { amount: settings.meander, frequency: 4, seed: 1 },
  )

  const droplets = settings.weathering > 0 ? dropletsFor(settings.weathering, r) : 0
  let height = composite
  if (droplets > 0) {
    height = erodeStep(null, composite, r, droplets, 1, EROSION, {
      talus: 0.02,
      strength: 0.5,
      passes: settings.slopeCollapse,
    }).height
  } else if (settings.slopeCollapse > 0) {
    // Thermal collapse is normally folded into an erosion tick. With no rain
    // there is no tick, so it has to be run on its own or the control would
    // silently do nothing at weathering 0.
    height = Float32Array.from(composite)
    for (let i = 0; i < settings.slopeCollapse; i++) thermalPass(height, r, 0.02, 0.5)
  }

  return {
    height: flood(height, settings.seaLevel),
    resolution: r,
    droplets,
    ms: performance.now() - started,
  }
}

/* ---------------------------------------------------------------------------
 * Caves: the same heightfield, as a solid
 * ------------------------------------------------------------------------- */

/** Bilinear read of the heightfield at continuous map coordinates. */
function readHeight(height: Float32Array, r: number, x: number, y: number): number {
  const cx = Math.min(r - 1, Math.max(0, x))
  const cy = Math.min(r - 1, Math.max(0, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(r - 1, x0 + 1)
  const y1 = Math.min(r - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  const a = height[y0 * r + x0]
  const b = height[y0 * r + x1]
  const c = height[y1 * r + x0]
  const d = height[y1 * r + x1]
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/**
 * Turn the heightfield into a solid and subtract a tunnel network from it.
 *
 * `y - terrain(x, z)` is the standard heightfield SDF: negative under the
 * ground, positive above it, zero at the surface. It is not a true Euclidean
 * distance — the value is a vertical gap, not the shortest one, so it reads
 * shorter than it should on a steep slope — which is the same inexactness
 * `density.ts` flags on its own `terrain` shape, and the reason the subtraction
 * below is a hard boolean rather than a blended one.
 *
 * The tunnels are Topic 3's gyroid, inverted. A gyroid's walls are the solid
 * part, so subtracting the walls would leave two interlocking halves rather
 * than a cave system; subtracting the *gaps* leaves a connected network, which
 * is what the thickness parameter ends up controlling.
 */
export function meshCaves(world: World, caveDensity: number): Mesh {
  const r = world.resolution
  const field = new Float32Array(r * r * r)
  const step = (DOMAIN * 2) / Math.max(r - 1, 1)

  // Thickness, not scale, carries the density control: scale changes how many
  // tunnels there are, which rescales the whole network and makes the dial read
  // as "zoom" rather than as "more cave".
  const tunnel = getShape('gyroid').build({ scale: 5.5, thickness: 1.2 - caveDensity }, 1)
  const seal = DOMAIN - step * 2

  for (let zi = 0; zi < r; zi++) {
    const z = -DOMAIN + zi * step
    for (let yi = 0; yi < r; yi++) {
      const y = -DOMAIN + yi * step
      for (let xi = 0; xi < r; xi++) {
        const x = -DOMAIN + xi * step

        // Map coordinates: the sampled cube's x/z span maps onto the grid.
        const mx = ((x + DOMAIN) / (DOMAIN * 2)) * (r - 1)
        const mz = ((z + DOMAIN) / (DOMAIN * 2)) * (r - 1)
        const ground = readHeight(world.height, r, mx, mz) * 2 - 1
        let d = y - ground * 0.7

        if (caveDensity > 0) d = combine(d, tunnel(x, y, z), 'subtract', 0)

        // Clip to the box the way `sampleVolume` does, so the solid closes
        // instead of ending in open triangles at the grid edge.
        const outside = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - seal
        field[(zi * r + yi) * r + xi] = Math.max(d, outside)
      }
    }
  }

  return meshSurfaceNets(field, r, 0)
}
