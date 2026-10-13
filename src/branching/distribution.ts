import { mulberry32 } from '../noise'

/**
 * Where the trees go: points on a square, by one of five strategies.
 *
 * This is deliberately ignorant of terrain, unlike Topic 5's scatter. There
 * the ground decided where things grew and the point process was hidden
 * under the rules; here the point process *is* the subject, on flat ground,
 * so the only difference between two forests is how their points were drawn.
 *
 * | Strategy | What it does | Character |
 * | --- | --- | --- |
 * | Uniform random | Every point independent | Clumps and holes by pure chance |
 * | Grid | Rows and columns | Perfectly even, and obviously planted |
 * | Jittered grid | One point per grid cell, anywhere in it | Even without rows |
 * | Clustered | Parents scattered, children round each | Groves and clearings |
 * | Poisson disk | Random, but never closer than a minimum | Even and natural |
 *
 * Every strategy is seeded, and each draws from its own stream, so changing
 * a parameter re-rolls only what that parameter affects.
 */
export type Strategy = 'uniform' | 'grid' | 'jittered' | 'clustered' | 'poisson'

export const STRATEGIES: { value: Strategy; label: string; hint: string; uses: (keyof DistributionParams)[] }[] = [
  { value: 'uniform', label: 'Uniform random', hint: 'Every tree placed independently. The clumps and gaps are chance, not a rule — this is what "random" actually looks like.', uses: ['count'] },
  { value: 'grid', label: 'Grid', hint: 'Rows and columns: as even as possible and immediately read as planted, an orchard rather than a forest.', uses: ['count'] },
  { value: 'jittered', label: 'Jittered grid', hint: 'One tree per grid cell, moved anywhere within its share of the cell. Keeps the grid\'s evenness and loses its rows.', uses: ['count', 'jitter'] },
  { value: 'clustered', label: 'Clustered', hint: 'Cluster centres are scattered first; every tree then lands near one of them — a Thomas process. Groves with clearings between.', uses: ['count', 'clusterCount', 'clusterRadius', 'minSpacing'] },
  { value: 'poisson', label: 'Poisson disk', hint: 'Random positions, but a tree is refused if it lands within the minimum spacing of another. Even like a grid, irregular like nature.', uses: ['count', 'minSpacing'] },
]

export type DistributionParams = {
  strategy: Strategy
  count: number
  seed: number
  /** Side of the square, world units. */
  area: number
  minSpacing: number
  clusterCount: number
  clusterRadius: number
  /** Jittered grid: how far within its cell a point may move, 0 to 1. */
  jitter: number
}

export type Point = { x: number; z: number }

export type Scatter = {
  points: Point[]
  /** Points the strategy was asked for but could not fit. */
  refused: number
  ms: number
}

/** A uniform hash grid for minimum-spacing tests. */
class SpacingGrid {
  private cells = new Map<number, Point[]>()
  private readonly cell: number
  constructor(cell: number) {
    this.cell = cell
  }
  private key(i: number, j: number) {
    return (i + 32768) * 65536 + (j + 32768)
  }
  clear(x: number, z: number, r: number): boolean {
    const i = Math.floor(x / this.cell)
    const j = Math.floor(z / this.cell)
    const reach = Math.ceil(r / this.cell)
    for (let di = -reach; di <= reach; di++) {
      for (let dj = -reach; dj <= reach; dj++) {
        const list = this.cells.get(this.key(i + di, j + dj))
        if (!list) continue
        for (const p of list) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return false
      }
    }
    return true
  }
  add(p: Point) {
    const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell))
    const list = this.cells.get(k)
    if (list) list.push(p)
    else this.cells.set(k, [p])
  }
}

const STREAM: Record<Strategy, number> = { uniform: 11, grid: 13, jittered: 17, clustered: 19, poisson: 23 }

/** Standard normal by Box–Muller, for the cluster offsets. */
const gaussian = (rand: () => number) => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())

