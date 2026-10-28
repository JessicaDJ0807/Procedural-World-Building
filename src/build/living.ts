import { GLASS, type Building, type Volume } from '../green/building'
import { CLIMBER } from '../wildform/species'
import type { WildGrowth } from '../wildform/growth'
import { D, H, W, Town } from './town'

/**
 * Living architecture: what the plants build when they meet.
 *
 * Where the growth stacks — one plant grown over another — a **mutation
 * node** can form. What grows from it depends on what met there, read from
 * the cell's stack, and on everything around it:
 *
 * | Stack                     | Combination       | Grows                                  |
 * | ------------------------- | ----------------- | -------------------------------------- |
 * | two layers, both species  | Climber + Spreader | a bridge to another building in reach, or a balcony-pod if none |
 * | a Climber on two layers   | Climber + Layered  | a scaffold: helical rails and stair pads up past the roof |
 * | a Spreader on two layers  | Spreader + Layered | a terrace (at a roof) or canopy, fanned out from the wall |
 *
 * The Climber gives a vertical path, the Spreader horizontal reach; layered
 * growth is mass. So the combination sets the architectural identity, and
 * the context sets the form: the wall's facing, the plants' growth
 * directions, other buildings in reach, the room in front, the roof above.
 * Nothing is a prefab: every structure is a set of curves and swept
 * surfaces planned here and grown in stages (STAGES) over simulation steps:
 *
 *   node → structural frame → surface → mature (usable, casts shade) → vegetation
 *
 * Plain data — positions in the growth model's units (a block is 3) — so it
 * can be checked outside the browser; livingMesh.ts draws it.
 */

export type V3 = [number, number, number]
export type Combo = 'climber+spreader' | 'climber+layered' | 'spreader+layered'
export type Kind = 'bridge' | 'balcony' | 'scaffold' | 'terrace' | 'canopy'

/** A swept surface along a centreline: a deck, a pad, a canopy. */
export type Deck = { centre: V3[]; width: number[]; thickness: number[] }

export type Living = {
  id: number
  combo: Combo
  kind: Kind
  /** The step its node formed. */
  born: number
  node: V3
  normal: V3
  decks: Deck[]
  /** The structural frame: rails, keels, ribs, helices — drawn first. */
  frame: V3[][]
  /** Roots, braces and tendrils into walls and ground. */
  roots: V3[][]
  /** The block it grew from, and the block it reaches, if any (town grid). */
  ends: { from: [number, number, number]; to: [number, number, number] | null }
  matured: boolean
  seed: number
}

/** Stage windows, in steps after the node forms. Overlapping, so one flows into the next. */
export const STAGES = {
  node: [0, 30],
  frame: [20, 150],
  surface: [140, 300],
  mature: [280, 380],
  leaves: [360, 520],
} as const
/** When a structure becomes architecture: it casts shade and gives support. */
export const MATURE_AT = 300

export const COMBO_NAMES: Record<Combo, string> = {
  'climber+spreader': 'Climber + Spreader',
  'climber+layered': 'Climber + Layered',
  'spreader+layered': 'Spreader + Layered',
}
export const KIND_NAMES: Record<Kind, string> = {
  bridge: 'living bridge',
  balcony: 'living balcony',
  scaffold: 'living scaffold',
  terrace: 'living terrace',
  canopy: 'living canopy',
}

/** Cells of the same combination a node needs within NODE_RADIUS, by combination. */
const NEED: Record<Combo, number> = { 'climber+spreader': 6, 'climber+layered': 2, 'spreader+layered': 2 }
const NODE_RADIUS = 1.2
/** The growth there must be this old on average, in steps: established, not a passing tip. */
const MIN_AGE = 25
/** Nodes stay this far apart. */
const SPACING = 5
const MAX_STRUCTURES = 8
/** Not at the foot of a wall: a node there made its bridge a ramp from the lawn. */
const MIN_HEIGHT = 1.8
const S = 3

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const flat = (a: V3): V3 => norm([a[0], 0, a[2]])
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const UP: V3 = [0, 1, 0]
const rotY = (a: V3, ang: number): V3 => [a[0] * Math.cos(ang) + a[2] * Math.sin(ang), a[1], -a[0] * Math.sin(ang) + a[2] * Math.cos(ang)]

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Growth units to the town grid cell holding a point. */
export const toTown = (p: V3): [number, number, number] => [Math.floor(p[0] / S + W / 2), Math.floor(p[1] / S), Math.floor(p[2] / S + D / 2)]

