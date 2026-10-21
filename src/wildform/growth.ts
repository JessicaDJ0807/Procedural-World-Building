import { LEDGE, UNGROWABLE, type Building } from '../green/building'
import { rng } from '../green/growth'
import { WILD_SPECIES } from './species'
import type { World } from './world'

/**
 * Two species growing over the building in layers.
 *
 * Every cell holds a **stack** of up to three layers of plant, bottom to top.
 * New growth always goes on top, and what it grows onto matters:
 *
 *   active tip → score the eight neighbouring cells, each by its own
 *   suitability and by what is on top of it already → enter the best one,
 *   as a new top layer → maybe branch → repeat
 *
 *     suitability′ = suitability × SUBSTRATE[species][what is on top]
 *     score = 1.4·suitability′ + vertical·rise + lateral·(1 − |rise|)
 *           + straightness·(same direction) + ledge bonus
 *           − crowding·(own species' neighbours) + jitter
 *     enter if suitability′ > 0.1, with chance 0.05 + 0.95·suitability′²
 *
 * ## What is already there
 *
 * - **The substrate.** On bare wall a species grows as the fields say. On the
 *   other species it is helped, and each seeks the other out: the Climber
 *   grips a Spreader's mat far better than bare wall (1.6), and the
 *   light-seeking Spreader rides the Climber's stems up off the wall (1.2).
 *   Nothing grows straight onto its own species (0). A third layer is possible: Climber over Spreader over Climber.
 * - **The top layer shades the ones beneath.** Each layer above a plant cuts
 *   its light to LAYERING.shade (0.75) of what it was. A plant that is overgrown has its
 *   env worked out again under that light, and if it falls well below what it
 *   grew in, it starts to wither — the sun-loving Spreader under a Climber
 *   does; the shade-tolerant Climber under a Spreader hardly minds.
 *
 * So a cell's stack records a history, and its order is a result: who arrived
 * first, who grew over whom, who survived being covered.
 *
 * A tip only ever moves to a neighbour, and new tips only start on grown
 * cells, so each species' growth is connected — nothing teleports. Seeded:
 * the same seeds and settings grow the same building, cell for cell.
 *
 * ## Withering
 *
 * Each layer remembers how suitable its species found the cell when it grew
 * there, in full light on top. If its env later falls well below that —
 * covered by another plant, or shaded by a platform — it may wither. A
 * Climber's stem carries what is above it, so everything it grew from that
 * cell goes too; the Spreader, a mat, dies back piece by piece. The layers
 * above close down over the gap. Roots never wither. Under a
 * stable world nothing withers, so this only ever runs as a response.
 */

/** A seed's parent. Roots never wither. */
export const ROOT = -1
/**
 * The parent of a Spreader cell whose parent withered and left it standing.
 * Without it the cell kept pointing at the freed entry, which was soon reused
 * by new growth elsewhere: its stem was drawn to that new cell, right across
 * a town, and when that cell withered it took the orphan with it.
 */
export const ORPHAN = -2

/** Layers a cell can hold. */
export const MAX_LAYERS = 3
/** Light reaching a layer, per layer above it. In an object so a measurement can vary it. */
export const LAYERING = { shade: 0.75 }
/** Growing onto what: [species][on top now: wall, Climber, Spreader]. */
export const SUBSTRATE = [
  [1, 0, 1.6],
  [1, 1.2, 0],
]
const WALL = 0
const ENTER_CUTOFF = 0.1
/** A fall in env below this is shrugged off. */
const STRESS_TOLERANCE = 0.12
/** Chance per step, per unit of stress beyond the tolerance. */
const WITHER_RATE = 0.24
/** Side shoots per species per step, at most. */
const SHOOT_CAP = 2

export type Seed = { species: number; cell: number }

/**
 * Growth as plain data: what `exportState` gives and `restoreState` takes.
 * Cells are named by position (× 8, rounded) and facing (rounded), not index.
 */
export type GrowthState = {
  step: number
  lastGrowth: number
  withered: number
  witheredBy: number[]
  smothered: number
  layers: { pos: Int16Array; facing: Int8Array; species: Uint8Array; birth: Int32Array; parent: Int32Array; env: Float32Array }
  tips: { pos: Int16Array; facing: Int8Array; dir: Float32Array; species: Uint8Array }
}

