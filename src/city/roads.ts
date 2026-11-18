import { mulberry32 } from '../noise'
import { valueNoise } from '../hashNoise'
import { distanceToSegment, segmentHit, type Vec } from './geometry'
import type { Ground } from './ground'

/**
 * Road networks by growth, after Parish & Müller (2001).
 *
 * A network starts as one junction and a queue of proposed segments. Each
 * proposal is popped in priority order and put through the same **local
 * constraints** whatever the strategy:
 *
 *   1. it must stay on land, inside the site, and off slopes over 16°
 *   2. if it crosses a road, it stops there and the two become a junction
 *   3. if it ends near a junction, it snaps onto it
 *   4. if it stops just short of a road, it is extended to meet it
 *   5. it may not leave a junction at under 30° to a road already there; if
 *      it ends crowded against a road, it is joined straight onto that road
 *
 * A proposal that survives becomes a road, and the strategy's **global
 * goals** propose what grows from its end. That is the whole difference
 * between the three strategies — grid, organic and layered run the same loop
 * and the same five rules, and differ only in what they propose next:
 *
 *   grid     straight on, and a branch at ±90°, every `spacing`
 *   organic  short steps that wander with noise and turn toward flatter
 *            ground; branches now and then, at loose angles
 *   layered  primaries first — long, gently curving arterials that follow the
 *            terrain — and only then secondaries, which leave the primaries at
 *            right angles and grow small grids aligned to the road they came
 *            from. Priority does the layering: every secondary is queued
 *            behind every primary.
 *
 * Constraint 2 is what keeps the graph planar — every crossing is a node —
 * which is what lets `blocks.ts` read the city blocks straight off it as
 * faces.
 */
export type RoadStrategy = 'grid' | 'organic' | 'layered'
export type RoadKind = 'primary' | 'secondary'

export type RoadParams = {
  strategy: RoadStrategy
  /** 0–1: closer roads, smaller blocks. */
  density: number
  /** Secondary road width in world units; primaries are 1.6× this. */
  width: number
  /** 0–1: angle and length noise for grids, wander for organic and layered. */
  irregularity: number
  seed: number
}

export type RoadNode = Vec
export type RoadEdge = { a: number; b: number; kind: RoadKind; width: number }

export type Rejection = 'water' | 'slope' | 'bounds' | 'angle' | 'crowded' | 'short'

export type RoadNetwork = {
  nodes: RoadNode[]
  edges: RoadEdge[]
  centre: Vec
  /**
   * Proposals popped, and what became of them: grown is a new road to a new
   * junction; joined, snapped, extended and merged each connected to the
   * network; the rest were refused. The five add up to `proposals`.
   */
  proposals: number
  grown: number
  joined: number
  snapped: number
  extended: number
  /** Ends that came too close to a road and were joined straight onto it. */
  merged: number
  /** Dead ends joined, after growth, to the road they pointed at. */
  closed: number
  /** Stubs shorter than a step, removed after growth. */
  trimmed: number
  rejected: Record<Rejection, number>
  ms: number
}

export const PRIMARY_SCALE = 1.6
/** Steeper than this and a road is refused; organic roads turn away from it first. */
export const MAX_ROAD_SLOPE = 16
const MAX_EDGES = 2600
const MAX_PROPOSALS = 24000
/** Secondaries wait behind every primary: the layering is in the queue. */
const SECONDARY_DELAY = 10000

/** Block spacing in world units, from density. */
export function spacingFor(strategy: RoadStrategy, density: number): number {
  if (strategy === 'organic') return 38 - 22 * density
  return 64 - 40 * density
}

type Proposal = {
  from: number
  angle: number
  length: number
  kind: RoadKind
  t: number
  order: number
  /** Distance since the last secondary spawned off this primary chain. */
  since: number
}

/** A binary heap on (t, order), so ties pop in insertion order and runs replay. */
class Queue {
  private items: Proposal[] = []
  get size() {
    return this.items.length
  }
  private less(a: Proposal, b: Proposal) {
    return a.t < b.t || (a.t === b.t && a.order < b.order)
  }
  push(p: Proposal) {
    const h = this.items
    h.push(p)
    let i = h.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(h[i], h[parent])) break
      ;[h[i], h[parent]] = [h[parent], h[i]]
      i = parent
    }
  }
  pop(): Proposal | undefined {
    const h = this.items
    if (!h.length) return undefined
    const top = h[0]
    const last = h.pop()!
    if (h.length) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < h.length && this.less(h[l], h[m])) m = l
        if (r < h.length && this.less(h[r], h[m])) m = r
        if (m === i) break
        ;[h[i], h[m]] = [h[m], h[i]]
        i = m
      }
    }
    return top
  }
}