/** What met in a cell, read from its stack; null if nothing has. */
export function comboOf(g: WildGrowth, cell: number): Combo | null {
  const d = g.depth[cell]
  // Both species must be in the stack. A plant never grows onto its own kind,
  // but when a middle layer withers the stack closes over the gap and can hold
  // one species twice: Spreader · Climber · Spreader losing its Climber is
  // Spreader · Spreader. Counting depth alone called that Climber + Spreader,
  // and it wasn't rare — at peak, 183 of 317 such cells in a default run
  // (292 of 423 when the sun moved mid-run) held one species twice.
  if (d < 2 || g.mask[cell] !== 3) return null
  if (d === 2) return 'climber+spreader'
  return g.top(cell) === CLIMBER ? 'climber+layered' : 'spreader+layered'
}

const cellPos = (b: Building, i: number): V3 => [b.px[i], b.py[i], b.pz[i]]

/**
 * Cells beyond walls where a node may form — pitched roofs and living
 * architecture (surfaces.ts) — and a horizontal direction to plan from, since
 * a deck top or a roof has no wall facing to grow out along.
 */
export type NodeSurfaces = { site: (cell: number) => boolean; facing: (cell: number) => V3 }

/**
 * Looks for a place a node can form: a wall cell where enough of one
 * combination has gathered, mature enough, clear of other structures.
 * The rarer layered combinations are checked first.
 */
export function findNode(g: WildGrowth, b: Building, living: Living[], skip: Set<number> = new Set(), surface?: NodeSurfaces): { cell: number; combo: Combo } | null {
  if (living.length >= MAX_STRUCTURES) return null
  const byCombo: Record<Combo, number[]> = { 'climber+layered': [], 'spreader+layered': [], 'climber+spreader': [] }
  for (let i = 0; i < g.N; i++) {
    if (!(b.segment[i] >= 0 || surface?.site(i)) || b.py[i] < MIN_HEIGHT || skip.has(i)) continue
    const c = comboOf(g, i)
    if (c) byCombo[c].push(i)
  }
  const MAX_LAYERS = g.stack.length / g.N
  for (const combo of ['climber+layered', 'spreader+layered', 'climber+spreader'] as Combo[]) {
    const cells = byCombo[combo].sort((p, q) => b.py[q] - b.py[p])
    for (const c of cells) {
      const p = cellPos(b, c)
      if (living.some((l) => len(add(l.node, scale(p, -1))) < SPACING)) continue
      let n = 0
      let age = 0
      for (const o of cells) {
        if (len(add(cellPos(b, o), scale(p, -1))) > NODE_RADIUS) continue
        n++
        age += g.step - g.entryBirth[g.stack[o * MAX_LAYERS + g.depth[o] - 1]]
      }
      if (n >= NEED[combo] && age / n >= MIN_AGE) return { cell: c, combo }
    }
  }
  return null
}