export class WildGrowth {
  readonly b: Building
  readonly N: number
  // --- entries: one per layer of plant, wherever it is ---
  /**
   * Which cell, which species, born when, grown from which entry, and env
   * when it grew. The parent is ROOT for a seed, and ORPHAN for a mat cell
   * whose parent withered while it lived on.
   */
  readonly entryCell: Int32Array
  readonly entrySpecies: Uint8Array
  readonly entryBirth: Int32Array
  readonly entryParent: Int32Array
  readonly entryEnv: Float32Array
  /** Live entries in birth order. `grown` of them are valid. */
  readonly order: Int32Array
  // --- per cell ---
  /** Entries in each cell, bottom to top: `cell × MAX_LAYERS + level`; −1 where empty. */
  readonly stack: Int32Array
  readonly depth: Uint8Array
  /** Which species are anywhere in the cell, one bit each (1 Climber, 2 Spreader, 3 both). */
  readonly mask: Uint8Array
  readonly grownBy = new Int32Array(WILD_SPECIES.length)
  grown = 0
  /** Cells holding any plant; holding both species; holding more than one layer. */
  occupied = 0
  shared = 0
  layered = 0
  step = 0
  lastGrowth = 0
  withered = 0
  witheredBy = new Int32Array(WILD_SPECIES.length)
  /** Layers that withered while something grew over them. */
  smothered = 0
  private free: number[] = []
  private nextEntry = 0
  private tips: Int32Array
  private tipDir: Float32Array
  private tipSp: Uint8Array
  private tipCount = 0
  private nextTips: Int32Array
  private nextDir: Float32Array
  private nextSp: Uint8Array
  private perSpecies = new Int32Array(WILD_SPECIES.length)
  private random: () => number = Math.random
  private growable = 0
  /** Entries whose env fell after they grew: candidates for withering, in the order they were found. */
  private stressed = new Set<number>()
  private cellsOf: number[][] = WILD_SPECIES.map(() => [])

  /** Tips each species may have at once: its own cap, times `tipScale`. */
  readonly caps: number[]
  /** The planting's scale: tip caps and side shoots both grow with it. */
  readonly tipScale: number

  /**
   * `tipScale` multiplies each species' tip cap. The caps were set for one
   * building and a seed or two of each; a town from the Build page planted
   * at several walls, with the same caps, let the first vigorous plant take
   * every tip and the rest stay sprouts. Side shoots — how a stalled plant
   * starts again — scale with it too: capped at two a step per species, they
   * all went to the biggest plant.
   */
  constructor(b: Building, tipScale = 1) {
    this.b = b
    this.N = b.count
    this.caps = WILD_SPECIES.map((s) => Math.max(1, Math.round(s.maxTips * tipScale)))
    this.tipScale = tipScale
    const capacity = this.caps.reduce((a, c) => a + c, 0)
    this.tips = new Int32Array(capacity)
    this.tipDir = new Float32Array(capacity * 3)
    this.tipSp = new Uint8Array(capacity)
    this.nextTips = new Int32Array(capacity)
    this.nextDir = new Float32Array(capacity * 3)
    this.nextSp = new Uint8Array(capacity)
    const entries = this.N * MAX_LAYERS
    this.entryCell = new Int32Array(entries)
    this.entrySpecies = new Uint8Array(entries)
    this.entryBirth = new Int32Array(entries)
    this.entryParent = new Int32Array(entries)
    this.entryEnv = new Float32Array(entries)
    this.order = new Int32Array(entries)
    this.stack = new Int32Array(entries)
    this.depth = new Uint8Array(this.N)
    this.mask = new Uint8Array(this.N)
    for (let i = 0; i < this.N; i++) if (!(b.flags[i] & UNGROWABLE)) this.growable++
  }

  get activeTips() {
    return this.tipCount
  }

  has(sp: number, cell: number): boolean {
    return (this.mask[cell] & (1 << sp)) !== 0
  }

  /** The species on top of a cell, or −1 if bare. */
  top(cell: number): number {
    const d = this.depth[cell]
    return d ? this.entrySpecies[this.stack[cell * MAX_LAYERS + d - 1]] : -1
  }

