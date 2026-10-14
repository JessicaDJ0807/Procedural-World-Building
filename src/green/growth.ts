import { CELL, UNGROWABLE, type Building } from './building'
import type { Fields } from './fields'
import type { GrowthParams } from './params'
import { SPECIES, SPECIES_IDS } from './species'

/**
 * Vines as tips walking a grid.
 *
 * The state is three arrays and a list. Every cell has a `birth` (−1 while
 * empty, otherwise the step it was grown into) and a `parent` (the cell the
 * vine came from), and the cells grown so far are kept in birth order so a
 * renderer can draw only what is new. The *tips* are the cells still growing.
 *
 * One step, for every tip, in order:
 *
 *  1. **Die?** With probability 0.005 + 0.12 × (1 − env)² — a tip in a cell
 *     it can barely live in gives up within a few steps; one in a good cell
 *     almost never does.
 *  2. **Look** at the eight neighbours that are empty and growable, and score
 *     each:
 *
 *         score = 1.4 · suitability
 *               + 0.6 · upward · dy              climbing bias, dy in [−1, 1]
 *               + 0.3 · (direction · last direction)   keeps a vine straight
 *               − 0.25 · crowding                 occupied cells around it
 *               − 0.05 if diagonal
 *               + 1.6 · randomness · (rand − ½)
 *
 *  3. **Grow** into the best one with probability 0.05 + 0.95 × suitability²,
 *     and never into a cell below 0.1. Otherwise stall and try again next step,
 *     with a 10% chance of giving up. Having grown, **branch** into the second
 *     best with probability 0.03 + 0.04 × env.
 *
 * Then a few existing cells are woken as new tips (1 per 300 grown cells,
 * accepted with probability 0.6 × env) — side shoots, so a stand keeps filling
 * after its first tips have died. A new tip only ever starts on a grown cell,
 * which is what keeps growth connected: nothing appears out of reach of an
 * existing vine.
 *
 * ## Why entering is gated on suitability squared
 *
 * The first version gated it on env, linearly, with a floor of 0.3. Under
 * Balanced it filled 94% of the (then walls-only) facade by step 600, and the
 * cells it grew into had the same mean moisture, sun and geometry as the
 * facade as a whole — the environment changed how *fast* the building filled,
 * never *where*. A tip that stalls retries, so any non-zero chance of entering
 * a cell is eventually a certainty. The square, the cutoff and the 10% chance
 * of giving up on each stall make a poor cell fill *late*, and a cell under the
 * cutoff never.
 *
 * Late, mostly — not never. Run long enough and the order is what the rules
 * set, not the extent: ivy alone at the Balanced settings covers 54% by step
 * 900 and 78% by step 3,000, and with all three species even Dry + sunny is at
 * 60–78% after 20,000 steps and still growing. A plant that can also die back
 * where it cannot live is the change that would make the end state selective.
 *
 * Directions are real 3D steps between cell positions, not grid offsets, so
 * the same rule works on a wall, a roof, and over the edge between them. `dy`
 * is the height a step gains, in cells, clamped to ±1: a step up a wall is 1
 * (diagonal or not), a step across a roof is 0 — on a flat roof, climbing
 * means nothing, which is what upward tendency should do there.
 *
 * ## Species
 *
 * Every cell also records which species holds it, and every tip which species
 * it belongs to. The rule above is the same for all three; what differs is the
 * species' own suitability field, its upward bias, and the traits in
 * `species.ts` — the crowding and straightness weights (0.25 and 0.3 above are
 * ivy's), its branch rate and its tip cap. Species compete only for space: a
 * tip can never enter a cell another species already holds.
 *
 * When species were added, ivy alone reproduced the single-plant runs cell for
 * cell (fifteen runs, every cell's birth step hashed before and after). The
 * roof and the wing changed the building, so the old runs no longer exist to
 * compare with; the experiments were measured again on this building.
 *
 * ## Deterministic
 *
 * Two seeded streams: one places the seeds, one drives the steps. Tips are
 * visited in array order and new tips are appended in order, so the same seed
 * and parameters give the same building cell for cell. Seed *positions* use
 * only the seed and the species — each species has its own placement stream —
 * so two presets are compared from the same start, and switching one species
 * off does not move another's seeds.
 */

/** mulberry32: small, fast, and good enough for choosing between eight cells. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}


const SPECIES_COUNT = SPECIES_IDS.length
/**
 * Tip caps, per species, from `species.ts` — ivy's 48 is the original single
 * cap. Without a cap, branching is exponential: the no-rules case covered 98%
 * of the wall in 150 steps, a blob rather than vines.
 */
