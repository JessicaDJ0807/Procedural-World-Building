import { UNGROWABLE, type Building } from '../green/building'
import type { WildGrowth } from '../wildform/growth'
import type { World } from '../wildform/world'
import { lawnHeight } from './lawn'
import type { Living, V3 } from './living'
import { D, W, type Town } from './town'
import { TOWN_SCALE as S } from './townBuilding'

/**
 * The Draper: a plant that hangs.
 *
 * Climber goes up and Spreader goes sideways. Draper goes **down**: from an
 * elevated edge — a roof's eave, a string course, the soffit of an arch, the
 * edge of a living bridge or terrace — it lets strands fall under gravity,
 * and over time they gather into a curtain.
 *
 * It is its own model, not a third Wildform species. Wildform's plants live
 * on wall cells, each growing into a neighbour; a hanging strand spends most
 * of its length in open air below an edge, where there are no cells.
 * Draper still reads the same world: the sun and moisture where it hangs, the
 * Climber growth beneath it, the town it hangs past or lands on, and the
 * living architecture it hangs from. All in the growth model's units.
 *
 * The rules:
 *
 * 1. **Anchoring.** A Draper needs an edge at the top: the top edge of an open
 *    wall face (a roof eave, or a string course where a storey continues
 *    above), the bottom edge of a block with nothing under it (an overhang,
 *    an arch), or the edge of a mature living structure's deck. Not the lawn.
 * 2. **Direction.** Each strand grows down. A slow sway along the edge and a
 *    little drift outward keep it from hanging like a cable; gravity
 *    dominates.
 * 3. **Surface.** Where there is a wall behind, a strand clings lightly — it
 *    is drawn toward a small, wavering gap off the façade. Where there is
 *    none (below an overhang, under a bridge) it hangs free.
 * 4. **Contact.** A strand that reaches the lawn **roots**, and a small patch
 *    of Draper grows round the root (groundCover.ts). A strand that meets a
 *    block — a lower roof, a wing — rests on it and stops.
 * 5. **Density.** A Draper sprouts a strand every SPROUT_EVERY steps, in
 *    small clusters spreading out along its edge from where it was planted,
 *    up to MAX_STRANDS — a curtain, not a line. The strands near the middle
 *    are longest, so the curtain's hem curves.
 *
 * Ecology: it likes **moderate moisture and part sun** — the lee of a
 * building, the filtered light under a deck — and slows in full sun or on a
 * dry wall. Two interactions:
 *
 * - **Veil.** Over a wall where Climber has grown, a Draper has something to
 *   mingle with: it grows half as many strands again, a little faster.
 * - **Spreading onto living architecture.** An established Draper whose edge
 *   comes within reach of a mature living structure's deck edge, or whose
 *   strands hang past one, attaches to it, and a new curtain starts there —
 *   at most twice per planted Draper, and a curtain that spread doesn't
 *   spread again. Living architecture gets
 *   inhabited without the player planting every edge.
 */

export type EdgeKind = 'roof' | 'ledge' | 'overhang' | 'living'

export type EdgeSource =
  | { block: [number, number, number]; side: [number, number]; level: 'top' | 'bottom' }
  | { living: number; deck: number; side: 1 | -1 }

/** An edge a Draper hangs from: a polyline, the outward normal at each point, and where it came from. */
export type Edge = { kind: EdgeKind; path: V3[]; out: V3[]; source: EdgeSource }

export type Contact = 'free' | 'ground' | 'surface'

export type Strand = {
  /** Distance along the edge from the Draper's anchor. */
  offset: number
  /** The step it sprouts. */
  birth: number
  /** How long it has grown. */
  length: number
  /** Its share of the Draper's reach: longer in the middle, so the hem curves. */
  share: number
  seed: number
  /** The path it would follow, laid out every SEG; grown along as far as `length`. */
  path: V3[]
  /** What the end of the path meets. */
  contact: Contact
  /** The step it rooted in the lawn, −1 if not. */
  rootedAt: number
}

