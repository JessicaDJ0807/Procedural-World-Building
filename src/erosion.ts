/**
 * Droplet-based hydraulic erosion over a height field.
 *
 * Each droplet is dropped at random, follows the downhill gradient, and trades
 * material with the terrain: it picks sediment up where it runs fast down a
 * steep slope, and drops it where it slows or climbs. Thousands of them carve
 * the dendritic valley networks that noise alone never produces.
 *
 * Unlike every other stage of the pipeline, erosion ACCUMULATES: 20k droplets
 * means 10k landing on the result of the previous 10k. It therefore cannot be a
 * pure function of the controls the way sampling, shaping and the automaton
 * are — the caller carries an `ErosionRun` forward instead.
 */

import { mulberry32 } from './noise'

export type ErosionParams = {
  /** How much of its previous direction a droplet keeps. 0 is pure gradient descent. */
  inertia: number
  /** How much sediment a droplet can hold per unit of slope and speed. */
  capacity: number
  /** Fraction of the excess dropped per step once a droplet is over capacity. */
  deposition: number
  /** Fraction of the shortfall cut per step once a droplet is under capacity. */
  erosion: number
  /** Water lost per step; a droplet carries less as it dries out. */
  evaporation: number
  /** Converts drop in height into speed. */
  gravity: number
  /** Steps a droplet lives for. */
  lifetime: number
  /** Cells around the droplet that erosion is spread over. */
  radius: number
}

export type ErosionParamSpec = {
  key: keyof ErosionParams
  label: string
  /** Hover explanation for the control. */
  info: string
  min: number
  max: number
  step: number
  format?: (value: number) => string
}

/**
 * Ranges chosen from a sweep against this project's own noise stack rather than
 * from the literature: capacity above ~2 and erosion above ~0.2 strip relief
 * fast without cutting better channels, so the useful part of each range sits
 * near the bottom.
 */
export const EROSION_PARAM_SPECS: ErosionParamSpec[] = [
  { key: 'erosion', label: 'Erosion rate', info: 'How greedily a droplet cuts when it is carrying less than it could. Low values wear broadly and keep the ridges; high values dig fast and strip relief with them.', min: 0.01, max: 0.6, step: 0.01 },
  { key: 'capacity', label: 'Carry capacity', info: 'How much sediment a droplet can hold per unit of slope and speed. This is the single most destructive control: above about 2 it never fills up, so it keeps cutting all the way downhill and flattens the terrain instead of carving it.', min: 0.5, max: 12, step: 0.5 },
  { key: 'deposition', label: 'Deposition', info: 'How much of the excess a droplet drops each step once it is over capacity. Low values hold the load and carry it further, cutting cleaner channels; high values backfill what was just cut.', min: 0.02, max: 1, step: 0.02 },
  { key: 'inertia', label: 'Inertia', info: 'How much of its previous direction a droplet keeps. At 0 it follows the steepest slope exactly; higher values let it carry on across a bend, which smooths the path but blurs the channel.', min: 0, max: 0.9, step: 0.01 },
  { key: 'gravity', label: 'Gravity', info: 'Converts a change in height into speed. Faster droplets have more capacity, so raising this makes steep ground erode disproportionately harder than gentle ground.', min: 1, max: 20, step: 0.5, format: (v) => v.toFixed(1) },
  { key: 'evaporation', label: 'Evaporation', info: "Water lost per step. A drier droplet carries less, so this is effectively how far a droplet's influence reaches before it gives up.", min: 0, max: 0.1, step: 0.005, format: (v) => v.toFixed(3) },
  { key: 'lifetime', label: 'Droplet life', info: 'Steps a droplet lives for before it expires and drops whatever it still holds. Longer lives let separate cuts join into continuous channels rather than isolated nicks.', min: 8, max: 64, step: 1, format: (v) => `${v} steps` },
  { key: 'radius', label: 'Erosion radius', info: 'How many cells each cut is spread over. A wider brush wears hillsides; a narrow one carves. Note the falloff divides by radius + 1, so radius 1 still covers 5 cells rather than collapsing to a single one.', min: 1, max: 4, step: 1, format: (v) => `${v} cells` },
]

export type ErosionPreset = {
  value: string
  label: string
  hint: string
  /** Droplets per cell per tick — see the note on RAIN_DENSITY_RANGE. */
  density: number
  params: ErosionParams
}

