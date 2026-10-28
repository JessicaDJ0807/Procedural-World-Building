import { EDGE, FRAME, GLASS, UNGROWABLE, type Building } from '../green/building'
import type { SurfaceOverlay, World } from '../wildform/world'
import type { Living, V3 } from './living'
import { D, H, W, type Town } from './town'
import { ROOF_SHAPE, roofKind } from './townMesh'

/**
 * Surfaces beyond walls and flat roofs: pitched roofs, and the surfaces of
 * living architecture — so that geometry decides how plants behave on them,
 * rather than some meshes taking plants and others not.
 *
 * The growth model's cells (building.ts) are vertical walls and flat roofs.
 * A hip or gable roof was drawn as a solid with no cells under it, and a
 * living bridge was a shadow and a support, with nothing growing on it: plants
 * reached a pitched roof's eave or a deck's root plate and stopped. Here each
 * of those becomes a **patch** — a grid of cells laid on the surface as drawn
 * — appended to the town's building and **stitched** to the cells beside it,
 * so growth moves from wall to eave to ridge, and from wall to root to deck.
 *
 * Every cell then carries what a plant needs to know about its surface:
 *
 *     semantic (roof slope, ridge, eave, deck top, rim, underside, support…)
 *     slope → runoff → how much water it keeps
 *     semantic → attachment (something to hold: an edge, a rib)
 *     slope + semantic → per-species affinity, a weight on suitability
 *
 * No surface is reserved for a species. A steep roof is poor for the Spreader
 * and still possible; a deck top is the Spreader's best place on a structure
 * and the Climber can still cross it. Only glass is invalid, as before.
 *
 * Kept out of building.ts on purpose: the invented building and the campus
 * use `assembleBuilding` as it is, and their runs stay identical.
 */

// --- surface kinds ---

export const SURFACE = {
  wall: 0,
  roofFlat: 1,
  roofSlope: 2,
  ridge: 3,
  eave: 4,
  gable: 5,
  deckTop: 6,
  deckRim: 7,
  underside: 8,
  support: 9,
  junction: 10,
} as const
export type SurfaceKind = (typeof SURFACE)[keyof typeof SURFACE]

export const SURFACE_NAMES: Record<SurfaceKind, string> = {
  0: 'wall',
  1: 'flat roof',
  2: 'roof slope',
  3: 'ridge',
  4: 'eave',
  5: 'gable end',
  6: 'deck top',
  7: 'deck rim',
  8: 'underside',
  9: 'support',
  10: 'junction',
}

/** Where a surface came from. */
export type SurfaceSource = 'block' | 'roof' | 'living'

export type SurfaceInfo = {
  /** Cells of the town's own building; the rest are patches. */
  baseCount: number
  kind: Uint8Array
  /** Degrees from horizontal: 0 a flat roof, 90 a wall, beyond 90 facing down. */
  slope: Float32Array
  /** 0–1: something to hold — an edge, a rib, a ridge. */
  attachment: Float32Array
  /** 0–1: the share of rain a surface keeps; 1 − runoff. */
  retention: Float32Array
  /** The living structure a cell belongs to, or −1. */
  structure: Int16Array
  /** A horizontal direction for planning a structure from this cell (a deck top has no wall facing). */
  planX: Float32Array
  planZ: Float32Array
  /** Per species (Climber, Spreader), 0–1. */
  affinity: Float32Array[]
  /** 0–1: how good a hanging anchor is here, for the debug view. Drapers anchor on edges (draper.ts). */
  draper: Float32Array
}

// --- the rule: geometry → water, attachment, affinity ---

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Water a surface keeps, from its slope: a flat roof keeps all of what lands
 * on it, and the steeper the pitch the more runs off. Continuous, not a
 * class: 1 flat, 0.80 at the gable's 31°, 0.49 at the hip's 49°, 0.36 at
 * 60°. A first curve (1 − 0.8·smoothstep(3°, 60°)) kept 0.60 at 31°, and the
 * gable's slopes grew almost nothing — moderate behaved like steep.
 */