export type Draper = {
  id: number
  born: number
  edge: Edge
  /** The anchor: where it was planted, and its distance along the edge. */
  anchor: V3
  s0: number
  seed: number
  strands: Strand[]
  /** Light and moisture over the wall it hangs across. */
  sun: number
  moisture: number
  /** 0.15–1.15: how well it grows here. */
  vigour: number
  /** Over Climber growth: a denser, faster veil. */
  veil: boolean
  /** The Draper it spread from, for one spread onto living architecture. */
  from: number | null
  /** The living structure its curtain made (draperLiving.ts), once it has: one each. */
  formed?: number
}

/** Strand node spacing. */
export const SEG = 0.22
/** Growth a step, at vigour 1. */
const RATE = 0.03
export const SPROUT_EVERY = 24
export const MAX_STRANDS = 9
/** The longest a strand gets: about three storeys. */
const MAX_REACH = 10
/** Off the face, where a strand starts. */
const LIP = 0.2
/** Blocks along an edge on either side of the one clicked: a curtain's widest run. */
const RUN = 3
/** A Draper may spread onto a living deck edge within this of its edge, or of a grown strand. */
const SPREAD_REACH = 2.6
const STRAND_REACH = 1.2
/** Curtains one planted Draper may start on living architecture. */
const SPREADS = 2
/** Steps before a Draper is established enough to spread. */
const SPREAD_AGE = 160
export const MAX_DRAPERS = 18
/** Steps between looks at light, moisture, Climber underneath and living edges in reach. */
const LOOK_EVERY = 10

// --- small vector helpers ---
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1))

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Whether a point (growth units) is inside a block. */
function solid(town: Town, p: V3): boolean {
  return town.filled(Math.floor(p[0] / S + W / 2), Math.floor(p[1] / S), Math.floor(p[2] / S + D / 2))
}

// --- edges ---

/** Whether a block's side has a Draper edge at the top or bottom, and what kind. */
function edgeKindAt(town: Town, x: number, y: number, z: number, dx: number, dz: number, level: 'top' | 'bottom'): EdgeKind | null {
  if (!town.filled(x, y, z) || town.filled(x + dx, y, z + dz)) return null
  if (level === 'top') {
    // The space in front of the edge must be open, up as well as across.
    if (town.filled(x + dx, y + 1, z + dz)) return null
    return town.filled(x, y + 1, z) ? 'ledge' : 'roof'
  }
  return y > 0 && !town.filled(x, y - 1, z) ? 'overhang' : null
}

/**
 * The edge along a block's side, run on along the neighbouring blocks with the
 * same edge, up to RUN blocks either way — so a curtain can widen along an
 * eave or a ledge rather than stop at one block.
 */
export function blockEdge(town: Town, x: number, y: number, z: number, dx: number, dz: number, level: 'top' | 'bottom'): Edge | null {
  const kind = edgeKindAt(town, x, y, z, dx, dz, level)
  if (!kind) return null
  const tx = -dz
  const tz = dx
  let lo = 0
  let hi = 0
  while (lo > -RUN && edgeKindAt(town, x + tx * (lo - 1), y, z + tz * (lo - 1), dx, dz, level) === kind) lo--
  while (hi < RUN && edgeKindAt(town, x + tx * (hi + 1), y, z + tz * (hi + 1), dx, dz, level) === kind) hi++
  const wx = x - W / 2 + 0.5
  const wz = z - D / 2 + 0.5
  const ey = (level === 'top' ? y + 1 : y) * S - (level === 'top' ? 0.05 : 0.02)
  const at = (k: number): V3 => [(wx + dx * 0.5 + tx * k) * S + dx * LIP, ey, (wz + dz * 0.5 + tz * k) * S + dz * LIP]
  const out: V3 = [dx, 0, dz]
  return { kind, path: [at(lo - 0.48), at(hi + 0.48)], out: [out, out], source: { block: [x, y, z], side: [dx, dz], level } }
}