  /** The earliest step a species grew in a cell, −1 if it isn't there. */
  bornAt(sp: number, cell: number): number {
    let first = -1
    for (let k = 0; k < this.depth[cell]; k++) {
      const e = this.stack[cell * MAX_LAYERS + k]
      if (this.entrySpecies[e] === sp && (first < 0 || this.entryBirth[e] < first)) first = this.entryBirth[e]
    }
    return first
  }

  /** An entry's layer in its cell, 0 at the wall. */
  levelOf(e: number): number {
    const c = this.entryCell[e]
    for (let k = 0; k < this.depth[c]; k++) if (this.stack[c * MAX_LAYERS + k] === e) return k
    return 0
  }

  /** The cells active tips are on, for the interaction view. */
  tipCells(): Int32Array {
    return this.tips.slice(0, this.tipCount)
  }

  reset(seed: number, seeds: Seed[], world: World) {
    this.stack.fill(-1)
    this.depth.fill(0)
    this.mask.fill(0)
    this.grownBy.fill(0)
    this.witheredBy.fill(0)
    this.perSpecies.fill(0)
    this.grown = 0
    this.occupied = 0
    this.shared = 0
    this.layered = 0
    this.step = 0
    this.lastGrowth = 0
    this.tipCount = 0
    this.withered = 0
    this.smothered = 0
    this.free = []
    this.nextEntry = 0
    this.stressed.clear()
    this.cellsOf = WILD_SPECIES.map(() => [])
    this.random = rng(seed * 2654435761)
    for (const s of seeds) {
      if (this.b.flags[s.cell] & UNGROWABLE || !this.canEnter(s.species, s.cell)) continue
      this.occupy(s.cell, -1, s.species, world)
      this.addTip(s.cell, 0, 1, 0, s.species)
    }
  }

  /** Seeds along the foot of the walls from a seed number: `counts[k]` of species k, 3 units apart. */
  static randomSeeds(b: Building, seed: number, counts: number[]): Seed[] {
    const out: Seed[] = []
    const ground = b.ground
    const n = ground.length
    const spacing = Math.round(3 / b.cell)
    const ring = (a: number, c: number) => Math.min(Math.abs(a - c), n - Math.abs(a - c))
    const taken: number[] = []
    counts.forEach((count, k) => {
      const place = rng(seed * 40503 + 17 + k * 7919)
      let placed = 0
      for (let guard = 0; placed < count && guard < 2000; guard++) {
        const u = Math.floor(place() * n)
        if (taken.some((c) => ring(c, u) < spacing)) continue
        taken.push(u)
        out.push({ species: k, cell: ground[u] })
        placed++
      }
    })
    return out
  }

  /** Plants one root by hand, now. Returns false where nothing can be planted. */
  plant(sp: number, cell: number, world: World): boolean {
    if (cell < 0 || cell >= this.N || this.b.flags[cell] & UNGROWABLE || !this.canEnter(sp, cell)) return false
    this.occupy(cell, -1, sp, world)
    this.addTip(cell, 0, 1, 0, sp)
    return true
  }

  /**
   * Carries growth over from another building: for the Build page, where the
   * player edits the town while plants grow on it. Every layer whose cell
   * still exists — same position, same facing — is laid down again in birth
   * order, keeping its birth step and the env it grew in; one whose cell is
   * gone (a new block covers it) is dropped, and anything grown from a
   * dropped layer is left an orphan rather than taken with it. Tips carry
   * over where their cell does. Returns how many layers were kept.
   */
  restoreFrom(old: WildGrowth, world: World, seed: number): number {
    return this.restoreState(old.exportState(), world, seed)
  }

