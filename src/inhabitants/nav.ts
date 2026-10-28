import type { Building } from '../green/building'
import type { BuildGame } from '../build/game'
import { SURFACE } from '../build/surfaces'
import { toTown, type Living, type V3 } from '../build/living'
import { Town } from '../build/town'

/**
 * Where an inhabitant can walk, and how to get there.
 *
 * Inhabitants live on the green. They walk on the same cells the plants grow
 * over — walls, roofs, the decks and supports of living architecture, one
 * neighbour table stitched across all of them (green/building.ts,
 * build/surfaces.ts) — but only where something grows:
 *
 * - a cell with plant growth on it, unless it faces down (they don't hang
 *   upside down from a soffit);
 * - any surface of a mature living structure but its underside.
 *
 * Bare wall, glass and the open lawn are off-limits. So what an inhabitant
 * can reach is the plants' doing: two buildings are separate worlds until
 * growth or a structure joins them, winter's withering can strand one, and a
 * bridge maturing opens a route it can discover.
 *
 * A NavGraph is a snapshot: built from a game's building and growth at one
 * moment, it holds the walkable cells, their connected regions, and what
 * each region touches. Rebuild it when the world changes; it never changes
 * the world.
 */

const FACING_DOWN = 135

export type Place = {
  /** The building (a mass of blocks in the town) a cell is on, or −1 on living architecture. */
  mass: number
  /** The living structure a cell belongs to, or −1. */
  structure: number
}

export class NavGraph {
  readonly building: Building
  readonly walkable: Uint8Array
  /** Region id per cell — connected walkable cells share one — or −1 where not walkable. */
  readonly region: Int32Array
  readonly regionSize: number[] = []
  /** Per region: the living structures in it, and the buildings it touches. */
  readonly regionStructures: Set<number>[] = []
  readonly regionMasses: Set<number>[] = []
  readonly walkableCount: number
  private readonly place: Place[]
  private readonly structureCells = new Map<number, number[]>()
  private readonly grid = new Map<string, number[]>()

  constructor(building: Building, walkable: Uint8Array, place: Place[]) {
    this.building = building
    this.walkable = walkable
    this.place = place
    const N = building.count
    this.region = new Int32Array(N).fill(-1)
    let count = 0
    const stack: number[] = []
    for (let i = 0; i < N; i++) {
      if (!walkable[i]) continue
      count++
      const s = place[i].structure
      if (s >= 0) {
        const list = this.structureCells.get(s)
        if (list) list.push(i)
        else this.structureCells.set(s, [i])
      }
      const key = this.key(building.px[i], building.py[i], building.pz[i])
      const bucket = this.grid.get(key)
      if (bucket) bucket.push(i)
      else this.grid.set(key, [i])
      if (this.region[i] >= 0) continue
      // A new region: flood it through walkable neighbours.
      const r = this.regionSize.length
      let size = 0
      const structures = new Set<number>()
      const masses = new Set<number>()
      this.region[i] = r
      stack.push(i)
      while (stack.length) {
        const c = stack.pop()!
        size++
        if (place[c].structure >= 0) structures.add(place[c].structure)
        if (place[c].mass >= 0) masses.add(place[c].mass)
        for (let k = 0; k < 8; k++) {
          const n = building.neighbours[c * 8 + k]
          if (n >= 0 && walkable[n] && this.region[n] < 0) {
            this.region[n] = r
            stack.push(n)
          }
        }
      }
      this.regionSize.push(size)
      this.regionStructures.push(structures)
      this.regionMasses.push(masses)
    }
    this.walkableCount = count
  }