/**
 * Rain is measured per cell, never as a flat droplet count.
 *
 * A count means something entirely different at each resolution: 5,000 droplets
 * is 0.3 per cell at 128² but 1.2 per cell at 64², so the same setting that
 * carves valleys on one grid strips the relief off another. Density holds the
 * amount of weather constant and lets the droplet count follow the grid.
 */
export const RAIN_DENSITY_RANGE = { min: 0.02, max: 1.5, step: 0.02 }

/** Total rain a run may accumulate, in droplets per cell. */
export const MAX_RAIN_DENSITY = 12

export function dropletsFor(density: number, resolution: number): number {
  return Math.max(1, Math.round(density * resolution * resolution))
}

/**
 * Measured, not guessed. Channel concentration — the share of all erosion
 * landing in the busiest 10% of cells, against 0.10 for perfectly even wear —
 * peaks early and decays as the rain keeps falling. At 128²: 0.47 at 0.3
 * droplets/cell, 0.33 at 3, 0.26 at 24, with relief going the same way (93%
 * kept, then 76%, then 55%). More erosion is not better, so every preset here
 * is deliberately restrained.
 */
export const EROSION_PRESETS: ErosionPreset[] = [
  {
    value: 'valleys',
    label: 'River valleys',
    hint: 'Restrained cutting that keeps the ridges. The best channels per unit of relief lost.',
    density: 0.3,
    params: {
      inertia: 0.02, capacity: 1, deposition: 0.3, erosion: 0.05,
      evaporation: 0.02, gravity: 4, lifetime: 30, radius: 2,
    },
  },
  {
    value: 'gorges',
    label: 'Gorges',
    hint: 'Narrow, deep cuts: a tight radius and a long droplet life concentrate the wear.',
    density: 0.3,
    params: {
      inertia: 0.01, capacity: 1.5, deposition: 0.1, erosion: 0.12,
      evaporation: 0.01, gravity: 8, lifetime: 48, radius: 1,
    },
  },
  {
    value: 'badlands',
    label: 'Badlands',
    hint: 'Aggressive. Cuts fast and strips relief with it — watch the readout fall.',
    density: 0.6,
    params: {
      inertia: 0.05, capacity: 4, deposition: 0.4, erosion: 0.3,
      evaporation: 0.03, gravity: 4, lifetime: 24, radius: 3,
    },
  },
  {
    value: 'floodplain',
    label: 'Floodplain',
    hint: 'Deposition-heavy: droplets drop their load early and fill the low ground in.',
    density: 0.3,
    params: {
      inertia: 0.3, capacity: 0.5, deposition: 1, erosion: 0.04,
      evaporation: 0.05, gravity: 2, lifetime: 40, radius: 3,
    },
  },
]

export function getPreset(value: string): ErosionPreset {
  return EROSION_PRESETS.find((p) => p.value === value) ?? EROSION_PRESETS[0]
}

export type ErosionRun = {
  /** The terrain this run started from. Identity is how the caller detects staleness. */
  source: Float32Array
  /** Eroded terrain. A NEW array each tick — see the note on erodeStep. */
  height: Float32Array
  /** Signed change against `source`: negative cut, positive fill. */
  cut: Float32Array
  /** Largest absolute change so far, for scaling the overlay. */
  cutScale: number
  droplets: number
  /** Droplets per cell so far — comparable across resolutions, unlike the count. */
  rain: number
  /** Height range remaining as a fraction of the source's, so flattening is visible. */
  reliefKept: number
}

type Brush = { dx: number; dy: number; weight: number }

/**
 * Falloff divides by `r + 1`, not `r`.
 *
 * With `1 - distance / r` a cell exactly `r` away weighs zero and drops out, so
 * radius 1 collapses to the centre cell alone — no spreading at all. That is
 * the single-cell cutting this brush exists to prevent: it carves pinpoint
 * pits, a pit steepens its own walls, steeper walls raise the droplet's
 * capacity, and the field runs away until it hits the clamp. Measured at radius
 * 1 over 40 seeds, the degenerate brush blew up 8 times and this one never.
 */
function buildBrush(radius: number): Brush[] {
  const r = Math.max(1, Math.round(radius))
  const brush: Brush[] = []
  let total = 0
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance > r) continue
      const weight = 1 - distance / (r + 1)
      brush.push({ dx, dy, weight })
      total += weight
    }
  }
  for (const b of brush) b.weight /= total
  return brush
}