  /**
   * The growth as plain data, keyed by where each cell is rather than by its
   * index — the same key `restoreFrom` has always matched on — so it can be
   * laid onto a rebuilt building (an edit), or saved and laid onto the
   * building a saved town rebuilds into (a saved world, build/worldState.ts).
   * Layers in birth order, each with its parent as an index into that order;
   * tips with their direction. Nothing derived: stacks, masks and counts are
   * rebuilt by laying the layers down again.
   */
  exportState(): GrowthState {
    const b = this.b
    const n = this.grown
    const pos = new Int16Array(n * 3)
    const facing = new Int8Array(n * 3)
    const species = new Uint8Array(n)
    const birth = new Int32Array(n)
    const parent = new Int32Array(n)
    const env = new Float32Array(n)
    const index = new Map<number, number>()
    for (let k = 0; k < n; k++) index.set(this.order[k], k)
    const keyInto = (cell: number, p: Int16Array, f: Int8Array, k: number) => {
      p[k * 3] = Math.round(b.px[cell] * 8)
      p[k * 3 + 1] = Math.round(b.py[cell] * 8)
      p[k * 3 + 2] = Math.round(b.pz[cell] * 8)
      f[k * 3] = Math.round(b.nx[cell])
      f[k * 3 + 1] = Math.round(b.ny[cell])
      f[k * 3 + 2] = Math.round(b.nz[cell])
    }
    for (let k = 0; k < n; k++) {
      const e = this.order[k]
      keyInto(this.entryCell[e], pos, facing, k)
      species[k] = this.entrySpecies[e]
      birth[k] = this.entryBirth[e]
      const p = this.entryParent[e]
      parent[k] = p < 0 ? p : (index.get(p) ?? ORPHAN)
      env[k] = this.entryEnv[e]
    }
    const t = this.tipCount
    const tipPos = new Int16Array(t * 3)
    const tipFacing = new Int8Array(t * 3)
    for (let k = 0; k < t; k++) keyInto(this.tips[k], tipPos, tipFacing, k)
    return {
      step: this.step,
      lastGrowth: this.lastGrowth,
      withered: this.withered,
      witheredBy: Array.from(this.witheredBy),
      smothered: this.smothered,
      layers: { pos, facing, species, birth, parent, env },
      tips: { pos: tipPos, facing: tipFacing, dir: this.tipDir.slice(0, t * 3), species: this.tipSp.slice(0, t) },
    }
  }

  /**
   * Lays a growth state onto this building. Every layer whose cell exists here
   * — same position, same facing — is laid down again in birth order, keeping
   * its birth step and the env it grew in; one whose cell is gone (a new block
   * covers it) is dropped, and anything grown from a dropped layer is left an
   * orphan rather than taken with it. Tips carry over where their cell does.
   * Returns how many layers were kept.
   */
  restoreState(state: GrowthState, world: World, seed: number): number {
    const b = this.b
    const key = (p: ArrayLike<number>, f: ArrayLike<number>, k: number) => `${p[k * 3]},${p[k * 3 + 1]},${p[k * 3 + 2]},${f[k * 3]},${f[k * 3 + 1]},${f[k * 3 + 2]}`
    const where = new Map<string, number>()
    for (let i = 0; i < this.N; i++) {
      if (b.flags[i] & UNGROWABLE) continue
      where.set(`${Math.round(b.px[i] * 8)},${Math.round(b.py[i] * 8)},${Math.round(b.pz[i] * 8)},${Math.round(b.nx[i])},${Math.round(b.ny[i])},${Math.round(b.nz[i])}`, i)
    }
    this.reset(seed, [], world)
    this.step = state.step
    this.lastGrowth = state.lastGrowth
    this.withered = state.withered
    state.witheredBy.forEach((v, k) => (this.witheredBy[k] = v))
    this.smothered = state.smothered
    this.random = rng((seed + state.step) * 2654435761)
    const L = state.layers
    const n = L.species.length
    const mapped = new Int32Array(n).fill(-1)
    let kept = 0
    for (let k = 0; k < n; k++) {
      const cell = where.get(key(L.pos, L.facing, k))
      const sp = L.species[k]
      // Copied as it stands, not re-grown: a stack that closed over a withered
      // middle layer can hold one species twice in a row, which the growth rule
      // would refuse — and refusing it dropped a fifth of a town's growth on
      // every edit.
      if (cell === undefined || this.depth[cell] >= MAX_LAYERS) continue
      const p = L.parent[k]
      const parent = p < 0 ? p : mapped[p] >= 0 ? mapped[p] : ORPHAN
      const before = this.step
      this.step = L.birth[k]
      this.occupy(cell, parent, sp, world)
      this.step = before
      const ne = this.order[this.grown - 1]
      this.entryEnv[ne] = L.env[k]
      mapped[k] = ne
      kept++
    }
    const T = state.tips
    for (let k = 0; k < T.species.length; k++) {
      const cell = where.get(key(T.pos, T.facing, k))
      const sp = T.species[k]
      if (cell !== undefined && this.has(sp, cell)) this.addTip(cell, T.dir[k * 3], T.dir[k * 3 + 1], T.dir[k * 3 + 2], sp)
    }
    return kept
  }

