import { mulberry32 } from '../noise'
import { D, EAST, W, WEST } from './town'
import { lawnHeight, outside } from './lawn'
import { LineIndex, chaikin, resample, route, type Line } from './features'

/**
 * The land round the town: gentle hills, three environmental fields, and
 * where the decorations stand. Pure data, seeded — the same seed gives the
 * same land, every time — so a saved world stores only its seed and density.
 *
 * **The town's ground is untouched.** Height is `lawnHeight` (the ground the
 * game has always stood on: within centimetres of level on the grid, a gentle
 * roll just outside it) plus hills multiplied by a mask that is exactly zero
 * within KEEP units of the buildable grid and rises smoothly to one by FULL.
 * Everything the simulation reads — where a Draper roots, where ground cover
 * lies — is on that untouched ground, so gameplay can't change. The mask is
 * a distance from the grid's rounded rectangle, eased, so there is no
 * plateau edge to see.
 *
 * Town units throughout: a block is 1 across and a storey high.
 */

/** Hills begin this far outside the buildable grid… */
export const KEEP = 3
/** …and reach full height here. */
const FULL = 14
/** Decorations stay this far outside the grid: a quiet margin round the buildings. */
export const QUIET = 2.5

export type Density = 'low' | 'medium' | 'high'
export const DENSITIES: Density[] = ['low', 'medium', 'high']
export const DENSITY_NAMES: Record<Density, string> = { low: 'Low', medium: 'Medium', high: 'High' }
const DENSITY_SCALE: Record<Density, number> = { low: 0.45, medium: 1, high: 1.7 }

/** What a world saves about its land. */
export type LandscapeSettings = { seed: number; density: Density }

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export { outside }

/** The two buildings' footprints in the lawn scenario, in world units (town.ts's cells, centred). */
const FOOTPRINTS = [WEST, EAST].map(([cx, , cz]) => ({ x0: cx - W / 2, x1: cx + 2 - W / 2, z0: cz - D / 2, z1: cz + 2 - D / 2 }))

/** Distance from a point to the nearer building's footprint (0 inside it). */
export function toBuilding(x: number, z: number): number {
  let best = Infinity
  for (const f of FOOTPRINTS) best = Math.min(best, Math.hypot(Math.max(f.x0 - x, 0, x - f.x1), Math.max(f.z0 - z, 0, z - f.z1)))
  return best
}

/**
 * The gap between the two buildings, and 4.5 units either side of it: where the plants are
 * meant to join them, so nothing is laid or stands there but the lawn's own colour — no path,
 * no flower. (Its x runs from the west building's east wall to the east building's west wall,
 * with 0.6 to spare.)
 */
export function inGap(x: number, z: number): boolean {
  return x > FOOTPRINTS[0].x1 - 0.6 && x < FOOTPRINTS[1].x0 + 0.6 && Math.abs(z) < 4.5
}

/**
 * The protected ground: the gap, and 2.5 units round each building, where its plants climb,
 * drape and spread onto the lawn. Paths may approach a building's outer side through it;
 * nothing stands in it.
 */
export function inProtected(x: number, z: number): boolean {
  return inGap(x, z) || toBuilding(x, z) < 2.5
}

/**
 * Seeded 2D gradient (Perlin) noise, in about [−1, 1]. The permutation comes
 * from the repository's own mulberry32, so it is reproducible from the seed.
 */
class Perlin {
  private perm = new Uint8Array(512)
  constructor(seed: number) {
    const rand = mulberry32(seed)
    const p = Array.from({ length: 256 }, (_, i) => i)
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[p[i], p[j]] = [p[j], p[i]]
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]
  }
  noise(x: number, y: number): number {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
    const P = this.perm
    const g = (h: number, dx: number, dy: number) => {
      // Eight gradient directions.
      switch (h & 7) {
        case 0: return dx + dy
        case 1: return -dx + dy
        case 2: return dx - dy
        case 3: return -dx - dy
        case 4: return dx
        case 5: return -dx
        case 6: return dy
        default: return -dy
      }
    }
    const X = xi & 255
    const Y = yi & 255
    const aa = P[P[X] + Y]
    const ab = P[P[X] + Y + 1]
    const ba = P[P[X + 1] + Y]
    const bb = P[P[X + 1] + Y + 1]
    const x1 = g(aa, xf, yf) + u * (g(ba, xf - 1, yf) - g(aa, xf, yf))
    const x2 = g(ab, xf, yf - 1) + u * (g(bb, xf - 1, yf - 1) - g(ab, xf, yf - 1))
    return (x1 + v * (x2 - x1)) * 0.9
  }
}

export class Landscape {
  readonly seed: number
  private hills: Perlin
  private wet: Perlin
  private rich: Perlin
  private cluster: Perlin
  private woods: Perlin

  constructor(seed: number) {
    this.seed = seed
    this.hills = new Perlin(seed * 7919 + 1)
    this.wet = new Perlin(seed * 7919 + 2)
    this.rich = new Perlin(seed * 7919 + 3)
    this.cluster = new Perlin(seed * 7919 + 4)
    this.woods = new Perlin(seed * 7919 + 5)
    this.meadow = new Perlin(seed * 7919 + 6)
    // The lines through the land come last: they are planned over the finished terrain — the
    // stream over the land as it was, then the paths over the land the stream has cut.
    this.stream = planStream(this)
    // Each segment indexed as far as its own banks reach (one reach for all, the widest bank's
    // 11 units, put 40-odd segments in every bucket and doubled the decorations' build time).
    // At least 6, so moisture can feel the water from up its banks.
    this.streamIndex = new LineIndex(this.stream, 4, this.stream.half.map((h, i) => Math.max(6, h + this.stream.bank![i] + 0.5)))
    this.paths = planPaths(this)
    this.pathIndex = this.paths.map((p) => new LineIndex(p, 4, 3))
  }

  private meadow: Perlin
  /** The stream, from its spring to where it leaves through the valley. */
  readonly stream: Line
  private streamIndex: LineIndex | null = null
  /** The footpaths: the main one first, then its branch. */
  readonly paths: Line[]
  private pathIndex: LineIndex[]

  /**
   * How worn the ground is by a footpath here, 0–1: full across the path's
   * middle, fading over its edges and where the path itself fades (into the
   * forest, or into trodden grass by the town). Decorations keep off it, trees
   * leave it a gap, and the ground beside it is a little worn.
   */
  onPath(x: number, z: number): number {
    let best = 0
    for (const idx of this.pathIndex) {
      const n = idx.nearest(x, z)
      if (!n) continue
      const half = idx.at(idx.line.half, n)
      const v = idx.at(idx.line.wear!, n) * (1 - smooth(half * 0.6, half + 0.6, n.d))
      if (v > best) best = v
    }
    return best
  }

  /** Distance from a point to the nearest footpath's edge (negative on it); Infinity when none is near. */
  pathEdge(x: number, z: number): number {
    let best = Infinity
    for (const idx of this.pathIndex) {
      const n = idx.nearest(x, z)
      if (n && idx.at(idx.line.wear!, n) > 0.15) best = Math.min(best, n.d - idx.at(idx.line.half, n))
    }
    return best
  }

  /**
   * 0–1: the low ground cover's patches (clover, creeping weeds) — irregular shapes, not discs:
   * the coordinates warped by a slower noise before a two-octave field is read, so a patch
   * runs out in lobes and fingers.
   */
  groundCover(x: number, z: number): number {
    const wx = x + this.meadow.noise(x * 0.06 + 17.3, z * 0.06 - 4.1) * 3.5
    const wz = z + this.meadow.noise(x * 0.06 - 9.7, z * 0.06 + 12.2) * 3.5
    return clamp01(0.5 + this.meadow.noise(wx * 0.17 + 31.1, wz * 0.17 - 7.7) * 0.85 + this.meadow.noise(wx * 0.41 - 2.2, wz * 0.41 + 5.3) * 0.25)
  }

  /** −1…1: a broad, slow shift in the grass's green (about 30 units across), lighter one way, deeper the other. */
  broadTone(x: number, z: number): number {
    return Math.max(-1, Math.min(1, this.meadow.noise(x * 0.033 + 51.7, z * 0.033 - 23.9) * 1.6))
  }

  /**
   * 0–1: a few small patches of bare soil out in the meadow — where the grass is thin — sparse
   * by a high threshold on a field 3 units across, and never on the protected ground or in the
   * woods.
   */
  bareSoil(x: number, z: number): number {
    if (outside(x, z) < 2 || inProtected(x, z)) return 0
    const n = 0.5 + this.meadow.noise(x * 0.33 + 3.9, z * 0.33 + 41.3) * 0.9 + this.meadow.noise(x * 0.9, z * 0.9) * 0.12
    return smooth(0.8, 0.92, n) * smooth(0.7, 0.4, this.forest(x, z) + 0.4) * smooth(2, 4, outside(x, z))
  }

  /**
   * 0–1: where wildflowers gather — inside the meadow's patches, where a second
   * field clusters them, out of the woods. The flowers stand here, and the
   * ground under them takes a pale wash of their colour: one flower is a few
   * pixels at play distance, but a drift of them reads.
   */
  flowerDrift(x: number, z: number, patch = this.meadowPatch(x, z), woods = this.forest(x, z)): number {
    const p = smooth(0.58, 0.76, patch)
    if (p <= 0 || woods >= 1) return 0
    return p * smooth(0.5, 0.68, this.clustering(x, z, 91)) * (1 - woods)
  }

  /**
   * 0–1: the meadow's patches — where the grass grows taller, wildflowers
   * gather and the green shifts a little — so the open ground varies in
   * drifts rather than evenly. Two octaves, about 9 and 4 units across.
   */
  meadowPatch(x: number, z: number): number {
    return clamp01(0.5 + this.meadow.noise(x * 0.11 + 3.7, z * 0.11 - 1.3) * 0.9 + this.meadow.noise(x * 0.27 - 8.2, z * 0.27 + 5.1) * 0.35)
  }

  /** The rim's share of the last `hillsAt`, so `relief` needn't build the terrain twice (the build took 261 ms that way, 228 this way). */
  private lastRim = 0

  /** 0 on and near the grid, easing to 1 by FULL units out: where hills may rise. */
  mask(x: number, z: number): number {
    return smooth(KEEP, FULL, outside(x, z))
  }

  /**
   * The hills alone, before the mask: two octaves of domain-warped noise —
   * broad rolls (one per ~35 units, ±1.5) and smaller undulations (~12 units,
   * ±0.4) — growing taller with distance, so the far ground reads as hills
   * and the near as a meadow, plus the landforms.
   */
  hillsAt(x: number, z: number): number {
    const n = this.hills
    // Domain warp: the coordinates are pushed about by a slow noise first, so
    // the rolls bend and run into each other instead of sitting on a lattice.
    const wx = x + n.noise(x * 0.02 + 3.1, z * 0.02 - 5.7) * 9
    const wz = z + n.noise(x * 0.02 - 8.4, z * 0.02 + 1.9) * 9
    const broad = n.noise(wx * 0.028, wz * 0.028) * 1.5
    const mid = n.noise(wx * 0.08 + 31.7, wz * 0.08 - 12.3) * 0.4
    // No fine ripple any more: at this scale it only made the ground look bumpy.
    // The rolls come up sooner than they did (0.6 → 1.6 over 14–70 units): the hills just
    // past the rim are the middle layer between the clearing and the ridge.
    const far = 0.7 + 0.9 * smooth(10, 50, outside(x, z))
    const land = this.landforms(x, z)
    // The rim gives way where the spur or the ridge's foot already climbs: stacked, they rose
    // together over the mask's few units and the slope reached 0.59, steeper than 1 in 2.
    this.lastRim = this.shelter(x, z) * (1 - 0.6 * smooth(0.2, 1.4, land))
    const h = (broad + mid) * far + land + this.lastRim
    // Tops eased toward 5.8 above 4 units: where the rim runs into the ridge the two stacked to
    // 6.3, over twice the tallest building. Nothing below 4 changes, and slopes only soften.
    return h > 4 ? 4 + 1.8 * Math.tanh((h - 4) / 1.8) : h
  }