export function retentionOf(slope: number): number {
  return 1 - 0.7 * smooth(10, 70, Math.min(90, slope))
}

/**
 * How well a surface suits each behaviour — a weight on suitability, never a
 * gate. Walls keep 1 for both, so the walls grow as they always did.
 *
 * - **Spreader** wants broad, flat, open surface: full on a flat roof or deck
 *   top, easing off with slope (0.80 at 31°, 0.62 at 49°), poor on a narrow
 *   rib or an underside, fair on a rim. Gently: slope already costs it water
 *   through runoff, and a first version that also took 0.3 + 0.7·flatness
 *   charged slope twice — a Spreader seeded on the 31° gable died before it
 *   spread.
 * - **Climber** wants something to hold: full on ridges, eaves, rims, ribs
 *   and junctions; on a plain roof or deck, about half, more as the slope
 *   steepens (it traverses a pitch better than it covers a flat).
 */
export function affinityOf(kind: SurfaceKind, slope: number, attachment: number): [number, number] {
  const flatness = 1 - smooth(5, 60, Math.min(90, slope))
  switch (kind) {
    case SURFACE.wall:
    case SURFACE.gable:
      return [1, 1]
    case SURFACE.roofFlat:
    case SURFACE.roofSlope:
    case SURFACE.deckTop:
      return [0.45 + 0.35 * attachment + 0.2 * (1 - flatness), 0.7 + 0.3 * flatness]
    case SURFACE.ridge:
    case SURFACE.eave:
    case SURFACE.deckRim:
      return [1, 0.45 + 0.3 * flatness]
    case SURFACE.support:
      return [1, 0.3]
    case SURFACE.underside:
      return [0.5, 0.25]
    case SURFACE.junction:
      return [1, 0.9]
  }
  return [1, 1]
}

/** A hanging anchor's quality, for the debug view: edges, rims and undersides best. */
function draperOf(kind: SurfaceKind, slope: number): number {
  switch (kind) {
    case SURFACE.eave:
    case SURFACE.deckRim:
      return 1
    case SURFACE.underside:
      return 0.9
    case SURFACE.junction:
      return 0.6
    case SURFACE.ridge:
      return 0.5
    case SURFACE.support:
      return 0.35
    case SURFACE.roofSlope:
    case SURFACE.roofFlat:
    case SURFACE.deckTop:
      return 0.1 + 0.15 * smooth(20, 60, slope)
  }
  return 0.15
}

// --- patches ---

type PatchCell = { p: V3; n: V3; a: V3; u: V3; kind: SurfaceKind; attachment?: number }

/** A grid of cells on one surface; `at` returns null where the grid falls outside it. */
type Patch = {
  cols: number
  rows: number
  at: (i: number, j: number) => PatchCell | null
  source: SurfaceSource
  structure: number
  /** For planning a structure from these cells. */
  plan: (c: PatchCell) => V3
}

const CELL = 0.25
const S = 3
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1))
const flatDir = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[2])
  return l > 1e-4 ? [a[0] / l, 0, a[2] / l] : [0, 0, 0]
}
/** Just off the surface as drawn, so leaves sit on it rather than in it. */
const LIFT = 0.03

const blockCentre = (x: number, z: number): [number, number] => [(x - W / 2 + 0.5) * S, (z - D / 2 + 0.5) * S]

/**
 * A triangular or rectangular roof face, from its eave line up to the ridge or
 * apex: `mid` the middle of the eave, `across` along it (unit), `halfBase` its
 * half-length, `top` the apex or ridge midpoint, `taper` 1 for a hip face (a
 * triangle) or 0 for a gable face (a rectangle).
 */