export function distribute(params: DistributionParams): Scatter {
  const started = performance.now()
  const { strategy, count, area, minSpacing } = params
  const rand = mulberry32(params.seed * 2654435761 + STREAM[strategy])
  const half = area / 2
  const points: Point[] = []
  let refused = 0

  if (strategy === 'uniform') {
    for (let i = 0; i < count; i++) points.push({ x: (rand() - 0.5) * area, z: (rand() - 0.5) * area })
  } else if (strategy === 'grid' || strategy === 'jittered') {
    // As close to `count` as a square grid gets, filled row by row; the last
    // row may be short, which is better than silently planting more trees
    // than were asked for.
    const side = Math.ceil(Math.sqrt(count))
    const cell = area / side
    const jitter = strategy === 'jittered' ? params.jitter : 0
    for (let j = 0; j < side && points.length < count; j++) {
      for (let i = 0; i < side && points.length < count; i++) {
        const ox = (rand() - 0.5) * jitter
        const oz = (rand() - 0.5) * jitter
        points.push({ x: -half + (i + 0.5 + ox) * cell, z: -half + (j + 0.5 + oz) * cell })
      }
    }
  } else if (strategy === 'clustered') {
    const parents = Array.from({ length: Math.max(1, params.clusterCount) }, () => ({
      x: (rand() - 0.5) * area * 0.9,
      z: (rand() - 0.5) * area * 0.9,
    }))
    const grid = new SpacingGrid(Math.max(minSpacing, 0.5))
    // A child that lands too close to another is redrawn rather than dropped,
    // up to a limit, so minimum spacing thins a crowded grove outward instead
    // of quietly losing trees.
    const sigma = params.clusterRadius / 2
    for (let i = 0; i < count; i++) {
      const parent = parents[i % parents.length]
      let placed = false
      for (let attempt = 0; attempt < 30 && !placed; attempt++) {
        const x = parent.x + gaussian(rand) * sigma
        const z = parent.z + gaussian(rand) * sigma
        if (Math.abs(x) > half || Math.abs(z) > half) continue
        if (minSpacing > 0 && !grid.clear(x, z, minSpacing)) continue
        const p = { x, z }
        grid.add(p)
        points.push(p)
        placed = true
      }
      if (!placed) refused++
    }
  } else {
    // Dart throwing with a spatial grid: throw uniformly, keep what does not
    // land within `minSpacing` of anything kept. Bridson's algorithm is
    // faster at filling the square to saturation, but it grows outward from
    // one seed point, so stopping it at `count` leaves a disc in a corner.
    // Darts fill the whole square evenly at every count, and the readout says
    // how many could not fit when the spacing is too wide for the count.
    const grid = new SpacingGrid(Math.max(minSpacing, 0.5))
    const budget = count * 40
    let thrown = 0
    while (points.length < count && thrown < budget) {
      thrown++
      const x = (rand() - 0.5) * area
      const z = (rand() - 0.5) * area
      if (!grid.clear(x, z, minSpacing)) continue
      const p = { x, z }
      grid.add(p)
      points.push(p)
    }
    refused = count - points.length
  }

  return { points, refused, ms: performance.now() - started }
}

/**
 * The Clark–Evans ratio: mean nearest-neighbour distance over what a uniform
 * random pattern of the same density would give, 0.5 / √density.
 *
 * About 1 for uniform random, below 1 for clustered, above 1 for evenly
 * spaced, and 2.15 for a perfect hexagonal lattice. It is the one number that
 * says what the eye sees when two strategies are compared, which is why the
 * readout carries it. No edge correction: points near the square's border
 * have fewer neighbours than they would in an endless forest, which nudges
 * every value up by a few percent — equally for every strategy, so the
 * comparison stands.
 */
export function clarkEvans(points: Point[], area: number): { ratio: number; meanNearest: number; minNearest: number } {
  if (points.length < 2) return { ratio: NaN, meanNearest: NaN, minNearest: NaN }
  const cell = area / Math.max(4, Math.sqrt(points.length))
  const grid = new Map<number, Point[]>()
  const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768)
  for (const p of points) {
    const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell))
    const list = grid.get(k)
    if (list) list.push(p)
    else grid.set(k, [p])
  }
  let sum = 0
  let min = Infinity
  for (const p of points) {
    const i = Math.floor(p.x / cell)
    const j = Math.floor(p.z / cell)
    let best = Infinity
    // Widen the search ring until a neighbour is found and the ring is
    // further than the best so far — a sparse pattern's nearest can be
    // several cells away.
    for (let reach = 1; reach < 64; reach++) {
      for (let di = -reach; di <= reach; di++) {
        for (let dj = -reach; dj <= reach; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== reach && reach > 1) continue
          const list = grid.get(key(i + di, j + dj))
          if (!list) continue
          for (const q of list) {
            if (q === p) continue
            const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2
            if (d < best) best = d
          }
        }
      }
      if (best < Infinity && Math.sqrt(best) <= (reach - 1) * cell) break
    }
    const d = Math.sqrt(best)
    sum += d
    min = Math.min(min, d)
  }
  const meanNearest = sum / points.length
  const expected = 0.5 / Math.sqrt(points.length / (area * area))
  return { ratio: meanNearest / expected, meanNearest, minNearest: min }
}
