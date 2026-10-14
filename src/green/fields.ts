import {
  ACROSS_SLOTS,
  BLOCKED,
  DOWN_SLOT,
  EDGE,
  FRAME,
  GLASS,
  LEDGE,
  ROOF,
  SHELTER,
  UNGROWABLE,
  type Building,
  type Volume,
} from './building'
import { SUN_ELEVATION_DEG, type GrowthParams } from './params'
import { SPECIES_IDS } from './species'

/**
 * The environment, as three scalar fields over the building's cells.
 *
 * Each is one number per cell in [0, 1], computed from the building and the
 * parameters and never from the growth: the plants respond to the environment
 * but do not change it. That is a simplification — a real vine shades the wall
 * under it and holds water — and it is the first thing to relax if the model
 * needs to feed back on itself.
 *
 * None of this is physically calibrated. Each field is a rule simple enough to
 * say in a sentence, so that a pattern in the growth can be traced back to the
 * sentence that caused it.
 */
export type Fields = {
  sun: Float32Array
  moisture: Float32Array
  geometry: Float32Array
  /** Per species, in SPECIES_IDS order. Can it live here: moisture factor × light factor. Decides survival. */
  env: Float32Array[]
  /** Per species. Where a tip would rather go: env, weighted toward features by edge preference. */
  suitability: Float32Array[]
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Unit vector toward the sun. Azimuth 0 shines straight at the front wall (+z). */
export function sunDirection(azimuthDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (SUN_ELEVATION_DEG * Math.PI) / 180
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]
}

/**
 * Whether a ray toward the sun passes through a volume's side.
 *
 * The ray leaves (ox, y, oz) along the horizontal unit direction (hx, hz),
 * climbing `rise` per unit travelled. Each edge of the volume's footprint is a
 * wall; the ray is blocked if it crosses one at a height between the volume's
 * bottom and top. Exact, not a blur, and shared by the single-sun field here
 * and the whole-day field in sunPath.ts.
 */
export function rayHits(vol: Volume, ox: number, y: number, oz: number, hx: number, hz: number, rise: number): boolean {
  const poly = vol.polygon
  for (let k = 0; k < poly.length; k++) {
    const [axv, azv] = poly[k]
    const [bxv, bzv] = poly[(k + 1) % poly.length]
    const ex = bxv - axv
    const ez = bzv - azv
    // Ray o + t·h against segment a + w·e, w in [0, 1].
    const denom = hx * ez - hz * ex
    if (Math.abs(denom) < 1e-9) continue
    const rx = axv - ox
    const rz = azv - oz
    const t = (rx * ez - rz * ex) / denom
    const w = (rx * hz - rz * hx) / denom
    if (t <= 1e-4 || w < 0 || w > 1) continue
    const at = y + t * rise
    if (at > vol.y0 + 1e-6 && at < vol.y1 - 1e-6) return true
  }
  return false
}

/**
 * Sunlight: Lambert on each cell's facing, then shadow rays, then sky light.
 *
 * Direct light is `n · L` divided by the cosine of the sun's elevation, so a
 * wall facing the sun's compass bearing reads 1 rather than 0.79 — the field is
 * "how lit is this cell compared with the most lit wall". A flat roof, facing
 * the sky, reads sin 38° / cos 38° = 0.78 everywhere it is not shaded.
 *
 * Two kinds of shadow, both exact rays rather than blurs:
 * - **Solids.** A ray from the cell toward the sun is tested against every
 *   volume — the main block, the wing, each rooftop unit — and the cell is
 *   shaded if the ray passes through one's side. This is what lets the L's
 *   inside corner shade itself, the main block shade the terrace beside it,
 *   and a stair housing shade the roof behind it.
 * - **Overhangs on the same wall.** Balconies, ledges and the cornice each
 *   shade a band beneath them whose height depends on the sun's angle to that
 *   wall: grazing light throws a long shadow, square-on light a short one.
 *
 * Sky light is 0.14 on a wall — less near the inside corner and under
 * balconies, where less of the sky is visible — and 0.2 on a roof, which sees
 * all of it.
 */
