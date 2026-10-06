import { sampleField, type StudyTerrain } from '../study/terrain'
import { atParam, corridor, sampleSpline, smoothstep, withTangents, type P2, type Sample } from './spline'

/**
 * A river: here the terrain mostly decides, and the spline mostly obeys.
 *
 *     source + guide points → traced downhill → smoothed → descending profile
 *                           → channel carved (only ever down) → water ribbon
 *
 * The road takes its *heights* from the ground; the river takes its *route*
 * from it too. From the source it steps forward, and each step's direction is
 * a blend of "toward the next guide point" and "straight downhill", weighted
 * by terrain influence. At 0 the river goes where it is told and has to cut a
 * trench through anything in the way; at 1 it ignores the guides and finds the
 * valley itself.
 *
 * Two rules make it a river rather than a road with water on it:
 *
 *  - **The water surface only ever descends.** Each sample takes the lower of
 *    "a minimum fall below the last sample" and "a fixed depth below the
 *    ground here". The first guarantees it falls; the second keeps it in its
 *    bed when the course crosses a rise.
 *  - **The channel only ever cuts.** Terrain is pulled down toward the bed,
 *    never up. A road fills across a dip; a river leaves the dip alone.
 */
export type RiverParams = {
  /** Width at the source; it widens downstream. */
  width: number
  /** Bed depth below the water surface. */
  depth: number
  /** Bank width over which the carve eases back to the ground. */
  falloff: number
  /** 0 follows the guide points regardless of terrain; 1 follows only the downhill direction. */
  influence: number
}

export type RiverResult = {
  /** The traced course before smoothing, for the debug view. */
  traced: P2[]
  samples: Sample[]
  raw: number[]
  surface: number[]
  bed: number[]
  halfWidth: number[]
  weight: Float32Array
  ending: 'lake' | 'joined' | 'edge' | 'pit' | 'length'
  stats: { length: number; drop: number; climbed: number; maxCarve: number }
}

const MIN_FALL = 0.012 // world units of fall per world unit of run

/** Downhill direction from a central difference two cells wide. */
function downhill(t: StudyTerrain, h: Float32Array, x: number, z: number): [number, number, number] {
  const e = t.cell * 2
  const gx = sampleField(t, h, x + e, z) - sampleField(t, h, x - e, z)
  const gz = sampleField(t, h, x, z + e) - sampleField(t, h, x, z - e)
  const len = Math.hypot(gx, gz)
  return len < 1e-6 ? [0, 0, 0] : [-gx / len, -gz / len, len / (2 * e)]
}