  /**
   * The rise round the clearing, units: the ground lifts gently from partway
   * across the meadow up into the forest, so the trees at the edge stand
   * higher than the buildings and close the view round them — a hollow, not a
   * lawn. Not a ring: its height round the circle is noise (sampled round a
   * circle, like the clearing's edge), from a low saddle to a shoulder ~3.4
   * high, and it falls away along the open valley, which stays the clearing's
   * way out. It starts 11 units inside the edge (inside the mask, so the grid
   * itself stays flat), crests ~14 past it, and eases back a little beyond, so
   * the land behind reads as a further layer rather than a wall.
   */
  shelter(x: number, z: number): number {
    const a = Math.atan2(z, x)
    const c = Math.cos(a)
    const s = Math.sin(a)
    const n = this.woods.noise(c * 1.4 + 12.1, s * 1.4 - 3.3) * 0.7 + this.woods.noise(c * 3.1 - 6.6, s * 3.1 + 9.2) * 0.3
    // 0 due north, positive to the east, as `corridor`; the opening a little wider than the valley's trees.
    const bearing = Math.atan2(x, -z)
    const d = Math.atan2(Math.sin(bearing - 0.3), Math.cos(bearing - 0.3))
    const opening = Math.exp(-((d / 0.4) ** 2))
    const rim = Math.max(0.4, 2.0 + n * 1.8) * (1 - 0.85 * opening)
    const past = this.pastEdge(x, z)
    return rim * smooth(-11, 14, past) * (1 - 0.4 * smooth(16, 38, past))
  }

  /**
   * 0–1: how high the ground is, leaving out the clearing's rim — the hills and
   * the ridge. What decides where conifers lead a stand: counting the rim, every
   * stand round the edge looked "high", and the forest went back to firs on one
   * side and broadleaves on the other.
   */
  relief(x: number, z: number): number {
    const m = this.mask(x, z)
    if (m <= 0) return 0.5
    const h = this.hillsAt(x, z)
    return clamp01(0.5 + (m * (h - this.lastRim)) / 4)
  }

  /** Ridged noise, 0–1: sharp crests where the noise crosses zero, broad troughs between. */
  private ridged(x: number, z: number): number {
    const r = 1 - Math.abs(this.hills.noise(x, z) / 0.9)
    return r * r
  }

  /**
   * The landmarks that give the land a silhouette, placed for composition
   * (the opening view looks north-west, from the south-east). Not domes: the
   * first version's Gaussian ridge and hill read as smooth isolated mounds.
   *
   * - **A ridgeline** behind the scene, ~42 units out to the north-west. Its
   *   crest wanders (a warped line), and its height along the crest is ridged
   *   noise — peaks up to ~4.8 with saddles between, never a straight bar.
   *   (It was 48 out and 5.5 high; nearer and lower, the place feels smaller.) Its
   *   slopes are asymmetric: a long gentle fall toward the clearing (20 units)
   *   and a shorter, steeper back (10).
   * - **A spur** branching off its western end toward the south-west, lower,
   *   so the skyline steps and the ridge reads as part of a range.
   * - **Shallow valleys** out in the far land: inverted ridged noise carves
   *   long troughs (to −1.2) between the rolls.
   * - **The open valley** to the north-north-east, where the ground dips and
   *   the forest stays sparse (`corridor`).
   *
   * All are smooth (no edges) and well beyond the mask's 14 units, so the
   * town's ground never sees them.
   */
  landforms(x: number, z: number): number {
    const n = this.hills
    const crest = (s: number, base: number, wobble: number) => base + n.noise(s * 0.035, 7.3) * wobble
    const band = (t: number, near: number, back: number) => Math.exp(-((t / (t < 0 ? near : back)) ** 2))
    // The ridgeline: along its axis s (WSW–ENE), across it t (positive outward, NW).
    const s = x * 0.83 + z * -0.55
    const t = x * -0.55 + z * -0.83 - crest(s, 42, 6)
    const peaks = 1.9 + 2.9 * this.ridged(s * 0.045 + 11.2, 3.7)
    const ridge = peaks * band(t, 20, 10) * Math.exp(-((s / 75) ** 2)) * (0.8 + 0.2 * Math.tanh(-s / 30))
    // The spur, off the ridge's western end toward the south-west.
    const s2 = x * 0.35 + z * 0.94
    const t2 = x * -0.94 + z * 0.35 - crest(s2, 33, 5)
    const spur = (1.4 + 1.8 * this.ridged(s2 * 0.06 - 4.4, 9.1)) * band(t2, 12, 8) * Math.exp(-(((s2 + 5) / 30) ** 2))
    // Shallow valleys between the far rolls.
    const troughs = -1.2 * (1 - this.ridged(x * 0.03 + 21, z * 0.03 - 17)) * smooth(30, 70, outside(x, z)) * 0.6
    const valley = -1.4 * this.corridor(x, z) * smooth(16, 40, Math.hypot(x, z))
    return ridge + spur + troughs + valley
  }

  /** 0–1: how much a point lies in the open valley to the north-north-east — the forest leaves it clear. */
  corridor(x: number, z: number): number {
    const a = Math.atan2(x, -z) // 0 due north, positive toward the east
    const d = Math.atan2(Math.sin(a - 0.3), Math.cos(a - 0.3))
    return Math.exp(-((d / 0.22) ** 2)) * smooth(12, 22, Math.hypot(x, z))
  }

  /** Ground height at a point: the town's ground, plus masked hills, with the stream's channel cut in. Use this to stand anything on the land. */
  height(x: number, z: number): number {
    const c = this.channelAt(x, z)
    if (!c) return this.baseHeight(x, z)
    return c.base + (c.channel - c.base) * c.w
  }

  /**
   * The stream's channel at a point, if it reaches here: the height it would make the ground,
   * and how fully it does (`w`, blended into the land). Its pieces, for the colours and the
   * decorations: how far past the water's edge (`edge`, negative in the water), how deep in the
   * water (0 at the edge, 1 in the middle), whether this bank is the outside of a bend (`outer`,
   * the cut bank) or the inside (`inner`, a gravel bar), and the bank's character.
   *
   * Under the water: a bowl a fifth of the half-width deep, deeper in pools (a fixed depth
   * under the spring's narrow trickle made its sides 1 in 1). From the water's edge: exactly the
   * water level, so the flat water meets the ground with no gap and never floats; then the bank,
   * in two stages — a small **lip** right at the water, up to 0.2 high over 0.65 units, taller on
   * a bend's outside (the cut bank) than its inside (a gravel bar), so the edge can be seen; and
   * the rest of the rise blended into the land over the whole bank (smoothstep alone, the first
   * version, started flat at the water and showed no bank at all).
   * Faded out before the town's ground, so within KEEP of the grid the height is exactly as
   * it was, whatever the banks; fading only leaves the ground higher than the water there.
   */
  channelAt(x: number, z: number) {
    const idx = this.streamIndex
    if (!idx) return null
    const n = idx.nearest(x, z)
    if (!n) return null
    const st = this.stream
    const centre = idx.at(st.half, n)
    const skew = idx.at(st.skew!, n)
    const half = centre * (1 + n.side * skew)
    const bank = idx.at(st.bank!, n)
    if (n.d > half + bank) return null
    const level = idx.at(st.level!, n)
    const bend = idx.at(st.bend!, n)
    // The outside of a bend is the bank on the opposite side to the turn.
    const outer = Math.max(0, -n.side * bend)
    const inner = Math.max(0, n.side * bend)
    const base = this.baseHeight(x, z)
    const depth = 0.2 * Math.min(1, half) * idx.at(st.deep!, n)
    const edge = n.d - half
    let h: number
    if (edge < 0) h = level - depth * (1 - (n.d / half) ** 2)
    else {
      // The lip: a small rise right at the water — up to 0.2, more of it on a bend's outside
      // than its inside — over 0.65 units; then the rest of the way to the land over the whole
      // bank. (A lip taking a share of the whole cut stood at 1 in 1 where the cut was deep.)
      const lip = Math.min(0.2, Math.max(0, base - level) * (0.45 + 0.25 * outer - 0.25 * inner))
      const near = level + lip * smooth(0, 0.65, edge)
      h = near + (base - near) * smooth(0, bank, edge)
    }
    const fade = smooth(KEEP, KEEP + 3, outside(x, z))
    const channel = base + (h - base) * fade
    return { base, channel, w: 1, edge, half, wet: edge < 0 ? 1 - (n.d / half) ** 2 : 0, outer, inner, rocky: idx.at(st.rocky!, n), lush: idx.at(st.lush!, n), lift: Math.max(0, base - level) }
  }

  /**
   * The land before the stream: the town's ground plus masked hills, and gentle swells in the
   * meadow just beyond the town — up to 12 cm, about 7 units across (16 put seed 4's steepest at 0.5), from 3 units off the grid
   * (where the hills' mask is still nearly flat) and full by 7, fading out at the clearing's edge — a
   * meadow's swells, not the hills'. Inside KEEP, exactly the town's ground.
   */
  baseHeight(x: number, z: number): number {
    const m = this.mask(x, z)
    const out = outside(x, z)
    // Only inside the clearing (its edge is under 25 units out): worked out everywhere, the swells
    // slowed every height in the land by half.
    const swell = out > KEEP && x * x + z * z < 28 * 28 ? 0.12 * this.meadow.noise(x * 0.15 + 8.1, z * 0.15 - 2.6) * smooth(KEEP, KEEP + 4, out) * (1 - smooth(-4, 4, this.pastEdge(x, z))) : 0
    return lawnHeight(x, z) + (m > 0 ? m * this.hillsAt(x, z) : 0) + swell
  }

  /**
   * How far past the water's edge the fine bank mesh reaches here (`landscapeDecor.bankStrip`):
   * 2 units, more where the bank is cut deeper (to 6).
   */
  bankReach(lift: number): number {
    return Math.max(2, Math.min(6, 0.5 * lift + 1.6))
  }

  /**
   * How far the lawn is lowered under the fine bank mesh, so its coarser triangles (0.5–0.9
   * apart near the stream) can't poke through the mesh's lip or the water: 10 cm under the
   * mesh, back to nothing across its last unit, where the mesh fades out over the lawn.
   */
  lawnSink(x: number, z: number): number {
    const c = this.channelAt(x, z)
    if (!c) return 0
    const reach = this.bankReach(c.lift)
    return 0.1 * (1 - smooth(reach - 1, reach - 0.3, c.edge))
  }

  /** Distance from a point to the water's edge (negative in the water); Infinity when the stream is far. */
  streamEdge(x: number, z: number): number {
    const idx = this.streamIndex
    const n = idx?.nearest(x, z)
    if (!n) return Infinity
    return n.d - idx!.at(this.stream.half, n) * (1 + n.side * idx!.at(this.stream.skew!, n))
  }