export function computeSun(b: Building, azimuthDeg: number): Float32Array {
  const out = new Float32Array(b.count)
  const [lx, ly, lz] = sunDirection(azimuthDeg)
  const horizontal = Math.hypot(lx, lz)
  const hx = lx / horizontal
  const hz = lz / horizontal
  // Height gained per unit of horizontal travel toward the sun.
  const rise = ly / horizontal
  const norm = horizontal // cos(elevation)
  // Overhangs grouped by wall: a cell only ever tests its own wall's, and
  // testing all of them for every cell made this 33 ms.
  const bySegment = b.segments.map((_, si) => b.overhangs.filter((o) => o.segment === si))

  for (let i = 0; i < b.count; i++) {
    const facing = b.nx[i] * lx + b.ny[i] * ly + b.nz[i] * lz
    let lit = Math.min(1, Math.max(0, facing) / norm)
    const y = b.py[i]
    const wall = b.segment[i] >= 0

    if (lit > 0) {
      const ox = b.px[i] + b.nx[i] * 1e-3
      const oz = b.pz[i] + b.nz[i] * 1e-3
      for (const vol of b.volumes) {
        if (rayHits(vol, ox, y, oz, hx, hz, rise)) {
          lit = 0
          break
        }
      }
    }

    if (lit > 0 && wall) {
      const seg = b.segments[b.segment[i]]
      const facingH = seg.nx * hx + seg.nz * hz
      const tangent = seg.dx * hx + seg.dz * hz
      for (const o of bySegment[b.segment[i]]) {
        if (o.y <= y) continue
        // Where the ray meets the underside's height: how far out from the
        // wall, and how far along it.
        const travel = (o.y - y) / rise
        const reach = travel * facingH
        const along = b.along[i] + travel * tangent
        if (reach < o.depth && along > o.s0 && along < o.s1) {
          lit = 0
          break
        }
      }
    }

    let sky: number
    if (wall) {
      const insideCorner = b.cornerInside[i] ? Math.min(1, b.cornerDist[i] / 2.5) : 1
      sky = 0.14 * (0.5 + 0.5 * insideCorner)
      if (b.flags[i] & SHELTER) sky *= 0.6
    } else {
      sky = 0.2
    }
    out[i] = clamp01(sky + 0.86 * lit)
  }
  return out
}

/**
 * Moisture: rain runs down the walls, lands on the roofs, and the sun dries
 * what it lights.
 *
 * **Walls.** Walking each column from the top down, a running total of water
 * is carried: exposed wall catches rain and adds it to the flow; a balcony's
 * shelter catches none; **glass sheds water** — it absorbs nothing and passes
 * its whole load to the wall below, which is why the strip under each window
 * comes out wetter; **a ledge holds water**, soaking up much of what reaches it
 * and throwing most of the rest clear. Rising damp adds a band at the foot of
 * walls that stand on the ground.
 *
 * **Roofs.** A flat roof catches more rain than a wall (0.6 of it against
 * 0.35), and **water collects against whatever stops it** — the parapet at a
 * roof's edge, the sides of a rooftop unit — so edge cells get a third more.
 * **Where a wall stands on a roof**, the water running down that wall does not
 * stop at its foot: it lands on the roof cell below, which is why the terrace
 * beside the main block is the wettest roof there is.
 *
 * Then evaporation removes up to 55% where the sun is strongest, a short
 * sideways blur stands in for wicking, and the raw amount is mapped through
 * 1 − e^(−1.6·m), which saturates smoothly instead of clipping.
 *
 * Not a fluid simulation, and not meant to be: it is the smallest rule that
 * makes ledges, windows, balconies, roofs and orientation each leave a mark.
 */
export function computeMoisture(b: Building, rain: number, sun: Float32Array): Float32Array {
  const { count, flags } = b
  const raw = new Float32Array(count)
  const runoff = new Float32Array(count)

  for (const column of b.columns) {
    let carried = 0
    for (let k = 0; k < column.length; k++) {
      const i = column[k]
      const f = flags[i]
      const direct = f & SHELTER ? 0 : rain * 0.35
      if (f & GLASS) {
        carried += direct
        continue
      }
      const damp = 0.45 * (0.4 + 0.6 * rain) * Math.exp(-b.py[i] / 1.6)
      let wet = direct + carried * 0.6 + damp
      if (f & LEDGE) {
        wet += carried * 0.8
        carried *= 0.35
      }
      carried = carried * 0.9 + direct * 0.5
      raw[i] = wet * (1 - 0.55 * sun[i])
    }
    // A wall that stands on a roof drains onto it.
    const foot = column[column.length - 1]
    const below = b.neighbours[foot * 8 + DOWN_SLOT]
    if (below >= 0 && flags[below] & ROOF) runoff[below] += carried
  }

  for (let i = 0; i < count; i++) {
    if (!(flags[i] & ROOF) || flags[i] & BLOCKED) continue
    const wet = rain * 0.6 * (flags[i] & EDGE ? 1.35 : 1) + runoff[i] * 0.8
    raw[i] = wet * (1 - 0.55 * sun[i])
  }

  // Sideways wicking: two passes of a 3-tap blur across the surface, over
  // growable cells only — glass and blocked cells neither give nor receive.
  const tmp = new Float32Array(count)
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? raw : tmp
    const dst = pass === 0 ? tmp : raw
    for (let i = 0; i < count; i++) {
      if (flags[i] & UNGROWABLE) {
        dst[i] = 0
        continue
      }
      let sum = src[i] * 2
      let weight = 2
      for (const slot of ACROSS_SLOTS) {
        const j = b.neighbours[i * 8 + slot]
        if (j >= 0 && !(flags[j] & UNGROWABLE)) {
          sum += src[j]
          weight++
        }
      }
      dst[i] = sum / weight
    }
  }
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = flags[i] & UNGROWABLE ? 0 : 1 - Math.exp(-1.6 * raw[i])
  return out
}