function roofFace(mid: V3, across: V3, halfBase: number, top: V3, taper: number, outward: V3): Patch {
  const upSlope = sub(top, mid)
  const slant = len(upSlope)
  const rows = Math.max(2, Math.round(slant / CELL))
  const cols = Math.max(2, Math.round((halfBase * 2) / CELL))
  let n = norm(cross(across, upSlope))
  if (dot(n, outward) < 0) n = scale(n, -1)
  const u = norm(upSlope)
  return {
    cols,
    rows,
    source: 'roof',
    structure: -1,
    plan: () => flatDir(n),
    at: (i, j) => {
      const v = (j + 0.5) / rows
      const s = ((i + 0.5) / cols) * 2 - 1
      const reach = 1 - taper * v
      if (Math.abs(s) > reach - (taper ? 0.5 / cols : 0)) return null
      const p = add(add(add(mid, scale(across, s * halfBase)), scale(upSlope, v)), scale(n, LIFT))
      // The bottom row is the eave; the top row, or a hip face's sloping
      // sides, the ridge. Both are edges — something to hold, and a line
      // the Climber follows.
      const kind: SurfaceKind = j === 0 ? SURFACE.eave : j === rows - 1 || (taper && Math.abs(s) > reach - 2.2 / cols) ? SURFACE.ridge : SURFACE.roofSlope
      return { p, n, a: across, u, kind }
    },
  }
}

/** A gable end: a vertical triangle above the end wall of a row. */
function gableEnd(base: V3, across: V3, halfBase: number, rise: number, outward: V3): Patch {
  const rows = Math.max(2, Math.round(rise / CELL))
  const cols = Math.max(2, Math.round((halfBase * 2) / CELL))
  return {
    cols,
    rows,
    source: 'roof',
    structure: -1,
    plan: () => outward,
    at: (i, j) => {
      const v = (j + 0.5) / rows
      const s = ((i + 0.5) / cols) * 2 - 1
      if (Math.abs(s) > 1 - v - 0.5 / cols) return null
      const p = add(add(add(base, scale(across, s * halfBase)), [0, v * rise, 0]), scale(outward, LIFT))
      return { p, n: outward, a: across, u: [0, 1, 0], kind: SURFACE.gable }
    },
  }
}

/** Patches for every pitched roof in the town, matching townMesh's shapes (ROOF_SHAPE). */
export function roofPatches(town: Town): Patch[] {
  const out: Patch[] = []
  const has = (x: number, y: number, z: number) => town.filled(x, y, z)
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const kind = roofKind(town, x, y, z)
        if (!kind || kind === 'terrace') continue
        const [cx, cz] = blockCentre(x, z)
        const eaveY = (y + 1 + ROOF_SHAPE.eave) * S
        if (kind === 'hip') {
          const half = ROOF_SHAPE.hip.half * S
          const apex: V3 = [cx, eaveY + ROOF_SHAPE.hip.rise * S, cz]
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const out_: V3 = [dx, 0, dz]
            out.push(roofFace([cx + dx * half, eaveY, cz + dz * half], [-dz, 0, dx], half, apex, 1, out_))
          }
        } else {
          // A gable over a row: two rectangular slopes per block, ridge along the row.
          const alongX = kind === 'gable-x'
          const ridgeDir: V3 = alongX ? [1, 0, 0] : [0, 0, 1]
          const perp: V3 = alongX ? [0, 0, 1] : [1, 0, 0]
          const half = ROOF_SHAPE.gable.half * S
          const rise = ROOF_SHAPE.gable.rise * S
          for (const s of [1, -1]) {
            const side = scale(perp, s)
            const mid: V3 = [cx + side[0] * half, eaveY, cz + side[2] * half]
            const ridge: V3 = [cx, eaveY + rise, cz]
            out.push(roofFace(mid, ridgeDir, S / 2, ridge, 0, side))
          }
          // Gable ends where the row stops.
          for (const s of [1, -1]) {
            const open = alongX ? !has(x + s, y, z) : !has(x, y, z + s)
            if (!open) continue
            const outward = scale(ridgeDir, s)
            const base: V3 = [cx + outward[0] * 0.506 * S, eaveY, cz + outward[2] * 0.506 * S]
            // The end wall's triangle, at the roof's own slope (townMesh draws it so).
            out.push(gableEnd(base, perp, 0.49 * S, ((ROOF_SHAPE.gable.rise * 0.98) / (ROOF_SHAPE.gable.half * 2)) * S, outward))
          }
        }
      }
    }
  }
  return out
}

