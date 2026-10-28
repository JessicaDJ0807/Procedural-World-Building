import type { Building } from '../green/building'
import type { WildGrowth } from '../wildform/growth'
import { CLIMBER, SPREADER } from '../wildform/species'
import { edgeAt, pathLength, type Draper, type Strand } from './draper'
import { lawnHeight } from './lawn'
import {
  MAX_STRUCTURES,
  SPACING,
  add,
  columnTop,
  findTarget,
  flat,
  hash,
  len,
  rootFan,
  rotY,
  sample,
  scale,
  toTown,
  type Combo,
  type Deck,
  type Living,
  type V3,
} from './living'
import { Town } from './town'

/**
 * The Draper's architecture: what grows where a hanging curtain meets the
 * other plants.
 *
 * Climber and Spreader meet in a wall cell's stack (living.ts, `comboOf`).
 * A Draper never enters the stack — its strands hang in open air off the
 * face — so its meetings are read from the curtain itself, once it is
 * established: what grows on the wall behind its strands, what has spread
 * along the edge it hangs from, and what its strands have reached below.
 *
 * | The curtain                                                | Combination       | Grows             |
 * | ---------------------------------------------------------- | ----------------- | ----------------- |
 * | hangs from living architecture, or over layered growth, and has rooted below | Draper + Layered | a root column |
 * | hangs over Climber, high up, with a building in reach       | Climber + Draper  | a suspended walkway |
 * | hangs from an edge where Spreader has spread, with room below | Spreader + Draper | a hanging pod   |
 *
 * Checked in that order — rarest first, as the wall's are — and each Draper
 * makes one structure at most. Where the conditions aren't met, nothing
 * forms: a curtain over Climber with no building in reach stays a veil.
 *
 * What the Draper brings is a direction the others don't have: **down**.
 * Its forms hang, descend and are held in tension — a trunk let down to the
 * ground, a basket hung under an edge, a deck slung from cables — where the
 * wall's forms bear, spread and arch.
 */

/** Steps a Draper must have hung before it can make anything: established, not a seedling curtain. */
const DRAPER_AGE = 200
/** Strands a curtain needs: a curtain, not a few threads. */
const MIN_STRANDS = 5
/** How close a wall cell must be to a grown strand to count as under the curtain. */
const UNDER = 0.7
/** Strands rooted or resting below that make a column, and the least drop worth one. */
const COLUMN_STRANDS = 3
const COLUMN_DROP = 2.5
/** Layered cells (three layers or more) under a curtain that count as layered growth. */
const LAYERED_CELLS = 3
/** Climber cells under the curtain for a walkway: the veil's own threshold and more. */
const WALKWAY_CLIMBER = 4
/** A walkway starts at least this high: from a second storey's eave or above. */
const WALKWAY_HEIGHT = 5.5
/** Spreader cells along the top of the curtain for a pod. */
const POD_SPREADER = 3
const POD_HEIGHT = 4.5
/** Spacing between structures facing opposite ways. */
const OPPOSED_SPACING = 2
const S = 3

/** What a Draper's curtain is over, counted. */
export type CurtainReading = {
  climber: number
  spreader: number
  layered: number
  /** Spreader along the top of the curtain: on the edge, the roof by it, or just under it. */
  spreaderAbove: number
  /** Strands that have grown all the way to the lawn or a surface below. */
  landed: Strand[]
  /** The cells counted, for the Architecture page's Growth view. */
  cells: number[]
}

const solid = (town: Town, p: V3) => {
  const [x, y, z] = toTown(p)
  return town.filled(x, y, z)
}

const grownPoints = (d: Draper): V3[] => {
  const pts: V3[] = []
  for (const st of d.strands) {
    const grown = Math.min(st.path.length - 1, Math.floor(st.length / 0.22))
    for (let k = 0; k <= grown; k += 2) pts.push(st.path[k])
  }
  return pts
}

