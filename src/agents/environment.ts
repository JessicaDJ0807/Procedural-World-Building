import { mulberry32 } from '../noise'

/**
 * The ground the agents walk on: a 160 × 100 grid of one-unit cells, three
 * destinations, a wall with three gaps, and rocks.
 *
 * The layout is designed rather than generated, and only its details come from
 * the seed. The experiment needs a few things to be true of every world: there
 * must be more than one way between any two destinations, the straight line
 * between them must be blocked (otherwise "follow the compass" is already the
 * best route and nothing can emerge), and every destination must be reachable.
 * A fully random scatter guarantees none of these. So the wall and its three
 * gaps are always there, a short wall splits the two eastern destinations, and
 * the seed moves the gaps and scatters the rocks.
 */
export const WORLD_W = 160
export const WORLD_H = 100

export type Circle = { x: number; y: number; r: number }

export type Destination = Circle & { label: string }

export type Gap = { y0: number; y1: number }

/** Where the dividing wall is. Crossings of its centre line are counted as route choices. */
export const WALL_X0 = 78
export const WALL_X1 = 82
export const WALL_MID = (WALL_X0 + WALL_X1) / 2
const GAP_HALF = 4.5

/**
 * A free-standing wall between B and C, with a passage at each end.
 *
 * It first ran in from the east edge, and that made a dead-end pocket: a B↔C
 * walker heading straight for its goal met the wall, slid east along it into
 * the corner with the border, and stayed there. In the first no-trail
 * measurement that jam was the brightest trail on the map — and it read as the
 * baseline having *more* route agreement than the colony with trails.
 */
const SPUR = { x0: 116, x1: 148, y0: 49, y1: 51 }

/**
 * Radius of a block placed by clicking. Six, so that one block centred on a
 * gap seals it: at the gap's edge (4.5 from centre) the circle still spans
 * x 76–84, past both faces of the 78–82 wall.
 */
export const PLACED_RADIUS = 6

export const DESTINATIONS: Destination[] = [
  { label: 'A', x: 18, y: 50, r: 7 },
  { label: 'B', x: 142, y: 24, r: 7 },
  { label: 'C', x: 142, y: 76, r: 7 },
]

export type Environment = {
  seed: number
  /** 1 where a cell cannot be walked on. Row-major, WORLD_W per row. */
  blocked: Uint8Array
  destinations: Destination[]
  gaps: Gap[]
  rocks: Circle[]
  placed: Circle[]
  /**
   * Walking distance from every cell to each destination, around obstacles.
   *
   * Measurement only. No agent reads it — an agent that could would simply
   * walk the shortest route and there would be nothing to observe. It exists
   * so the page can say how much longer the routes the agents actually take
   * are than the best one available.
   */
  distance: Float32Array[]
}

const inCircle = (x: number, y: number, c: Circle) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r

/** The three gaps, one in each third of the wall's height. */
export function generateGaps(seed: number): Gap[] {
  const rand = mulberry32(seed * 7919 + 17)
  const bands: [number, number][] = [
    [12, 28],
    [40, 60],
    [72, 88],
  ]
  return bands.map(([lo, hi]) => {
    const c = lo + rand() * (hi - lo)
    return { y0: c - GAP_HALF, y1: c + GAP_HALF }
  })
}

/**
 * Rocks, scattered either side of the wall but never on a destination, in a
 * gap, or on the spur. Each is a circle so an agent sliding round it never
 * meets a concave corner it could wedge in.
 */
export function generateRocks(seed: number, gaps: Gap[]): Circle[] {
  const rand = mulberry32(seed * 104729 + 3)
  const rocks: Circle[] = []
  for (let tries = 0; rocks.length < 9 && tries < 400; tries++) {
    const r = 3 + rand() * 3
    const x = 28 + rand() * (WORLD_W - 56)
    const y = 8 + rand() * (WORLD_H - 16)
    if (Math.abs(x - WALL_MID) < r + 6) continue
    if (DESTINATIONS.some((d) => Math.hypot(x - d.x, y - d.y) < r + d.r + 8)) continue
    if (x > SPUR.x0 - r - 8 && Math.abs(y - 50) < r + 8) continue
    if (gaps.some((g) => Math.abs(x - WALL_MID) < r + 12 && y > g.y0 - r - 4 && y < g.y1 + r + 4)) continue
    if (rocks.some((o) => Math.hypot(x - o.x, y - o.y) < r + o.r + 5)) continue
    rocks.push({ x, y, r })
  }
  return rocks
}