/** Uniform bucket grid over the site, for edges and for nodes. */
class Buckets {
  private cells = new Map<number, number[]>()
  private readonly size: number
  private readonly half: number
  constructor(half: number, size: number) {
    this.half = half
    this.size = size
  }
  private key(i: number, j: number) {
    return i * 4096 + j
  }
  private idx(v: number) {
    return Math.floor((v + this.half) / this.size)
  }
  add(id: number, x0: number, z0: number, x1: number, z1: number) {
    for (let i = this.idx(Math.min(x0, x1)); i <= this.idx(Math.max(x0, x1)); i++) {
      for (let j = this.idx(Math.min(z0, z1)); j <= this.idx(Math.max(z0, z1)); j++) {
        const k = this.key(i, j)
        const list = this.cells.get(k)
        if (list) list.push(id)
        else this.cells.set(k, [id])
      }
    }
  }
  query(x0: number, z0: number, x1: number, z1: number, out: Set<number>) {
    out.clear()
    for (let i = this.idx(Math.min(x0, x1)); i <= this.idx(Math.max(x0, x1)); i++) {
      for (let j = this.idx(Math.min(z0, z1)); j <= this.idx(Math.max(z0, z1)); j++) {
        const list = this.cells.get(this.key(i, j))
        if (list) for (const id of list) out.add(id)
      }
    }
    return out
  }
}

/**
 * Where the city starts: flat land near the middle of the site. Scored on a
 * coarse grid — slope, distance from the middle, and nearness to water, which
 * a centre on the shore would push half the city into.
 */
export function chooseCentre(ground: Ground): Vec {
  let best = { x: 0, z: 0 }
  let bestScore = Infinity
  const r = ground.half * 0.35
  for (let x = -r; x <= r; x += 4) {
    for (let z = -r; z <= r; z += 4) {
      if (!ground.isLand(x, z)) continue
      const score = ground.slope(x, z) + Math.hypot(x, z) * 0.08 + Math.max(0, 20 - ground.waterDistance(x, z)) * 0.5
      if (score < bestScore) {
        bestScore = score
        best = { x, z }
      }
    }
  }
  return best
}

