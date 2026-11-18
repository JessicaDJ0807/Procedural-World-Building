import type { RoadNetwork } from '../roads'

/**
 * The road network as something to travel on.
 *
 * Experiments A–E treat roads as geometry; here they are a weighted graph —
 * junctions are nodes, roads are edges weighted by length — and two searches
 * run over it:
 *
 *   A*        one route between two junctions, for an inhabitant's trip. The
 *             straight-line distance to the goal is the heuristic: it never
 *             overestimates on roads, so the route is the shortest there is.
 *   Dijkstra  every junction's shortest route back to one source, for a
 *             utility plant distributing along the roads. The result is a
 *             tree — each junction knows its parent toward the plant — and
 *             the pipes are the tree's edges.
 *
 * Nothing here knows about cities: a graph of points and lengths is all it
 * needs, which is why Wildform could run it on a lattice of living platforms.
 */
export type Graph = {
  x: Float64Array
  z: Float64Array
  /** CSR adjacency: neighbours of n are adjTo[adjStart[n] .. adjStart[n+1]). */
  adjStart: Int32Array
  adjTo: Int32Array
  /** Index into the road network's edges, parallel to adjTo. */
  adjEdge: Int32Array
  adjLen: Float64Array
  /** Road edge → its two nodes and length. */
  edgeA: Int32Array
  edgeB: Int32Array
  edgeLen: Float64Array
  /** Road edge width, for capacity: a primary carries more. */
  edgeWidth: Float64Array
}

export function buildGraph(net: RoadNetwork): Graph {
  const n = net.nodes.length
  const m = net.edges.length
  const degree = new Int32Array(n)
  for (const e of net.edges) {
    degree[e.a]++
    degree[e.b]++
  }
  const adjStart = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) adjStart[i + 1] = adjStart[i] + degree[i]
  const fill = adjStart.slice(0, n)
  const adjTo = new Int32Array(m * 2)
  const adjEdge = new Int32Array(m * 2)
  const adjLen = new Float64Array(m * 2)
  const edgeA = new Int32Array(m)
  const edgeB = new Int32Array(m)
  const edgeLen = new Float64Array(m)
  const edgeWidth = new Float64Array(m)
  net.edges.forEach((e, i) => {
    const a = net.nodes[e.a]
    const b = net.nodes[e.b]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    edgeA[i] = e.a
    edgeB[i] = e.b
    edgeLen[i] = len
    edgeWidth[i] = e.width
    for (const [from, to] of [[e.a, e.b], [e.b, e.a]]) {
      const k = fill[from]++
      adjTo[k] = to
      adjEdge[k] = i
      adjLen[k] = len
    }
  })
  return {
    x: Float64Array.from(net.nodes, (p) => p.x),
    z: Float64Array.from(net.nodes, (p) => p.z),
    adjStart,
    adjTo,
    adjEdge,
    adjLen,
    edgeA,
    edgeB,
    edgeLen,
    edgeWidth,
  }
}

export function nearestNode(g: Graph, x: number, z: number): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < g.x.length; i++) {
    const d = (g.x[i] - x) ** 2 + (g.z[i] - z) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Binary min-heap of (key, value) pairs. */
class Heap {
  private keys: number[] = []
  private vals: number[] = []
  get size() {
    return this.keys.length
  }
  push(key: number, val: number) {
    const k = this.keys
    const v = this.vals
    k.push(key)
    v.push(val)
    let i = k.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= k[i]) break
      ;[k[p], k[i]] = [k[i], k[p]]
      ;[v[p], v[i]] = [v[i], v[p]]
      i = p
    }
  }
  pop(): number {
    const k = this.keys
    const v = this.vals
    const top = v[0]
    const lk = k.pop()!
    const lv = v.pop()!
    if (k.length) {
      k[0] = lk
      v[0] = lv
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < k.length && k[l] < k[s]) s = l
        if (r < k.length && k[r] < k[s]) s = r
        if (s === i) break
        ;[k[s], k[i]] = [k[i], k[s]]
        ;[v[s], v[i]] = [v[i], v[s]]
        i = s
      }
    }
    return top
  }
}

export type Route = { nodes: number[]; length: number; expanded: number }

/** A* from one junction to another. Null if they are not connected. */
export function findRoute(g: Graph, from: number, to: number): Route | null {
  if (from === to) return { nodes: [from], length: 0, expanded: 0 }
  const n = g.x.length
  const dist = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const h = (i: number) => Math.hypot(g.x[i] - g.x[to], g.z[i] - g.z[to])
  const open = new Heap()
  dist[from] = 0
  open.push(h(from), from)
  let expanded = 0
  while (open.size) {
    const u = open.pop()
    if (closed[u]) continue
    closed[u] = 1
    expanded++
    if (u === to) break
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const v = g.adjTo[k]
      const d = dist[u] + g.adjLen[k]
      if (d < dist[v]) {
        dist[v] = d
        prev[v] = u
        open.push(d + h(v), v)
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null
  const nodes: number[] = []
  for (let v = to; v !== -1; v = prev[v]) nodes.push(v)
  nodes.reverse()
  return { nodes, length: dist[to], expanded }
}

/**
 * Dijkstra from a source: distance and parent toward the source for every
 * junction, and which road edge joins each junction to its parent.
 */
export type Tree = { dist: Float64Array; parent: Int32Array; parentEdge: Int32Array; order: Int32Array }

export function shortestTree(g: Graph, source: number): Tree {
  const n = g.x.length
  const dist = new Float64Array(n).fill(Infinity)
  const parent = new Int32Array(n).fill(-1)
  const parentEdge = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)
  const order: number[] = []
  const open = new Heap()
  dist[source] = 0
  open.push(0, source)
  while (open.size) {
    const u = open.pop()
    if (done[u]) continue
    done[u] = 1
    order.push(u)
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const v = g.adjTo[k]
      const d = dist[u] + g.adjLen[k]
      if (d < dist[v]) {
        dist[v] = d
        parent[v] = u
        parentEdge[v] = g.adjEdge[k]
        open.push(d, v)
      }
    }
  }
  return { dist, parent, parentEdge, order: Int32Array.from(order) }
}