/** One side edge of a living structure's deck, just under its rim. */
export function livingEdge(l: Living, deck: number, side: 1 | -1): Edge | null {
  const d = l.decks[deck]
  if (!d || d.centre.length < 2) return null
  const path: V3[] = []
  const out: V3[] = []
  const n = d.centre.length
  for (let j = 0; j < n; j++) {
    const a = d.centre[Math.max(0, j - 1)]
    const b = d.centre[Math.min(n - 1, j + 1)]
    const t = norm([b[0] - a[0], 0, b[2] - a[2]])
    // Matches deckGeometry: side = up × tangent.
    const s: V3 = scale([t[2], 0, -t[0]], side)
    const p = d.centre[j]
    path.push([p[0] + s[0] * (d.width[j] * 0.47 + 0.05), p[1] - 0.12, p[2] + s[2] * (d.width[j] * 0.47 + 0.05)])
    out.push(s)
  }
  return { kind: 'living', path, out, source: { living: l.id, deck, side } }
}

export function edgeLength(e: Edge): number {
  let total = 0
  for (let i = 1; i < e.path.length; i++) total += len(sub(e.path[i], e.path[i - 1]))
  return total
}

/** The point, outward normal and tangent at a distance along an edge (clamped to it). */
export function edgeAt(e: Edge, s: number): { p: V3; out: V3; tangent: V3 } {
  let left = Math.max(0, s)
  for (let i = 1; i < e.path.length; i++) {
    const seg = sub(e.path[i], e.path[i - 1])
    const l = len(seg)
    if (left <= l || i === e.path.length - 1) {
      const t = Math.min(1, left / (l || 1))
      return { p: add(e.path[i - 1], scale(seg, t)), out: norm(add(scale(e.out[i - 1], 1 - t), scale(e.out[i], t))), tangent: norm(seg) }
    }
    left -= l
  }
  return { p: e.path[0], out: e.out[0], tangent: [1, 0, 0] }
}

/** The distance along an edge of the point on it nearest `q`, and how far that is. */
export function nearestOnEdge(e: Edge, q: V3): { s: number; d: number } {
  let best = { s: 0, d: Infinity }
  let acc = 0
  for (let i = 1; i < e.path.length; i++) {
    const a = e.path[i - 1]
    const seg = sub(e.path[i], a)
    const l2 = dot(seg, seg) || 1
    const t = Math.max(0, Math.min(1, dot(sub(q, a), seg) / l2))
    const d = len(sub(q, add(a, scale(seg, t))))
    if (d < best.d) best = { s: acc + t * Math.sqrt(l2), d }
    acc += Math.sqrt(l2)
  }
  return best
}

/**
 * The edge a click finds: the player clicks a wall, roof or living structure,
 * and the Draper is anchored on the nearest valid edge — so it always starts
 * somewhere a hanging plant makes sense.
 *
 * For a block: on a side face, that side's top edge (or, for a block with
 * nothing beneath, its bottom edge if that is nearer the click); on a roof or
 * soffit, the nearest edge of any open side. For a living structure: the
 * nearest edge of its decks, once it has matured.
 */
export function anchorForBlock(town: Town, cell: [number, number, number], face: [number, number, number], q: V3): { edge: Edge; s: number } | null {
  const [x, y, z] = cell
  const sides: [number, number][] = face[1] === 0 ? [[face[0], face[2]]] : [[1, 0], [-1, 0], [0, 1], [0, -1]]
  let best: { edge: Edge; s: number; d: number } | null = null
  for (const [dx, dz] of sides) {
    for (const level of ['top', 'bottom'] as const) {
      const edge = blockEdge(town, x, y, z, dx, dz, level)
      if (!edge) continue
      const { s, d } = nearestOnEdge(edge, q)
      if (!best || d < best.d) best = { edge, s, d }
    }
  }
  return best && { edge: best.edge, s: best.s }
}