export function generateRoads(ground: Ground, params: RoadParams): RoadNetwork {
  const started = performance.now()
  const { strategy, density, irregularity: irr } = params
  const rand = mulberry32(params.seed * 7919 + strategyCode(strategy))
  const half = ground.half
  const spacing = spacingFor(strategy, density)
  const step = strategy === 'organic' ? spacing * 0.42 : 16
  const centre = chooseCentre(ground)
  // Circular extents, so the city thins out toward the corners of the site.
  const extent = { primary: half * 0.95, secondary: half * 0.82 }

  const nodes: RoadNode[] = []
  const edges: RoadEdge[] = []
  const adjacency: number[][] = []
  const edgeGrid = new Buckets(half + 40, 16)
  const nodeGrid = new Buckets(half + 40, 16)
  const candidates = new Set<number>()
  const rejected: Record<Rejection, number> = { water: 0, slope: 0, bounds: 0, angle: 0, crowded: 0, short: 0 }
  let joined = 0
  let snapped = 0
  let extended = 0
  let merged = 0
  let grown = 0
  let order = 0

  const widthOf = (kind: RoadKind) => (kind === 'primary' ? params.width * PRIMARY_SCALE : params.width)

  const addNode = (x: number, z: number) => {
    nodes.push({ x, z })
    adjacency.push([])
    nodeGrid.add(nodes.length - 1, x, z, x, z)
    return nodes.length - 1
  }
  const addEdge = (a: number, b: number, kind: RoadKind) => {
    edges.push({ a, b, kind, width: widthOf(kind) })
    const id = edges.length - 1
    adjacency[a].push(id)
    adjacency[b].push(id)
    edgeGrid.add(id, nodes[a].x, nodes[a].z, nodes[b].x, nodes[b].z)
    return id
  }
  const other = (edge: RoadEdge, n: number) => (edge.a === n ? edge.b : edge.a)

  /** Split edge `id` at point (x, z) and return the new junction. */
  const splitEdge = (id: number, x: number, z: number) => {
    const e = edges[id]
    const n = addNode(x, z)
    const b = e.b
    adjacency[b] = adjacency[b].filter((k) => k !== id)
    e.b = n
    adjacency[n].push(id)
    edgeGrid.add(id, nodes[e.a].x, nodes[e.a].z, x, z)
    addEdge(n, b, e.kind)
    return n
  }

  /** First road crossed by from→(x, z), as a fraction along it. */
  const firstCrossing = (from: number, x: number, z: number, skip?: number) => {
    const a = nodes[from]
    const rx = x - a.x
    const rz = z - a.z
    let best: { t: number; edge: number; x: number; z: number } | null = null
    edgeGrid.query(a.x, a.z, x, z, candidates)
    for (const id of candidates) {
      const e = edges[id]
      if (e.a === from || e.b === from || (skip !== undefined && (e.a === skip || e.b === skip))) continue
      const p = nodes[e.a]
      const q = nodes[e.b]
      const hit = segmentHit(a.x, a.z, rx, rz, p.x, p.z, q.x - p.x, q.z - p.z)
      if (!hit || hit.t <= 1e-6 || hit.t >= 1 || hit.u < 0 || hit.u > 1) continue
      if (!best || hit.t < best.t) best = { t: hit.t, edge: id, x: a.x + rx * hit.t, z: a.z + rz * hit.t }
    }
    return best
  }

  /** Leaving `from` at `angle`, is it too close to a road already leaving it? */
  const tooAcute = (from: number, angle: number, minAngle = 0.52) => {
    for (const id of adjacency[from]) {
      const o = nodes[other(edges[id], from)]
      const a = Math.atan2(o.z - nodes[from].z, o.x - nodes[from].x)
      let d = Math.abs(a - angle) % (Math.PI * 2)
      if (d > Math.PI) d = Math.PI * 2 - d
      if (d < minAngle) return true
    }
    return false
  }

  const groundCheck = (x0: number, z0: number, x1: number, z1: number): Rejection | null => {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const n = Math.max(2, Math.ceil(len / 2))
    for (let i = 1; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n
      const z = z0 + ((z1 - z0) * i) / n
      if (Math.abs(x) > half - 4 || Math.abs(z) > half - 4) return 'bounds'
      if (!ground.isLand(x, z)) return 'water'
      if (ground.slope(x, z) > MAX_ROAD_SLOPE) return 'slope'
    }
    return null
  }

  /**
   * For strategies that bend: of a fan of headings around the intended one,
   * take the one that lands on the flattest ground, with a cost for turning.
   * This is what makes organic roads follow contours.
   */
  const steer = (from: Vec, angle: number, length: number, fan: number) => {
    let best = angle
    let bestScore = Infinity
    for (let k = -3; k <= 3; k++) {
      const a = angle + (k / 3) * fan
      const x = from.x + Math.cos(a) * length
      const z = from.z + Math.sin(a) * length
      if (Math.abs(x) > half - 4 || Math.abs(z) > half - 4 || !ground.isLand(x, z)) continue
      const score = ground.slope(x, z) / 6 + Math.abs(a - angle) * 1.5
      if (score < bestScore) {
        bestScore = score
        best = a
      }
    }
    return best
  }

  /** Junctions reachable from `start` in at most `hops` roads. */
  const within = (start: number, hops: number) => {
    const seen = new Set([start])
    let frontier = [start]
    for (let h = 0; h < hops; h++) {
      const next: number[] = []
      for (const n of frontier) {
        for (const id of adjacency[n]) {
          const o = other(edges[id], n)
          if (!seen.has(o)) {
            seen.add(o)
            next.push(o)
          }
        }
      }
      frontier = next
    }
    return seen
  }

  /**
   * Connect `p.from` to the nearest point of edge `id`, or to one of its ends
   * if the nearest point is close to one. False if that connection breaks a
   * rule; the proposal is then refused.
   */
  const tryMerge = (p: Proposal, id: number) => {
    const a = nodes[p.from]
    const e = edges[id]
    const P = nodes[e.a]
    const Q = nodes[e.b]
    const qx = Q.x - P.x
    const qz = Q.z - P.z
    const len2 = qx * qx + qz * qz
    const u = len2 > 0 ? ((a.x - P.x) * qx + (a.z - P.z) * qz) / len2 : 0
    const segLen = Math.sqrt(len2)
    let target = -1
    let tx: number
    let tz: number
    if (u * segLen < 4) {
      target = e.a
      tx = P.x
      tz = P.z
    } else if ((1 - u) * segLen < 4) {
      target = e.b
      tx = Q.x
      tz = Q.z
    } else {
      tx = P.x + qx * u
      tz = P.z + qz * u
    }
    const length = Math.hypot(tx - a.x, tz - a.z)
    if (length < 3 || length > p.length * 1.6) return false
    if (target === p.from || (target >= 0 && adjacency[p.from].some((k) => other(edges[k], p.from) === target))) return false
    const angle = Math.atan2(tz - a.z, tx - a.x)
    if (tooAcute(p.from, angle)) return false
    if (target >= 0 && tooAcute(target, angle + Math.PI)) return false
    // Any crossing on the way, other than the target road itself, blocks it.
    const blocked = firstCrossing(p.from, tx, tz, target >= 0 ? target : undefined)
    if (blocked && blocked.edge !== id) return false
    if (groundCheck(a.x, a.z, tx, tz)) return false
    const n = target >= 0 ? target : splitEdge(id, tx, tz)
    addEdge(p.from, n, p.kind)
    return true
  }

  const queue = new Queue()
  const propose = (p: Omit<Proposal, 'order'>) => queue.push({ ...p, order: order++ })

  const root = addNode(centre.x, centre.z)
  const theta0 = (rand() - 0.5) * 0.7
  const arms = strategy === 'organic' ? 3 + (rand() < 0.5 ? 1 : 0) : 4
  for (let k = 0; k < arms; k++) {
    const jitter = strategy === 'grid' ? 0 : (rand() - 0.5) * 0.5
    propose({ from: root, angle: theta0 + (k * Math.PI * 2) / arms + jitter, length: strategy === 'grid' ? spacing : step, kind: 'primary', t: 0, since: 0 })
  }

  let proposals = 0
  while (queue.size && proposals < MAX_PROPOSALS && edges.length < MAX_EDGES) {
    const p = queue.pop()!
    proposals++
    const a = nodes[p.from]
    let angle = p.angle
    if (strategy === 'organic' || (strategy === 'layered' && p.kind === 'primary')) {
      angle = steer(a, angle, p.length, strategy === 'organic' ? 0.5 : 0.3)
    }
    const dx = Math.cos(angle)
    const dz = Math.sin(angle)
    let x = a.x + dx * p.length
    let z = a.z + dz * p.length

    const limit = p.kind === 'primary' ? extent.primary : extent.secondary
    if (Math.hypot(x - centre.x, z - centre.z) > limit) {
      rejected.bounds++
      continue
    }
    if (tooAcute(p.from, angle)) {
      rejected.angle++
      continue
    }

    // 2. Crossing a road: stop at it, and make a junction.
    const hit = firstCrossing(p.from, x, z)
    if (hit) {
      if (hit.t * p.length < 3) {
        rejected.short++
        continue
      }
      const bad = groundCheck(a.x, a.z, hit.x, hit.z)
      if (bad) {
        rejected[bad]++
        continue
      }
      const n = splitEdge(hit.edge, hit.x, hit.z)
      addEdge(p.from, n, p.kind)
      joined++
      continue
    }

    // 3. Ending near a junction: snap onto it.
    const snapRadius = (strategy === 'organic' ? 0.6 : 0.4) * p.length
    nodeGrid.query(x - snapRadius, z - snapRadius, x + snapRadius, z + snapRadius, candidates)
    let snapTo = -1
    let snapDist = snapRadius
    for (const id of candidates) {
      if (id === p.from) continue
      const d = Math.hypot(nodes[id].x - x, nodes[id].z - z)
      if (d < snapDist && !adjacency[p.from].some((e) => other(edges[e], p.from) === id)) {
        snapDist = d
        snapTo = id
      }
    }
    if (snapTo >= 0) {
      const t = nodes[snapTo]
      const snapAngle = Math.atan2(t.z - a.z, t.x - a.x)
      const blocked = firstCrossing(p.from, t.x, t.z, snapTo)
      const bad = groundCheck(a.x, a.z, t.x, t.z)
      if (!blocked && !bad && !tooAcute(p.from, snapAngle) && !tooAcute(snapTo, snapAngle + Math.PI)) {
        addEdge(p.from, snapTo, p.kind)
        snapped++
        continue
      }
    }

    // 4. Stopping just short of a road: extend to meet it.
    const reach = firstCrossing(p.from, x + dx * snapRadius, z + dz * snapRadius)
    if (reach) {
      const bad = groundCheck(a.x, a.z, reach.x, reach.z)
      if (!bad) {
        const n = splitEdge(reach.edge, reach.x, reach.z)
        addEdge(p.from, n, p.kind)
        extended++
        continue
      }
    }

    // 1. Ground.
    const bad = groundCheck(a.x, a.z, x, z)
    if (bad) {
      rejected[bad]++
      continue
    }

    // 5. Crowding: the end may not sit close against a road it is not joining.
    // It joins it instead — straight across to the nearest point on that road,
    // if the way is clear. Refusing outright is what left organic networks
    // full of dead ends: a street that wanders up to another and stops.
    const minSep = (strategy === 'organic' ? 0.55 : 0.45) * spacing
    edgeGrid.query(x - minSep, z - minSep, x + minSep, z + minSep, candidates)
    // The road's own chain, two junctions back, is exempt: a street that bends
    // would otherwise be refused for coming close to itself.
    const near = new Set([p.from, ...adjacency[p.from].map((e) => other(edges[e], p.from))])
    let crowdEdge = -1
    let crowdDist = minSep
    for (const id of candidates) {
      const e = edges[id]
      if (near.has(e.a) || near.has(e.b)) continue
      const P = nodes[e.a]
      const Q = nodes[e.b]
      const dist = distanceToSegment(x, z, P.x, P.z, Q.x, Q.z)
      if (dist < crowdDist) {
        crowdDist = dist
        crowdEdge = id
      }
    }
    if (crowdEdge >= 0) {
      // Only onto a road that is not its own neighbourhood: merging back onto
      // the street it branched from, a few junctions along, made a triangle
      // too small to hold a plot (40 of seed 1's 58 organic faces did).
      const local = within(p.from, 4)
      const e = edges[crowdEdge]
      if (!local.has(e.a) && !local.has(e.b) && tryMerge(p, crowdEdge)) merged++
      else rejected.crowded++
      continue
    }

    const n = addNode(x, z)
    addEdge(p.from, n, p.kind)
    grown++
    x = nodes[n].x
    z = nodes[n].z

    // Global goals: what grows from here.
    const next = (angle2: number, length: number, kind: RoadKind, dt: number, since = 0) =>
      propose({ from: n, angle: angle2, length, kind, t: p.t + dt, since })

    if (strategy === 'grid') {
      const jitterA = () => (rand() - 0.5) * irr * 0.45
      const jitterL = () => spacing * (1 + (rand() - 0.5) * irr * 0.6)
      next(angle + jitterA(), jitterL(), p.kind, 1)
      for (const side of [-1, 1]) {
        if (rand() < 1 - 0.35 * irr) next(angle + side * (Math.PI / 2) + jitterA(), jitterL(), 'secondary', 1)
      }
    } else if (strategy === 'organic') {
      // Wander: a smooth turn from noise sampled where the road is, so nearby
      // roads bend alike — streets, not a random walk.
      const wander = (valueNoise(x / 40, z / 40, params.seed) - 0.5) * irr * 1.6
      next(angle + wander, step * (0.85 + rand() * 0.3), p.kind, 1)
      const branchChance = (0.12 + 0.3 * density) * (p.kind === 'primary' ? 1.3 : 1)
      for (const side of [-1, 1]) {
        if (rand() < branchChance) {
          const spread = (rand() - 0.5) * (0.4 + irr * 0.9)
          next(angle + side * (Math.PI / 2 + spread), step, 'secondary', 3)
        }
      }
    } else {
      if (p.kind === 'primary') {
        const wander = (valueNoise(x / 70, z / 70, params.seed + 17) - 0.5) * irr * 0.9
        const since = p.since + p.length
        next(angle + wander, step, 'primary', 1, since >= spacing ? 0 : since)
        if (rand() < 0.035) next(angle + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.4), step, 'primary', 2)
        if (since >= spacing) {
          for (const side of [-1, 1]) next(angle + side * (Math.PI / 2), spacing, 'secondary', SECONDARY_DELAY)
        }
      } else {
        const jitterA = () => (rand() - 0.5) * irr * 0.3
        next(angle + jitterA(), spacing, 'secondary', 1)
        for (const side of [-1, 1]) {
          if (rand() < 1 - 0.3 * irr) next(angle + side * (Math.PI / 2) + jitterA(), spacing, 'secondary', 1)
        }
      }
    }
  }

  // Tidying. Growth leaves two kinds of loose end: a road that stopped a few
  // units short of another, and a branch that was refused one step out and
  // left as a stub. The first is joined to the road it points at, if that
  // closes a real loop; the second is removed. Real towns keep their
  // cul-de-sacs, so a dead end longer than a step stays.
  let closed = 0
  const reach = strategy === 'organic' ? step * 1.8 : spacing * 0.6
  const nodeCount = nodes.length
  for (let n = 0; n < nodeCount; n++) {
    if (adjacency[n].length !== 1) continue
    const a = nodes[n]
    const prev = nodes[other(edges[adjacency[n][0]], n)]
    const angle = Math.atan2(a.z - prev.z, a.x - prev.x)
    const hit = firstCrossing(n, a.x + Math.cos(angle) * reach, a.z + Math.sin(angle) * reach)
    if (!hit || hit.t * reach < 2) continue
    const local = within(n, 4)
    const e = edges[hit.edge]
    if (local.has(e.a) || local.has(e.b) || groundCheck(a.x, a.z, hit.x, hit.z)) continue
    const j = splitEdge(hit.edge, hit.x, hit.z)
    addEdge(n, j, edges[adjacency[n][0]].kind)
    closed++
  }
  const dead = new Uint8Array(edges.length)
  let trimmed = 0
  for (let n = 0; n < nodes.length; n++) {
    if (adjacency[n].length !== 1) continue
    // Walk back to the first junction, measuring.
    const chain: number[] = []
    let length = 0
    let at = n
    let via = -1
    for (let guard = 0; guard < 64; guard++) {
      const next = adjacency[at].find((id) => id !== via && !dead[id])
      if (next === undefined) break
      chain.push(next)
      const o = other(edges[next], at)
      length += Math.hypot(nodes[o].x - nodes[at].x, nodes[o].z - nodes[at].z)
      via = next
      at = o
      if (adjacency[at].filter((id) => !dead[id]).length !== 2) break
    }
    if (length < step * 1.1 && adjacency[at].filter((id) => !dead[id]).length >= 3) {
      for (const id of chain) dead[id] = 1
      trimmed++
    }
  }
  // Compact: drop removed roads and the junctions only they used.
  const keep = new Int32Array(nodes.length).fill(-1)
  const outNodes: RoadNode[] = []
  const outEdges: RoadEdge[] = []
  edges.forEach((e, id) => {
    if (dead[id]) return
    for (const n of [e.a, e.b]) {
      if (keep[n] < 0) {
        keep[n] = outNodes.length
        outNodes.push(nodes[n])
      }
    }
    outEdges.push({ ...e, a: keep[e.a], b: keep[e.b] })
  })

  return {
    nodes: outNodes,
    edges: outEdges,
    closed,
    trimmed,
    centre,
    proposals,
    grown,
    joined,
    snapped,
    extended,
    merged,
    rejected,
    ms: performance.now() - started,
  }
}

function strategyCode(s: RoadStrategy) {
  return s === 'grid' ? 1 : s === 'organic' ? 2 : 3
}

export function roadLength(net: RoadNetwork, kind?: RoadKind): number {
  let total = 0
  for (const e of net.edges) {
    if (kind && e.kind !== kind) continue
    const a = net.nodes[e.a]
    const b = net.nodes[e.b]
    total += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return total
}

export function degrees(net: RoadNetwork): number[] {
  const d = new Array(net.nodes.length).fill(0)
  for (const e of net.edges) {
    d[e.a]++
    d[e.b]++
  }
  return d
}

/** Distance from a point to the nearest road's edge (negative inside a road). */
export function roadClearance(net: RoadNetwork, x: number, z: number): number {
  let best = Infinity
  for (const e of net.edges) {
    const a = net.nodes[e.a]
    const b = net.nodes[e.b]
    const d = distanceToSegment(x, z, a.x, a.z, b.x, b.z) - e.width / 2
    if (d < best) best = d
  }
  return best
}