export function traceRiver(
  terrain: StudyTerrain,
  height: Float32Array,
  points: P2[],
  influence: number,
  /**
   * Per vertex, how strongly earlier rivers' channels claim the ground. A
   * trace that enters one stops there: it has become a tributary. Without
   * this, a second river that found the first one's channel — which it will,
   * because the channel is the lowest ground around — would run down it and
   * carve the same bed twice.
   */
  channels: Float32Array | null = null,
): { traced: P2[]; ending: RiverResult['ending'] } {
  const step = terrain.cell * 0.8
  const half = terrain.size / 2 - 0.1
  let x = points[0].x
  let z = points[0].z
  let target = 1
  let dx = points[1] ? points[1].x - x : 1
  let dz = points[1] ? points[1].z - z : 0
  let len = Math.hypot(dx, dz) || 1
  dx /= len
  dz /= len
  const traced: P2[] = [{ x, z }]
  let lowest = sampleField(terrain, height, x, z)
  let sinceLower = 0

  for (let n = 0; n < 900; n++) {
    // Guide: toward the next guide point, then carry straight on past the last.
    let gx = dx
    let gz = dz
    while (target < points.length && Math.hypot(points[target].x - x, points[target].z - z) < 0.35) target++
    if (target < points.length) {
      gx = points[target].x - x
      gz = points[target].z - z
      len = Math.hypot(gx, gz) || 1
      gx /= len
      gz /= len
    }
    const [hx, hz, slope] = downhill(terrain, height, x, z)
    // On flat ground the gradient carries no direction; let the guide decide.
    const pull = slope < 0.02 ? 0 : influence
    let wx = gx * (1 - pull) + hx * pull
    let wz = gz * (1 - pull) + hz * pull
    len = Math.hypot(wx, wz) || 1
    wx /= len
    wz /= len
    // Inertia: a river cannot turn on a point, and without it a pure-downhill
    // trace zig-zags across every valley floor it meets.
    dx = dx * 0.6 + wx * 0.4
    dz = dz * 0.6 + wz * 0.4
    len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    x += dx * step
    z += dz * step
    traced.push({ x, z })
    if (Math.abs(x) > half || Math.abs(z) > half) return { traced, ending: 'edge' }
    const h = sampleField(terrain, height, x, z)
    if (h < terrain.waterLevel - 0.02) return { traced, ending: 'lake' }
    // Not in the first few steps, so a source placed beside an existing
    // river can still leave it.
    if (channels && n > 8 && sampleField(terrain, channels, x, z) > 0.6) return { traced, ending: 'joined' }
    if (h < lowest - 1e-4) {
      lowest = h
      sinceLower = 0
    } else if (++sinceLower > 60 && influence > 0.5) {
      // Sixty steps without finding lower ground, while the terrain is in
      // charge: it is circling the bottom of a basin with nowhere to drain.
      return { traced, ending: 'pit' }
    }
  }
  return { traced, ending: 'length' }
}

export function buildRiver(
  terrain: StudyTerrain,
  height: Float32Array,
  points: P2[],
  params: RiverParams,
  channels: Float32Array | null = null,
): RiverResult {
  const { traced, ending } = traceRiver(terrain, height, points, params.influence, channels)
  // The trace is one point per step and carries every wobble of the inertia
  // filter; a spline through every sixth point keeps its course and drops the
  // jitter.
  const keys = traced.filter((_, i) => i % 6 === 0 || i === traced.length - 1)
  const samples = keys.length >= 2 ? sampleSpline(keys, terrain.cell * 0.75) : withTangents(traced)
  const field = { res: terrain.res, size: terrain.size }
  const raw = samples.map((p) => sampleField(field, height, p.x, p.z))

  const surface: number[] = []
  for (let i = 0; i < samples.length; i++) {
    const below = raw[i] - params.depth * 0.3
    if (i === 0) {
      surface.push(below)
      continue
    }
    const run = samples[i].s - samples[i - 1].s
    surface.push(Math.min(surface[i - 1] - MIN_FALL * run, below))
  }
  const bed = surface.map((y) => y - params.depth)
  const total = samples[samples.length - 1]?.s || 1
  const halfWidth = samples.map((p) => (params.width / 2) * (0.6 + 0.8 * (p.s / total)))

  const reach = Math.max(...halfWidth) + params.falloff
  const { dist, param } = corridor(field, samples, reach)
  const weight = new Float32Array(height.length)
  let maxCarve = 0
  for (let k = 0; k < height.length; k++) {
    if (param[k] < 0) continue
    const hw = atParam(halfWidth, param[k])
    const w = 1 - smoothstep(hw * 0.7, hw + Math.max(params.falloff, 1e-3), dist[k])
    if (w <= 0) continue
    const target = atParam(bed, param[k])
    const carved = height[k] + (target - height[k]) * w
    if (carved < height[k]) {
      maxCarve = Math.max(maxCarve, height[k] - carved)
      height[k] = carved
      weight[k] = w
    }
  }

  let climbed = 0
  for (let i = 1; i < raw.length; i++) climbed += Math.max(0, raw[i] - raw[i - 1])

  return {
    traced,
    samples,
    raw,
    surface,
    bed,
    halfWidth,
    weight,
    ending,
    stats: { length: total, drop: surface[0] - surface[surface.length - 1], climbed, maxCarve },
  }
}