  /** Steepness, 0 flat to 1 steep, by central differences. */
  slope(x: number, z: number): number {
    const e = 0.5
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e)
    const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e)
    return clamp01(Math.hypot(dx, dz) * 2.5)
  }

  /** 0–1. Elevation of the land relative to the town's ground, for colour and placement. */
  elevation(x: number, z: number): number {
    return clamp01(0.5 + (this.height(x, z) - lawnHeight(x, z)) / 4)
  }

  /**
   * 0–1. Moisture: a slow noise field, wetter in hollows (water gathers low)
   * and drier on crests.
   */
  // `colour` passes in what it has already worked out (the relief, the stream's edge, the slope);
  // each would otherwise be built again — 14 terrain evaluations per lawn vertex, 870 ms a world.
  moisture(x: number, z: number, relief = this.relief(x, z), edge = this.streamEdge(x, z)): number {
    const n = this.wet.noise(x * 0.045 + 4.2, z * 0.045 - 9.1) * 0.5 + this.wet.noise(x * 0.12, z * 0.12) * 0.15
    // The relief, not the elevation: the clearing's rim isn't a dry crest. Read from the
    // elevation, the rim halved the grass (1,977 → 1,021 at the opening view), left 111 of 685
    // ferns and 53 of 281 flowers, and turned its slopes olive and bare.
    const low = (0.5 - relief) * 0.9
    // And wetter toward the stream: ferns, grass and reeds read this, so the banks grow lush.
    const bank = Number.isFinite(edge) ? 0.45 * Math.exp(-((Math.max(0, edge) / 2.5) ** 2)) : 0
    return clamp01(0.5 + n + low + bank)
  }

  /**
   * 0–1. Fertility: moisture helps up to a point (waterlogged ground is
   * poorer), flat ground beats steep, and its own patchy noise.
   */
  fertility(x: number, z: number, m = this.moisture(x, z), slope = this.slope(x, z)): number {
    const water = 1 - Math.abs(m - 0.62) * 1.6
    const flat = 1 - slope
    const n = this.rich.noise(x * 0.07 - 3.3, z * 0.07 + 8.8) * 0.35
    return clamp01(0.15 + 0.45 * water + 0.25 * flat + n)
  }

  /**
   * How far the meadow reaches from the town in a direction (radians), units
   * from the centre: an irregular clearing, not a circle. Two octaves of
   * noise sampled round a circle (so it closes on itself) push the edge in and
   * out between about 12 and 24 units — groves reaching toward the town in
   * some directions, longer sightlines in others. Never nearer than 12: the
   * grid's corners are 10 from the centre, and trees keep 6 from the grid
   * anyway. (It was 15–31, mean 22: the meadow read as a park, the forest
   * as a far-off wall.)
   */
  clearingRadius(angle: number): number {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const n = this.woods.noise(c * 1.1 + 5.3, s * 1.1 - 2.7) * 0.7 + this.woods.noise(c * 2.6 - 8.1, s * 2.6 + 4.4) * 0.3
    return Math.max(12, 17.5 + n * 10)
  }

  /** Distance past the clearing's edge at a point: negative in the meadow. */
  pastEdge(x: number, z: number): number {
    return Math.hypot(x, z) - this.clearingRadius(Math.atan2(z, x))
  }

  /**
   * 0–1: how wooded the land is. Zero in the meadow; rising from 3 units
   * inside the clearing's edge to 8 past it; broken by a slow noise into groves and open
   * gaps; and filling in beyond 25 units out, so the far forest is a deep mass
   * rather than a row of trees.
   */
  forest(x: number, z: number): number {
    const past = this.pastEdge(x, z)
    if (past < -3) return 0
    // Over 11 units: at first 14, which left a ring of shrubs and only 2 trees in 1,500 near the edge.
    const edge = smooth(-3, 8, past)
    const patches = smooth(0.3, 0.72, 0.5 + this.woods.noise(x * 0.045 + 1.7, z * 0.045 - 6.2) * 0.8)
    const deep = smooth(14, 34, past)
    // Thicker up the landforms' slopes, so the ridge and the hill read as forested; thin along the valley.
    const raised = smooth(0.6, 0.85, this.elevation(x, z)) * 0.5
    return edge * Math.min(1, 0.15 + 0.85 * patches + 0.6 * deep + raised) * (1 - 0.85 * this.corridor(x, z))
  }

  /**
   * 0–1: a slow field that leans a stand toward conifers or broadleaves,
   * independent of the terrain — so conifer-led stands turn up in the low
   * ground too, and broadleaves up the ridge, rather than one per side.
   */
  standMix(x: number, z: number): number {
    return clamp01(0.5 + this.woods.noise(x * 0.035 + 40.3, z * 0.035 - 13.9) * 0.9)
  }

  /** 0–1: a slowly varying field that groups shrubs and rocks into clusters. */
  clustering(x: number, z: number, offset: number): number {
    return clamp01(0.5 + this.cluster.noise(x * 0.09 + offset, z * 0.09 - offset * 0.7) * 0.9)
  }

  /**
   * The ground's colour at a point, as linear-ish RGB 0–1: a muted grass
   * green moved toward a cooler green where it's wet, olive where it's dry,
   * a richer green where it's fertile, earth where it's poor and steep, and
   * moss in damp hollows. All blends, no thresholds.
   */
  colour(x: number, z: number, out: [number, number, number]): [number, number, number] {
    // Each field once, handed on to the ones built from it.
    const e = this.relief(x, z)
    const edge = this.streamEdge(x, z)
    const m = this.moisture(x, z, e, edge)
    const s = this.slope(x, z)
    const f = this.fertility(x, z, m, s)
    const woods = this.forest(x, z)
    let r = GRASS[0], g = GRASS[1], b = GRASS[2]
    const mix = (c: readonly number[], t: number) => {
      if (t <= 0) return
      r += (c[0] - r) * t
      g += (c[1] - g) * t
      b += (c[2] - b) * t
    }
    mix(DRY, smooth(0.45, 0.15, m) * 0.7)
    mix(DAMP, smooth(0.55, 0.85, m) * 0.5)
    mix(RICH, smooth(0.55, 0.85, f) * 0.45)
    mix(SOIL, smooth(0.35, 0.12, f) * 0.5 + s * 0.25)
    mix(MOSS, smooth(0.45, 0.3, e) * smooth(0.55, 0.8, m) * 0.55)
    // Under the trees the ground is a darker, browner forest floor, easing in with the woods.
    mix(FLOOR, woods * 0.55)
    // The meadow's patches: a lighter, yellower green where the grass grows tall, a deeper one
    // between — slight, so the open ground varies without looking spotted.
    const meadow = this.meadowPatch(x, z)
    const patch = meadow - 0.5
    mix(patch > 0 ? MEADOW_LIGHT : MEADOW_DEEP, Math.min(1, Math.abs(patch) * 0.8) * (1 - woods))
    // The stream's bed and banks. Under the water: sand in the shallows, a darker olive-brown
    // where it's deep, which shows through the translucent water as depth. At the edge: the lip's
    // exposed earth — strongest on a bend's outside, the cut bank, and the line that reads as a
    // bank from the opening view; pale gravel on a bend's inside and along stony reaches; then
    // damp, darker grass up the bank.
    if (Number.isFinite(edge) && edge < 6) {
      const ch = this.channelAt(x, z)
      if (ch) {
        if (ch.edge < 0) {
          mix(BED_SAND, 0.85)
          mix(BED_DEEP, ch.wet * 0.75)
        } else {
          const lip = 1 - smooth(0, 0.75, ch.edge)
          mix(EARTH, lip * (0.4 + 0.45 * ch.outer) * (1 - 0.8 * ch.inner))
          mix(GRAVEL, (1 - smooth(0.1, 1.4, ch.edge)) * Math.max(ch.inner, 0.75 * ch.rocky) * 0.7)
          mix(DAMP, Math.exp(-(((ch.edge - 1.3) / 1.3) ** 2)) * 0.35)
        }
      }
    }
    // A broad, slow shift in the green, so the open meadow isn't one colour.
    const broad = this.broadTone(x, z)
    mix(broad > 0 ? MEADOW_LIGHT : MEADOW_DEEP, Math.abs(broad) * 0.35 * (1 - woods))
    // The ground cover's patches, a deeper green under the clover, so a patch reads from afar.
    mix(CLOVER_DEEP, smooth(0.62, 0.82, this.groundCover(x, z)) * 0.3 * (1 - woods))
    // A few patches of bare soil out in the meadow.
    mix(SOIL_BARE, this.bareSoil(x, z) * 0.6)
    // A wash of the wildflowers' colour where they gather, each drift its own colour (`bloomHue`).
    const drift = this.flowerDrift(x, z, meadow, woods)
    if (drift > 0) mix(BLOOM_WASH[bloomHue(this.clustering(x, z, 113))], drift * 0.3)
    // Worn grass either side of a footpath, so the path's edge blends rather than being painted on.
    mix(WORN, this.onPath(x, z) * 0.5)
    out[0] = r
    out[1] = g
    out[2] = b
    return out
  }
}

// The palette: muted greens, sage, olive and earth, round the lawn's own #87a35c.
const hex = (h: string) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] as const
const GRASS = hex('#87a35c')
const DAMP = hex('#6c9462')
const DRY = hex('#a3a160')
const RICH = hex('#77a04c')
const SOIL = hex('#9e8f6d')
const MOSS = hex('#6b8a52')
const FLOOR = hex('#6c7a48')
const MEADOW_LIGHT = hex('#9aab62')
const MEADOW_DEEP = hex('#76955a')
const WORN = hex('#a29a6f')
const EARTH = hex('#7b6a4d')
const GRAVEL = hex('#b3aa92')
const BED_SAND = hex('#a3956f')
const BED_DEEP = hex('#5c5a3e')
const SOIL_BARE = hex('#9a8a68')
const CLOVER_DEEP = hex('#6a9150')
// The washes under each drift, one per flower colour (`FLOWER_COLOURS` in landscapeDecor):
// cream, lavender, pink, muted yellow, blue — pale, as the ground under many small flowers.
const BLOOM_WASH = [hex('#c8cc9a'), hex('#aaa8a6'), hex('#b9ad9a'), hex('#c6c26a'), hex('#9ea9a6')]

/**
 * Which of the five flower colours a drift is, from a slow field, so a drift is mostly one colour
 * and the next is another: cream, lavender, pink, muted yellow, and — rarely — blue.
 */
export function bloomHue(field: number): number {
  return field < 0.3 ? 0 : field < 0.5 ? 1 : field < 0.68 ? 2 : field < 0.9 ? 3 : 4
}

// --- where the decorations stand ---

export type Kind = 'grass' | 'shrub' | 'rock' | 'flower' | 'fern' | 'sapling' | 'stone' | 'reed' | 'litter' | 'clover'
export const KINDS: Kind[] = ['grass', 'shrub', 'rock', 'flower', 'fern', 'sapling', 'stone', 'reed', 'litter', 'clover']

/** One decoration: where, which way, how big, and a 0–1 hue pick for its colour. */
export type Placement = {
  x: number; y: number; z: number; rot: number; scale: number; stretch: number; tone: number
  /** A stone in the stream: its height scale (set so it rests in the bed and breaks the surface) and its waterline radius. */
  tall?: number
  ring?: number
}

type Rule = {
  /** Candidate spacing on a jittered grid, units. */
  step: number
  /** Most of them, at medium density. */
  cap: number
  /** Nearest any two may stand, units (0: no check). */
  spacing: number
  /** No closer to the grid than this, and how far out they reach. */
  from: number
  to: number
  /** 0–1: how much to grow at a point. */
  suit: (L: Landscape, x: number, z: number, out: number) => number
  /**
   * Where to try, if not a jittered grid over the whole land: reeds are tried along the
   * stream, nearest the clearing first — scanning the land at their 0.4 spacing would be
   * 700,000 candidates for a strip a few units wide.
   */
  candidates?: (L: Landscape, rand: () => number) => [number, number][]
  /** Size, by how far out it is (and, for the meadow's tall patches, where). */
  size: (out: number, r: number, L: Landscape, x: number, z: number) => number
}

/** Fewer near the town, ramping up from the quiet margin over `over` units. */
const near = (out: number, from: number, over: number) => smooth(from, from + over, out)