type Sample = {
  height: number
  gx: number
  gy: number
  xa: number
  ya: number
  xb: number
  yb: number
  fx: number
  fy: number
}

/**
 * Bilinear height and gradient, wrapping like the noise lattices and the
 * automaton. Clamping at the border instead would pool every droplet against
 * the edges and wear a rim into the field.
 */
function sample(height: Float32Array, r: number, x: number, y: number, out: Sample): Sample {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const xa = ((x0 % r) + r) % r
  const ya = ((y0 % r) + r) % r
  const xb = (xa + 1) % r
  const yb = (ya + 1) % r
  const h00 = height[ya * r + xa]
  const h10 = height[ya * r + xb]
  const h01 = height[yb * r + xa]
  const h11 = height[yb * r + xb]

  out.height = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy
  out.gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy
  out.gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx
  out.xa = xa
  out.ya = ya
  out.xb = xb
  out.yb = yb
  out.fx = fx
  out.fy = fy
  return out
}

function deposit(height: Float32Array, r: number, s: Sample, amount: number) {
  height[s.ya * r + s.xa] += amount * (1 - s.fx) * (1 - s.fy)
  height[s.ya * r + s.xb] += amount * s.fx * (1 - s.fy)
  height[s.yb * r + s.xa] += amount * (1 - s.fx) * s.fy
  height[s.yb * r + s.xb] += amount * s.fx * s.fy
}

function relief(field: Float32Array): number {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < field.length; i++) {
    const v = field[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  return max - min
}

/* ---------------------------------------------------------------------------
 * Thermal erosion
 * ------------------------------------------------------------------------- */

/** Neighbour offsets, with the diagonal distance the talus check has to respect. */
const TALUS_NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
]

/**
 * Talus slippage: material on a slope steeper than rock will hold slumps down it.
 *
 * Where the droplets are a transport process — they pick material up, carry it,
 * and put it somewhere else — this is purely local. Nothing is carried; a cell
 * simply gives its excess to whichever neighbours sit below its angle of
 * repose. That is what puts scree at the foot of a cliff and stops slopes
 * getting arbitrarily steep, neither of which hydraulic erosion does on its own.
 *
 * Writes go to a separate buffer and are applied together, so a pass does not
 * depend on the order cells happen to be visited in — the same reason the
 * cellular automaton swaps buffers instead of writing in place.
 */
export function thermalPass(height: Float32Array, resolution: number, talus: number, strength: number) {
  const delta = new Float32Array(height.length)
  const r = resolution

  for (let y = 0; y < r; y++) {
    for (let x = 0; x < r; x++) {
      const i = y * r + x
      const h = height[i]
      let total = 0
      let steepest = 0

      for (const [dx, dy, distance] of TALUS_NEIGHBOURS) {
        const j = (((y + dy) % r + r) % r) * r + (((x + dx) % r + r) % r)
        // Scaling by distance is what keeps the result from growing eight-armed
        // stars: a diagonal neighbour is further away, so the same height drop
        // is a gentler slope.
        const drop = (h - height[j]) / distance
        if (drop > talus) {
          total += drop - talus
          if (drop - talus > steepest) steepest = drop - talus
        }
      }
      if (total <= 0) continue

      // Half the worst excess, shared out in proportion to each drop: moving the
      // whole excess would overshoot and oscillate between the two cells.
      const moved = strength * steepest * 0.5
      delta[i] -= moved
      for (const [dx, dy, distance] of TALUS_NEIGHBOURS) {
        const j = (((y + dy) % r + r) % r) * r + (((x + dx) % r + r) % r)
        const drop = (h - height[j]) / distance
        if (drop > talus) delta[j] += moved * ((drop - talus) / total)
      }
    }
  }

  for (let i = 0; i < height.length; i++) {
    const v = height[i] + delta[i]
    height[i] = v < 0 ? 0 : v > 1 ? 1 : v
  }
}

/**
 * Advances a run by `droplets` more droplets and returns a NEW run.
 *
 * The height buffer is copied rather than mutated in place, which matters more
 * than it looks: `applyShaping` returns its input unchanged when shaping is
 * None, so an in-place buffer would keep the same identity all the way to the
 * viewport and the geometry effect would never re-run. A 128² copy is 65 KB
 * against ~50 ms of droplet work, so the safety is close to free.
 */