/** The average direction each species was growing in, near a point: horizontal unit vectors, or zero. Exported for the Architecture page's Growth view. */
export function growthDirections(g: WildGrowth, b: Building, p: V3): V3[] {
  const sum: V3[] = [
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (let k = 0; k < g.grown; k++) {
    const e = g.order[k]
    const parent = g.entryParent[e]
    if (parent < 0) continue
    const c = g.entryCell[e]
    if (Math.abs(b.px[c] - p[0]) > 1.5 || Math.abs(b.py[c] - p[1]) > 1.5 || Math.abs(b.pz[c] - p[2]) > 1.5) continue
    const pc = g.entryCell[parent]
    const s = g.entrySpecies[e]
    sum[s] = add(sum[s], [b.px[c] - b.px[pc], b.py[c] - b.py[pc], b.pz[c] - b.pz[pc]])
  }
  return sum.map((v) => (Math.hypot(v[0], v[2]) > 1e-3 ? flat(v) : ([0, 0, 0] as V3)))
}

type Hit = { point: V3; block: [number, number, number]; dist: number }

/**
 * Casts out from `origin` along each direction, at the origin's height and a
 * storey down or up, for a block of another building within `reach`. Stops
 * on its own building. Returns the nearest, preferring level.
 */
function findTarget(town: Town, masses: Int32Array, own: number, origin: V3, dirs: V3[], reach: number, rises = [0, -S, S]): Hit | null {
  let best: Hit | null = null
  let bestScore = Infinity
  for (const dir of dirs) {
    for (const rise of rises) {
      for (let t = 0.6; t <= reach; t += 0.25) {
        const q: V3 = [origin[0] + dir[0] * t, origin[1] + rise, origin[2] + dir[2] * t]
        if (q[1] < 0.2) break
        const [x, y, z] = toTown(q)
        if (!town.filled(x, y, z)) continue
        const m = masses[Town.index(x, y, z)]
        if (m === own) break
        // Step back to the face.
        let back = t
        while (back > 0 && town.filled(...toTown([origin[0] + dir[0] * back, q[1], origin[2] + dir[2] * back]))) back -= 0.05
        const point: V3 = [origin[0] + dir[0] * back, q[1], origin[2] + dir[2] * back]
        const score = back + Math.abs(rise) * 0.8
        if (score < bestScore) {
          bestScore = score
          best = { point, block: [x, y, z], dist: back }
        }
        break
      }
    }
  }
  return best
}

/** How far a point can go along a direction before meeting its own building, up to `reach`. */
function freeRun(town: Town, origin: V3, dir: V3, reach: number): number {
  for (let t = 0.5; t <= reach; t += 0.25) {
    if (town.filled(...toTown(add(origin, scale(dir, t))))) return t - 0.4
  }
  return reach
}

/** The roof level above a block: the top of its column of blocks, in growth units. */
function columnTop(town: Town, x: number, y: number, z: number): number {
  let top = y
  while (top + 1 < H && town.filled(x, top + 1, z)) top++
  return (top + 1) * S
}

const sample = (k: number, f: (t: number) => V3) => Array.from({ length: k }, (_, i) => f(i / (k - 1)))

/** Root tendrils fanning from a point down a wall plane (or into the ground): `count` curves. */
function rootFan(at: V3, along: V3, down: number, count: number, seed: number, out: V3 = [0, 0, 0]): V3[][] {
  return Array.from({ length: count }, (_, k) => {
    const spread = (k / Math.max(1, count - 1) - 0.5) * 2 * (0.6 + hash(seed + k) * 0.6)
    const drop = down * (0.6 + hash(seed + k * 7) * 0.5)
    return sample(5, (t) => add(add(at, scale(along, spread * t)), add([0, -drop * t * t, 0], scale(out, Math.sin(t * Math.PI) * 0.15))))
  })
}

/** Plans a structure from a node: what grows, shaped by the context. */
export function planLiving(g: WildGrowth, b: Building, town: Town, node: { cell: number; combo: Combo }, id: number, surface?: NodeSurfaces): Living {
  const i = node.cell
  const seed = id * 7919 + i
  const n: V3 = b.segment[i] >= 0 || !surface ? flat([b.nx[i], 0, b.nz[i]]) : flat(surface.facing(i))
  const tangent: V3 = [-n[2], 0, n[0]]
  const P: V3 = add(cellPos(b, i), scale(n, 0.12))
  const from = toTown(add(cellPos(b, i), scale(n, -0.3)))
  const masses = town.masses()
  const own = masses[Town.index(...from)]
  const [dC, dS] = growthDirections(g, b, P)
  const jitter = (hash(seed) - 0.5) * 0.3
  const base: Omit<Living, 'kind' | 'decks' | 'frame' | 'roots' | 'ends'> = { id, combo: node.combo, born: g.step, node: P, normal: n, matured: false, seed }
  const fans = [0, -0.35, 0.35, -0.7, 0.7].map((a) => rotY(n, a))

  if (node.combo === 'climber+spreader') {
    // The Climber's vertical path meets the Spreader's horizontal reach: a deck out from the wall.
    const toward = flat(add(n, scale(dS, 0.6)))
    const hit = findTarget(town, masses, own, P, [toward, ...fans], 5 * S)
    if (hit) {
      // Across the gap to the other building: an arched bridge, bowed the way the Spreader was going.
      const A = P
      const B = hit.point
      const span = len(add(B, scale(A, -1)))
      const along = flat(add(B, scale(A, -1)))
      const perp: V3 = [-along[2], 0, along[0]]
      const side = Math.max(-1, Math.min(1, dot(dS, perp) + jitter))
      const mid = add(scale(add(A, B), 0.5), add(scale(UP, 0.12 * span), scale(perp, side * 0.18 * span)))
      const curve = (t: number): V3 => add(add(scale(A, (1 - t) * (1 - t)), scale(mid, 2 * t * (1 - t))), scale(B, t * t))
      const pts = sample(15, curve)
      const half = (from: number, to: number) => {
        const c = pts.slice(Math.min(from, to), Math.max(from, to) + 1)
        return from > to ? c.reverse() : c
      }
      const w = (k: number, m: number) => Array.from({ length: m }, (_, j) => 1.7 - 0.55 * (j / (m - 1)) + (hash(seed + k * 31 + j) - 0.5) * 0.25)
      const th = (m: number) => Array.from({ length: m }, (_, j) => 0.42 - 0.14 * (j / (m - 1)))
      const left = half(0, 7)
      const right = half(14, 7)
      const rail = (o: number, dip: number) => pts.map((p, k) => add(add(p, scale(perp, o)), [0, -dip * Math.sin((k / 14) * Math.PI), 0]))
      return {
        ...base,
        kind: 'bridge',
        decks: [
          { centre: left, width: w(1, left.length), thickness: th(left.length) },
          { centre: right, width: w(2, right.length), thickness: th(right.length) },
        ],
        frame: [rail(0.55, 0.2), rail(-0.55, 0.2), rail(0, 0.45)],
        roots: [...rootFan(A, tangent, 2.2, 3, seed, n), ...rootFan(B, [-perp[0], 0, -perp[2]], 2.0, 3, seed + 99, scale(along, -1))],
        ends: { from, to: hit.block },
      }
    }
    // Nothing in reach: a balcony-pod, out along the growth, curling up at its lip.
    const dir = flat(add(add(n, scale(dS, 0.6)), scale(tangent, jitter)))
    const L = Math.max(2, Math.min(4.2, freeRun(town, P, dir, 4.2)))
    const side = dot(dS, tangent)
    const pts = sample(9, (t) => add(add(add(P, scale(dir, L * t)), scale(UP, 0.9 * t * t * t)), scale(tangent, side * 0.6 * t * t)))
    const width = pts.map((_, j) => {
      const t = j / (pts.length - 1)
      return 2.0 + 1.3 * Math.sin(Math.PI * t * 0.9) - 0.9 * t + (hash(seed + j) - 0.5) * 0.3
    })
    const thickness = pts.map((_, j) => 0.45 - 0.15 * (j / (pts.length - 1)))
    const under = add(P, scale(dir, L * 0.55))
    const braces = [-0.8, 0.8].map((o) => sample(6, (t) => add(add(add(P, [0, -2.6 * (1 - t), 0]), scale(tangent, o * (1 - t * 0.3))), add(scale(dir, L * 0.55 * t), [0, -0.3 * t + 0.1 * Math.sin(t * Math.PI), 0]))))
    const tip = pts[pts.length - 1]
    return {
      ...base,
      kind: 'balcony',
      decks: [{ centre: pts, width, thickness }],
      frame: [pts.map((p, j) => add(p, scale(tangent, width[j] * 0.42))), pts.map((p, j) => add(p, scale(tangent, -width[j] * 0.42))), pts.map((p) => add(p, [0, -0.3, 0]))],
      roots: [...braces, ...rootFan(P, tangent, 1.6, 2, seed), ...rootFan(tip, tangent, 1.0, 4, seed + 5, dir), ...rootFan(under, tangent, 0.8, 2, seed + 9)],
      ends: { from, to: null },
    }
  }

  if (node.combo === 'climber+layered') {
    // Vertical: a scaffold of three helical rails, leaning with the Climber, stair pads up past the roof.
    const top = columnTop(town, ...from) + S
    const bottom = Math.max(0.2, P[1] - 1.5)
    const lean = dC
    const axisAt = (y: number): V3 => add(add([P[0], y, P[2]], scale(n, 1.25)), scale(lean, ((y - bottom) / S) * 0.35))
    const turns = ((top - bottom) / S) * 0.55 * Math.PI * 2
    const rails = [0, 1, 2].map((k) =>
      sample(Math.max(8, Math.round((top - bottom) / 0.4)), (t) => {
        const y = bottom + (top - bottom) * t
        const a = (k * Math.PI * 2) / 3 + turns * t
        const r = 0.75 - 0.2 * t
        return add(axisAt(y), add(scale(n, Math.cos(a) * r), scale(tangent, Math.sin(a) * r)))
      }),
    )
    const decks: Deck[] = []
    for (let y = bottom + 1.0, k = 0; y < top - 0.6; y += 1.1, k++) {
      const a = turns * ((y - bottom) / (top - bottom)) + k * 0.4
      const radial: V3 = add(scale(n, Math.cos(a)), scale(tangent, Math.sin(a)))
      const tan: V3 = [-radial[2], 0, radial[0]]
      const c = add(axisAt(y), scale(radial, 0.35))
      decks.push({ centre: [add(c, scale(tan, -0.55)), c, add(c, scale(tan, 0.55))], width: [0.6, 1.0, 0.6], thickness: [0.16, 0.2, 0.16] })
    }
    const crown = axisAt(top)
    decks.push({ centre: [add(crown, scale(n, -0.9)), crown, add(crown, scale(n, 0.9))], width: [1.3, 2.2, 1.4], thickness: [0.28, 0.32, 0.26] })
    const ties: V3[][] = []
    for (let y = bottom + 1.5; y < top - 1; y += S) {
      const a = axisAt(y)
      ties.push(sample(4, (t) => add(add(a, scale(add([P[0], y, P[2]], scale(a, -1)), t)), [0, 0.25 * Math.sin(t * Math.PI), 0])))
    }
    // A crown in reach of another building throws an arm across to it.
    const hit = findTarget(town, masses, own, add(crown, [0, -0.5, 0]), [n, ...fans], 4 * S, [0, -S, -2 * S])
    if (hit) {
      const A = crown
      const B = hit.point
      const span = len(add(B, scale(A, -1)))
      const mid = add(scale(add(A, B), 0.5), scale(UP, 0.1 * span))
      const arm = sample(10, (t) => add(add(scale(A, (1 - t) * (1 - t)), scale(mid, 2 * t * (1 - t))), scale(B, t * t)))
      decks.push({ centre: arm, width: arm.map((_, j) => 1.3 - 0.3 * Math.sin((j / 9) * Math.PI)), thickness: arm.map(() => 0.26) })
    }
    return {
      ...base,
      kind: 'scaffold',
      decks,
      frame: rails,
      roots: [...ties, ...rootFan(axisAt(bottom), tangent, 0.6, 4, seed, n)],
      ends: { from, to: hit ? hit.block : null },
    }
  }

  // Spreader + Layered: mass spread wide — a terrace at the roof, or a canopy below it.
  const roof = columnTop(town, ...from)
  const atRoof = roof - P[1] <= 3.5
  const Y = atRoof ? roof : P[1] + 1.2
  const C0: V3 = [P[0], Y, P[2]]
  const dir = flat(add(n, scale(dS, 0.7)))
  const hit = findTarget(town, masses, own, add(C0, [0, -0.6, 0]), [dir, ...fans], 9, [0, -S])
  const L = hit ? hit.dist : Math.max(2.2, Math.min(4.6, freeRun(town, add(C0, [0, -0.6, 0]), dir, 4.6)))
  const end = hit ? hit.point : add(C0, scale(dir, L))
  const along = flat(add(end, scale(C0, -1)))
  const perp: V3 = [-along[2], 0, along[0]]
  const pts = sample(10, (t) => add(add(add(scale(C0, 1 - t), scale(end, t)), scale(UP, 0.35 * Math.sin(Math.PI * t))), scale(perp, dot(dS, perp) * 0.5 * Math.sin(Math.PI * t))))
  const width = pts.map((_, j) => {
    const t = j / (pts.length - 1)
    return (hit ? 2.6 + 1.6 * Math.sin(Math.PI * t) : 2.6 + 2.6 * Math.sin(Math.PI * t * 0.55)) + (hash(seed + j * 3) - 0.5) * 0.4
  })
  const thickness = pts.map((_, j) => 0.55 - 0.2 * (j / (pts.length - 1)))
  const far = pts[pts.length - 2]
  const ribs = [-0.42, -0.15, 0.15, 0.42].map((f) => pts.map((p, j) => add(add(p, scale(perp, width[j] * f)), [0, -0.25, 0])))
  const columns: V3[][] = []
  if (!hit && Y > 2) {
    for (const s of [-1, 1]) {
      const top = add(far, scale(perp, s * width[pts.length - 2] * 0.32))
      columns.push(sample(6, (t) => add(top, [s * perp[0] * 0.3 * Math.sin(t * Math.PI), -(top[1] + 0.3) * t, s * perp[2] * 0.3 * Math.sin(t * Math.PI)])))
      columns.push(...rootFan([top[0], 0.1, top[2]], perp, 0.4, 3, seed + s * 13, along))
    }
  }
  return {
    ...base,
    kind: atRoof ? 'terrace' : 'canopy',
    decks: [{ centre: pts, width, thickness }],
    frame: ribs,
    roots: [...columns, ...rootFan(C0, tangent, 2.0, 4, seed, n)],
    ends: { from, to: hit ? hit.block : null },
  }
}

/** Whether a structure joins two separate buildings as they stand now: both ends still there, in different masses. */
export function connects(l: Living, town: Town, masses: Int32Array): boolean {
  const to = l.ends.to
  if (!to || !town.filled(...l.ends.from) || !town.filled(...to)) return false
  return masses[Town.index(...l.ends.from)] !== masses[Town.index(...to)]
}

/** A mature structure's solids, for shadows: each stretch of deck as a slab. */
export function livingVolumes(l: Living): Volume[] {
  const out: Volume[] = []
  for (const d of l.decks) {
    for (let k = 0; k + 1 < d.centre.length; k++) {
      const a = d.centre[k]
      const c = d.centre[k + 1]
      const along = flat(add(c, scale(a, -1)))
      if (!Number.isFinite(along[0])) continue
      const perp: V3 = [-along[2], 0, along[0]]
      const wa = d.width[k] / 2
      const wc = d.width[k + 1] / 2
      out.push({
        polygon: [
          [a[0] + perp[0] * wa, a[2] + perp[2] * wa],
          [c[0] + perp[0] * wc, c[2] + perp[2] * wc],
          [c[0] - perp[0] * wc, c[2] - perp[2] * wc],
          [a[0] - perp[0] * wa, a[2] - perp[2] * wa],
        ],
        y0: Math.min(a[1], c[1]) - Math.max(d.thickness[k], d.thickness[k + 1]),
        y1: Math.max(a[1], c[1]),
      })
    }
  }
  return out
}

/** Wall cells a mature structure stands against: within 1 unit of its frame or roots. Support for climbers. */
export function livingSupport(l: Living, b: Building): number[] {
  const pts = [...l.frame.flat(), ...l.roots.flat()]
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); z0 = Math.min(z0, p[2])
    x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); z1 = Math.max(z1, p[2])
  }
  const out: number[] = []
  for (let i = 0; i < b.count; i++) {
    if (b.flags[i] & GLASS) continue
    const x = b.px[i], y = b.py[i], z = b.pz[i]
    if (x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1 || z < z0 - 1 || z > z1 + 1) continue
    if (pts.some((p) => Math.abs(p[0] - x) + Math.abs(p[1] - y) + Math.abs(p[2] - z) < 1.2)) out.push(i)
  }
  return out
}