/** Reads what a curtain hangs over: the wall cells behind its grown strands, and the band along its edge. */
export function readCurtain(d: Draper, g: WildGrowth, b: Building): CurtainReading {
  const pts = grownPoints(d)
  const offs = d.strands.map((s) => s.offset)
  const edgePts = [Math.min(0, ...offs), 0, Math.max(0, ...offs)].map((o) => edgeAt(d.edge, d.s0 + o).p)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const p of [...pts, ...edgePts]) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0])
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1])
    z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2])
  }
  const r: CurtainReading = { climber: 0, spreader: 0, layered: 0, spreaderAbove: 0, landed: [], cells: [] }
  const top = edgePts[1][1]
  for (let i = 0; i < b.count; i++) {
    const x = b.px[i], y = b.py[i], z = b.pz[i]
    if (x < x0 - 1.6 || x > x1 + 1.6 || y < y0 - 1 || y > y1 + 1 || z < z0 - 1.6 || z > z1 + 1.6) continue
    if (g.depth[i] === 0) continue
    // Along the top: within 1.6 of the edge stretch, from a little under it to just over (a roof's first cells).
    if (y > top - 1.5 && y < top + 0.6 && edgePts.some((p) => Math.hypot(p[0] - x, p[2] - z) < 1.6) && g.has(SPREADER, i)) r.spreaderAbove++
    if (Math.abs(b.ny[i]) > 0.5) continue
    if (!pts.some((p) => (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2 < UNDER * UNDER)) continue
    r.cells.push(i)
    if (g.has(CLIMBER, i)) r.climber++
    if (g.has(SPREADER, i)) r.spreader++
    if (g.depth[i] >= 3 && g.mask[i] === 3) r.layered++
  }
  r.landed = d.strands.filter((st) => st.contact !== 'free' && st.length >= pathLength(st) - 1e-3)
  return r
}

/**
 * The first Draper meeting that can make something, rarest first: a column,
 * then a walkway, then a pod. Each is planned here, since whether it can form
 * depends on its geometry fitting — a walkway needs its far end, a pod its
 * room — and returned whole.
 */
export function findDraperLiving(drapers: Draper[], g: WildGrowth, b: Building, town: Town, living: Living[], step: number): { draper: Draper; living: Living; reading: CurtainReading } | null {
  if (living.length >= MAX_STRUCTURES) return null
  const id = living.length + 1
  for (const combo of ['draper+layered', 'climber+draper', 'spreader+draper'] as Combo[]) {
    for (const d of drapers) {
      if (d.formed !== undefined || step - d.born < DRAPER_AGE || d.strands.length < MIN_STRANDS) continue
      const reading = readCurtain(d, g, b)
      const l = plan(combo, d, reading, town, living, id, step)
      if (!l) continue
      // Clear of other structures — except the one a column hangs from, which it is meant to hold up.
      // Two that grow in opposite directions can't collide, and may stand closer: walkways slung both
      // ways from one tower's opposite eaves are 3.6 units apart, and the wall's spacing refused the second.
      const parent = 'living' in d.edge.source ? d.edge.source.living : -1
      const clash = (o: Living) => {
        const gap = len(add(o.node, scale(l.node, -1)))
        const opposed = o.normal[0] * l.normal[0] + o.normal[2] * l.normal[2] < -0.5
        return gap < (opposed ? OPPOSED_SPACING : SPACING)
      }
      if (living.some((o) => o.id !== parent && clash(o))) continue
      return { draper: d, living: l, reading }
    }
  }
  return null
}

function plan(combo: Combo, d: Draper, r: CurtainReading, town: Town, living: Living[], id: number, step: number): Living | null {
  if (combo === 'draper+layered') {
    const layered = d.edge.kind === 'living' || r.layered >= LAYERED_CELLS
    if (!layered || r.landed.length < COLUMN_STRANDS) return null
    return planColumn(d, r, town, living, id, step)
  }
  if (combo === 'climber+draper') {
    if (d.edge.kind === 'living' || r.climber < WALKWAY_CLIMBER || d.anchor[1] < WALKWAY_HEIGHT) return null
    return planWalkway(d, town, id, step)
  }
  if (d.edge.kind === 'living' || r.spreaderAbove < POD_SPREADER || d.anchor[1] < POD_HEIGHT) return null
  return planPod(d, town, id, step)
}