export function anchorForLiving(l: Living, q: V3): { edge: Edge; s: number } | null {
  if (!l.matured) return null
  let best: { edge: Edge; s: number; d: number } | null = null
  for (let k = 0; k < l.decks.length; k++) {
    for (const side of [1, -1] as const) {
      const edge = livingEdge(l, k, side)
      if (!edge) continue
      const { s, d } = nearestOnEdge(edge, q)
      if (!best || d < best.d) best = { edge, s, d }
    }
  }
  return best && { edge: best.edge, s: best.s }
}

// --- strands ---

/**
 * Where each strand sprouts along the edge: alternating either side of the
 * anchor, in clusters of two or three with wider gaps between, so the
 * curtain bunches rather than ranks like a fringe. Kept within the edge.
 */
function strandOffsets(seed: number, count: number, before: number, after: number): number[] {
  const out = [0]
  let right = 0
  let left = 0
  let nRight = 0
  let nLeft = 0
  const gap = (n: number, k: number) => (n % 3 === 2 ? 0.62 : 0.3) + hash(seed + k * 13) * 0.18
  for (let k = 1; out.length < count; k++) {
    const gr = gap(nRight, k)
    const gl = gap(nLeft, k + 500)
    const canRight = right + gr <= after
    const canLeft = left + gl <= before
    if (!canRight && !canLeft) break
    if ((k % 2 === 1 && canRight) || !canLeft) {
      out.push((right += gr))
      nRight++
    } else {
      out.push(-(left += gl))
      nLeft++
    }
  }
  return out
}

/**
 * Lays out the path a strand would follow, from its point on the edge down to
 * its reach, the lawn, or a block. Recomputed whenever the town changes; the
 * strand's grown length is kept, so it carries on along the new path.
 */
function layoutStrand(st: Strand, d: Draper, town: Town) {
  const { p: start, out, tangent } = edgeAt(d.edge, d.s0 + st.offset)
  const reach = st.share * MAX_REACH
  const path: V3[] = [start]
  let p = start
  let contact: Contact = 'free'
  const ph = hash(st.seed) * 6.28
  const ph2 = hash(st.seed + 1) * 6.28
  const swayAmp = 0.1 + hash(st.seed + 2) * 0.1
  for (let k = 1; k * SEG <= reach; k++) {
    // How far out from the face it is, against a gently wavering gap.
    const gap = dot(sub(p, start), out) + LIP
    const behind = add(p, scale(out, -(gap + 0.15)))
    const wall = solid(town, behind)
    const outward = wall ? (0.22 + 0.08 * Math.sin(k * 0.17 + ph2) - gap) * 0.35 : 0.03 * Math.sin(k * 0.09 + ph2)
    const sway = swayAmp * Math.sin(k * 0.21 + ph) + 0.05 * Math.sin(k * 0.53 + ph2)
    const dir = norm(add(add(scale(tangent, sway), scale(out, outward)), [0, -1, 0]))
    const next = add(p, scale(dir, SEG))
    const ground = lawnHeight(next[0] / S, next[2] / S) * S
    if (next[1] <= ground + 0.02) {
      path.push([next[0], ground + 0.02, next[2]])
      contact = 'ground'
      break
    }
    if (solid(town, next)) {
      // Rests on the top of the block below.
      path.push([next[0], Math.floor(next[1] / S + 1) * S + 0.04, next[2]])
      contact = 'surface'
      break
    }
    path.push(next)
    p = next
  }
  st.path = path
  st.contact = contact
}

export function pathLength(st: Strand): number {
  return (st.path.length - 1) * SEG
}

