import { mulberry32 } from '../noise'
import {
  area,
  centroid,
  distanceToOutline,
  distanceToSegment,
  orientedBox,
  pointInPolygon,
  segmentHit,
  splitPolygon,
  type Obb,
  type Polygon,
  type Vec,
} from './geometry'
import type { Block } from './blocks'
import type { RoadNetwork } from './roads'

/**
 * Plots: each block cut into parcels.
 *
 * Both modes cut with the same operation — split a polygon by a line, which
 * works on concave blocks too (see `splitPolygon`) — and differ only in where
 * the lines go:
 *
 *   grid       lines at a fixed spacing along both axes of the block's
 *              oriented bounding box: regular lots, aligned to the block.
 *   irregular  recursive bisection, after Vanegas et al. (2012): take the
 *              piece's own bounding box, cut across its long side near the
 *              middle, and repeat on each half until it is small enough.
 *              Irregularity moves the cut off-centre and tilts it.
 *
 * Every plot is then checked for **frontage** — how much of its outline lies
 * on the block's kerb, i.e. faces a road. Recursive bisection can cut a deep
 * block into an inner plot with no road at all; that is a real result of the
 * method, not a bug, and the zoning rules make such plots gardens rather than
 * pretend they can be built on.
 *
 * Plots that a dead-end road crosses are dropped: dead ends are pruned before
 * the blocks are traced, so a cul-de-sac runs through the middle of its block.
 */
export type PlotMode = 'grid' | 'irregular'

export type PlotParams = {
  mode: PlotMode
  /** Target side length in world units; a plot is about this squared. */
  size: number
  /** 0–1: how far irregular cuts stray from the middle, and how far they tilt. */
  irregularity: number
  seed: number
}

export type Plot = {
  id: number
  block: number
  polygon: Polygon
  area: number
  centre: Vec
  box: Obb
  /** Outline length on the kerb, in world units. */
  frontage: number
  /** Unit direction from the plot toward its longest road-facing side; buildings face it. */
  facing: Vec
  /** Too small, or too thin, to build on. */
  sliver: boolean
}

export type PlotResult = {
  plots: Plot[]
  /** Pieces dropped because a dead-end road runs through them. */
  crossed: number
  ms: number
}

/** A plot narrower than this cannot take even the smallest building. */
export const MIN_PLOT_WIDTH = 5

export function subdivide(blocks: Block[], net: RoadNetwork, params: PlotParams): PlotResult {
  const started = performance.now()
  const target = params.size * params.size
  const plots: Plot[] = []
  let crossed = 0
  const deadEnds = deadEndSegments(net)

  for (const block of blocks) {
    const rand = mulberry32(params.seed * 131 + block.id * 7 + 3)
    const pieces = params.mode === 'grid' ? gridCut(block.outline, params.size) : bisect(block.outline, target, params.irregularity, rand)
    for (const polygon of pieces) {
      const a = area(polygon)
      if (a < 4) continue
      if (deadEnds.some((s) => segmentTouches(polygon, s))) {
        crossed++
        continue
      }
      const box = orientedBox(polygon)
      const { frontage, facing } = frontageOf(polygon, block.outline, box)
      const fill = a / Math.max(box.long * box.short, 1e-6)
      plots.push({
        id: plots.length,
        block: block.id,
        polygon,
        area: a,
        centre: centroid(polygon),
        box,
        frontage,
        facing,
        sliver: box.short < MIN_PLOT_WIDTH || a < target * 0.2 || fill < 0.45,
      })
    }
  }
  return { plots, crossed, ms: performance.now() - started }
}

function bisect(poly: Polygon, target: number, irregularity: number, rand: () => number, depth = 0): Polygon[] {
  const a = area(poly)
  if (a <= target * 1.4 || depth > 12) return [poly]
  const box = orientedBox(poly)
  // Cut across the long axis: the normal of the cut line is the long axis.
  const offset = (rand() - 0.5) * 0.5 * irregularity * box.long
  const tilt = (rand() - 0.5) * 0.6 * irregularity
  const nx = box.ux * Math.cos(tilt) - box.uz * Math.sin(tilt)
  const nz = box.ux * Math.sin(tilt) + box.uz * Math.cos(tilt)
  const px = box.cx + box.ux * offset
  const pz = box.cz + box.uz * offset
  const pieces = splitPolygon(poly, px, pz, nx, nz)
  if (pieces.length < 2) return [poly]
  return pieces.flatMap((p) => bisect(p, target, irregularity, rand, depth + 1))
}