/** The block a Draper's edge belongs to, in the town grid. */
function edgeBlock(d: Draper, living: Living[]): [number, number, number] {
  const src = d.edge.source
  if ('block' in src) return src.block
  return living.find((o) => o.id === src.living)?.ends.from ?? toTown(d.anchor)
}

const base = (d: Draper, combo: Combo, id: number, step: number, node: V3, normal: V3) => ({ id, combo, born: step, node, normal, matured: false, seed: id * 7919 + d.seed, draper: d.id })

/** Strands trailing from points: thin, swaying a little as they fall. */
function trailing(from: V3[], seed: number, lo: number, hi: number, out: V3): V3[][] {
  return from.map((p, k) => {
    const drop = lo + (hi - lo) * hash(seed + k * 11)
    const ph = hash(seed + k * 3) * 6.28
    return sample(6, (t) => add(p, add([0, -drop * t, 0], scale(out, 0.12 * Math.sin(t * 3 + ph) * t))))
  })
}

/**
 * Root column: the curtain's strands that reached the ground, twisted
 * together into a trunk. Its axis runs from where they hang, at the edge,
 * down to where they landed; six strands spiral round it, flaring at the
 * foot into buttress roots and at the top into a capital that grips the
 * edge. Bracket shelves — half-rings, alternating sides — grow out of it on
 * the way down: small decks, new ground. On a wall it stands a little off
 * the face, a living pilaster; under a living deck it stands free and holds
 * the deck up. A foot on another building's roof connects the two.
 */
function planColumn(d: Draper, r: CurtainReading, town: Town, living: Living[], id: number, step: number): Living | null {
  // The landed strands nearest the curtain's middle: the bundle.
  const bundle = [...r.landed].sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset)).slice(0, 5)
  const mean = (ps: V3[]): V3 => scale(ps.reduce((a, p) => add(a, p), [0, 0, 0] as V3), 1 / ps.length)
  const top = mean(bundle.map((st) => st.path[0]))
  const foot = mean(bundle.map((st) => st.path.at(-1)!))
  const out = flat(edgeAt(d.edge, d.s0).out)
  const tangent: V3 = [-out[2], 0, out[0]]
  const onWall = d.edge.kind !== 'living'
  // Off the face a little, so the trunk's spiral clears the wall.
  const off = onWall ? 0.5 : 0
  const A: V3 = add(top, scale(out, off))
  const F: V3 = add([foot[0], foot[1], foot[2]], scale(out, off))
  const drop = A[1] - F[1]
  if (drop < COLUMN_DROP) return null
  const seed = id * 7919 + d.seed
  const axis = (t: number): V3 => add(scale(A, 1 - t), scale(F, t))
  const twist = 1.1 + hash(seed) * 0.5
  const trunks = Array.from({ length: 6 }, (_, k) =>
    sample(Math.max(10, Math.round(drop / 0.3)), (t) => {
      const a = (k / 6) * Math.PI * 2 + twist * Math.PI * 2 * t
      // Narrow in the middle, flaring at the foot and a little at the top.
      const rad = 0.24 + 0.16 * t * t * t + 0.08 * (1 - t) ** 3
      return add(axis(t), add(scale(out, Math.cos(a) * rad), scale(tangent, Math.sin(a) * rad)))
    }),
  )
  // The capital: strands fanning up from the trunk's top to grip the edge either side.
  const frame = [-1.2, -0.6, 0, 0.6, 1.2].map((o) => {
    const grip = edgeAt(d.edge, d.s0 + o).p
    const start = axis(0.12)
    return sample(6, (t) => add(add(scale(start, 1 - t), scale(grip, t)), scale(out, Math.sin(t * Math.PI) * 0.25)))
  })
  // Buttress roots at the foot, radiating out and down to the ground.
  const roots: V3[][] = []
  for (let k = 0; k < 6; k++) {
    const dir = rotY(out, (k / 6) * Math.PI * 2 + hash(seed + k) * 0.5)
    const reach = 0.9 + hash(seed + k * 7) * 0.8
    const from = axis(0.82)
    roots.push(
      sample(6, (t) => {
        const p = add(from, scale(dir, reach * t))
        const ground = F[1] - 0.05
        return [p[0], from[1] + (ground - from[1]) * Math.sin((t * Math.PI) / 2), p[2]]
      }),
    )
  }
  if (onWall) roots.push(...rootFan(add(top, scale(out, 0.1)), tangent, 1.2, 3, seed + 3, out))
  // Bracket shelves on the way down, one a storey, alternating sides.
  const decks: Deck[] = []
  for (let y = A[1] - 1.4, k = 0; y > F[1] + 1.2; y -= S, k++) {
    const t = (A[1] - y) / drop
    const c = axis(t)
    const facing = rotY(out, (k % 2 ? 1 : -1) * 0.9)
    const arc = sample(7, (u) => {
      const a = (u - 0.5) * Math.PI * 1.1
      const radial = rotY(facing, a)
      return add(add(c, scale(radial, 0.55)), [0, -0.08 * Math.abs(u - 0.5), 0])
    })
    decks.push({ centre: arc, width: arc.map((_, j) => 0.75 - 0.35 * Math.abs(j / 6 - 0.5) * 2), thickness: arc.map(() => 0.16) })
  }
  // The Draper is still in it: a few strands trailing from the capital.
  const cables = trailing([-0.9, -0.3, 0.4, 1.0].map((o) => edgeAt(d.edge, d.s0 + o).p), seed + 50, 0.6, 1.8, out)
  // A foot on another building's roof joins it to the one above.
  const from = edgeBlock(d, living)
  const below = toTown(add(F, [0, -0.3, 0]))
  const landedOnBlock = F[1] > 0.5 && town.filled(...below)
  return {
    ...base(d, 'draper+layered', id, step, A, out),
    kind: 'column',
    decks,
    frame,
    roots,
    trunks,
    cables,
    ends: { from, to: landedOnBlock ? below : null },
  }
}