/**
 * What a Draper hangs across: the light and moisture over the band of wall
 * below its anchor — about 4 units down and 1.5 either side — and how many
 * of those cells hold Climber. The anchor itself is a poor guide: moisture in
 * the growth model gathers low on a wall and is near zero at the eaves, where
 * a Draper is planted. With no wall below (a living deck, an overhang) it
 * reads the nearest cell.
 */
function survey(b: Building, g: WildGrowth, world: World, q: V3, out: V3): { sun: number; moisture: number; climber: number } {
  const x = q[0] - out[0] * LIP
  const z = q[2] - out[2] * LIP
  let sun = 0
  let moisture = 0
  let n = 0
  let climber = 0
  let best = 0
  let bd = Infinity
  for (let i = 0; i < b.count; i++) {
    const h = Math.hypot(b.px[i] - x, b.pz[i] - z)
    const dy = q[1] - b.py[i]
    const d = h * h + dy * dy
    if (d < bd) {
      bd = d
      best = i
    }
    if (h > 1.5 || dy < -0.3 || dy > 4 || Math.abs(b.ny[i]) > 0.5) continue
    sun += world.sun[i]
    moisture += world.moisture[i]
    n++
    if (dy < 2.5 && h < 1.4 && g.has(0, i)) climber++
  }
  if (!n) return { sun: world.sun[best], moisture: world.moisture[best], climber: 0 }
  return { sun: sun / n, moisture: moisture / n, climber }
}

/**
 * How well a Draper grows: best in part sun (a light level of about 0.45 —
 * the walls here are 0.14 in shade and 0.6–0.87 in sun) and moderate
 * moisture (about 0.5); slower in full sun, deep shade or on a dry wall.
 * Under a living deck the light is filtered.
 */
export function vigourOf(sun: number, moisture: number, living: boolean, veil: boolean): number {
  const light = Math.max(0.3, 1 - 1.2 * Math.abs(sun * (living ? 0.7 : 1) - 0.45))
  const wet = Math.max(0.35, 1 - 1.3 * Math.abs(moisture - 0.5))
  return light * wet + (veil ? 0.15 : 0)
}

/** Climber cells under an anchor that make a veil. */
const VEIL_CLIMBER = 3

// --- the Drapers of a game ---

export type DraperEvent = { text: string; at?: V3 }

export class Drapers {
  list: Draper[] = []
  private nextId = 1

  clear() {
    this.list = []
    this.nextId = 1
  }

  /** The Drapers as plain data, for a saved world: everything but the strands' paths, which are laid out again on load. */
  exportState(): { nextId: number; list: Draper[] } {
    return { nextId: this.nextId, list: this.list.map((d) => ({ ...d, strands: d.strands.map((s) => ({ ...s, path: [] })) })) }
  }

  /** Puts saved Drapers back; `relayout` then finds their edges and lays their strands out. */
  restoreState(state: { nextId: number; list: Draper[] }) {
    this.nextId = state.nextId
    this.list = state.list.map((d) => ({ ...d, strands: d.strands.map((s) => ({ ...s, path: [] })) }))
  }

  /** Reads the light, moisture and Climber where a Draper hangs. */
  private look(d: Draper, b: Building, g: WildGrowth, world: World) {
    const sv = survey(b, g, world, d.anchor, edgeAt(d.edge, d.s0).out)
    d.sun = sv.sun
    d.moisture = sv.moisture
    d.veil = d.edge.kind !== 'living' && sv.climber >= VEIL_CLIMBER
    d.vigour = vigourOf(d.sun, d.moisture, d.edge.kind === 'living', d.veil)
  }

  /** Plants a Draper on an edge; false if there are too many, or one already hangs there. */
  plant(edge: Edge, s: number, step: number, from: number | null = null): Draper | null {
    if (this.list.length >= MAX_DRAPERS) return null
    const anchor = edgeAt(edge, s).p
    if (this.list.some((d) => len(sub(d.anchor, anchor)) < 0.6)) return null
    const id = this.nextId++
    const seed = id * 7907 + Math.round(anchor[0] * 31 + anchor[2] * 17)
    const d: Draper = { id, born: step, edge, anchor, s0: s, seed, strands: [], sun: 0.45, moisture: 0.5, vigour: 1, veil: false, from }
    this.list.push(d)
    return d
  }