  private key(x: number, y: number, z: number) {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`
  }

  placeOf(cell: number): Place {
    return this.place[cell]
  }

  pos(cell: number): V3 {
    const b = this.building
    return [b.px[cell], b.py[cell], b.pz[cell]]
  }

  normal(cell: number): V3 {
    const b = this.building
    return [b.nx[cell], b.ny[cell], b.nz[cell]]
  }

  reachable(a: number, b: number): boolean {
    return a >= 0 && b >= 0 && this.region[a] >= 0 && this.region[a] === this.region[b]
  }

  /** The walkable cells of a structure, if it is walkable at all. */
  cellsOf(structure: number): number[] {
    return this.structureCells.get(structure) ?? []
  }

  /** The nearest walkable cell to a point, within `reach` units, or −1. Optionally only in one region. */
  nearest(p: V3, reach = 1.5, region = -1): number {
    const b = this.building
    let best = -1
    let bd = reach * reach
    const r = Math.ceil(reach)
    const [fx, fy, fz] = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])]
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          const bucket = this.grid.get(`${fx + dx},${fy + dy},${fz + dz}`)
          if (!bucket) continue
          for (const c of bucket) {
            if (region >= 0 && this.region[c] !== region) continue
            const d = (b.px[c] - p[0]) ** 2 + (b.py[c] - p[1]) ** 2 + (b.pz[c] - p[2]) ** 2
            if (d < bd) {
              bd = d
              best = c
            }
          }
        }
    return best
  }

  /**
   * A route over walkable cells, A* by distance, as the cells to step
   * through (excluding the start); null if there is none. Routes never leave
   * a region, so a different region is refused at once.
   */
  path(from: number, to: number): number[] | null {
    if (!this.reachable(from, to)) return null
    if (from === to) return []
    const b = this.building
    const h = (c: number) => Math.hypot(b.px[c] - b.px[to], b.py[c] - b.py[to], b.pz[c] - b.pz[to])
    const g = new Map<number, number>([[from, 0]])
    const came = new Map<number, number>()
    const open = new MinHeap()
    open.push(from, h(from))
    const closed = new Set<number>()
    while (open.size) {
      const c = open.pop()
      if (c === to) {
        const out: number[] = []
        for (let k = to; k !== from; k = came.get(k)!) out.push(k)
        return out.reverse()
      }
      if (closed.has(c)) continue
      closed.add(c)
      const gc = g.get(c)!
      for (let k = 0; k < 8; k++) {
        const n = b.neighbours[c * 8 + k]
        if (n < 0 || !this.walkable[n] || closed.has(n)) continue
        const step = Math.hypot(b.px[n] - b.px[c], b.py[n] - b.py[c], b.pz[n] - b.pz[c])
        const gn = gc + step
        if (gn < (g.get(n) ?? Infinity)) {
          g.set(n, gn)
          came.set(n, c)
          open.push(n, gn + h(n))
        }
      }
    }
    return null
  }
}

/** A small binary min-heap of cells by priority, for A*. */
class MinHeap {
  private items: number[] = []
  private keys: number[] = []
  get size() {
    return this.items.length
  }
  push(item: number, key: number) {
    const it = this.items
    const ks = this.keys
    it.push(item)
    ks.push(key)
    let i = it.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (ks[p] <= ks[i]) break
      ;[it[p], it[i]] = [it[i], it[p]]
      ;[ks[p], ks[i]] = [ks[i], ks[p]]
      i = p
    }
  }
  pop(): number {
    const it = this.items
    const ks = this.keys
    const top = it[0]
    const lastI = it.pop()!
    const lastK = ks.pop()!
    if (it.length) {
      it[0] = lastI
      ks[0] = lastK
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < it.length && ks[l] < ks[m]) m = l
        if (r < it.length && ks[r] < ks[m]) m = r
        if (m === i) break
        ;[it[m], it[i]] = [it[i], it[m]]
        ;[ks[m], ks[i]] = [ks[i], ks[m]]
        i = m
      }
    }
    return top
  }
}

/** The navigation snapshot of a game as it stands: its building, its growth, its mature structures. */
export function navFromGame(game: BuildGame): NavGraph {
  const b = game.building
  const info = game.surface
  const g = game.sim.growth
  const masses = game.town.masses()
  const N = b.count
  const walkable = new Uint8Array(N)
  const place: Place[] = new Array(N)
  for (let i = 0; i < N; i++) {
    const structure = i >= info.baseCount ? info.structure[i] : -1
    let mass = -1
    if (structure < 0) {
      // The block behind the cell: a wall's is behind its face, a roof's below it.
      const [x, y, z] = toTown([b.px[i] - b.nx[i] * 0.3, b.py[i] - b.ny[i] * 0.3, b.pz[i] - b.nz[i] * 0.3])
      if (game.town.filled(x, y, z)) mass = masses[Town.index(x, y, z)]
    }
    place[i] = { mass, structure }
    if (structure >= 0) walkable[i] = info.kind[i] === SURFACE.underside ? 0 : 1
    else walkable[i] = g.depth[i] > 0 && info.slope[i] < FACING_DOWN ? 1 : 0
  }
  return new NavGraph(b, walkable, place)
}

/** A structure's kind, by id, for labels. */
export function structureKind(living: Living[], id: number): Living['kind'] | null {
  return living.find((l) => l.id === id)?.kind ?? null
}
