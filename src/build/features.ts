/**
 * Lines through the land — the stream and the footpaths — as data: smooth
 * polylines with a width (and, for the stream, a water level) at every point,
 * and a bucketed index for "how far is this point from the line, and where
 * along it". Pure and seeded, like the rest of the landscape: planned once
 * when a `Landscape` is made, from its own terrain.
 */

export type Line = {
  x: number[]
  z: number[]
  /** Arc length from the first point, units. */
  s: number[]
  /** Half-width at each point, units. */
  half: number[]
  /** Stream only: the water surface at each point, non-increasing downstream. */
  level?: number[]
  /** Stream only: how far its banks reach past the water — wider where the channel is cut deeper. */
  bank?: number[]
  /**
   * Stream only: how much wider the water is to the left (+) than the right (−) of its line, as
   * a share of its half-width — the inside of a bend, where a shallow bar builds, is the wider.
   */
  skew?: number[]
  /** Stream only: signed bend, +1 a hard left, −1 a hard right — which bank is the outside, cut one. */
  bend?: number[]
  /** Stream only: how much deeper than usual the bed is here (pools), 1 and up. */
  deep?: number[]
  /** Stream only: the bank's character along the stream, 0–1: stony, and lush. */
  rocky?: number[]
  lush?: number[]
  /** Stream only: the water's pace, units per second at the surface: quicker where it's narrow. */
  pace?: number[]
  /** Stream only: the flow pattern's coordinate — ∫ ds / pace — so a pattern moved along it at a constant rate moves with the water. */
  phase?: number[]
  /** Paths only: how strongly the path shows at each point, 0–1 (it fades into the forest). */
  wear?: number[]
}

/** The nearest point of a line: distance, segment, how far along it, and which side (+1: left of the direction of travel). */
export type Nearest = { d: number; i: number; t: number; side: number }

/** Nearest-segment lookup in square buckets: a point is checked only against segments near it. */
export class LineIndex {
  private readonly buckets = new Map<number, number[]>()
  readonly line: Line
  private readonly cell: number
  /** `reach`: how far from the line a query may find it — one distance, or one per point (a stream's banks widen where it's cut in). */
  constructor(line: Line, cell = 4, reach: number | number[] = 4) {
    this.line = line
    this.cell = cell
    const { x, z } = line
    for (let i = 0; i + 1 < x.length; i++) {
      const r = typeof reach === 'number' ? reach : Math.max(reach[i], reach[i + 1])
      const x0 = Math.min(x[i], x[i + 1]) - r
      const x1 = Math.max(x[i], x[i + 1]) + r
      const z0 = Math.min(z[i], z[i + 1]) - r
      const z1 = Math.max(z[i], z[i + 1]) + r
      for (let bx = Math.floor(x0 / cell); bx <= Math.floor(x1 / cell); bx++)
        for (let bz = Math.floor(z0 / cell); bz <= Math.floor(z1 / cell); bz++) {
          const k = this.key(bx, bz)
          const list = this.buckets.get(k)
          if (list) list.push(i)
          else this.buckets.set(k, [i])
        }
    }
  }
  private key(bx: number, bz: number) {
    return (bx + 1000) * 4096 + (bz + 1000)
  }
  /** The nearest point of the line within `reach` (as built), or null. */
  nearest(px: number, pz: number): Nearest | null {
    const list = this.buckets.get(this.key(Math.floor(px / this.cell), Math.floor(pz / this.cell)))
    if (!list) return null
    const { x, z } = this.line
    let best: Nearest | null = null
    for (const i of list) {
      const ax = x[i], az = z[i]
      const dx = x[i + 1] - ax, dz = z[i + 1] - az
      const len2 = dx * dx + dz * dz || 1e-9
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2))
      const d = Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
      if (!best || d < best.d) best = { d, i, t, side: dx * (pz - az) - dz * (px - ax) >= 0 ? 1 : -1 }
    }
    return best
  }
  /** A per-point value of the line at a nearest hit, interpolated along its segment. */
  at(values: number[], n: Nearest): number {
    return values[n.i] + (values[n.i + 1] - values[n.i]) * n.t
  }
}