  /**
   * The town or the living architecture changed: find each Draper's edge
   * again, drop those whose edge is gone, and lay every strand out anew.
   */
  relayout(town: Town, b: Building, world: World, g: WildGrowth, living: Living[]): DraperEvent[] {
    const events: DraperEvent[] = []
    this.list = this.list.filter((d) => {
      const src = d.edge.source
      let edge: Edge | null
      if ('block' in src) edge = blockEdge(town, ...src.block, ...src.side, src.level)
      else {
        const l = living.find((o) => o.id === src.living)
        edge = l ? livingEdge(l, src.deck, src.side) : null
      }
      if (!edge) {
        events.push({ text: 'A Draper lost its edge, and fell', at: d.anchor })
        return false
      }
      d.edge = edge
      d.s0 = nearestOnEdge(edge, d.anchor).s
      this.look(d, b, g, world)
      for (const st of d.strands) {
        layoutStrand(st, d, town)
        st.length = Math.min(st.length, pathLength(st))
        if (st.contact !== 'ground') st.rootedAt = -1
      }
      return true
    })
    return events
  }

  /** Grows every Draper by `steps`, sprouting strands and rooting them; returns what happened. */
  advance(steps: number, step: number, town: Town, b: Building, world: World, g: WildGrowth, living: Living[]): DraperEvent[] {
    const events: DraperEvent[] = []
    for (const d of this.list) {
      const age = step - d.born
      // Light and moisture move with the sun and rain sliders, and Climber can
      // arrive under it: looked at every LOOK_EVERY steps, as nodes are.
      if (step % LOOK_EVERY === 0) {
        const was = d.veil
        this.look(d, b, g, world)
        if (d.veil && !was) events.push({ text: 'A veil forms: Draper over Climber', at: d.anchor })
      }
      const max = Math.round(MAX_STRANDS * (d.veil ? 1.5 : 1))
      const want = Math.min(max, 1 + Math.floor((age * Math.min(1, d.vigour)) / SPROUT_EVERY))
      if (d.strands.length < want) {
        const total = edgeLength(d.edge)
        const offsets = strandOffsets(d.seed, max, d.s0, total - d.s0)
        const half = Math.max(0.5, ...offsets.map(Math.abs))
        while (d.strands.length < want && d.strands.length < offsets.length) {
          const k = d.strands.length
          const o = offsets[k]
          const seed = d.seed * 31 + k * 101
          // Longest in the middle, so the hem of the curtain curves.
          const share = (0.4 + 0.6 * Math.cos((Math.abs(o) / (half + 0.4)) * Math.PI * 0.5)) * (0.8 + 0.35 * hash(seed + 5))
          const st: Strand = { offset: o, birth: step, length: 0, share: Math.min(1, share), seed, path: [], contact: 'free', rootedAt: -1 }
          layoutStrand(st, d, town)
          d.strands.push(st)
        }
      }
      let rooted = false
      for (const st of d.strands) {
        const full = pathLength(st)
        if (st.length < full) st.length = Math.min(full, st.length + RATE * d.vigour * Math.min(steps, step - st.birth))
        if (st.length >= full && st.contact === 'ground' && st.rootedAt < 0) {
          st.rootedAt = step
          rooted = true
        }
      }
      if (rooted && d.strands.filter((s) => s.rootedAt >= 0).length === 1) events.push({ text: 'A Draper reached the lawn and took root', at: d.strands.find((s) => s.rootedAt >= 0)!.path.at(-1) })
    }
    if (step % LOOK_EVERY === 0) events.push(...this.spread(step, living))
    return events
  }