/** Evenly spaced points along a polyline, every `step`, with their tangents and interpolated values. */
function resample(pts: V3[], step: number, values: number[][] = []): { p: V3; t: V3; v: number[] }[] {
  const out: { p: V3; t: V3; v: number[] }[] = []
  const seg: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const l = len(sub(pts[i], pts[i - 1]))
    seg.push(l)
    total += l
  }
  if (total < step) return out
  const n = Math.max(2, Math.round(total / step))
  let i = 0
  let acc = 0
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * total
    while (i < seg.length - 1 && acc + seg[i] < s) acc += seg[i++]
    const f = seg[i] > 0 ? Math.min(1, (s - acc) / seg[i]) : 0
    const p = add(pts[i], scale(sub(pts[i + 1], pts[i]), f))
    const t = norm(sub(pts[i + 1], pts[i]))
    out.push({ p, t, v: values.map((arr) => arr[i] + (arr[i + 1] - arr[i]) * f) })
  }
  return out
}

/**
 * Patches for a mature living structure, by part — the semantic regions:
 *
 * - each deck's **top** (and its rim, the outer fifth either side), swept
 *   along the centreline with the deck's own domed section;
 * - each deck's **underside**, the deeper curve beneath;
 * - every rail, keel, rib, helix and root as a **support**: a one-cell strip
 *   along the upper side of the tube;
 * - **junctions**: deck cells near the node and at the deck's ends, where it
 *   roots into a wall, and the ends of each support.
 */
export function livingPatches(l: Living): Patch[] {
  const out: Patch[] = []
  const UP: V3 = [0, 1, 0]
  for (const d of l.decks) {
    const rows = resample(d.centre, CELL, [d.width, d.thickness])
    if (rows.length < 2) continue
    const maxW = Math.max(...d.width)
    const cols = Math.max(2, Math.round((maxW * 0.94) / CELL))
    for (const top of [true, false]) {
      out.push({
        cols,
        rows: rows.length,
        source: 'living',
        structure: l.id,
        plan: (c) => flatDir(c.a),
        at: (i, j) => {
          const r = rows[j]
          const w = r.v[0] / 2
          const h = r.v[1]
          // Columns sized for the widest point: narrower stretches use fewer.
          const f = ((i + 0.5) / cols) * 2 - 1
          const span = (w * 0.94) / ((maxW * 0.94) / 2)
          if (Math.abs(f) > span) return null
          const ff = f / span
          const side: V3 = norm([r.t[2], 0, -r.t[0]])
          // The deck's section (livingMesh deckGeometry): x = sign·|cos|^0.7·w,
          // a flattish top 0.22·h·sin above the centre, the underside h·sin below.
          const ca = ff
          const sa = Math.sqrt(Math.max(0, 1 - ca * ca))
          const u = Math.sign(ca) * Math.pow(Math.abs(ca), 0.7) * w
          const y = top ? 0.22 * h * sa + LIFT : -h * sa - LIFT
          const p = add(add(r.p, scale(side, u)), [0, y, 0])
          const n = norm(add(top ? UP : [0, -1, 0], scale(side, ff * (top ? 0.35 : 0.6))))
          const nearNode = len(sub(r.p, l.node)) < 1.2
          const atEnd = j === 0 || j === rows.length - 1
          const kind: SurfaceKind = top
            ? nearNode || atEnd
              ? SURFACE.junction
              : Math.abs(ff) > 0.8
                ? SURFACE.deckRim
                : SURFACE.deckTop
            : SURFACE.underside
          return { p, n, a: side, u: r.t, kind }
        },
      })
    }
  }
  // Supports: a strip along the upper side of each tube.
  const centre = l.decks[0]?.centre[Math.floor((l.decks[0]?.centre.length ?? 1) / 2)] ?? l.node
  // A root column's trunk strands are supports like any frame member: climbable. Cables aren't — too slight.
  for (const tube of [...l.frame, ...l.roots, ...(l.trunks ?? [])]) {
    const rows = resample(tube, CELL)
    if (rows.length < 2) continue
    out.push({
      cols: 1,
      rows: rows.length,
      source: 'living',
      structure: l.id,
      plan: (c) => flatDir(c.n),
      at: (_i, j) => {
        const r = rows[j]
        let t = r.t
        if (t[1] < 0) t = scale(t, -1)
        // The side facing up; on a vertical tube, the side facing away from the structure.
        let n = sub(UP, scale(t, dot(t, UP)))
        if (len(n) < 0.3) n = flatDir(sub(r.p, centre))
        n = norm(len(n) > 0 ? n : [1, 0, 0])
        const p = add(r.p, scale(n, 0.1 + LIFT))
        const kind: SurfaceKind = j === 0 || j === rows.length - 1 ? SURFACE.junction : SURFACE.support
        return { p, n, a: norm(cross(n, t)), u: t, kind }
      },
    })
  }
  return out
}