const TIP_CAPS = SPECIES_IDS.map((id) => SPECIES[id].maxTips)
const TIP_CAPACITY = TIP_CAPS.reduce((a, b) => a + b, 0)
/** Below this suitability a tip will not enter a cell at all. */
const ENTER_CUTOFF = 0.1
/** Marks a cell no species holds. */
export const NO_SPECIES = 255

export class Growth {
  readonly birth: Int32Array
  readonly parent: Int32Array
  /** Which species holds each cell, as an index into SPECIES_IDS; NO_SPECIES if none. */
  readonly species: Uint8Array
  /** Grown cells in birth order. `grown` of them are valid. */
  readonly order: Int32Array
  /** Grown cells per species. */
  readonly grownBy = new Int32Array(SPECIES_COUNT)
  grown = 0
  step = 0
  /** The step at which a cell last grew — what the viewport's stall detection reads. */
  lastGrowth = 0
  private tips = new Int32Array(TIP_CAPACITY)
  private tipDir = new Float32Array(TIP_CAPACITY * 3)
  private tipSp = new Uint8Array(TIP_CAPACITY)
  private tipCount = 0
  private nextTips = new Int32Array(TIP_CAPACITY)
  private nextDir = new Float32Array(TIP_CAPACITY * 3)
  private nextSp = new Uint8Array(TIP_CAPACITY)
  private perSpecies = new Int32Array(SPECIES_COUNT)
  private random: () => number = Math.random
  private readonly b: Building
  private growable = 0

  constructor(b: Building) {
    this.b = b
    const n = b.count
    this.birth = new Int32Array(n)
    this.parent = new Int32Array(n)
    this.species = new Uint8Array(n)
    this.order = new Int32Array(n)
    for (let i = 0; i < n; i++) if (!(b.flags[i] & UNGROWABLE)) this.growable++
  }

  get activeTips() {
    return this.tipCount
  }

  /** Clears everything and plants the seeds for `seed`, for the species switched on. */
  reset(seed: number, p: GrowthParams) {
    this.birth.fill(-1)
    this.parent.fill(-1)
    this.species.fill(NO_SPECIES)
    this.grownBy.fill(0)
    this.perSpecies.fill(0)
    this.grown = 0
    this.step = 0
    this.lastGrowth = 0
    this.tipCount = 0
    this.random = rng(seed * 2654435761)

    // Seeds along the foot of the wall, at least 3 units apart within a
    // species, each species from its own stream so neither the parameters nor
    // the other species can move them.
    const ground = this.b.ground
    const n = ground.length
    const ring = (a: number, c: number) => Math.min(Math.abs(a - c), n - Math.abs(a - c))
    SPECIES_IDS.forEach((id, k) => {
      if (!p.species[id].enabled) return
      const place = rng(seed * 40503 + 17 + k * 7919)
      const chosen: number[] = []
      let guard = 0
      while (chosen.length < SPECIES[id].seeds && guard++ < 1000) {
        const u = Math.floor(place() * n)
        if (chosen.some((c) => ring(c, u) < 12)) continue
        chosen.push(u)
      }
      for (const u of chosen) {
        const cell = ground[u]
        // Glass at the foot of a wall, or an earlier species already rooted here: no seed.
        if (this.birth[cell] >= 0 || this.b.flags[cell] & UNGROWABLE) continue
        this.occupy(cell, -1, k)
        this.addTip(cell, 0, 1, 0, k)
      }
    })
  }

  private occupy(cell: number, parent: number, sp: number) {
    this.birth[cell] = this.step
    this.parent[cell] = parent
    this.species[cell] = sp
    this.order[this.grown++] = cell
    this.grownBy[sp]++
    this.lastGrowth = this.step
  }

  private addTip(cell: number, dx: number, dy: number, dz: number, sp: number) {
    if (this.perSpecies[sp] >= TIP_CAPS[sp]) return
    this.perSpecies[sp]++
    const t = this.tipCount++
    this.tips[t] = cell
    this.tipDir[t * 3] = dx
    this.tipDir[t * 3 + 1] = dy
    this.tipDir[t * 3 + 2] = dz
    this.tipSp[t] = sp
  }

  private crowding(cell: number, exclude: number): number {
    let count = 0
    const nb = this.b.neighbours
    for (let k = 0; k < 8; k++) {
      const n = nb[cell * 8 + k]
      if (n >= 0 && n !== exclude && this.birth[n] >= 0) count++
    }
    return count
  }