function rasterise(gaps: Gap[], rocks: Circle[], placed: Circle[]): Uint8Array {
  const blocked = new Uint8Array(WORLD_W * WORLD_H)
  for (let j = 0; j < WORLD_H; j++) {
    const y = j + 0.5
    for (let i = 0; i < WORLD_W; i++) {
      const x = i + 0.5
      let b = i === 0 || j === 0 || i === WORLD_W - 1 || j === WORLD_H - 1
      if (!b && x >= WALL_X0 && x < WALL_X1) b = !gaps.some((g) => y >= g.y0 && y < g.y1)
      if (!b && x >= SPUR.x0 && x < SPUR.x1 && y >= SPUR.y0 && y < SPUR.y1) b = true
      if (!b) b = rocks.some((c) => inCircle(x, y, c)) || placed.some((c) => inCircle(x, y, c))
      blocked[j * WORLD_W + i] = b ? 1 : 0
    }
  }
  return blocked
}

// 16 neighbours: the 8 adjacent cells and the 8 knight's moves. Eight alone
// over-measures any route that is neither axial nor diagonal by up to 8%,
// which would read as agents beating the shortest path; the knight's moves
// bring the worst case to 2.7%.
const STEPS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1],
  [1, 2], [1, -2], [-1, 2], [-1, -2],
]

/**
 * Dijkstra from every cell inside a destination outward. A move is allowed
 * only if the cells it passes between are free too, so no route cuts a corner
 * an agent could not.
 */
export function distanceField(blocked: Uint8Array, dest: Circle): Float32Array {
  const n = WORLD_W * WORLD_H
  // Float64 while searching: a Float32 store rounds some distances up, the
  // stored value then never compares as settled against the exact one, and the
  // same cells are pushed again and again until the heap runs out of memory.
  const dist = new Float64Array(n).fill(Infinity)
  // A binary heap of (distance, cell) in two parallel arrays.
  const heapD: number[] = []
  const heapC: number[] = []
  const push = (d: number, c: number) => {
    let i = heapD.length
    heapD.push(d)
    heapC.push(c)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heapD[p] <= d) break
      heapD[i] = heapD[p]
      heapC[i] = heapC[p]
      i = p
    }
    heapD[i] = d
    heapC[i] = c
  }
  const pop = () => {
    const d = heapD[0]
    const c = heapC[0]
    const lastD = heapD.pop() as number
    const lastC = heapC.pop() as number
    if (heapD.length > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= heapD.length) break
        const r = l + 1
        const m = r < heapD.length && heapD[r] < heapD[l] ? r : l
        if (heapD[m] >= lastD) break
        heapD[i] = heapD[m]
        heapC[i] = heapC[m]
        i = m
      }
      heapD[i] = lastD
      heapC[i] = lastC
    }
    return [d, c]
  }
  for (let j = 0; j < WORLD_H; j++) {
    for (let i = 0; i < WORLD_W; i++) {
      const c = j * WORLD_W + i
      if (!blocked[c] && inCircle(i + 0.5, j + 0.5, dest)) {
        dist[c] = 0
        push(0, c)
      }
    }
  }
  const free = (i: number, j: number) => i >= 0 && j >= 0 && i < WORLD_W && j < WORLD_H && !blocked[j * WORLD_W + i]
  while (heapD.length > 0) {
    const [d, c] = pop()
    if (d > dist[c]) continue
    const i = c % WORLD_W
    const j = (c - i) / WORLD_W
    for (const [di, dj] of STEPS) {
      const ni = i + di
      const nj = j + dj
      if (!free(ni, nj)) continue
      // The cells the segment passes through on its way.
      if (Math.abs(di) + Math.abs(dj) >= 2) {
        if (!free(i + Math.sign(di), j) || !free(i, j + Math.sign(dj))) continue
        if (Math.abs(di) === 2 && !free(i + Math.sign(di), j + dj)) continue
        if (Math.abs(dj) === 2 && !free(i + di, j + Math.sign(dj))) continue
      }
      const nd = d + Math.hypot(di, dj)
      const nc = nj * WORLD_W + ni
      if (nd < dist[nc]) {
        dist[nc] = nd
        push(nd, nc)
      }
    }
  }
  return Float32Array.from(dist)
}