/**
 * Geometry: how close a cell is to something a vine could follow.
 *
 * - **Corners**, Gaussian over 0.9 units of wall either side; an inside corner
 *   counts fully, an outside one 0.75 — the inside corner is the sheltered one.
 * - **Window frames, ledges and edges** — a roof's border, the cells against a
 *   rooftop unit, and the line where a wall meets a roof — by distance in steps
 *   across the neighbour table: 1 on the feature, 0.5 one step away, nothing
 *   at two.
 *
 * Fixed for the building, so it is computed once. Edge preference decides how
 * much of it reaches the growth.
 */
export function computeGeometry(b: Building): Float32Array {
  const { count, flags } = b
  const dist = new Int32Array(count).fill(1 << 30)
  const queue = new Int32Array(count)
  let head = 0
  let tail = 0
  for (let i = 0; i < count; i++) {
    if (flags[i] & UNGROWABLE) continue
    if (flags[i] & (FRAME | LEDGE | EDGE)) {
      dist[i] = 0
      queue[tail++] = i
    }
  }
  // Breadth-first over the neighbour table, two steps deep is all that matters.
  while (head < tail) {
    const i = queue[head++]
    if (dist[i] >= 2) continue
    for (let k = 0; k < 8; k++) {
      const j = b.neighbours[i * 8 + k]
      if (j < 0 || flags[j] & UNGROWABLE || dist[j] <= dist[i] + 1) continue
      dist[j] = dist[i] + 1
      queue[tail++] = j
    }
  }
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    if (flags[i] & UNGROWABLE) continue
    const c = b.cornerDist[i] / 0.9
    const corner = Number.isFinite(c) ? Math.exp(-c * c) * (b.cornerInside[i] ? 1 : 0.75) : 0
    const feature = Math.max(0, 1 - dist[i] / 2)
    out[i] = Math.max(corner, feature)
  }
  return out
}

/**
 * Combines the fields under the current parameters, once per species.
 *
 * The split between the two outputs is the model's main claim, so it is worth
 * saying plainly: **the environment decides whether a plant can live in a cell;
 * the geometry decides which way it goes.**
 *
 *     moistureFactor = smoothstep(0.06·need, need, moisture)
 *     lightFactor    = clamp(1 − 1.1·|sun − lightPreference|, 0.08, 1)
 *     env            = moistureFactor × lightFactor
 *     suitability    = env × (1 − w + w·geometry),   w = edge preference
 *
 * `need`, `lightPreference` and `w` are the species' own, so the same wall
 * gives three different answers — moss's env is high where ivy's is middling
 * and the vine's is near zero. Ivy's need of 0.5 is the old single plant's
 * smoothstep(0.03, 0.5) exactly.
 *
 * A rule switched off contributes a constant 1 (or w = 0), so it stops
 * distinguishing one cell from another without changing anything else.
 * Multiplying rather than adding is deliberate: a cell that is bone dry is not
 * rescued by being bright, and a wet cell in the wrong light is not either.
 *
 * Disabled species get arrays too — zeros cost nothing to read and keep every
 * index valid — but nothing is computed for them.
 */
export function combine(
  b: Building,
  base: { sun: Float32Array; moisture: Float32Array; geometry: Float32Array },
  p: GrowthParams,
): Fields {
  const n = b.count
  const env: Float32Array[] = []
  const suitability: Float32Array[] = []
  for (const id of SPECIES_IDS) {
    const sp = p.species[id]
    const e = new Float32Array(n)
    const s = new Float32Array(n)
    env.push(e)
    suitability.push(s)
    if (!sp.enabled) continue
    const w = p.useGeometry ? sp.edgePreference : 0
    for (let i = 0; i < n; i++) {
      if (b.flags[i] & UNGROWABLE) continue
      const m = p.useMoisture ? smoothstep(0.06 * sp.moistureNeed, sp.moistureNeed, base.moisture[i]) : 1
      const l = p.useSunlight ? Math.min(1, Math.max(0.08, 1 - 1.1 * Math.abs(base.sun[i] - sp.lightPreference))) : 1
      e[i] = m * l
      s[i] = e[i] * (1 - w + w * base.geometry[i])
    }
  }
  return { ...base, env, suitability }
}

/** Builds all three fields and combines them. Geometry can be passed in, since it never changes. */
export function computeFields(b: Building, p: GrowthParams, geometry = computeGeometry(b)): Fields {
  const sun = computeSun(b, p.sunAzimuth)
  const moisture = computeMoisture(b, p.rain, sun)
  return combine(b, { sun, moisture, geometry }, p)
}