/**
 * Suspended walkway: a deck slung between this building's eave and another
 * building's face, held by cables. Where the Bridge arches up off the wall
 * and bears on its own stiffness, the walkway sags: a narrow, thin deck on a
 * catenary below the line between its ends, hung by hangers from two cables
 * strung between masts at either end, with the Draper's strands trailing
 * from its edges. It lands on the neighbour's roof when that is within two
 * storeys up or down — roof to roof, sloping if it must — where a bridge
 * meets the neighbour's wall at its own level: tension doesn't mind a slope.
 */
function planWalkway(d: Draper, town: Town, id: number, step: number): Living | null {
  const { p: E, out: o } = edgeAt(d.edge, d.s0)
  const out = flat(o)
  // Looks for the far end from just under the eave; starts on the roof itself if the edge is a roof's.
  const look: V3 = add(add(E, scale(out, 0.35)), [0, -0.5, 0])
  const A: V3 = d.edge.kind === 'roof' ? add(add(E, scale(out, -0.3)), [0, 0.1, 0]) : look
  const src = d.edge.source
  if (!('block' in src)) return null
  const from = src.block
  const masses = town.masses()
  const own = masses[Town.index(...from)]
  const fans = [0, -0.35, 0.35, -0.7, 0.7].map((a) => rotY(out, a))
  const hit = findTarget(town, masses, own, look, fans, 5 * S, [0, -S, S, -2 * S, 2 * S])
  if (!hit) return null
  // Roof to roof: onto the neighbour's roof, just in from its edge, if it is within two storeys.
  const roof = columnTop(town, ...hit.block)
  const inward = flat(add(hit.point, scale(A, -1)))
  const B: V3 = Math.abs(roof - A[1]) <= 2 * S + 0.5 ? add([hit.point[0], roof + 0.05, hit.point[2]], scale(inward, 0.4)) : hit.point
  const span = len(add(B, scale(A, -1)))
  const along = flat(add(B, scale(A, -1)))
  const perp: V3 = [-along[2], 0, along[0]]
  const seed = id * 7919 + d.seed
  const sag = 0.05 * span + 0.15
  const deckAt = (t: number): V3 => add(add(scale(A, 1 - t), scale(B, t)), [0, -sag * 4 * t * (1 - t), 0])
  const n = Math.max(9, Math.round(span / 0.8))
  const centre = sample(n, deckAt)
  const deck: Deck = { centre, width: centre.map((_, j) => 1.2 - 0.2 * Math.sin((j / (n - 1)) * Math.PI)), thickness: centre.map(() => 0.14) }
  // Masts at each end, a pair either side of the deck, and the cables strung between their tops.
  const MAST = 2.2
  const masts: V3[][] = []
  const tops: V3[][] = [[], []]
  for (const [end, p, back] of [
    [0, A, scale(along, -0.15)],
    [1, B, scale(along, 0.15)],
  ] as [number, V3, V3][]) {
    for (const [k, side] of [
      [0, 0.62],
      [1, -0.62],
    ] as [number, number][]) {
      const foot = add(p, scale(perp, side))
      const top = add(add(foot, [0, MAST, 0]), back)
      masts.push(sample(4, (t) => add(scale(foot, 1 - t), scale(top, t))))
      tops[k][end] = top
    }
  }
  const dip = sag + MAST - 0.7
  const cableAt = (k: number, t: number): V3 => add(add(scale(tops[k][0], 1 - t), scale(tops[k][1], t)), [0, -dip * 4 * t * (1 - t), 0])
  const cables: V3[][] = [0, 1].map((k) => sample(Math.max(12, n * 2), (t) => cableAt(k, t)))
  // Hangers from each cable down to the deck's edge.
  const hangers = Math.max(3, Math.round(span / 0.9))
  for (let h = 1; h < hangers; h++) {
    const t = h / hangers
    for (const [k, side] of [
      [0, 0.55],
      [1, -0.55],
    ] as [number, number][]) {
      const top = cableAt(k, t)
      const bottom = add(deckAt(t), scale(perp, side))
      if (top[1] - bottom[1] > 0.15) cables.push([top, bottom])
    }
  }
  // The Draper's strands, trailing from under the deck's edges.
  const edgeFeet: V3[] = []
  for (let j = 1; j < n - 1; j++) if (hash(seed + j * 5) < 0.75) edgeFeet.push(add(add(centre[j], scale(perp, (j % 2 ? 1 : -1) * 0.5)), [0, -0.08, 0]))
  cables.push(...trailing(edgeFeet, seed + 9, 0.5, 1.6, perp))
  const tangent: V3 = [-out[2], 0, out[0]]
  return {
    ...base(d, 'climber+draper', id, step, A, out),
    kind: 'walkway',
    decks: [deck],
    frame: masts,
    roots: [...rootFan(A, tangent, 1.6, 3, seed, out), ...rootFan(B, perp, 1.4, 3, seed + 99, scale(along, -1))],
    cables,
    ends: { from, to: hit.block },
  }
}