/** Corner-cutting (Chaikin): each pass rounds every corner, keeping the ends. */
export function chaikin(x: number[], z: number[], passes: number): [number[], number[]] {
  for (let p = 0; p < passes; p++) {
    const nx = [x[0]]
    const nz = [z[0]]
    for (let i = 0; i + 1 < x.length; i++) {
      nx.push(0.75 * x[i] + 0.25 * x[i + 1], 0.25 * x[i] + 0.75 * x[i + 1])
      nz.push(0.75 * z[i] + 0.25 * z[i + 1], 0.25 * z[i] + 0.75 * z[i + 1])
    }
    nx.push(x[x.length - 1])
    nz.push(z[z.length - 1])
    x = nx
    z = nz
  }
  return [x, z]
}

/** Points every `step` units along a polyline, with their arc lengths. */
export function resample(x: number[], z: number[], step: number): { x: number[]; z: number[]; s: number[] } {
  const ox = [x[0]]
  const oz = [z[0]]
  const os = [0]
  let carry = 0
  let total = 0
  for (let i = 0; i + 1 < x.length; i++) {
    const dx = x[i + 1] - x[i], dz = z[i + 1] - z[i]
    const len = Math.hypot(dx, dz)
    let at = step - carry
    while (at <= len) {
      ox.push(x[i] + (dx * at) / len)
      oz.push(z[i] + (dz * at) / len)
      os.push(total + at)
      at += step
    }
    carry = len - (at - step)
    total += len
  }
  if (carry > step * 0.3) {
    ox.push(x[x.length - 1])
    oz.push(z[z.length - 1])
    os.push(total)
  }
  return { x: ox, z: oz, s: os }
}

/**
 * The cheapest route between two points over a 1-unit grid (A*, eight
 * neighbours), where `cost(x, z)` is the price of standing on a cell
 * (Infinity: never). Used for the footpaths, so they go round steep ground and
 * the stream instead of straight at their ends.
 */
export function route(from: [number, number], to: [number, number], cost: (x: number, z: number) => number, margin = 24): [number, number][] | null {
  const x0 = Math.floor(Math.min(from[0], to[0]) - margin)
  const z0 = Math.floor(Math.min(from[1], to[1]) - margin)
  const nx = Math.ceil(Math.max(from[0], to[0]) + margin) - x0 + 1
  const nz = Math.ceil(Math.max(from[1], to[1]) + margin) - z0 + 1
  const id = (ix: number, iz: number) => iz * nx + ix
  const start = id(Math.round(from[0]) - x0, Math.round(from[1]) - z0)
  const goal = id(Math.round(to[0]) - x0, Math.round(to[1]) - z0)
  const g = new Float64Array(nx * nz).fill(Infinity)
  const prev = new Int32Array(nx * nz).fill(-1)
  const cellCost = new Float64Array(nx * nz).fill(NaN)
  const price = (k: number) => {
    if (Number.isNaN(cellCost[k])) cellCost[k] = cost(x0 + (k % nx), z0 + Math.floor(k / nx))
    return cellCost[k]
  }
  const gx = to[0], gz = to[1]
  // A binary heap of [f, node].
  const heap: [number, number][] = []
  const push = (f: number, k: number) => {
    heap.push([f, k])
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  g[start] = 0
  push(0, start)
  while (heap.length) {
    const [, k] = pop()
    if (k === goal) break
    const ix = k % nx, iz = Math.floor(k / nx)
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue
        const jx = ix + dx, jz = iz + dz
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue
        const j = id(jx, jz)
        const c = price(j)
        if (!Number.isFinite(c)) continue
        const step = (dx && dz ? Math.SQRT2 : 1) * c
        if (g[k] + step < g[j]) {
          g[j] = g[k] + step
          prev[j] = k
          push(g[j] + Math.hypot(x0 + jx - gx, z0 + jz - gz), j)
        }
      }
  }
  if (prev[goal] < 0 && goal !== start) return null
  const out: [number, number][] = []
  for (let k = goal; k >= 0; k = prev[k]) out.push([x0 + (k % nx), z0 + Math.floor(k / nx)])
  return out.reverse()
}