  advance(fields: Fields, p: GrowthParams) {
    const { flags, neighbours, px, py, pz } = this.b
    const r = this.random
    this.step++
    let next = 0
    const counts = this.perSpecies
    counts.fill(0)
    const traits = SPECIES_IDS.map((id) => SPECIES[id])
    const upward = SPECIES_IDS.map((id) => p.species[id].upward)
    const DIAGONAL = CELL * 1.2

    const push = (cell: number, dx: number, dy: number, dz: number, sp: number) => {
      if (counts[sp] >= TIP_CAPS[sp]) return
      counts[sp]++
      this.nextTips[next] = cell
      this.nextDir[next * 3] = dx
      this.nextDir[next * 3 + 1] = dy
      this.nextDir[next * 3 + 2] = dz
      this.nextSp[next] = sp
      next++
    }

    for (let t = 0; t < this.tipCount; t++) {
      const cell = this.tips[t]
      const tx = this.tipDir[t * 3]
      const ty = this.tipDir[t * 3 + 1]
      const tz = this.tipDir[t * 3 + 2]
      const sp = this.tipSp[t]
      const env = fields.env[sp]
      const suitability = fields.suitability[sp]
      const trait = traits[sp]
      const harsh = 1 - env[cell]
      if (r() < 0.005 + 0.12 * harsh * harsh) continue

      let best = -1
      let bestScore = -Infinity
      let second = -1
      let secondScore = -Infinity

      for (let k = 0; k < 8; k++) {
        const n = neighbours[cell * 8 + k]
        if (n < 0 || this.birth[n] >= 0 || flags[n] & UNGROWABLE) continue
        const sx = px[n] - px[cell]
        const sy = py[n] - py[cell]
        const sz = pz[n] - pz[cell]
        const len = Math.hypot(sx, sy, sz)
        const along = (sx * tx + sy * ty + sz * tz) / len
        const dy = Math.max(-1, Math.min(1, sy / CELL))
        const score =
          1.4 * suitability[n] +
          0.6 * upward[sp] * dy +
          trait.straightness * along -
          trait.crowding * this.crowding(n, cell) -
          (len > DIAGONAL ? 0.05 : 0) +
          1.6 * p.randomness * (r() - 0.5)
        if (score > bestScore) {
          second = best
          secondScore = bestScore
          best = n
          bestScore = score
        } else if (score > secondScore) {
          second = n
          secondScore = score
        }
      }

      if (best < 0) continue // boxed in: the tip ends here
      const s = suitability[best]
      if (s > ENTER_CUTOFF && r() < 0.05 + 0.95 * s * s) {
        this.occupy(best, cell, sp)
        this.pushToward(push, cell, best, sp)
        if (second >= 0 && r() < trait.branch + trait.branchPerEnv * env[best]) {
          this.occupy(second, cell, sp)
          this.pushToward(push, cell, second, sp)
        }
      } else if (r() > 0.1) {
        push(cell, tx, ty, tz, sp)
      }
    }

    // Side shoots from what has already grown, each of its own species, set
    // off toward a random neighbour.
    if (this.grown > 0) {
      const wakes = 1 + Math.floor(this.grown / 300)
      for (let k = 0; k < wakes; k++) {
        const cell = this.order[Math.floor(r() * this.grown)]
        const sp = this.species[cell]
        if (r() < 0.6 * fields.env[sp][cell]) {
          const toward = neighbours[cell * 8 + Math.floor(r() * 8)]
          if (toward >= 0) this.pushToward(push, cell, toward, sp)
          else push(cell, 0, 1, 0, sp)
        }
      }
    }

    // Swap the tip buffers.
    ;[this.tips, this.nextTips] = [this.nextTips, this.tips]
    ;[this.tipDir, this.nextDir] = [this.nextDir, this.tipDir]
    ;[this.tipSp, this.nextSp] = [this.nextSp, this.tipSp]
    this.tipCount = next
  }

  /** Queues a tip at `to`, heading the way it came from `from`. */
  private pushToward(
    push: (cell: number, dx: number, dy: number, dz: number, sp: number) => void,
    from: number,
    to: number,
    sp: number,
  ) {
    const { px, py, pz } = this.b
    const dx = px[to] - px[from]
    const dy = py[to] - py[from]
    const dz = pz[to] - pz[from]
    const len = Math.hypot(dx, dy, dz) || 1
    push(to, dx / len, dy / len, dz / len, sp)
  }

  /** Grown cells as a fraction of the cells anything could grow on. */
  coverage(): number {
    return this.grown / this.growable
  }

  /** One species' share of the growable surface. */
  coverageOf(sp: number): number {
    return this.grownBy[sp] / this.growable
  }
}