// --- appending and stitching ---

/** Neighbour slots, (across, up): (−1,−1) (0,−1) (1,−1) (−1,0) (1,0) (−1,1) (0,1) (1,1). */
const SLOTS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]
/** Within this, an edge cell of a patch is joined to the nearest cell of another surface. */
const STITCH = 0.45
/** Diagonal slots a full wall cell may give up for a stitch: it keeps its four straight neighbours. */
const SPARE = [7, 5, 2, 0]

/**
 * The town's building with patches appended: new cells after the old, the
 * old cells' neighbours untouched except where a patch is stitched to them.
 * Each patch's own grid gives its cells' neighbours; any edge cell then joins
 * the nearest cells of other surfaces within STITCH — an eave to the top of
 * the wall under it, a hip face to the next, a root to the wall it grips, a
 * deck's rim to its underside. A wall cell with all eight neighbours gives up
 * a diagonal for the stitch, so growth can step onto the patch as well as off
 * it.
 */
export function appendSurfaces(base: Building, patches: Patch[]): { building: Building; info: SurfaceInfo } {
  const N0 = base.count
  const cells: (PatchCell & { patch: number; source: SurfaceSource; structure: number; plan: V3 })[] = []
  const grids: Int32Array[] = []
  patches.forEach((patch, k) => {
    const grid = new Int32Array(patch.cols * patch.rows).fill(-1)
    for (let j = 0; j < patch.rows; j++)
      for (let i = 0; i < patch.cols; i++) {
        const c = patch.at(i, j)
        if (!c) continue
        grid[j * patch.cols + i] = N0 + cells.length
        cells.push({ ...c, patch: k, source: patch.source, structure: patch.structure, plan: patch.plan(c) })
      }
    grids.push(grid)
  })
  const N = N0 + cells.length
  const f32 = (src: Float32Array, pick: (c: (typeof cells)[number]) => number) => {
    const out = new Float32Array(N)
    out.set(src)
    cells.forEach((c, k) => (out[N0 + k] = pick(c)))
    return out
  }
  const px = f32(base.px, (c) => c.p[0])
  const py = f32(base.py, (c) => c.p[1])
  const pz = f32(base.pz, (c) => c.p[2])
  const nx = f32(base.nx, (c) => c.n[0])
  const ny = f32(base.ny, (c) => c.n[1])
  const nz = f32(base.nz, (c) => c.n[2])
  const ax = f32(base.ax, (c) => c.a[0])
  const ay = f32(base.ay, (c) => c.a[1])
  const az = f32(base.az, (c) => c.a[2])
  const ux = f32(base.ux, (c) => c.u[0])
  const uy = f32(base.uy, (c) => c.u[1])
  const uz = f32(base.uz, (c) => c.u[2])
  const along = f32(base.along, () => 0)
  const cornerDist = f32(base.cornerDist, () => Infinity)
  const flags = new Uint8Array(N)
  flags.set(base.flags)
  const segment = new Int16Array(N)
  segment.set(base.segment)
  const cornerInside = new Uint8Array(N)
  cornerInside.set(base.cornerInside)
  const texel = new Int32Array(N)
  texel.set(base.texel)
  const neighbours = new Int32Array(N * 8).fill(-1)
  neighbours.set(base.neighbours)

  cells.forEach((c, k) => {
    const id = N0 + k
    segment[id] = -1
    // Edges are features: the geometry field reads them, so the Climber follows them.
    if (c.kind === SURFACE.ridge || c.kind === SURFACE.eave || c.kind === SURFACE.deckRim || c.kind === SURFACE.junction) flags[id] |= EDGE
    if (c.kind === SURFACE.support) flags[id] |= FRAME
  })

  // The patch's own grid.
  patches.forEach((patch, k) => {
    const grid = grids[k]
    for (let j = 0; j < patch.rows; j++)
      for (let i = 0; i < patch.cols; i++) {
        const id = grid[j * patch.cols + i]
        if (id < 0) continue
        SLOTS.forEach(([di, dj], s) => {
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= patch.cols || jj >= patch.rows) return
          const n = grid[jj * patch.cols + ii]
          if (n >= 0) neighbours[id * 8 + s] = n
        })
      }
  })

  // Stitches, through a spatial hash of every cell.
  const R = STITCH
  const hash = new Map<string, number[]>()
  const keyOf = (x: number, y: number, z: number) => `${Math.floor(x / R)},${Math.floor(y / R)},${Math.floor(z / R)}`
  for (let i = 0; i < N; i++) {
    if (flags[i] & UNGROWABLE) continue
    const key = keyOf(px[i], py[i], pz[i])
    const list = hash.get(key)
    if (list) list.push(i)
    else hash.set(key, [i])
  }
  const patchOf = (i: number) => (i < N0 ? -1 : cells[i - N0].patch)
  const has = (i: number, j: number) => {
    for (let s = 0; s < 8; s++) if (neighbours[i * 8 + s] === j) return true
    return false
  }
  const give = (i: number, j: number): boolean => {
    if (has(i, j)) return true
    for (let s = 0; s < 8; s++)
      if (neighbours[i * 8 + s] < 0) {
        neighbours[i * 8 + s] = j
        return true
      }
    // Full: give up a diagonal that leads to another cell of the same surface.
    for (const s of SPARE) {
      const o = neighbours[i * 8 + s]
      if (o >= 0 && patchOf(o) === patchOf(i)) {
        neighbours[i * 8 + s] = j
        return true
      }
    }
    return false
  }
  for (let k = 0; k < cells.length; k++) {
    const id = N0 + k
    let free = 0
    for (let s = 0; s < 8; s++) if (neighbours[id * 8 + s] < 0) free++
    if (!free) continue
    const bx = Math.floor(px[id] / R)
    const by = Math.floor(py[id] / R)
    const bz = Math.floor(pz[id] / R)
    const near: [number, number][] = []
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = hash.get(`${bx + dx},${by + dy},${bz + dz}`)
          if (!list) continue
          for (const j of list) {
            if (patchOf(j) === cells[k].patch) continue
            const d = Math.hypot(px[j] - px[id], py[j] - py[id], pz[j] - pz[id])
            if (d < R) near.push([j, d])
          }
        }
    near.sort((a, b) => a[1] - b[1])
    let joined = 0
    for (const [j] of near) {
      if (joined >= Math.min(free, 2)) break
      if (give(id, j) && give(j, id)) joined++
    }
  }

  const building: Building = {
    ...base,
    count: N,
    px, py, pz, nx, ny, nz, ax, ay, az, ux, uy, uz,
    flags, neighbours, segment, along, cornerDist, cornerInside, texel,
  }

  // --- what every cell is ---
  const kind = new Uint8Array(N)
  const slope = new Float32Array(N)
  const attachment = new Float32Array(N)
  const retention = new Float32Array(N)
  const structure = new Int16Array(N).fill(-1)
  const planX = new Float32Array(N)
  const planZ = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    slope[i] = (Math.acos(Math.max(-1, Math.min(1, ny[i]))) * 180) / Math.PI
    if (i < N0) {
      kind[i] = segment[i] >= 0 ? SURFACE.wall : SURFACE.roofFlat
      attachment[i] = flags[i] & (EDGE | FRAME) ? 1 : 0.2
      planX[i] = nx[i]
      planZ[i] = nz[i]
    } else {
      const c = cells[i - N0]
      kind[i] = c.kind
      attachment[i] = c.kind === SURFACE.roofSlope || c.kind === SURFACE.deckTop || c.kind === SURFACE.underside ? 0.2 : 1
      structure[i] = c.structure
      planX[i] = c.plan[0]
      planZ[i] = c.plan[2]
    }
    retention[i] = retentionOf(slope[i])
  }
  const affinity = [new Float32Array(N), new Float32Array(N)]
  const draper = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    if (flags[i] & GLASS) continue
    const [c, s] = affinityOf(kind[i] as SurfaceKind, slope[i], attachment[i])
    affinity[0][i] = c
    affinity[1][i] = s
    // The top row of a wall, under a roof's eave or at a terrace's edge, is a ledge to hang from.
    draper[i] = kind[i] === SURFACE.wall ? (flags[i] & EDGE || neighbours[i * 8 + 6] < 0 || neighbours[i * 8 + 6] >= N0 ? 0.8 : 0.12) : draperOf(kind[i] as SurfaceKind, slope[i])
  }
  return { building, info: { baseCount: N0, kind, slope, attachment, retention, structure, planX, planZ, affinity, draper } }
}