  /** Room on the stack, and not onto its own species. */
  private canEnter(sp: number, cell: number): boolean {
    return this.depth[cell] < MAX_LAYERS && this.top(cell) !== sp
  }

  /** What a species makes of growing onto a cell's current top: the substrate factor. */
  private substrate(sp: number, cell: number): number {
    const t = this.top(cell)
    return SUBSTRATE[sp][t < 0 ? WALL : t + 1]
  }

  /** An entry's env now, under the light the layers above it leave. */
  private envOf(e: number, world: World): number {
    const c = this.entryCell[e]
    const above = this.depth[c] - 1 - this.levelOf(e)
    const sp = this.entrySpecies[e]
    return above > 0 ? world.envUnder(sp, c, world.sun[c] * Math.pow(LAYERING.shade, above)) : world.env[sp][c]
  }

  private refreshMask(cell: number) {
    let m = 0
    for (let k = 0; k < this.depth[cell]; k++) m |= 1 << this.entrySpecies[this.stack[cell * MAX_LAYERS + k]]
    this.mask[cell] = m
  }

  private occupy(cell: number, parent: number, sp: number, world: World) {
    const e = this.free.length ? this.free.pop()! : this.nextEntry++
    this.entryCell[e] = cell
    this.entrySpecies[e] = sp
    this.entryBirth[e] = this.step
    this.entryParent[e] = parent
    this.entryEnv[e] = world.env[sp][cell]
    const d = this.depth[cell]
    const wasShared = this.mask[cell] === 3
    this.stack[cell * MAX_LAYERS + d] = e
    this.depth[cell] = d + 1
    this.refreshMask(cell)
    if (d === 0) this.occupied++
    if (d === 1) this.layered++
    if (!wasShared && this.mask[cell] === 3) this.shared++
    this.order[this.grown++] = e
    this.grownBy[sp]++
    this.cellsOf[sp].push(cell)
    this.lastGrowth = this.step
    // Everything it now covers is a little darker: check those layers.
    for (let k = 0; k < d; k++) {
      const below = this.stack[cell * MAX_LAYERS + k]
      if (this.entryParent[below] !== ROOT && this.entryEnv[below] - this.envOf(below, world) > STRESS_TOLERANCE) this.stressed.add(below)
    }
  }

  /** A species' highest layer in a cell — where its tip there grows from. */
  private topOf(sp: number, cell: number): number {
    for (let k = this.depth[cell] - 1; k >= 0; k--) {
      const e = this.stack[cell * MAX_LAYERS + k]
      if (this.entrySpecies[e] === sp) return e
    }
    return -1
  }

  private addTip(cell: number, dx: number, dy: number, dz: number, sp: number) {
    if (this.perSpecies[sp] >= this.caps[sp]) return
    this.perSpecies[sp]++
    const t = this.tipCount++
    this.tips[t] = cell
    this.tipDir.set([dx, dy, dz], t * 3)
    this.tipSp[t] = sp
  }

  /** Neighbours a species already holds: it crowds itself, not the other. */
  private crowding(cell: number, exclude: number, bit: number): number {
    let count = 0
    const nb = this.b.neighbours
    for (let k = 0; k < 8; k++) {
      const n = nb[cell * 8 + k]
      if (n >= 0 && n !== exclude && this.mask[n] & bit) count++
    }
    return count
  }