export function erodeStep(
  previous: ErosionRun | null,
  source: Float32Array,
  resolution: number,
  droplets: number,
  seed: number,
  params: ErosionParams,
  thermal: { talus: number; strength: number; passes: number } = { talus: 0, strength: 0, passes: 0 },
): ErosionRun {
  const height = Float32Array.from(previous ? previous.height : source)
  const brush = buildBrush(params.radius)
  const lifetime = Math.max(1, Math.round(params.lifetime))
  // Continuing the sequence rather than restarting it keeps successive ticks
  // from re-running the same droplets over the terrain they already carved.
  const rand = mulberry32(seed + (previous?.droplets ?? 0))

  const here: Sample = { height: 0, gx: 0, gy: 0, xa: 0, ya: 0, xb: 0, yb: 0, fx: 0, fy: 0 }
  const next: Sample = { height: 0, gx: 0, gy: 0, xa: 0, ya: 0, xb: 0, yb: 0, fx: 0, fy: 0 }

  for (let n = 0; n < droplets; n++) {
    let px = rand() * resolution
    let py = rand() * resolution
    let dx = 0
    let dy = 0
    let speed = 1
    let water = 1
    let sediment = 0

    for (let step = 0; step < lifetime; step++) {
      sample(height, resolution, px, py, here)
      dx = dx * params.inertia - here.gx * (1 - params.inertia)
      dy = dy * params.inertia - here.gy * (1 - params.inertia)
      const length = Math.hypot(dx, dy)
      // Perfectly flat ground — the automaton's dead cells are exactly 0 — gives
      // a droplet nowhere to go, so it drops what it carries and stops.
      if (length < 1e-8) break
      dx /= length
      dy /= length

      const nx = px + dx
      const ny = py + dy
      sample(height, resolution, nx, ny, next)
      const delta = next.height - here.height

      const capacity = Math.max(-delta * speed * water * params.capacity, 1e-4)
      if (sediment > capacity || delta > 0) {
        // Going uphill it can only drop what fills the step it just climbed.
        const amount = delta > 0 ? Math.min(delta, sediment) : (sediment - capacity) * params.deposition
        sediment -= amount
        deposit(height, resolution, here, amount)
      } else {
        const amount = Math.min((capacity - sediment) * params.erosion, -delta)
        sediment += amount
        // Spread over a brush: cutting a single cell carves 1-pixel slots that
        // read as sampling artifacts rather than valleys.
        for (const b of brush) {
          const bx = ((((here.xa + b.dx) % resolution) + resolution) % resolution)
          const by = ((((here.ya + b.dy) % resolution) + resolution) % resolution)
          height[by * resolution + bx] -= amount * b.weight
        }
      }

      speed = Math.sqrt(Math.max(0, speed * speed + delta * params.gravity))
      water *= 1 - params.evaporation
      px = nx
      py = ny
    }

    // A droplet that expires still holding sediment would delete that material
    // from the field, so it drops it where it stopped.
    if (sediment > 0) {
      sample(height, resolution, px, py, here)
      deposit(height, resolution, here, sediment)
    }
  }

  // Thermal runs after the droplets rather than alongside them: the water cuts
  // the slope, then the slope slumps to something it can hold. Interleaving
  // them per droplet would cost the same and say less.
  for (let pass = 0; pass < thermal.passes; pass++) {
    thermalPass(height, resolution, thermal.talus, thermal.strength)
  }

  // Clamped, not rescaled, matching the rest of the pipeline: erosion genuinely
  // digs below 0, and rescaling would hide how much relief the run has spent.
  const cut = new Float32Array(height.length)
  let cutScale = 0
  for (let i = 0; i < height.length; i++) {
    const v = height[i] < 0 ? 0 : height[i] > 1 ? 1 : height[i]
    height[i] = v
    const d = v - source[i]
    cut[i] = d
    const magnitude = d < 0 ? -d : d
    if (magnitude > cutScale) cutScale = magnitude
  }

  const sourceRelief = relief(source)
  return {
    source,
    height,
    cut,
    cutScale,
    droplets: (previous?.droplets ?? 0) + droplets,
    rain: ((previous?.droplets ?? 0) + droplets) / (resolution * resolution),
    reliefKept: sourceRelief > 0 ? relief(height) / sourceRelief : 1,
  }
}