/**
 * The fields for the cells the base rules don't know, and the affinities.
 *
 * Moisture: the base rule gives a flat roof rain × 0.6 and a wall rain × 0.35
 * plus what runs down it. A patch cell gets the roof's catch scaled by its
 * retention — so a 49° hip roof keeps about half what a terrace keeps — with
 * the water it sheds landing on its eave, which comes out wetter than the
 * slope above it; a ridge sheds both ways; a support is wetted like a wall; an
 * underside, out of the rain but shaded and still, stays damp. Then the same evaporation and saturation as the
 * base rule. Light: an underside sees half the sky.
 */
export function surfaceOverlay(info: SurfaceInfo): SurfaceOverlay {
  return {
    affinity: info.affinity,
    adjust(world: World) {
      const b = world.building
      const rain = world.rain
      for (let i = info.baseCount; i < b.count; i++) {
        if (b.flags[i] & UNGROWABLE) continue
        const k = info.kind[i]
        const keep = info.retention[i]
        if (k === SURFACE.underside) world.sun[i] *= 0.5
        let raw: number
        switch (k) {
          case SURFACE.eave:
            // What it keeps, plus a share of what the slope above it sheds.
            raw = rain * 0.6 * (keep + 0.6 * (1 - keep))
            break
          case SURFACE.ridge:
            raw = rain * 0.6 * keep * 0.7
            break
          case SURFACE.gable:
          case SURFACE.support:
            raw = rain * 0.35 * (k === SURFACE.support ? 0.8 : 1)
            break
          case SURFACE.underside:
            // Out of the rain, but shaded and still: damp rather than dry.
            raw = rain * 0.3 + 0.08
            break
          case SURFACE.junction:
            // Water gathers where a structure meets what holds it.
            raw = rain * 0.6 * 1.1
            break
          default:
            raw = rain * 0.6 * keep
        }
        raw *= 1 - 0.55 * world.sun[i]
        world.moisture[i] = 1 - Math.exp(-1.6 * raw)
      }
    },
  }
}