  advance(world: World, randomness = 0.25) {
    const { neighbours, px, py, pz } = this.b
    const flags = world.building.flags
    const r = this.random
    this.step++
    let next = 0
    const counts = this.perSpecies
    counts.fill(0)
    const cellSize = this.b.cell
    const DIAGONAL = cellSize * 1.2

    const push = (cell: number, dx: number, dy: number, dz: number, sp: number) => {
      if (counts[sp] >= this.caps[sp]) return
      counts[sp]++
      this.nextTips[next] = cell
      this.nextDir[next * 3] = dx
      this.nextDir[next * 3 + 1] = dy
      this.nextDir[next * 3 + 2] = dz
      this.nextSp[next] = sp
      next++
    }
    const toward = (from: number, to: number, sp: number) => {
      const dx = px[to] - px[from]
      const dy = py[to] - py[from]
      const dz = pz[to] - pz[from]
      const len = Math.hypot(dx, dy, dz) || 1
      push(to, dx / len, dy / len, dz / len, sp)
    }

    for (let t = 0; t < this.tipCount; t++) {
      const cell = this.tips[t]
      const tx = this.tipDir[t * 3]
      const ty = this.tipDir[t * 3 + 1]
      const tz = this.tipDir[t * 3 + 2]
      const sp = this.tipSp[t]
      const from = this.topOf(sp, cell)
      if (from < 0) continue
      const bit = 1 << sp
      const s = WILD_SPECIES[sp]
      const suitability = world.suitability[sp]
      const harsh = 1 - this.envOf(from, world)
      if (r() < 0.005 + 0.12 * harsh * harsh) continue

      let best = -1
      let bestScore = -Infinity
      let bestSuit = 0
      let second = -1
      let secondScore = -Infinity
      for (let k = 0; k < 8; k++) {
        const n = neighbours[cell * 8 + k]
        if (n < 0 || flags[n] & UNGROWABLE || !this.canEnter(sp, n)) continue
        const suit = suitability[n] * this.substrate(sp, n)
        if (suit <= 0) continue
        const sx = px[n] - px[cell]
        const sy = py[n] - py[cell]
        const sz = pz[n] - pz[cell]
        const len = Math.hypot(sx, sy, sz)
        const along = (sx * tx + sy * ty + sz * tz) / len
        const rise = Math.max(-1, Math.min(1, sy / cellSize))
        const score =
          1.4 * suit +
          s.vertical * rise +
          s.lateral * (1 - Math.abs(rise)) +
          s.straightness * along +
          (flags[n] & LEDGE ? s.ledge : 0) -
          s.crowding * this.crowding(n, cell, bit) -
          (len > DIAGONAL ? 0.05 : 0) +
          1.6 * randomness * (r() - 0.5)
        if (score > bestScore) {
          second = best
          secondScore = bestScore
          best = n
          bestScore = score
          bestSuit = suit
        } else if (score > secondScore) {
          second = n
          secondScore = score
        }
      }
      if (best < 0) continue
      if (bestSuit > ENTER_CUTOFF && r() < 0.05 + 0.95 * bestSuit * bestSuit) {
        this.occupy(best, from, sp, world)
        toward(cell, best, sp)
        if (second >= 0 && this.canEnter(sp, second) && r() < s.branch + s.branchPerEnv * world.env[sp][best]) {
          this.occupy(second, from, sp, world)
          toward(cell, second, sp)
        }
      } else if (r() > 0.1) {
        push(cell, tx, ty, tz, sp)
      }
    }

    // Side shoots, each species from its own cells. A floor of a quarter of a
    // shoot a step: without it a young plant whose first tips died had almost
    // no way to put out new ones.
    for (let sp = 0; sp < WILD_SPECIES.length; sp++) {
      if (!this.grownBy[sp]) continue
      const wakes = Math.min(SHOOT_CAP * this.tipScale, Math.floor(0.25 * this.tipScale + (this.grownBy[sp] / 100) * WILD_SPECIES[sp].shoots + r()))
      const own = this.cellsOf[sp]
      for (let k = 0; k < wakes; k++) {
        const cell = own[Math.floor(r() * own.length)]
        if (r() < 0.6 * world.env[sp][cell]) {
          const to = neighbours[cell * 8 + Math.floor(r() * 8)]
          if (to >= 0) toward(cell, to, sp)
        }
      }
    }

    ;[this.tips, this.nextTips] = [this.nextTips, this.tips]
    ;[this.tipDir, this.nextDir] = [this.nextDir, this.tipDir]
    ;[this.tipSp, this.nextSp] = [this.nextSp, this.tipSp]
    this.tipCount = next
  }