/**
 * Lots on a regular lattice aligned to the block. Across the long axis the
 * spacing is the plot size; along it, 1.4× — plots deeper than they are wide,
 * as street frontage is the scarce side. The lattice is centred on the block
 * so the remainders fall evenly at both ends.
 */
function gridCut(poly: Polygon, size: number): Polygon[] {
  const box = orientedBox(poly)
  let pieces = [poly]
  const cut = (nx: number, nz: number, extent: number, spacing: number) => {
    const count = Math.max(1, Math.round(extent / spacing))
    const step = extent / count
    for (let k = 1; k < count; k++) {
      const s = -extent / 2 + k * step
      const px = box.cx + nx * s
      const pz = box.cz + nz * s
      pieces = pieces.flatMap((p) => splitPolygon(p, px, pz, nx, nz))
    }
  }
  cut(box.ux, box.uz, box.long, size)
  cut(-box.uz, box.ux, box.short, size * 1.4)
  return pieces
}

/** Length of the plot's outline that runs along the block's kerb, and which way it faces. */
function frontageOf(polygon: Polygon, kerb: Polygon, box: Obb): { frontage: number; facing: Vec } {
  let frontage = 0
  let longest = 0
  let facing: Vec = { x: box.ux, z: box.uz }
  const c = centroid(polygon)
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const mx = (a.x + b.x) / 2
    const mz = (a.z + b.z) / 2
    if (distanceToOutline(kerb, mx, mz) > 0.05) continue
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    frontage += len
    if (len > longest) {
      longest = len
      const d = Math.hypot(mx - c.x, mz - c.z) || 1
      facing = { x: (mx - c.x) / d, z: (mz - c.z) / d }
    }
  }
  return { frontage, facing }
}

type Segment = { ax: number; az: number; bx: number; bz: number; half: number }

/** Roads that end without a junction, plus the chains leading to them. */
function deadEndSegments(net: RoadNetwork): Segment[] {
  const degree = new Array(net.nodes.length).fill(0)
  for (const e of net.edges) {
    degree[e.a]++
    degree[e.b]++
  }
  // The same pruning as blocks.ts, to find exactly the roads it removed.
  const incident: number[][] = net.nodes.map(() => [])
  net.edges.forEach((e, i) => {
    incident[e.a].push(i)
    incident[e.b].push(i)
  })
  const removed = new Set<number>()
  const stack = net.nodes.map((_, i) => i).filter((i) => degree[i] === 1)
  while (stack.length) {
    const n = stack.pop()!
    if (degree[n] !== 1) continue
    const id = incident[n].find((k) => !removed.has(k))
    if (id === undefined) continue
    removed.add(id)
    const e = net.edges[id]
    degree[e.a]--
    degree[e.b]--
    const o = e.a === n ? e.b : e.a
    if (degree[o] === 1) stack.push(o)
  }
  return [...removed].map((id) => {
    const e = net.edges[id]
    const a = net.nodes[e.a]
    const b = net.nodes[e.b]
    return { ax: a.x, az: a.z, bx: b.x, bz: b.z, half: e.width / 2 }
  })
}

function segmentTouches(poly: Polygon, s: Segment): boolean {
  // Cheap reject on the bounding box.
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const p of poly) {
    if (p.x < x0) x0 = p.x
    if (p.x > x1) x1 = p.x
    if (p.z < z0) z0 = p.z
    if (p.z > z1) z1 = p.z
  }
  if (Math.max(s.ax, s.bx) + s.half < x0 || Math.min(s.ax, s.bx) - s.half > x1) return false
  if (Math.max(s.az, s.bz) + s.half < z0 || Math.min(s.az, s.bz) - s.half > z1) return false
  // Inside, or within half a road width of any side: a corner test alone
  // missed a plot side passing a dead end's tip (two plots on seed 1's
  // organic network).
  if (pointInPolygon(poly, s.ax, s.az) || pointInPolygon(poly, s.bx, s.bz)) return true
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (segmentDistance(a.x, a.z, b.x, b.z, s.ax, s.az, s.bx, s.bz) < s.half) return true
  }
  return false
}

function segmentDistance(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const hit = segmentHit(ax, az, bx - ax, bz - az, cx, cz, dx - cx, dz - cz)
  if (hit && hit.t >= 0 && hit.t <= 1 && hit.u >= 0 && hit.u <= 1) return 0
  return Math.min(
    distanceToSegment(ax, az, cx, cz, dx, dz),
    distanceToSegment(bx, bz, cx, cz, dx, dz),
    distanceToSegment(cx, cz, ax, az, bx, bz),
    distanceToSegment(dx, dz, ax, az, bx, bz),
  )
}