const RULES: Record<Kind, Rule> = {
  // Grass loves fertile ground, thins on steep slopes, and is sparse by the town.
  grass: {
    step: 0.85,
    cap: 6500,
    spacing: 0,
    from: QUIET,
    to: 48,
    // In patches — a meadow's clumps — rather than evenly: spread evenly they read as scattered weeds.
    suit: (L, x, z, out) => {
      const ramp = near(out, QUIET, 5)
      if (ramp <= 0) return 0
      const patchy = Math.max(smooth(0.4, 0.68, L.clustering(x, z, 11)), 0.8 * smooth(0.6, 0.8, L.meadowPatch(x, z)))
      if (patchy <= 0) return 0
      const slope = L.slope(x, z)
      return ramp * patchy * smooth(0.25, 0.7, L.fertility(x, z, undefined, slope)) * (1 - 0.6 * slope) * (1 - 0.7 * L.forest(x, z))
    },
    // Taller in the meadow's patches — up to about 1.7× — but only from 5 units off the grid,
    // so nothing near the buildings stands high enough to hide a planting or an inhabitant.
    size: (out, r, L, x, z) => (0.8 + 0.6 * r) * (1 + 0.3 * smooth(10, 40, out)) * (1 + 0.7 * smooth(0.55, 0.85, L.meadowPatch(x, z)) * smooth(5, 9, out)),
  },
  // Shrubs mark the meadow's edge — thickest in a band either side of where the
  // woods begin — with a few loose clumps out in the meadow, none near the town.
  shrub: {
    step: 1.2,
    // Fewer than before (420): ferns and saplings now share the edge, and many alike shrubs made a pattern.
    cap: 300,
    spacing: 1.1,
    from: 7,
    to: 70,
    suit: (L, x, z, out) => {
      const past = L.pastEdge(x, z)
      const band = Math.exp(-(((past - 1) / 5) ** 2))
      const meadow = past < 0 ? 0.25 * smooth(0.55, 0.75, L.clustering(x, z, 0)) : 0
      return near(out, 7, 6) * Math.min(1, band * (0.4 + 0.6 * L.clustering(x, z, 0)) + meadow) * smooth(0.15, 0.5, L.fertility(x, z))
    },
    size: (out, r) => (0.55 + 0.45 * r) * (1 + 0.4 * smooth(12, 50, out)),
  },
  // Ferns: the low layer under the forest's edge and into its shade, in irregular drifts.
  fern: {
    step: 0.9,
    cap: 900,
    spacing: 0,
    from: 9,
    to: 75,
    suit: (L, x, z, out) => {
      const past = L.pastEdge(x, z)
      const shade = smooth(-4, 3, past) * (1 - smooth(14, 26, past))
      // And on the stream's lush banks, a unit or two up from the water.
      const c = Number.isFinite(L.streamEdge(x, z)) ? L.channelAt(x, z) : null
      const bank = c ? c.lush * Math.exp(-(((c.edge - 1.4) / 1.1) ** 2)) : 0
      return near(out, 9, 4) * Math.max(shade * smooth(0.45, 0.7, L.clustering(x, z, 63)), 0.9 * bank) * smooth(0.3, 0.6, L.moisture(x, z))
    },
    size: (_out, r) => 0.75 + 0.6 * r,
  },
  // Saplings: young trees a little ahead of the forest, the edge advancing into the meadow.
  sapling: {
    step: 1.6,
    cap: 220,
    spacing: 1.0,
    from: 10,
    to: 70,
    suit: (L, x, z, out) => {
      const past = L.pastEdge(x, z)
      // A wider band than at first (±4 round 1 unit inside the edge; 45–79 placed), from the
      // meadow's margin well into the young trees: a gradual edge, not a line.
      return near(out, 10, 4) * Math.exp(-(((past - 1) / 6.5) ** 2)) * smooth(0.42, 0.66, L.clustering(x, z, 77)) * (1 - L.corridor(x, z))
    },
    size: (_out, r) => 0.7 + 0.6 * r,
  },
  // Rocks prefer dry, poor and steep ground, in their own clusters.
  rock: {
    step: 1.5,
    cap: 200,
    spacing: 0.7,
    from: 4,
    to: 85,
    suit: (L, x, z, out) => {
      const poor = 1 - L.fertility(x, z)
      const dry = 1 - L.moisture(x, z)
      return near(out, 4, 6) * smooth(0.62, 0.8, L.clustering(x, z, 23)) * smooth(0.3, 0.75, 0.5 * poor + 0.3 * dry + 0.4 * L.slope(x, z))
    },
    // Growing much with distance made the far ones big grey blobs; a little reads as scale.
    size: (out, r) => (0.12 + 0.22 * r * r) * (1 + 0.5 * smooth(10, 45, out)),
  },
  // Reeds: in clumps right along the water's edge, from just in it to a unit up the bank — never
  // a continuous hedge, so the water shows between them.
  reed: {
    step: 0.4,
    cap: 380,
    spacing: 0,
    from: 6,
    to: 160,
    // Thick in the lush reaches, a few in the rest, and fewer on a bend's outside (the cut bank)
    // than its inside, where the shallows are: some stretches reedy, some stony, some open.
    suit: (L, x, z) => {
      const c = L.channelAt(x, z)
      if (!c) return 0
      const e = c.edge
      return Math.exp(-(((e - 0.35) / 0.55) ** 2)) * smooth(0.45, 0.65, L.clustering(x, z, 151)) * (0.12 + 0.88 * c.lush) * (1 - 0.6 * c.outer)
    },
    // About knee- to waist-high on a person against a storey: 0.4–0.8.
    size: (_out, r) => 0.55 + 0.35 * r,
    candidates: (L, rand) => {
      const st = L.stream
      const out: [number, number, number][] = []
      for (let i = 1; i + 1 < st.x.length; i++) {
        const tx = st.x[i + 1] - st.x[i - 1], tz = st.z[i + 1] - st.z[i - 1]
        const len = Math.hypot(tx, tz) || 1
        for (let k = 0; k < 4; k++) {
          const side = rand() < 0.5 ? -1 : 1
          const o = side * (st.half[i] + rand() * 1.6 - 0.25)
          const along = (rand() - 0.5) * 0.6
          const x = st.x[i] + (-tz / len) * o + (tx / len) * along
          const z = st.z[i] + (tx / len) * o + (tz / len) * along
          out.push([x, z, Math.hypot(x, z) + rand() * 10])
        }
      }
      return out.sort((a, b) => a[2] - b[2]).map(([x, z]) => [x, z])
    },
  },
  // Fallen leaves: drifts along the paths' edges, on the stream's banks and at the forest's
  // edge — where leaves gather. Drawn only in autumn (their size follows the season), so the
  // places are fixed and only their showing changes.
  litter: {
    step: 0.6,
    cap: 650,
    spacing: 0,
    from: 4,
    to: 40,
    suit: (L, x, z) => {
      const path = L.pathEdge(x, z)
      const bank = L.streamEdge(x, z)
      const byPath = Number.isFinite(path) ? Math.exp(-(((path - 0.1) / 0.6) ** 2)) : 0
      const byWater = Number.isFinite(bank) ? Math.exp(-(((bank - 0.8) / 0.9) ** 2)) : 0
      const edge = Math.exp(-((L.pastEdge(x, z) / 3) ** 2)) * 0.5
      return Math.min(1, byPath + byWater + edge) * smooth(0.35, 0.6, L.clustering(x, z, 171))
    },
    size: (_out, r) => 0.7 + 0.6 * r,
  },
  // Low ground cover — clover and creeping weeds, a few centimetres high — in irregular patches,
  // richer out in the meadow. Low enough to lie on the town's lawn too, sparser there and only in
  // its patches' hearts, outside the protected ground round the buildings.
  clover: {
    // Close together in their patches and nowhere else: spread thinner, with the patches' edges
    // softer, they read as separate dots across the whole meadow.
    step: 0.32,
    cap: 1600,
    spacing: 0,
    from: 0,
    to: 22,
    suit: (L, x, z, out) => {
      const patch = L.groundCover(x, z)
      if (patch < 0.66) return 0
      if (out < 0.01) return 0.75 * smooth(0.74, 0.86, patch)
      return smooth(0.66, 0.8, patch) * (1 - L.forest(x, z))
    },
    size: (_out, r) => 0.8 + 0.5 * r,
  },
  // Small stones: a few groups in the meadow, more just beside the footpaths, where walking
  // turned them up. Low — 0.1–0.2 high — so they never hide anything.
  stone: {
    step: 0.7,
    cap: 140,
    spacing: 0.35,
    from: 4,
    to: 35,
    suit: (L, x, z, out) => {
      const edge = L.pathEdge(x, z)
      const beside = Number.isFinite(edge) ? Math.exp(-(((edge - 0.45) / 0.5) ** 2)) : 0
      // And at the water's edge, where the current has washed them clean.
      // At the water's edge mostly in the stony reaches, and on a bend's inside, the gravel bar.
      const c = L.channelAt(x, z)
      const shore = c ? Math.exp(-(((c.edge - 0.1) / 0.45) ** 2)) * (0.1 + 1.4 * c.rocky + 0.6 * c.inner) : 0
      return near(out, 4, 3) * smooth(0.68, 0.85, L.clustering(x, z, 131)) * (0.35 + 1.4 * beside + 1.6 * shore) * (1 - 0.8 * L.forest(x, z))
    },
    size: (_out, r) => 0.1 + 0.12 * r,
  },
  // Flowers: sparse accents on fertile, moderately moist ground, and wildflower clusters in the
  // meadow's patches — gathered, not sprinkled.
  flower: {
    // Candidates every 0.5 (was 1.1), so a cluster can be a clump; the scattered accents'
    // odds are cut by the same factor, (0.5 / 1.1)² ≈ 0.2, so they stay as sparse as they were.
    step: 0.5,
    cap: 700,
    spacing: 0,
    from: 0,
    to: 40,
    suit: (L, x, z, out) => {
      // The cheap terms first: at a 0.5 step this rule sees 30,000 candidates.
      // On the town's lawn only in the hearts of the strongest drifts, as clumps — never singly, which
      // read as a sprinkle of dots between the buildings. Out in the meadow, as before.
      if (out < 2) {
        const drift = L.flowerDrift(x, z, undefined, 0)
        return drift > 0.55 ? 0.8 * drift : 0
      }
      const ramp = near(out, 2, 7)
      const woods = L.forest(x, z)
      if (woods >= 1) return 0
      const clusters = 0.7 * L.flowerDrift(x, z, undefined, woods)
      // The accents never exceed 0.14: where a drift is stronger, they needn't be worked out.
      let accents = 0
      if (clusters < 0.14) {
        const m = L.moisture(x, z)
        accents = smooth(0.5, 0.75, L.fertility(x, z, m)) * (1 - Math.abs(m - 0.55) * 1.6) * smooth(0.5, 0.7, L.clustering(x, z, 47)) * 0.7 * 0.2
      }
      return ramp * Math.max(accents, clusters) * (1 - woods)
    },
    size: (_out, r) => 0.9 + 0.5 * r,
  },
}

/** How many of each kind stand at a density, at most. */
export function capOf(kind: Kind, density: Density): number {
  return Math.round(RULES[kind].cap * DENSITY_SCALE[density])
}

/**
 * Where every decoration of a kind stands: a jittered grid of candidates over
 * the land, each kept with probability suitability × density, with a minimum
 * spacing for the larger kinds, up to the cap. The candidates are visited in a
 * seeded order, so the cap doesn't crowd one side of the map. Deterministic:
 * the same seed and density give the same placements.
 */
