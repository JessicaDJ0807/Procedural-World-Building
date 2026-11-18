import { area, inset, signedArea, simplify, type Polygon } from './geometry'
import type { RoadNetwork } from './roads'

/**
 * City blocks: the faces of the road graph.
 *
 * Because every crossing in the network is a junction, the roads form a planar
 * graph, and the land they enclose can be read straight off it. At each
 * junction the roads leaving it are sorted by angle; walking along a road and,
 * at every junction, taking the next road clockwise from the one you arrived
 * on traces the boundary of one face with the face on your left. Every
 * directed road is walked once. Enclosed faces come out counter-clockwise —
 * positive area — and the single outer face of each connected network comes
 * out clockwise and is discarded.
 *
 * Dead ends are pruned first. A cul-de-sac inside a block would be walked up
 * one side and down the other, leaving a zero-width spike in the face that no
 * inset can survive. Pruning repeatedly removes degree-1 junctions until none
 * are left; the roads stay drawn, and the plots they would cross are found and
 * dropped later, in `plots.ts`.
 *
 * Each face is then moved inward by half the width of the road on each side,
 * plus a setback, so a block's outline is the kerb rather than the
 * centreline. Faces too small to survive that are counted, not hidden.
 */
export type Block = {
  id: number
  /** The kerb line: the face inset by each road's half-width plus the setback. */
  outline: Polygon
  /** The face itself, on the road centrelines. */
  face: Polygon
  area: number
}

export type BlockResult = {
  blocks: Block[]
  /** Faces enclosed by roads before insetting. */
  faces: number
  /** Faces lost to the inset: too narrow for a plot between their roads. */
  slivers: number
  /** Faces over the size limit: farmland between arterials, not a block. */
  oversized: number
  prunedDeadEnds: number
  ms: number
}

/** Kerb to plot line. */
export const SETBACK = 1.2
const MIN_BLOCK_AREA = 40
const MAX_BLOCK_AREA = 9000

export function extractBlocks(net: RoadNetwork): BlockResult {
  const started = performance.now()
  const { nodes, edges } = net
  const alive = new Array(edges.length).fill(true)
  const degree = new Array(nodes.length).fill(0)
  for (const e of edges) {
    degree[e.a]++
    degree[e.b]++
  }
  const incident: number[][] = nodes.map(() => [])
  edges.forEach((e, i) => {
    incident[e.a].push(i)
    incident[e.b].push(i)
  })

  // Prune dead ends until none remain.
  let pruned = 0
  const stack = nodes.map((_, i) => i).filter((i) => degree[i] === 1)
  while (stack.length) {
    const n = stack.pop()!
    if (degree[n] !== 1) continue
    const id = incident[n].find((k) => alive[k])
    if (id === undefined) continue
    alive[id] = false
    pruned++
    const e = edges[id]
    degree[e.a]--
    degree[e.b]--
    const o = e.a === n ? e.b : e.a
    if (degree[o] === 1) stack.push(o)
  }

  // Half-edges: 2i is a→b, 2i+1 is b→a. Outgoing half-edges per node, by angle.
  const from = (h: number) => (h & 1 ? edges[h >> 1].b : edges[h >> 1].a)
  const to = (h: number) => (h & 1 ? edges[h >> 1].a : edges[h >> 1].b)
  const angleOf = (h: number) => {
    const a = nodes[from(h)]
    const b = nodes[to(h)]
    return Math.atan2(b.z - a.z, b.x - a.x)
  }
  const out: number[][] = nodes.map(() => [])
  for (let i = 0; i < edges.length; i++) {
    if (!alive[i]) continue
    out[edges[i].a].push(2 * i)
    out[edges[i].b].push(2 * i + 1)
  }
  const position = new Map<number, number>()
  for (const list of out) {
    list.sort((p, q) => angleOf(p) - angleOf(q))
    list.forEach((h, k) => position.set(h, k))
  }

  const seen = new Uint8Array(edges.length * 2)
  const blocks: Block[] = []
  let faces = 0
  let slivers = 0
  let oversized = 0
  for (let h0 = 0; h0 < edges.length * 2; h0++) {
    if (!alive[h0 >> 1] || seen[h0]) continue
    const face: Polygon = []
    const halfWidths: number[] = []
    let h = h0
    for (let guard = 0; guard < edges.length * 2 + 2; guard++) {
      seen[h] = 1
      face.push({ ...nodes[from(h)] })
      halfWidths.push(edges[h >> 1].width / 2 + SETBACK)
      // Arrived at to(h). The reverse half-edge is h ^ 1; the next road
      // clockwise from it is the one before it in counter-clockwise order.
      const v = to(h)
      const list = out[v]
      const k = position.get(h ^ 1)!
      h = list[(k - 1 + list.length) % list.length]
      if (h === h0) break
    }
    const a = signedArea(face)
    if (a <= 0) continue
    faces++
    if (a > MAX_BLOCK_AREA) {
      oversized++
      continue
    }
    const outline = insetFace(face, halfWidths)
    if (!outline || area(outline) < MIN_BLOCK_AREA) {
      slivers++
      continue
    }
    blocks.push({ id: blocks.length, outline, face, area: area(outline) })
  }
  return { blocks, faces, slivers, oversized, prunedDeadEnds: pruned, ms: performance.now() - started }
}

/**
 * Inset with collinear runs merged first: an organic street is a chain of
 * short segments, and offsetting each one separately would solve dozens of
 * near-parallel corners for no change in shape. Each merged side keeps the
 * widest road along it.
 */
function insetFace(face: Polygon, halfWidths: number[]): Polygon | null {
  const simple = simplify(face, 0.35)
  const widths = simple.map((p, i) => {
    const q = simple[(i + 1) % simple.length]
    // The widest road whose start lies on this merged side.
    let w = 0
    for (let k = 0; k < face.length; k++) {
      const f = face[k]
      const onSide =
        Math.abs((q.x - p.x) * (f.z - p.z) - (q.z - p.z) * (f.x - p.x)) / (Math.hypot(q.x - p.x, q.z - p.z) || 1) < 0.5 &&
        (f.x - p.x) * (q.x - p.x) + (f.z - p.z) * (q.z - p.z) >= -1e-6 &&
        (f.x - q.x) * (p.x - q.x) + (f.z - q.z) * (p.z - q.z) > 1e-6
      if (onSide) w = Math.max(w, halfWidths[k])
    }
    return w || halfWidths[0]
  })
  return inset(simple, widths)
}