export function cellOf(x: number, y: number): number {
  const i = Math.floor(x)
  const j = Math.floor(y)
  if (i < 0 || j < 0 || i >= WORLD_W || j >= WORLD_H) return -1
  return j * WORLD_W + i
}

export function isBlocked(env: Pick<Environment, 'blocked'>, x: number, y: number): boolean {
  const c = cellOf(x, y)
  return c < 0 || env.blocked[c] === 1
}

/** Every destination can reach every other: the distance from B and C to A is finite. */
function connected(blocked: Uint8Array): boolean {
  const field = distanceField(blocked, DESTINATIONS[0])
  return DESTINATIONS.slice(1).every((d) => Number.isFinite(field[cellOf(d.x, d.y)]))
}

/**
 * Whether a block can go here: not on a destination, and not so that some
 * destination can no longer be reached. Closing every route is a different
 * experiment — the agents would simply circle — so it is refused rather than
 * allowed to strand the population.
 */
export function canPlace(env: Environment, c: Circle): 'ok' | 'destination' | 'disconnects' {
  if (env.destinations.some((d) => Math.hypot(c.x - d.x, c.y - d.y) < c.r + d.r + 1)) return 'destination'
  const blocked = rasterise(env.gaps, env.rocks, [...env.placed, c])
  return connected(blocked) ? 'ok' : 'disconnects'
}

export function buildEnvironment(seed: number, placed: Circle[] = []): Environment {
  const gaps = generateGaps(seed)
  let rocks = generateRocks(seed, gaps)
  let blocked = rasterise(gaps, rocks, placed)
  // Rocks are kept clear of the gaps, so this should never fire; it is the
  // guarantee rather than the expectation. A saved world whose placed blocks
  // disconnect it (hand-edited JSON) loses its blocks rather than its routes.
  while (!connected(blocked) && rocks.length > 0) {
    rocks = rocks.slice(0, -1)
    blocked = rasterise(gaps, rocks, placed)
  }
  if (!connected(blocked)) {
    placed = []
    blocked = rasterise(gaps, rocks, placed)
  }
  return {
    seed,
    blocked,
    destinations: DESTINATIONS,
    gaps,
    rocks,
    placed,
    distance: DESTINATIONS.map((d) => distanceField(blocked, d)),
  }
}

/**
 * A block dropped near a gap goes to the gap's centre.
 *
 * Closing a route is the experiment a block is for, and a click is never
 * exactly centred. The first version placed blocks where clicked, and a block
 * a unit or two off centre left a slit one or two cells wide where its circle
 * curved away from the wall — agents walked through it, the gap counter went
 * on counting it, and the gap was labelled closed.
 */
export function snapToGap(env: Environment, c: Circle): Circle {
  if (Math.abs(c.x - WALL_MID) > 8) return c
  for (const g of env.gaps) {
    const centre = (g.y0 + g.y1) / 2
    if (Math.abs(c.y - centre) < 8) return { ...c, x: WALL_MID, y: centre }
  }
  return c
}

/** The gap a placed block is sealing, or −1. */
export function gapClosedBy(env: Environment, c: Circle): number {
  return env.gaps.findIndex((g) => c.x === WALL_MID && Math.abs(c.y - (g.y0 + g.y1) / 2) < 0.01)
}

/** Which gap a point on the wall's centre line is in, or −1. */
export function gapAt(env: Environment, y: number): number {
  return env.gaps.findIndex((g) => y >= g.y0 - 1 && y < g.y1 + 1)
}