export function scatter(L: Landscape, kind: Kind, density: Density): Placement[] {
  const rule = RULES[kind]
  const k = DENSITY_SCALE[density]
  const cap = capOf(kind, density)
  const rand = mulberry32(L.seed * 104729 + KINDS.indexOf(kind) * 7907 + 1)
  const extent = W / 2 + rule.to
  const n = Math.ceil((2 * extent) / rule.step)
  const order = Array.from({ length: n * n }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const out: Placement[] = []
  if (rule.candidates) {
    for (const [x, z] of rule.candidates(L, rand)) {
      if (out.length >= cap) break
      const o = outside(x, z)
      if (o < rule.from || o > rule.to) continue
      if (rand() > rule.suit(L, x, z, o) * k * (1 - L.onPath(x, z))) continue
      out.push({ x, y: L.height(x, z), z, rot: rand() * Math.PI * 2, scale: rule.size(o, rand(), L, x, z), stretch: 0.8 + 0.4 * rand(), tone: rand() })
    }
    return out
  }
  const cell = Math.max(rule.spacing, 1e-6)
  const grid = new Map<string, Placement[]>()
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`
  for (const idx of order) {
    if (out.length >= cap) break
    const i = idx % n
    const j = Math.floor(idx / n)
    const x = -extent + (i + rand()) * rule.step
    const z = -extent + (j + rand()) * rule.step
    const o = outside(x, z)
    if (o < rule.from || o > rule.to) continue
    // Nothing stands in the gap between the buildings or close round them.
    if (o < 3 && inProtected(x, z)) continue
    // Nothing grows on a footpath, or in the water (but reeds, which stand at its edge).
    const wet = kind === 'reed' ? 1 : smooth(0.1, 0.5, L.streamEdge(x, z))
    const p = rule.suit(L, x, z, o) * k * (1 - L.onPath(x, z)) * wet
    if (rand() > p) continue
    if (rule.spacing > 0) {
      const gx = Math.floor(x / cell)
      const gz = Math.floor(z / cell)
      let clash = false
      for (let dx = -1; dx <= 1 && !clash; dx++)
        for (let dz = -1; dz <= 1 && !clash; dz++)
          for (const q of grid.get(`${gx + dx},${gz + dz}`) ?? []) if ((q.x - x) ** 2 + (q.z - z) ** 2 < rule.spacing ** 2) clash = true
      if (clash) continue
    }
    const r = rand()
    const place: Placement = { x, y: L.height(x, z), z, rot: rand() * Math.PI * 2, scale: rule.size(o, r, L, x, z), stretch: 0.8 + 0.4 * rand(), tone: rand() }
    out.push(place)
    if (rule.spacing > 0) {
      const kk = key(x, z)
      const list = grid.get(kk)
      if (list) list.push(place)
      else grid.set(kk, [place])
    }
  }
  return out
}

// --- the forest ---

/** One tree: where, how big, which way it leans, which crown. */
export type Tree = {
  x: number
  y: number
  z: number
  rot: number
  scale: number
  girth: number
  leanX: number
  leanZ: number
  variant: number
  tone: number
  /** The crown's own proportions: wider one way than the other, taller or squatter — so no two crowns of a family match. */
  crownX: number
  crownY: number
  crownZ: number
}

/**
 * Six tree families, each its own silhouette:
 * - **broad**: a rounded deciduous canopy;
 * - **slender**: a light, open young deciduous tree on a pale trunk;
 * - **weeping**: a dome with a hanging curtain — a rare accent;
 * - **fir**: a shorter, broader conifer in ragged tiers;
 * - **spire**: a tall, narrow conifer;
 * - **crooked**: a leaning tree with a bent trunk and flat pads of foliage — an accent.
 */
export const TREE_VARIANTS = 6
export const BROAD = 0
export const SLENDER = 1
export const WEEPING = 2
/** The shorter, broader conifer (the original evergreen). */
export const EVERGREEN = 3
export const FIR = EVERGREEN
export const SPIRE = 4
export const CROOKED = 5
/** Families that keep their green through the year (the seasons tint only the others). */
export const isEvergreen = (variant: number) => variant === FIR || variant === SPIRE || variant === CROOKED

const TREE_CAP: Record<Density, number> = { low: 1300, medium: 2600, high: 3900 }
/** Trees reach this far from the centre: well into the haze, so the forest doesn't end where you can see it. */
const FOREST_REACH = 140

/**
 * The forest: groves, not a ring. A jittered grid of possible grove centres
 * (every 8 units) over the land past the clearing, visited nearest-first;
 * each becomes a grove with probability set by the forest field.
 *
 * **Mixed stands.** A grove has a *leading* family and companions. The leader
 * is drawn, not decided: conifer-led stands are likelier on high, steep ground
 * (spires highest) but possible anywhere, and a slow `standMix` field moves
 * them about, so no side of the clearing is all one kind. 50–85% of a grove
 * follow its leader; the rest are its companions (firs and broadleaves among
 * spires, conifers and young slender trees among broadleaves). The first
 * version gave each grove its family from the terrain and 88% of its trees
 * followed it: the ridge side was 76–86% conifers and the east 0%.
 *
 * **Habit.** Some groves are tight (many trees close together), some loose
 * (a few, spread wide); with the forest field's gaps that makes dense
 * clumps, open groups and clearings rather than an even spread.
 *
 * **The edge.** Trees are young (small) at the clearing's edge and mature over
 * 20 units, so the forest rises gradually; loose groups of young trees stand
 * just ahead of it, and a few accents — a weeping tree, a crooked one, a big
 * broadleaf — stand out in the meadow's margin. Seeded: the same land grows
 * the same forest.
 */
export function scatterTrees(L: Landscape, density: Density): Tree[] {
  const rand = mulberry32(L.seed * 15485863 + 77)
  const accents = clearingAccents(L)
  const cap = TREE_CAP[density]
  const k = DENSITY_SCALE[density]
  const trees: Tree[] = []
  const grid = new Map<string, Tree[]>()
  // Trunks 1.3 apart (was 1.5): the trees are smaller, and a tight grove should look tight.
  const SPACING = 1.3
  const key = (x: number, z: number) => `${Math.floor(x / SPACING)},${Math.floor(z / SPACING)}`
  const damp = (x: number, z: number) => smooth(0.55, 0.8, L.moisture(x, z)) * smooth(0.45, 0.3, L.relief(x, z))
  /** A grove's leading family. */
  const leaderAt = (x: number, z: number): number => {
    // The relief, not the elevation: the clearing's rim is high all round, and would make every edge stand conifers.
    const high = Math.min(1, smooth(0.55, 0.85, L.relief(x, z)) + 0.4 * L.slope(x, z))
    const pConifer = Math.min(0.72, Math.max(0.15, 0.25 + 0.35 * high + 0.5 * (L.standMix(x, z) - 0.5)))
    if (rand() < pConifer) return rand() < 0.3 + 0.45 * high ? SPIRE : FIR
    if (rand() < 0.08 * damp(x, z)) return WEEPING
    if (L.pastEdge(x, z) < 6 && rand() < 0.5) return SLENDER
    return BROAD
  }
  /** A companion in a grove led by `leader`. */
  const companionOf = (leader: number, x: number, z: number): number => {
    const r = rand()
    if (leader === SPIRE) return r < 0.4 ? FIR : r < 0.8 ? BROAD : SLENDER
    if (leader === FIR) return r < 0.3 ? SPIRE : r < 0.75 ? BROAD : SLENDER
    if (leader === SLENDER) return r < 0.5 ? BROAD : r < 0.8 ? FIR : SPIRE
    if (leader === WEEPING) return r < 0.6 ? BROAD : SLENDER
    // Among broadleaves: conifers, young slender trees, now and then a crooked one or (if damp) a weeping one.
    return r < 0.3 ? FIR : r < 0.5 ? SPIRE : r < 0.88 ? SLENDER : r < 0.94 && damp(x, z) > 0.3 ? WEEPING : r < 0.96 ? CROOKED : BROAD
  }
  let leader = BROAD
  let share = 0.7
  let forced = -1
  let accent = false
  const tryTree = (x: number, z: number, young = 0) => {
    if (trees.length >= cap) return null
    if (outside(x, z) < 6 || Math.hypot(x, z) > FOREST_REACH) return null
    const f = L.forest(x, z)
    if (f < 0.05 && !accent && !young) return null
    // Trunks keep a unit off a footpath's edge, so it runs through the woods in a gap, and
    // a little more off the water's.
    if (L.pathEdge(x, z) < 1 || L.streamEdge(x, z) < 1.3) return null
    // And room round the clearing's accents, so each stands on its own.
    if (accents.some((a) => Math.hypot(a.x - x, a.z - z) < 2.2)) return null
    const gx = Math.floor(x / SPACING)
    const gz = Math.floor(z / SPACING)
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const t of grid.get(`${gx + dx},${gz + dz}`) ?? []) if ((t.x - x) ** 2 + (t.z - z) ** 2 < SPACING * SPACING) return null
    const past = L.pastEdge(x, z)
    // Mature over 20 units past the edge (was 15), so the forest rises gradually from the meadow.
    const maturity = young ? 0 : smooth(-2, 18, past)
    const variant = forced >= 0 ? forced : rand() < share ? leader : companionOf(leader, x, z)
    const crooked = variant === CROOKED
    const tree: Tree = {
      x,
      y: L.height(x, z),
      z,
      rot: rand() * Math.PI * 2,
      // Smaller than before (0.55 + 0.6m, up to 1.4): a mature broadleaf now stands about as tall
      // as the three-storey building (~2.8 units); only spires top it (~4.5–5; the old evergreens
      // reached 5.5). Not from 0.5: edge trees that small read as dots beside the buildings.
      scale: young ? young * (0.85 + 0.3 * rand()) : (0.6 + 0.4 * maturity) * (0.85 + 0.3 * rand()),
      girth: 0.8 + 0.5 * rand(),
      // Crooked trees lean hard, one way; the rest only a little.
      leanX: crooked ? 0.12 + 0.12 * rand() : (rand() - 0.5) * 0.12,
      leanZ: (rand() - 0.5) * (crooked ? 0.2 : 0.12),
      variant,
      tone: rand(),
      // Firs are broad and short, spires narrow; every crown its own proportions.
      crownX: variant === FIR ? 1.0 + 0.35 * rand() : variant === SPIRE ? 0.8 + 0.2 * rand() : 0.8 + 0.45 * rand(),
      // A slender tree's crown must meet its trunk, so it varies least.
      crownY: variant === FIR ? 0.75 + 0.3 * rand() : variant === SPIRE ? 0.95 + 0.35 * rand() : variant === SLENDER ? 0.96 + 0.08 * rand() : 0.85 + 0.3 * rand(),
      crownZ: variant === FIR ? 1.0 + 0.35 * rand() : variant === SPIRE ? 0.8 + 0.2 * rand() : 0.8 + 0.45 * rand(),
    }
    trees.push(tree)
    const kk = key(x, z)
    const list = grid.get(kk)
    if (list) list.push(tree)
    else grid.set(kk, [tree])
    return tree
  }
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * Math.cos(2 * Math.PI * rand())
  // The edge first: loose groups of two to four young trees just ahead of the forest and
  // into its margin — the middle layer between the shrubs and the mature trees. Placed
  // before the groves so the budget can't be spent before them.
  // 70 groups spread ±5 units either side of the edge speckled the meadow like a scatter; 34,
  // from 1 inside to 5 past it, read as groups.
  for (let i = 0; i < 34 * k; i++) {
    const a = rand() * Math.PI * 2
    const r = L.clearingRadius(a) - 1 + rand() * 6
    const cx = Math.cos(a) * r
    const cz = Math.sin(a) * r
    if (L.corridor(cx, cz) > 0.4) continue
    const n = 3 + Math.floor(rand() * 3)
    for (let j = 0; j < n; j++) {
      const q = rand()
      forced = q < 0.45 ? SLENDER : q < 0.7 ? FIR : q < 0.8 ? SPIRE : BROAD
      tryTree(cx + gauss() * 1.5, cz + gauss() * 1.5, 0.5 + 0.25 * rand())
    }
  }
  forced = -1
  // A few accents standing out in the meadow's margin, given room: a weeping tree, a crooked
  // one, a big broadleaf. Placed even where the forest field is thin: that's what makes them lone.
  for (let i = 0, placed = 0; i < 80 && placed < 7; i++) {
    const a = rand() * Math.PI * 2
    const r = L.clearingRadius(a) - 2 + rand() * 4
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (outside(x, z) < 8 || L.corridor(x, z) > 0.3) continue
    const q = rand()
    // Weeping trees less often: alone and large in the open, the curtain read as a barrel.
    forced = q < 0.45 ? CROOKED : q < 0.6 ? WEEPING : BROAD
    accent = true
    const t = tryTree(x, z)
    accent = false
    if (t) {
      t.scale = 1.0 + 0.25 * rand()
      placed++
    }
  }
  forced = -1
  // Grove centres nearest first (with a little jitter, so rings don't show): the tree budget
  // fills the forest you see before the far forest. Visited in a random order, the far land —
  // most of the area once the forest reached 140 units — took 2,173 of 2,600 trees and left 6
  // at the clearing's edge.
  const STEP = 8
  const N = Math.ceil((2 * FOREST_REACH) / STEP)
  const centreDist = (i: number) => Math.hypot(-FOREST_REACH + ((i % N) + 0.5) * STEP, -FOREST_REACH + (Math.floor(i / N) + 0.5) * STEP)
  const order = Array.from({ length: N * N }, (_, i) => i)
    .map((i) => ({ i, d: centreDist(i) + rand() * 14 }))
    .sort((p, q) => p.d - q.d)
    .map((o) => o.i)
  for (const idx of order) {
    const cx = -FOREST_REACH + ((idx % N) + rand()) * STEP
    const cz = -FOREST_REACH + (Math.floor(idx / N) + rand()) * STEP
    const f = L.forest(cx, cz)
    if (rand() > Math.min(1, f * 1.4 * k)) continue
    leader = leaderAt(cx, cz)
    share = 0.5 + 0.35 * rand()
    // Tight or loose: a dense clump of many trees, or a few spread a little wider. Loose groves
    // spread 3.5–6.5 scattered trees evenly over the edge; tight ones are the commoner now.
    const tight = rand() < 0.6
    const count = tight ? 5 + Math.round(9 * f * (0.5 + rand())) : 3 + Math.round(4 * f * (0.5 + rand()))
    const spread = tight ? 1.5 + 1.3 * f : 3 + 1.5 * f
    for (let t = 0; t < count; t++) tryTree(cx + gauss() * spread, cz + gauss() * spread)
  }
  return trees
}

// --- the stream ---

/** How far the stream's banks reach past its water where it isn't cut in, units. */
const BANK = 2.8
/** How far below its ground the water stands, before any cutting through humps. */
const FREEBOARD = 0.24

/**
 * The stream's shape along its line: width, its bends and pools, and the banks' character.
 *
 * - **Width** from slow noise and a quicker one, narrower at base than before (0.55–0.8 against
 *   0.5–0.94: the old width hardly varied), widening by up to half again round a bend.
 * - **Pools**: the three sharpest bends past the spring, at least 16 units apart, widen to about
 *   1.8× over a few units and deepen.
 * - **Skew**: the inside of a bend is wider and shallow (where a gravel bar builds); the outside
 *   is the cut bank. Up to ±0.3 of the half-width.
 * - **Character**: two slow fields along the stream, stony and lush, so some reaches are rocky,
 *   some reedy, and some open.
 * - **Pace**: quicker where it narrows (0.75 / half-width, held to 0.6–1.6), and the phase that
 *   lets the shader move its pattern with it.
 */
function streamShape(line: { x: number[]; z: number[]; s: number[] }, seed: number) {
  const n = new Perlin(seed * 7727 + 5)
  const N = line.x.length
  // Signed bend: the turn between neighbouring directions per unit, smoothed over ±5 points.
  const turn = line.x.map((_, i) => {
    if (i === 0 || i === N - 1) return 0
    const ax = line.x[i] - line.x[i - 1], az = line.z[i] - line.z[i - 1]
    const bx = line.x[i + 1] - line.x[i], bz = line.z[i + 1] - line.z[i]
    return Math.atan2(ax * bz - az * bx, ax * bx + az * bz) / 0.6
  })
  const curve = turn.map((_, i) => {
    let sum = 0, w = 0
    for (let j = Math.max(0, i - 5); j <= Math.min(N - 1, i + 5); j++) {
      sum += turn[j]
      w++
    }
    return sum / w
  })
  // Pools at the three sharpest bends from 10 to 110 units down, at least 16 apart.
  const pools: number[] = []
  const byBend = line.s.map((s, i) => ({ s, k: Math.abs(curve[i]) })).filter((p) => p.s > 10 && p.s < 110).sort((a, b) => b.k - a.k)
  for (const p of byBend) {
    if (pools.length >= 3) break
    if (pools.every((q) => Math.abs(q - p.s) > 16)) pools.push(p.s)
  }
  const poolAt = (s: number) => pools.reduce((m, q) => Math.max(m, Math.exp(-(((s - q) / 3.5) ** 2))), 0)
  // The water's own "left" in a turn: a positive turn bends left, its inside is the left bank.
  // (The sign of `turn` and LineIndex's `side` are the same cross product.)
  const half = line.s.map((s, i) => {
    const base = 0.55 + 0.25 * (0.5 + n.noise(s * 0.05, 8.8)) + 0.07 * n.noise(s * 0.21, 1.3)
    const bendy = 1 + 0.5 * smooth(0.02, 0.1, Math.abs(curve[i]))
    return base * bendy * (1 + 0.8 * poolAt(s)) * (0.25 + 0.75 * smooth(0, 10, s)) * (1 + 0.25 * smooth(30, 120, s))
  })
  const skew = curve.map((k) => Math.max(-0.3, Math.min(0.3, k * 3)))
  const bend = curve.map((k) => Math.max(-1, Math.min(1, k / 0.08)))
  const deep = line.s.map((s) => 1 + 0.7 * poolAt(s))
  const rocky = line.s.map((s) => smooth(0.5, 0.72, 0.5 + n.noise(s * 0.045, 4.2)))
  const lush = line.s.map((s, i) => smooth(0.45, 0.68, 0.5 + n.noise(s * 0.05, 7.7)) * (1 - 0.6 * rocky[i]))
  const pace = half.map((h) => Math.max(0.6, Math.min(1.6, 0.75 / h)))
  const phase: number[] = [0]
  for (let i = 1; i < N; i++) phase.push(phase[i - 1] + (line.s[i] - line.s[i - 1]) / ((pace[i] + pace[i - 1]) / 2))
  return { half, skew, bend, deep, rocky, lush, pace, phase }
}

/** The radius toward a bearing at which a point is `gap` units off the grid. */
function offGrid(bearing: number, gap: number): number {
  let lo = 4, hi = 80
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2
    const [x, z] = atBearing(bearing, mid)
    if (outside(x, z) >= gap) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * The stream: from a spring on the ridge's wooded slope north-west of the
 * clearing, down to its north margin, along the ridge's foot, and out through
 * the open valley to the north-north-east — the clearing is a hollow, and the
 * valley is where it drains.
 *
 * Laid out in three runs by bearing — down from the spring, along the margin
 * (10–12.5 units off the grid, so its banks never reach the town's ground),
 * out along the valley to 155 units, into the haze — then given a meander by
 * noise across the line, and, on the hillside and in the valley, settled
 * sideways into the lowest ground within three units (smoothed along the line,
 * so it can't zigzag). Corners rounded, and resampled every 0.6.
 *
 * The water's surface never rises downstream: each point's level is the lowest
 * of the last one's, its own ground less 24 cm, and (by at most 0.35 more) the
 * ground either side. Where the ground humps above that, the channel is cut
 * through, its banks widened with the cut. Its shape along the line — width,
 * pools, bends, the banks' character, its pace — is `streamShape`.
 * Eight spring bearings are tried, and the one that needs the least cutting —
 * that never comes back within reach of its own banks, and doesn't run across
 * a hillside too near the town for the bank it would need — is kept.
 */
function planStream(L: Landscape): Line {
  const rand = mulberry32(L.seed * 7727 + 3)
  const n = new Perlin(L.seed * 7727 + 4)
  // Bearings run on past a full turn (2π + …) so the margin run can cross north without wrapping.
  const valley = Math.PI * 2 + 0.3
  // Off the margin at 7°, and round to the valley's 17° as it leaves: leaving further round,
  // at 45°, it crossed the rim where it is still high, and its channel was cut 2.4 units deep.
  const bOut = Math.PI * 2 + 0.12
  // 10–12.5 units off the grid: closer, its banks were squeezed between the water and the town's
  // flat ground on the hollow's slope (at 7–9.5 they ran to 1 in 1.6; at 9–11.5, under the ridge,
  // to 0.64).
  const margin = (b: number) => offGrid(b, 10 + 2.5 * (0.5 + n.noise(b * 2.3, 1.7)))
  const build = (bIn: number) => {
    const xs: number[] = []
    const zs: number[] = []
    const run: number[] = []
    const push = (b: number, r: number, phase: number) => {
      const [x, z] = atBearing(b, r)
      xs.push(x)
      zs.push(z)
      run.push(phase)
    }
    const bTurn = bIn + 0.35
    const rSpring = edgeToward(L, bIn) + 10
    for (let t = 0; t < 1; t += 1 / 14) push(bIn + (bTurn - bIn) * t, rSpring + (margin(bTurn) - rSpring) * smooth(0, 1, t), 0)
    for (let b = bTurn; b < bOut; b += 0.05) push(b, margin(b), 1)
    // Out along the valley: points close together at first (u²) and the radius rising slowly,
    // so it bends out of the margin rather than turning a corner — spaced evenly, the first
    // step was 3.4 units and the turn showed as a V from above.
    for (let k = 1; k <= 48; k++) {
      const u = k / 48
      const t = u * u
      push(bOut + (valley - bOut) * smooth(0, 0.45, t), margin(bOut) + (155 - margin(bOut)) * t ** 1.15, 2)
    }
    // Meander: a slow wander across the line, smaller along the margin, where there's less room;
    // on the hillside and down the valley, drawn toward the low ground within three units.
    const offsets = xs.map((_, i) => {
      if (i === 0 || i + 1 === xs.length) return 0
      const tx = xs[i + 1] - xs[i - 1], tz = zs[i + 1] - zs[i - 1]
      const len = Math.hypot(tx, tz) || 1
      let o = n.noise(i * 0.31, 4.4) * (run[i] === 1 ? 1.0 : 2.4)
      if (run[i] !== 1) {
        let best = Infinity
        const centre = o
        for (let k = -6; k <= 6; k++) {
          const q = centre + k * 0.5
          const h = L.baseHeight(xs[i] + (-tz / len) * q, zs[i] + (tx / len) * q) + 0.03 * q * q
          if (h < best) {
            best = h
            o = q
          }
        }
      }
      return o
    })
    // Smoothed along the line before they're applied: chosen point by point, neighbouring
    // offsets jumped by units, and the line zigzagged into loops near the spring.
    const smoothed = offsets.map((_, i) => {
      let sum = 0, w = 0
      for (let j = Math.max(0, i - 3); j <= Math.min(offsets.length - 1, i + 3); j++) {
        sum += offsets[j]
        w++
      }
      return sum / w
    })
    const bx = xs.slice(), bz = zs.slice()
    for (let i = 1; i + 1 < xs.length; i++) {
      const tx = bx[i + 1] - bx[i - 1], tz = bz[i + 1] - bz[i - 1]
      const len = Math.hypot(tx, tz) || 1
      xs[i] += (-tz / len) * smoothed[i]
      zs[i] += (tx / len) * smoothed[i]
    }
    // Evened out over about ±4 units before the corners are rounded: Chaikin only rounds a corner
    // within a point or two, and where the margin turns into the valley the line still made a V.
    const even = resample(xs, zs, 1)
    let sx = even.x, sz = even.z
    for (let pass = 0; pass < 3; pass++) {
      const nx = sx.slice(), nz = sz.slice()
      for (let i = 1; i + 1 < sx.length; i++) {
        let ax = 0, az = 0, w = 0
        for (let j = Math.max(0, i - 4); j <= Math.min(sx.length - 1, i + 4); j++) {
          ax += sx[j]
          az += sz[j]
          w++
        }
        nx[i] = ax / w
        nz[i] = az / w
      }
      sx = nx
      sz = nz
    }
    keepOffGrid(sx, sz, 9.5)
    const [cx, cz] = chaikin(sx, sz, 2)
    keepOffGrid(cx, cz, 9.5)
    const line = resample(cx, cz, 0.6)
    const shape = streamShape(line, L.seed)
    const half = shape.half
    const level: number[] = []
    const bank: number[] = []
    let cut = 0
    // How much bank the route wanted and had no room for: a side-hill run near the town.
    let squeeze = 0
    for (let i = 0; i < line.x.length; i++) {
      const g = L.baseHeight(line.x[i], line.z[i])
      // Below the ground either side too, a little way out from each edge: set by its centre
      // alone, the water ran along the hollow's slope above the meadow on its lower side (by up to
      // 0.8 units, 3 units out), the bank there built up to meet it — water on a levee, which is
      // what read as a ribbon laid on the grass.
      const ta = Math.max(0, i - 1), tb = Math.min(line.x.length - 1, i + 1)
      const ux = line.x[tb] - line.x[ta], uz = line.z[tb] - line.z[ta]
      const ul = Math.hypot(ux, uz) || 1
      let low = g
      for (const side of [-1, 1])
        for (const out of [1.2, 2.6]) {
          const d = half[i] * (1 + side * shape.skew[i]) + out
          low = Math.min(low, L.baseHeight(line.x[i] + (-uz / ul) * side * d, line.z[i] + (ux / ul) * side * d) + 0.04 * out)
        }
      // 24 cm below its ground (it was 12): enough of a bank to see from the opening view.
      // The sides may pull it down by at most 0.35 more: on a side slope near the town, keeping it
      // under the downhill side cut the uphill bank 2.4 deep, where there's no room for a bank
      // that wide, and it stood at 1 in 1.
      const lv = Math.min(i ? level[i - 1] - 0.002 * 0.6 : g - 0.05, g - FREEBOARD, Math.max(low - 0.1, g - FREEBOARD - 0.35))
      level.push(lv)
      cut = Math.max(cut, g - lv)
      // The deeper the cut, the wider its banks: a slope of at most about cut × 1.5 / bank,
      // which this keeps under 0.4 however deep — room for the hillside's own slope on top.
      // Fixed at 2.4, a 2-unit cut stood at 1.4. "Cut" counts the ground either side too, a
      // bank's width out: a shallow channel across the rising rim had a bank of 0.57.
      const a = Math.max(0, i - 1), b = Math.min(line.x.length - 1, i + 1)
      const tx = line.x[b] - line.x[a], tz = line.z[b] - line.z[a]
      const len = Math.hypot(tx, tz) || 1
      // The ground either side, one bank and two banks out: at the ridge's foot the hillside goes
      // on climbing past the first, and a bank sized by it alone stood at 0.64.
      let sideHigh = g
      for (const side of [half[i] + BANK, half[i] + 2 * BANK]) {
        sideHigh = Math.max(sideHigh, L.baseHeight(line.x[i] - (tz / len) * side, line.z[i] + (tx / len) * side) - (side - half[i] - BANK) * 0.25)
        sideHigh = Math.max(sideHigh, L.baseHeight(line.x[i] + (tz / len) * side, line.z[i] - (tx / len) * side) - (side - half[i] - BANK) * 0.25)
      }
      // Ending where the carve starts to fade out, 3 units off the town's ground: the wider
      // banks met that fade with real depth still in them, at a slope of 0.6.
      // Counting the wider side of a bend.
      const room = outside(line.x[i], line.z[i]) - KEEP - 3 - half[i] * (1 + Math.abs(shape.skew[i]))
      const wanted = BANK + 4 * Math.max(0, sideHigh - lv - FREEBOARD)
      squeeze += Math.max(0, wanted - room)
      bank.push(Math.max(1.2, Math.min(room, wanted)))
    }
    // Smoothed along the stream, so a bank doesn't widen and narrow from one point to the next.
    const soft = bank.map((_, i) => {
      let sum = 0, w = 0
      for (let j = Math.max(0, i - 8); j <= Math.min(bank.length - 1, i + 8); j++) {
        sum += bank[j]
        w++
      }
      const room = outside(line.x[i], line.z[i]) - KEEP - 3 - half[i] * (1 + Math.abs(shape.skew[i]))
      return Math.max(1.2, Math.min(room, Math.max(bank[i], sum / w)))
    })
    // A stream that comes back within reach of its own banks would make two water levels meet
    // in one bank: such a route is scored out.
    let close = 0
    for (let i = 0; i < line.x.length; i += 2)
      for (let j = i + 30; j < line.x.length; j += 2) {
        const reach = half[i] + soft[i] + half[j] + soft[j]
        if (Math.hypot(line.x[i] - line.x[j], line.z[i] - line.z[j]) < reach) close++
      }
    return { line: { ...line, ...shape, level, bank: soft } as Line, cut: cut + close + 0.2 * squeeze }
  }
  let best: { line: Line; cut: number } | null = null
  for (let k = 0; k < 8; k++) {
    // Springs on the ridge's slope to the north-west (295–320°), so the stream runs along the
    // north margin at the ridge's foot — behind both buildings in the opening view, the middle
    // ground between the meadow and the hills — and out by the valley. Springing in the east, the
    // margin it followed was outside the opening view, but for a sliver at its edge.
    const tried = build(((295 + rand() * 25) * Math.PI) / 180)
    if (!best || tried.cut < best.cut) best = tried
  }
  return best!.line
}

// --- landmarks ---

/**
 * Two groups of boulders the eye can find its way by: one beside the main path
 * where it comes out of the trees into the clearing, one on the clearing's bank
 * where the stream turns away into the valley. Larger than the scattered rocks
 * (0.7–1.3 across), three or four together, well off the grid.
 */
export function landmarks(L: Landscape): Placement[] {
  const rand = mulberry32(L.seed * 3571 + 9)
  const out: Placement[] = []
  const group = (x: number, z: number) => {
    for (let k = 0; k < 3 + Math.floor(rand() * 2); k++) {
      const a = rand() * Math.PI * 2
      const d = k === 0 ? 0 : 0.7 + rand() * 0.6
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d
      out.push({ x: px, y: L.height(px, pz), z: pz, rot: rand() * Math.PI * 2, scale: (k === 0 ? 1.3 : 0.7) + rand() * 0.4, stretch: 0.8 + 0.4 * rand(), tone: rand() })
    }
  }
  const main = L.paths[0]
  if (main) {
    // Where the path crosses the forest's edge, set to one side of it.
    let i = 0
    for (let k = 0; k < main.x.length; k++) if (Math.abs(L.pastEdge(main.x[k], main.z[k])) < Math.abs(L.pastEdge(main.x[i], main.z[i]))) i = k
    const j = Math.min(main.x.length - 1, i + 1)
    const tx = main.x[j] - main.x[Math.max(0, i - 1)], tz = main.z[j] - main.z[Math.max(0, i - 1)]
    const len = Math.hypot(tx, tz) || 1
    const off = main.half[i] + 1.6
    group(main.x[i] + (-tz / len) * off, main.z[i] + (tx / len) * off)
  }
  // Where the stream leaves the margin for the valley: the point of it nearest the valley's
  // line still within 22 units of the centre, on the clearing's side.
  const st = L.stream
  let m = -1
  for (let k = 0; k < st.x.length; k++) {
    const r = Math.hypot(st.x[k], st.z[k])
    if (r < 22 && (m < 0 || L.corridor(st.x[k], st.z[k]) > L.corridor(st.x[m], st.z[m]))) m = k
  }
  if (m >= 0) {
    const r = Math.hypot(st.x[m], st.z[m])
    const off = st.half[m] + 1.4
    group(st.x[m] - (st.x[m] / r) * off, st.z[m] - (st.z[m] / r) * off)
  }
  return out.filter((p) => outside(p.x, p.z) >= 6 && L.onPath(p.x, p.z) < 0.2 && L.streamEdge(p.x, p.z) > 0.3)
}

/**
 * A few stones in the stream itself, which the water breaks round (the water shader rings
 * them): up to six, in the stony reaches 6–100 units down, off-centre.
 *
 * Each is sized from the water where it stands: its foot 3 cm into the bed and its top 6–12 cm
 * above the surface, so it always shows. Placed at a fixed size, all of
 * them ended 5–25 cm under the water once the stream was deepened, and only their rings showed —
 * white circles with nothing in them. A spot too deep for a stone gets none.
 */
export function streamRocks(L: Landscape): Placement[] {
  const rand = mulberry32(L.seed * 2741 + 13)
  const st = L.stream
  const out: Placement[] = []
  for (let k = 0; k < 60 && out.length < 6; k++) {
    const i = Math.floor(rand() * st.x.length)
    if (st.s[i] < 6 || st.s[i] > 100 || st.rocky![i] < 0.4) continue
    if (out.some((p) => Math.hypot(p.x - st.x[i], p.z - st.z[i]) < 6)) continue
    const j = Math.min(st.x.length - 1, i + 1)
    const tx = st.x[j] - st.x[i], tz = st.z[j] - st.z[i]
    const len = Math.hypot(tx, tz) || 1
    const o = (rand() - 0.5) * 0.9 * st.half[i]
    const x = st.x[i] + (-tz / len) * o, z = st.z[i] + (tx / len) * o
    const scale = 0.26 + 0.14 * rand()
    const stretch = 0.8 + 0.4 * rand()
    const bed = L.height(x, z)
    // Straight across from point i, so the water here is i's.
    const level = st.level![i]
    // The stone mesh is a flattened ball: 0.275 × its height scale above and below a centre 0.1
    // × that scale up. Its foot 3 cm into the bed, its top 6–12 cm above the water.
    const top = level + 0.06 + 0.06 * rand()
    const semi = (top - (bed - 0.03)) / 2
    if (semi > 0.3) continue
    const tall = semi / 0.275
    const centre = bed - 0.03 + semi
    // How wide it is where the water meets it, for the ring: the ball's section at that height.
    const t = (level - centre) / semi
    const ring = Math.sqrt(Math.max(0.05, 1 - t * t)) * 0.5 * scale * ((stretch + 0.8) / 2)
    out.push({ x, y: centre - 0.1 * tall, z, rot: rand() * Math.PI * 2, scale, stretch, tone: rand(), tall, ring })
  }
  return out
}

/**
 * River stones in groups along the banks: walking down the stream every 1.6 units, a group is
 * likelier in the stony reaches and on a bend's inside (the gravel bar), and then two to five
 * smooth stones gather from just in the water to half a unit up the bank. Most of the bank has
 * none — the shared scatter, capped with the meadow's stones, put 0–11 at the water.
 */
export function bankStones(L: Landscape): Placement[] {
  const rand = mulberry32(L.seed * 6007 + 21)
  const st = L.stream
  const out: Placement[] = []
  for (let i = 4; i + 1 < st.x.length && st.s[i] < 130; i += 3) {
    const chance = 0.06 + 0.45 * st.rocky![i] + 0.2 * Math.abs(st.bend![i])
    if (rand() > chance) continue
    // The inside of a bend if it bends; otherwise either side.
    const side = Math.abs(st.bend![i]) > 0.3 ? Math.sign(st.bend![i]) : rand() < 0.5 ? -1 : 1
    const tx = st.x[i + 1] - st.x[i - 1], tz = st.z[i + 1] - st.z[i - 1]
    const len = Math.hypot(tx, tz) || 1
    const half = st.half[i] * (1 + side * st.skew![i])
    for (let k = 2 + Math.floor(rand() * 4); k > 0; k--) {
      const d = half - 0.15 + rand() * 0.75
      const along = (rand() - 0.5) * 1.4
      const x = st.x[i] + (-tz / len) * side * d + (tx / len) * along
      const z = st.z[i] + (tx / len) * side * d + (tz / len) * along
      if (outside(x, z) < 6 || L.onPath(x, z) > 0.2 || out.some((p) => Math.hypot(p.x - x, p.z - z) < 0.3)) continue
      out.push({ x, y: L.height(x, z) - 0.02, z, rot: rand() * Math.PI * 2, scale: 0.12 + 0.18 * rand(), stretch: 0.8 + 0.5 * rand(), tone: rand() })
    }
  }
  return out
}

/** One of the clearing's accents: what it is, and where. */
export type Accent = { kind: 'log' | 'mossy' | 'mushrooms' | 'blossom'; x: number; y: number; z: number; rot: number; scale: number }

/**
 * The clearing's few accents, one of each, so each part of the meadow has something to know it
 * by: a fallen log, a group of mossy stones, a ring of mushrooms, a flowering shrub. Each takes its
 * own quarter of the compass (in a seeded order, so different worlds put them differently), at a
 * spot just inside or at the forest's edge — never on the town's lawn, a path or the stream's banks
 * — where its kind belongs: the log and the mushrooms in the shade at the edge, the mossy stones in
 * damper ground, the blossom out in the open meadow.
 */
export function clearingAccents(L: Landscape): Accent[] {
  const rand = mulberry32(L.seed * 9173 + 5)
  const kinds: Accent['kind'][] = ['log', 'mossy', 'mushrooms', 'blossom']
  const quarters = [0, 1, 2, 3]
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[quarters[i], quarters[j]] = [quarters[j], quarters[i]]
  }
  const out: Accent[] = []
  kinds.forEach((kind, k) => {
    // Where in its band from the forest's edge it belongs (past the edge, units: negative in the meadow).
    const band: [number, number] = kind === 'blossom' ? [-9, -4] : kind === 'mossy' ? [-4, 1] : [-2.5, 1.5]
    let best: Accent | null = null
    let bestScore = -Infinity
    for (let t = 0; t < 40; t++) {
      const bearing = ((quarters[k] + 0.15 + 0.7 * rand()) * Math.PI) / 2
      const r = edgeToward(L, bearing) + band[0] + rand() * (band[1] - band[0])
      const [x, z] = atBearing(bearing, r)
      if (outside(x, z) < 5 || L.onPath(x, z) > 0.05 || L.pathEdge(x, z) < 1.2 || L.streamEdge(x, z) < 2.5 || L.slope(x, z) > 0.35) continue
      // Damp ground suits moss; the rest want it flat.
      const score = (kind === 'mossy' ? L.moisture(x, z) : 0) - L.slope(x, z) + 0.2 * rand()
      if (score > bestScore) {
        bestScore = score
        best = { kind, x, y: L.height(x, z), z, rot: rand() * Math.PI * 2, scale: 0.9 + 0.25 * rand() }
      }
    }
    if (best) out.push(best)
  })
  return out
}

// --- the footpaths ---

/** A point at a compass bearing (radians, 0 north, positive east) and distance from the centre. */
const atBearing = (bearing: number, r: number): [number, number] => [Math.sin(bearing) * r, -Math.cos(bearing) * r]
/** The clearing's radius toward a bearing (`clearingRadius` takes the angle of atan2(z, x)). */
const edgeToward = (L: Landscape, bearing: number) => L.clearingRadius(Math.atan2(-Math.cos(bearing), Math.sin(bearing)))

/**
 * Keeps a footpath's points out of the gap between the buildings and off their walls, pushing any
 * that stray straight out from the town's centre. (Paths used to be kept 3.5 units off the whole
 * grid; they may now come in to a building's outer side.)
 */
function keepClear(x: number[], z: number[]) {
  for (let i = 0; i < x.length; i++) {
    for (let k = 0; k < 40 && (inGap(x[i], z[i]) || toBuilding(x[i], z[i]) < 0.6); k++) {
      const r = Math.hypot(x[i], z[i]) || 1
      x[i] += (x[i] / r) * 0.3
      z[i] += (z[i] / r) * 0.3
    }
  }
}

/** Keeps the line's points at least `gap` off the grid, pushing any that stray straight out from it. */
function keepOffGrid(x: number[], z: number[], gap: number) {
  for (let i = 0; i < x.length; i++) {
    for (let k = 0; k < 12 && outside(x[i], z[i]) < gap; k++) {
      const r = Math.hypot(x[i], z[i]) || 1
      x[i] += (x[i] / r) * 0.4
      z[i] += (z[i] / r) * 0.4
    }
  }
}

/**
 * A footpath's line from a routed grid walk: corners rounded (Chaikin), then a
 * gentle meander from noise across the line, so the grid's straight runs and
 * 45° turns don't show, kept off the grid, and resampled every half unit.
 */
function shapePath(pts: [number, number][], seed: number, wander: number): { x: number[]; z: number[]; s: number[] } {
  let [x, z] = chaikin(pts.map((p) => p[0]), pts.map((p) => p[1]), 3)
  const even = resample(x, z, 1)
  x = even.x
  z = even.z
  const n = new Perlin(seed)
  for (let i = 1; i + 1 < x.length; i++) {
    const tx = x[i + 1] - x[i - 1], tz = z[i + 1] - z[i - 1]
    const len = Math.hypot(tx, tz) || 1
    // Held still at the ends, so the path still meets where it was routed to.
    const hold = Math.min(1, i / 6, (x.length - 1 - i) / 6)
    const o = (n.noise(even.s[i] * 0.07, 0.5) * 1.6 + n.noise(even.s[i] * 0.19, 7.5) * 0.5) * wander * hold
    x[i] += (-tz / len) * o
    z[i] += (tx / len) * o
  }
  keepClear(x, z)
  ;[x, z] = chaikin(x, z, 1)
  keepClear(x, z)
  return resample(x, z, 0.5)
}

/**
 * The footpaths: one main path in from the forest on the west to the west
 * building's outer wall, a fainter trail branching off it to the south-west,
 * and a fainter one still from the south-eastern woods to the east building.
 *
 * Routed, not drawn: A* over a 1-unit grid where a cell's price grows with
 * the square of its slope, so a path takes the gentle way over the clearing's
 * rim rather than straight up it. Out in the meadow a path keeps 3.5 units off
 * the buildable grid; it comes onto the town's lawn only to reach one
 * building's outer side, and never into the gap between the buildings or within
 * 4.5 units either side of it (`inGap`) — so no path runs between them, or
 * suggests that anything but the plants will join them. Each fades into trodden
 * grass at its building and into the forest at its far end, where the trees
 * leave it a gap, with a few worn-thin stretches between.
 */
function planPaths(L: Landscape): Line[] {
  const rand = mulberry32(L.seed * 104729 + 11)
  const cost = (x: number, z: number) => {
    if (outside(x, z) < 3.5) return Infinity
    // No crossing: a path that met the stream would want a bridge.
    if (L.streamEdge(x, z) < 1.6) return Infinity
    const s = L.slope(x, z)
    // Steep ground costs the square of its steepness; the open valley is kept as a sightline.
    return 1 + 40 * s * s + 3 * L.corridor(x, z)
  }
  const lines: Line[] = []
  const finish = (shape: { x: number[]; z: number[]; s: number[] }, width: number, strength: number, fadeTown: boolean, seed: number): Line => {
    const n = new Perlin(seed)
    const len = shape.s[shape.s.length - 1]
    const half = shape.s.map((s, i) => {
      // Narrower under the trees, where fewer feet keep it open, and on the town's lawn, where it
      // comes to a single building's door rather than through the meadow.
      const woods = L.forest(shape.x[i], shape.z[i])
      const lawn = 1 - 0.3 * smooth(3, 0, outside(shape.x[i], shape.z[i]))
      return width * (0.85 + 0.3 * (0.5 + n.noise(s * 0.13, 2.5))) * (1 - 0.35 * woods) * lawn
    })
    const wear = shape.s.map((s) => {
      // A few worn-thin stretches, where the grass has come back across it.
      const faded = 1 - 0.55 * smooth(0.6, 0.85, 0.5 + n.noise(s * 0.085, 5.5))
      return strength * smooth(0, 14, s) * (fadeTown ? smooth(0, 2.5, len - s) : 1) * faded * (0.85 + 0.15 * (0.5 + n.noise(s * 0.21, 9.5)))
    })
    return { ...shape, half, wear }
  }
  // Coming in to a building: the town's lawn is allowed, but never the gap between the
  // buildings or their walls, and never the stream.
  const toward = (x: number, z: number) => {
    if (inGap(x, z) || toBuilding(x, z) < 0.6) return Infinity
    if (L.streamEdge(x, z) < 1.6) return Infinity
    const s = L.slope(x, z)
    return 1 + 40 * s * s + 3 * L.corridor(x, z)
  }
  // The main path: from the forest to the west, through the meadow, and on to the west building's
  // outer (west) wall — it ended 3.5 units short of the grid at first.
  const bearing = ((232 + rand() * 30) * Math.PI) / 180
  const from = atBearing(bearing, edgeToward(L, bearing) + 22)
  const to: [number, number] = [-11.2, -1.5 + rand() * 4]
  const walked = route(from, to, cost)
  if (!walked) return lines
  const door: [number, number] = [FOOTPRINTS[0].x0 - 0.75, Math.max(-0.6, Math.min(0.6, to[1] * 0.4))]
  const inward = route(to, door, toward)
  const main = finish(shapePath([...walked, ...(inward ?? []).slice(1)], L.seed * 31 + 1, 1), 0.62, 1, true, L.seed * 31 + 2)
  lines.push(main)
  // The branch: from where the main path crosses the meadow's middle, off to the south-west (the
  // ridge, where it went at first, is the stream's now).
  let j = 0
  for (let i = 0; i < main.x.length; i++) if (Math.abs(outside(main.x[i], main.z[i]) - 10) < Math.abs(outside(main.x[j], main.z[j]) - 10)) j = i
  const b2 = ((198 + rand() * 26) * Math.PI) / 180
  const far = atBearing(b2, edgeToward(L, b2) + 18)
  const branchWalk = route([main.x[j], main.z[j]], far, cost)
  if (branchWalk && branchWalk.length > 4) {
    // Walked from the forest end in, so it fades in the forest and meets the main path at full strength.
    const b = finish(shapePath(branchWalk.reverse(), L.seed * 31 + 3, 0.8), 0.42, 0.6, false, L.seed * 31 + 4)
    lines.push(b)
  }
  // A faint trail to the east building, out of the woods to the south-east: narrower and less
  // walked, coming to its south-east corner. Routed on its own — it never meets the main path, so
  // no path runs from one building to the other.
  const b3 = ((128 + rand() * 28) * Math.PI) / 180
  const start = atBearing(b3, edgeToward(L, b3) + 14)
  const corner: [number, number] = [FOOTPRINTS[1].x1 + 0.7, FOOTPRINTS[1].z1 + 0.8 + rand() * 0.6]
  const eastWalk = route(start, corner, toward)
  if (eastWalk && eastWalk.length > 4) lines.push(finish(shapePath(eastWalk, L.seed * 31 + 5, 0.9), 0.36, 0.62, true, L.seed * 31 + 6))
  return lines
}