/**
 * Hanging pod: a basket hung under an edge. The Spreader's spread at the edge
 * grows out as a cap; under it the Draper lets down a teardrop of woven
 * hoops — open arcs, widest a third of the way down, gathered to a point —
 * with a floor across its belly and a mouth facing out, held by hangers from
 * the cap and trailing strands below. Where the Canopy is a roof held out
 * over open ground, the pod encloses: a pocket of shade off the ground, its
 * hoops and floor new surfaces inside and out. Needs the room to hang:
 * every part clear of blocks and above the lawn.
 */
function planPod(d: Draper, town: Town, id: number, step: number): Living | null {
  const { p: E, out: o } = edgeAt(d.edge, d.s0)
  const out = flat(o)
  const tangent: V3 = [-out[2], 0, out[0]]
  const seed = id * 7919 + d.seed
  const R = 1.25 + hash(seed) * 0.2
  const H = 3.1 + hash(seed + 1) * 0.4
  const top: V3 = add(add(E, scale(out, R + 0.35)), [0, -0.35, 0])
  const radius = (h: number) => 0.12 + R * Math.pow(Math.sin(Math.PI * Math.min(0.98, h / H)), 0.7)
  const ring = (h: number, span: number): V3[] =>
    sample(13, (u) => {
      // The gap faces out, away from the wall: the pod's mouth.
      const a = Math.PI + (u - 0.5) * span
      const radial: V3 = add(scale(out, -Math.cos(a)), scale(tangent, Math.sin(a)))
      return add(add(top, [0, -h, 0]), scale(radial, -radius(h)))
    })
  const decks: Deck[] = []
  const hoops = [0.35, 0.8, 1.25, 1.7, 2.15, 2.6, 3.0].filter((h) => h < H - 0.05)
  for (const h of hoops) {
    const mouth = h > 0.9 && h < 2.0
    const pts = ring(h, mouth ? Math.PI * 1.3 : Math.PI * 1.85)
    decks.push({ centre: pts, width: pts.map(() => 0.24), thickness: pts.map(() => 0.13) })
  }
  // The floor, across the belly, front to back.
  const floorY = 2.3
  const fr = radius(floorY) - 0.15
  const floorC = sample(5, (t) => add(add(top, [0, -floorY, 0]), scale(out, (t - 0.5) * 2 * fr)))
  decks.push({ centre: floorC, width: floorC.map((_, j) => 2 * fr * Math.sqrt(Math.max(0.15, 1 - ((j / 4) * 2 - 1) ** 2)) * 0.9), thickness: floorC.map(() => 0.16) })
  // Ribs, from the top hoop to the point, none across the mouth.
  const frame: V3[][] = []
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) / 6) * Math.PI * 2
    const radial: V3 = add(scale(out, Math.cos(a)), scale(tangent, Math.sin(a)))
    if (Math.cos(a) > 0.8) continue
    frame.push(sample(10, (t) => add(add(top, [0, -(0.2 + (H - 0.2) * t), 0]), scale(radial, radius(0.2 + (H - 0.2) * t) + 0.04))))
  }
  // Clear of blocks, and off the ground.
  const parts = [...decks.flatMap((dk) => dk.centre), ...frame.flat()]
  const ground = (p: V3) => lawnHeight(p[0] / S, p[2] / S) * S
  if (parts.some((p) => solid(town, p) || p[1] < ground(p) + 0.5)) return null
  // The cap: the Spreader's spread grown out as a lip to hang from — only as far as the pod's
  // middle, and narrower than it, so it reads as where the pod hangs, not as a canopy over it.
  const capC = sample(5, (t) => add(add(E, scale(out, -0.1 + t * (R + 0.6))), [0, 0.12 + 0.1 * Math.sin(t * Math.PI), 0]))
  const capFree = !capC.slice(1).some((p) => solid(town, p))
  if (capFree) decks.unshift({ centre: capC, width: capC.map((_, j) => 1.5 + 0.4 * Math.sin((j / 4) * Math.PI) - 0.4 * (j / 4)), thickness: capC.map((_, j) => 0.26 - 0.08 * (j / 4)) })
  // Hangers from the edge (or cap) to the top hoop; strands trailing from the lower hoops and the point.
  const topHoop = ring(hoops[0], Math.PI * 1.85)
  // Hangers gather to the lip's end, like a basket's handles to a hook.
  const hook = capFree ? capC[capC.length - 1] : add(E, scale(out, 0.3))
  const cables: V3[][] = [0, 3, 6, 9, 12].map((j) => [hook, topHoop[j]])
  const low = ring(hoops[hoops.length - 1], Math.PI * 1.85).filter((_, j) => j % 3 === 0)
  cables.push(...trailing([...low, add(top, [0, -H, 0])], seed + 7, 0.7, 2.0, out))
  return {
    ...base(d, 'spreader+draper', id, step, E, out),
    kind: 'pod',
    decks,
    frame,
    roots: [...rootFan(add(E, scale(out, -0.1)), tangent, 1.5, 4, seed, out), ...rootFan(capC[capC.length - 1], tangent, 0.6, 3, seed + 4, out)],
    cables,
    ends: { from: 'block' in d.edge.source ? d.edge.source.block : toTown(E), to: null },
  }
}
