import { shortestTree, type Graph, type Tree } from './graph'
import type { Place } from './places'

/**
 * Resource flow: one plant per resource, distributing along the roads.
 *
 * The network is the shortest-path tree from the plant over the road graph —
 * pipes and cables under the streets, each junction fed by its parent toward
 * the plant. Every building connects at the junction nearest its door. Each
 * minute, every resource is allocated by one explicit rule:
 *
 *   consumers are served nearest-first (by distance along the network);
 *   each gets the least of what it asks for — rationed first, under the
 *   shared policy — what the plant has left, and the spare capacity of the
 *   tightest pipe on its way.
 *
 * What it asked for and did not get is a **shortage**, and is put down to one
 * cause: *supply* if the plant had run out, *network* if a pipe was the
 * limit. What the plant made and nobody received is **unused supply**; what a
 * pipe could carry and did not is **unused capacity**.
 *
 * Nearest-first is a choice, not physics — a real grid shares a shortage out
 * by pressure — but it makes the result legible: the end of the line goes
 * short first, which is what the map shows. `Policy` offers the other
 * extreme, and the two fail in opposite ways (see the Topic 10 chapter).
 *
 * Waste runs the same algorithm with the arrows reversed: buildings "ask" to
 * have their waste collected, the depot's capacity is the supply, and
 * uncollected waste is the shortage.
 */
export type ResourceId = 'water' | 'energy' | 'waste'
export const RESOURCES: ResourceId[] = ['water', 'energy', 'waste']

/** Units per person per minute: what one inhabitant inside a building uses. */
export const PER_PERSON: Record<ResourceId, number> = { water: 1, energy: 1, waste: 0.5 }

export type Network = {
  resource: ResourceId
  source: number
  tree: Tree
  /** Places in service order: nearest to the plant first. Unreachable ones last. */
  order: number[]
  /** Capacity of the pipe from each junction's parent to it, per unit of capacity scale. */
  pipeWeight: Float64Array
}

export type Allocation = {
  delivered: Float64Array
  /** Flow through each junction's parent pipe. */
  flow: Float64Array
  capacity: Float64Array
  demand: number
  supply: number
  given: number
  shortSupply: number
  shortNetwork: number
  unreachable: number
  /** Pipes running at 99% or more of capacity. */
  saturated: number
  /** Pipes carrying anything. */
  used: number
  /** Mean share of capacity used, over pipes in use. */
  utilisation: number
}

export function buildNetwork(resource: ResourceId, graph: Graph, places: Place[], source: number): Network {
  const tree = shortestTree(graph, source)
  const order = places
    .filter((p) => p.kind !== 'park')
    .map((p) => p.id)
    .sort((a, b) => tree.dist[places[a].node] - tree.dist[places[b].node] || a - b)
  // A primary road carries a trunk main; a lane a branch. Capacity scales
  // with road width, so the arterials the layered strategy grows first are
  // also the city's mains.
  const pipeWeight = new Float64Array(graph.x.length)
  for (let n = 0; n < graph.x.length; n++) {
    const e = tree.parentEdge[n]
    pipeWeight[n] = e >= 0 ? graph.edgeWidth[e] / 5 : 0
  }
  return { resource, source, tree, order, pipeWeight }
}

/**
 * Where each plant goes, from the ground and the plan: water works at the
 * junction nearest open water, the power station at the junction farthest
 * from the centre, the waste depot as far as it can be from both the centre
 * and the power station.
 */
export function placePlants(graph: Graph, centre: { x: number; z: number }, waterDistance: (x: number, z: number) => number): Record<ResourceId, number> {
  const n = graph.x.length
  let water = 0
  let energy = 0
  let bestW = Infinity
  let bestE = -1
  for (let i = 0; i < n; i++) {
    const w = waterDistance(graph.x[i], graph.z[i])
    if (w < bestW) {
      bestW = w
      water = i
    }
    const d = Math.hypot(graph.x[i] - centre.x, graph.z[i] - centre.z)
    if (d > bestE) {
      bestE = d
      energy = i
    }
  }
  let waste = 0
  let bestX = -1
  for (let i = 0; i < n; i++) {
    if (i === energy || i === water) continue
    const s = Math.min(Math.hypot(graph.x[i] - centre.x, graph.z[i] - centre.z), Math.hypot(graph.x[i] - graph.x[energy], graph.z[i] - graph.z[energy]))
    if (s > bestX) {
      bestX = s
      waste = i
    }
  }
  return { water, energy, waste }
}

/**
 * Who goes short when there is not enough.
 *
 *   nearest  serve in order of distance along the network; the end of the
 *            line gets whatever is left, which may be nothing
 *   shared   every building is rationed to the same fraction — supply over
 *            demand — before the pipes are applied, so a shortfall is spread
 *            thin instead of landing whole on the far buildings
 *
 * Pipes limit both the same way, nearest-first, since a pipe that is full
 * is full whoever is downstream.
 */
export type Policy = 'nearest' | 'shared'

export function allocate(net: Network, places: Place[], demand: Float64Array, supply: number, capacityScale: number, policy: Policy = 'nearest'): Allocation {
  const n = net.tree.parent.length
  const capacity = new Float64Array(n)
  for (let i = 0; i < n; i++) capacity[i] = net.pipeWeight[i] * capacityScale
  const left = Float64Array.from(capacity)
  const delivered = new Float64Array(places.length)
  let remaining = supply
  let total = 0
  let given = 0
  let shortSupply = 0
  let shortNetwork = 0
  let unreachable = 0
  const { parent, dist } = net.tree
  let ration = 1
  if (policy === 'shared') {
    let asked = 0
    for (const id of net.order) if (Number.isFinite(dist[places[id].node])) asked += Math.max(0, demand[id])
    ration = asked > supply ? supply / asked : 1
  }
  for (const id of net.order) {
    const want = demand[id]
    if (want <= 0) continue
    total += want
    const node = places[id].node
    if (!Number.isFinite(dist[node])) {
      unreachable += want
      continue
    }
    let tightest = Infinity
    for (let v = node; v !== net.source; v = parent[v]) if (left[v] < tightest) tightest = left[v]
    // Three limits; the smallest binds. The ration and the plant are both
    // supply; a pipe is the network.
    const bySupply = Math.min(want * ration, remaining)
    const give = Math.max(0, Math.min(bySupply, tightest))
    if (give > 0) {
      for (let v = node; v !== net.source; v = parent[v]) left[v] -= give
      remaining -= give
      delivered[id] = give
      given += give
    }
    const short = want - give
    if (short > 1e-9) {
      if (tightest < bySupply) shortNetwork += short
      else shortSupply += short
    }
  }
  const flow = new Float64Array(n)
  let saturated = 0
  let used = 0
  let util = 0
  for (let i = 0; i < n; i++) {
    flow[i] = capacity[i] - left[i]
    if (flow[i] > 1e-9) {
      used++
      util += flow[i] / capacity[i]
      if (flow[i] >= capacity[i] * 0.99) saturated++
    }
  }
  return {
    delivered,
    flow,
    capacity,
    demand: total,
    supply,
    given,
    shortSupply,
    shortNetwork,
    unreachable,
    saturated,
    used,
    utilisation: used ? util / used : 0,
  }
}