  /** Established Drapers send a runner onto the nearest mature living deck edge in reach. */
  private spread(step: number, living: Living[]): DraperEvent[] {
    const events: DraperEvent[] = []
    for (const d of [...this.list]) {
      // Only a planted Draper spreads, and at most SPREADS times: chained, six
      // curtains had hung from every deck in a run by step 1,100 — too busy.
      if (d.from !== null || step - d.born < SPREAD_AGE || d.strands.length < 4 || this.list.length >= MAX_DRAPERS) continue
      if (this.list.filter((o) => o.from === d.id).length >= SPREADS) continue
      // The stretch of edge the curtain covers, and its strands as far as they have grown.
      const offs = d.strands.map((s) => s.offset)
      const pts: [V3, number][] = [Math.min(...offs), 0, Math.max(...offs)].map((o) => [edgeAt(d.edge, d.s0 + o).p, SPREAD_REACH])
      for (const st of d.strands) {
        const grown = Math.min(st.path.length - 1, Math.floor(st.length / SEG))
        for (let k = 2; k <= grown; k += 2) pts.push([st.path[k], STRAND_REACH])
      }
      for (const l of living) {
        if (!l.matured) continue
        for (let k = 0; k < l.decks.length; k++) {
          for (const side of [1, -1] as const) {
            const taken = this.list.some((o) => 'living' in o.edge.source && o.edge.source.living === l.id && o.edge.source.deck === k && o.edge.source.side === side)
            if (taken) continue
            const edge = livingEdge(l, k, side)
            if (!edge) continue
            let best = { s: 0, d: Infinity }
            for (const [p, reach] of pts) {
              const n = nearestOnEdge(edge, p)
              if (n.d <= reach && n.d < best.d) best = n
            }
            if (best.d === Infinity) continue
            const child = this.plant(edge, best.s, step, d.id)
            if (child) events.push({ text: 'A Draper spreads onto the living architecture', at: edgeAt(edge, best.s).p })
            return events
          }
        }
      }
    }
    return events
  }

  /**
   * The share of the building's growable surface a curtain hangs over: cells
   * within 0.6 units of a grown strand — the same denominator as Climber's
   * and Spreader's coverage, so the three can be read side by side. A curtain
   * hanging in open air, under a deck, covers none of the building and
   * counts nothing.
   */
  coverage(b: Building): number {
    const R = 0.6
    const buckets = new Map<string, V3[]>()
    const key = (x: number, y: number, z: number) => `${Math.floor(x / R)},${Math.floor(y / R)},${Math.floor(z / R)}`
    for (const d of this.list) {
      for (const st of d.strands) {
        const grown = Math.min(st.path.length - 1, Math.floor(st.length / SEG))
        for (let k = 0; k <= grown; k++) {
          const p = st.path[k]
          const kk = key(...p)
          const list = buckets.get(kk)
          if (list) list.push(p)
          else buckets.set(kk, [p])
        }
      }
    }
    let growable = 0
    let covered = 0
    for (let i = 0; i < b.count; i++) {
      if (b.flags[i] & UNGROWABLE) continue
      growable++
      if (!buckets.size) continue
      const x = b.px[i]
      const y = b.py[i]
      const z = b.pz[i]
      const bx = Math.floor(x / R)
      const by = Math.floor(y / R)
      const bz = Math.floor(z / R)
      search: for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const list = buckets.get(`${bx + dx},${by + dy},${bz + dz}`)
            if (!list) continue
            for (const p of list) {
              if ((p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2 < R * R) {
                covered++
                break search
              }
            }
          }
    }
    return growable ? covered / growable : 0
  }

  get strandCount() {
    return this.list.reduce((a, d) => a + d.strands.length, 0)
  }

  get rootedCount() {
    return this.list.reduce((a, d) => a + d.strands.filter((s) => s.rootedAt >= 0).length, 0)
  }
}