  /** After the fields change: every layer whose env fell well below what it grew in. Returns how many newly, by species. */
  markStress(world: World): number[] {
    const by = WILD_SPECIES.map(() => 0)
    for (let k = 0; k < this.grown; k++) {
      const e = this.order[k]
      if (this.entryParent[e] === ROOT) continue
      if (this.entryEnv[e] - this.envOf(e, world) > STRESS_TOLERANCE) {
        if (!this.stressed.has(e)) by[this.entrySpecies[e]]++
        this.stressed.add(e)
      }
    }
    return by
  }

  /** One step of withering among stressed layers. Returns the number removed. */
  wither(world: World): number {
    this.withered = 0
    if (!this.stressed.size) return 0
    const r = this.random
    const dying = new Uint8Array(this.entryCell.length)
    let any = false
    // In insertion order, so the draws — and the run — are deterministic.
    for (const e of [...this.stressed]) {
      const stress = this.entryEnv[e] - this.envOf(e, world) - STRESS_TOLERANCE
      if (stress <= 0) {
        this.stressed.delete(e)
        continue
      }
      if (r() < WITHER_RATE * stress) {
        dying[e] = 1
        any = true
        const c = this.entryCell[e]
        if (this.levelOf(e) < this.depth[c] - 1) this.smothered++
      }
    }
    if (!any) return 0
    // For a species whose stems carry what grew from them, everything grown
    // from a dying layer goes with it: born after its parent, so one pass in
    // birth order settles every descendant. A mat dies piece by piece.
    for (let k = 0; k < this.grown; k++) {
      const e = this.order[k]
      const p = this.entryParent[e]
      if (p < 0 || !dying[p]) continue
      if (WILD_SPECIES[this.entrySpecies[e]].carries) dying[e] = 1
      else this.entryParent[e] = ORPHAN
    }
    const touched = new Set<number>()
    let w = 0
    for (let k = 0; k < this.grown; k++) {
      const e = this.order[k]
      if (!dying[e]) {
        this.order[w++] = e
        continue
      }
      const sp = this.entrySpecies[e]
      this.grownBy[sp]--
      this.witheredBy[sp]++
      this.withered++
      this.stressed.delete(e)
      touched.add(this.entryCell[e])
    }
    this.grown = w
    // Close each touched stack over its gaps, and recount the cell.
    for (const c of touched) {
      const wasShared = this.mask[c] === 3
      const before = this.depth[c]
      let d = 0
      for (let k = 0; k < before; k++) {
        const e = this.stack[c * MAX_LAYERS + k]
        if (!dying[e]) this.stack[c * MAX_LAYERS + d++] = e
      }
      for (let k = d; k < before; k++) this.stack[c * MAX_LAYERS + k] = -1
      this.depth[c] = d
      this.refreshMask(c)
      if (before > 0 && d === 0) this.occupied--
      if (before > 1 && d <= 1) this.layered--
      if (wasShared && this.mask[c] !== 3) this.shared--
    }
    // Freed entries go back for reuse only now, after every stack is settled.
    for (let e = 0; e < dying.length; e++) if (dying[e]) this.free.push(e)
    this.cellsOf = this.cellsOf.map((list, sp) => list.filter((c) => this.has(sp, c)))
    let t2 = 0
    this.perSpecies.fill(0)
    for (let t = 0; t < this.tipCount; t++) {
      if (!this.has(this.tipSp[t], this.tips[t])) continue
      this.tips[t2] = this.tips[t]
      this.tipDir.copyWithin(t2 * 3, t * 3, t * 3 + 3)
      this.tipSp[t2] = this.tipSp[t]
      this.perSpecies[this.tipSp[t]]++
      t2++
    }
    this.tipCount = t2
    return this.withered
  }

  /** Cells holding both species — where they overlap and can combine — highest first. */
  contacts(): number[] {
    const out: number[] = []
    for (let i = 0; i < this.N; i++) if (this.mask[i] === 3) out.push(i)
    const py = this.b.py
    return out.sort((a, c) => py[c] - py[a])
  }

  coverage(): number {
    return this.occupied / this.growable
  }

  coverageOf(sp: number): number {
    return this.grownBy[sp] / this.growable
  }

  overlap(): number {
    return this.shared / this.growable
  }

  /** Cells with more than one layer, as a share of the growable surface. */
  layering(): number {
    return this.layered / this.growable
  }
}
