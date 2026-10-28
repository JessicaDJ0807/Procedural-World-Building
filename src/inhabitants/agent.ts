import type { V3 } from '../build/living'
import type { NavGraph } from './nav'

/**
 * An inhabitant: a small creature that lives on the green, and the one state
 * machine every page runs it with — Play, the Lab and the Inhabitants studio.
 *
 * Behaviors, each entered for a reason the agent records in `why`:
 *
 * | Behavior     | When |
 * | ------------ | ---- |
 * | idle         | between walks, for 1.5–4 s; or with automatic exploring off |
 * | exploring    | walking to a random cell of its own region |
 * | discovering  | a living structure it hadn't known has joined its region: it walks to it |
 * | travelling   | walking to a destination it was sent to (the studio sends them) |
 * | no-route     | sent somewhere it can't reach — another region, or where nothing grows |
 * | stranded     | the growth under it withered and nothing walkable is near |
 *
 * Crossing is not a behavior but a fact read off where it stands: on a
 * living structure (`on`). Everything runs in real seconds, not growth
 * steps, and nothing here changes the world: an inhabitant reads a NavGraph
 * and moves itself. Not saved — a loaded world gets new inhabitants.
 */

export type Behavior = 'idle' | 'exploring' | 'discovering' | 'travelling' | 'no-route' | 'stranded'

export const BEHAVIOR_NAMES: Record<Behavior, string> = {
  idle: 'Idle',
  exploring: 'Exploring',
  discovering: 'Discovering',
  travelling: 'Travelling',
  'no-route': 'No route',
  stranded: 'Stranded',
}

/** Coats: one per inhabitant, so they can be told apart. Not species — all behave alike. */
export const COATS = [
  { name: 'Moss', body: '#7fa35a', belly: '#d9e3b0' },
  { name: 'Lichen', body: '#c9b25e', belly: '#f1e7bf' },
  { name: 'Blossom', body: '#d98fa0', belly: '#f7dce2' },
  { name: 'Bark', body: '#a27b57', belly: '#e6d2b8' },
]

/** Walking speed, growth units a second: a block (3 units) in about four seconds. */
export const WALK_SPEED = 0.75
/** How far a stranded inhabitant will step to reach walkable ground, units. */
const STEP_OFF = 1.0
const NO_ROUTE_SECONDS = 2.5

export type Inhabitant = {
  id: number
  coat: number
  /** The cell it last reached, or −1 if it isn't on the graph (stranded on a cell that was rebuilt away). */
  cell: number
  /** The cell it is stepping toward, −1 when still; and how far along, 0–1. */
  next: number
  t: number
  /** Where it is and which way is up (the surface normal) and forward, in growth units. */
  pos: V3
  up: V3
  heading: V3
  behavior: Behavior
  /** Seconds since the behavior began. */
  age: number
  /** Why it is doing what it's doing, in a few words. */
  why: string
  /** Where it is going: the cell, and its position (to find it again when the building is rebuilt). */
  destination: number
  destinationPos: V3 | null
  /** The cells still to step through. */
  path: number[]
  /** The structure it is walking to discover, or −1. */
  target: number
  /** Structures it already knows of: discovering one adds it. */
  known: Set<number>
  /** Seconds to wait before choosing again, when idle. */
  wait: number
  /** Off: it stays idle unless sent somewhere. */
  autoExplore: boolean
  /** Walked distance, units, and the number of times it has replanned. */
  walked: number
  replans: number
  rng: () => number
}

/** A small seeded random stream (mulberry32): the same seed, the same wandering. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** A new inhabitant standing on a walkable cell. It knows the structures already in its region: it discovers what joins later. */
export function spawn(id: number, nav: NavGraph, cell: number, seed: number): Inhabitant {
  const r = nav.region[cell]
  return {
    id,
    coat: id % COATS.length,
    cell,
    next: -1,
    t: 0,
    pos: nav.pos(cell),
    up: nav.normal(cell),
    heading: [1, 0, 0],
    behavior: 'idle',
    age: 0,
    why: 'Just arrived',
    destination: -1,
    destinationPos: null,
    path: [],
    target: -1,
    known: new Set(r >= 0 ? nav.regionStructures[r] : []),
    wait: 1 + (seed % 7) * 0.3,
    autoExplore: true,
    walked: 0,
    replans: 0,
    rng: seeded(seed),
  }
}

function enter(a: Inhabitant, behavior: Behavior, why: string) {
  a.behavior = behavior
  a.age = 0
  a.why = why
}

function stop(a: Inhabitant) {
  a.path = []
  a.destination = -1
  a.destinationPos = null
  a.target = -1
}

/** Starts a walk to a cell: true if there is a route. */
function walkTo(a: Inhabitant, nav: NavGraph, to: number): boolean {
  const from = a.next >= 0 ? a.next : a.cell
  const path = nav.path(from, to)
  if (!path) return false
  a.path = path
  a.destination = to
  a.destinationPos = nav.pos(to)
  return true
}

/**
 * Sends an inhabitant somewhere — the studio's "send here". It goes if it
 * can; if not, it says why: nothing grows there, or no route of growth or
 * architecture joins that place to where it stands.
 */
export function sendTo(a: Inhabitant, nav: NavGraph, cell: number) {
  a.target = -1
  if (cell < 0 || !nav.walkable[cell]) {
    stop(a)
    enter(a, 'no-route', 'Nothing grows there to walk on')
    return
  }
  if (a.cell < 0 || !nav.reachable(a.next >= 0 ? a.next : a.cell, cell)) {
    stop(a)
    a.destination = cell
    a.destinationPos = nav.pos(cell)
    enter(a, 'no-route', 'No route of growth or architecture joins it to where it stands')
    return
  }
  if (walkTo(a, nav, cell)) enter(a, 'travelling', 'Sent there')
}

/**
 * The graph was rebuilt — growth spread or withered, a block was placed, a
 * structure matured: find its cells again by position, and check the route.
 */
export function rehome(a: Inhabitant, nav: NavGraph) {
  const here = nav.nearest(a.pos, STEP_OFF)
  a.next = -1
  a.t = 0
  if (here < 0) {
    a.cell = -1
    stop(a)
    if (a.behavior !== 'stranded') enter(a, 'stranded', 'The growth under it withered')
    return
  }
  a.cell = here
  if (a.behavior === 'stranded') enter(a, 'idle', 'Found its footing again')
  if (a.destinationPos) {
    const to = nav.nearest(a.destinationPos, 0.6)
    a.replans++
    if (to < 0 || !walkTo(a, nav, to)) {
      const wasSent = a.behavior === 'travelling'
      stop(a)
      if (wasSent) enter(a, 'no-route', 'The way there is gone')
      else enter(a, 'idle', 'The way it was going is gone')
    }
  }
}

function randomCellIn(nav: NavGraph, region: number, near: V3, rng: () => number): number {
  // A random point nearby, then the nearest walkable cell to it in the same region: wandering, not teleporting across the map.
  for (let k = 0; k < 8; k++) {
    const p: V3 = add(near, [(rng() - 0.5) * 8, (rng() - 0.5) * 6, (rng() - 0.5) * 8])
    const c = nav.nearest(p, 2.5, region)
    if (c >= 0) return c
  }
  return -1
}

/** Advances an inhabitant by `dt` seconds on a graph. */
export function step(a: Inhabitant, nav: NavGraph, dt: number) {
  a.age += dt
  if (a.cell < 0) {
    // Stranded: look again now and then for walkable ground underfoot.
    if (a.age > 1) rehome(a, nav)
    return
  }
  const standing = a.next >= 0 ? a.next : a.cell
  const region = nav.region[standing]

  // Something new in its region — a structure joined by growth or newly matured: go and see it.
  if (a.autoExplore && region >= 0 && a.behavior !== 'travelling' && a.behavior !== 'discovering') {
    for (const s of nav.regionStructures[region]) {
      if (a.known.has(s)) continue
      const cells = nav.cellsOf(s)
      const to = cells[Math.floor(cells.length / 2)]
      if (to !== undefined && walkTo(a, nav, to)) {
        a.target = s
        enter(a, 'discovering', 'A new structure joined its region')
        break
      }
      a.known.add(s)
    }
  }

  switch (a.behavior) {
    case 'idle':
      a.wait -= dt
      if (a.wait <= 0 && a.autoExplore && region >= 0) {
        const to = randomCellIn(nav, region, a.pos, a.rng)
        if (to >= 0 && to !== standing && walkTo(a, nav, to)) enter(a, 'exploring', 'Wandering its region')
        else a.wait = 1
      }
      break
    case 'no-route':
    case 'stranded':
      if (a.age > NO_ROUTE_SECONDS) {
        stop(a)
        enter(a, 'idle', a.behavior === 'no-route' ? 'Gave up on that destination' : 'Waiting')
        a.wait = 1.5
      }
      break
    default:
      move(a, nav, dt)
  }
}

function move(a: Inhabitant, nav: NavGraph, dt: number) {
  let budget = WALK_SPEED * dt
  while (budget > 0) {
    if (a.next < 0) {
      if (!a.path.length) {
        // Arrived.
        if (a.behavior === 'discovering' && a.target >= 0) a.known.add(a.target)
        const why = a.behavior === 'discovering' ? 'Found the new structure' : a.behavior === 'travelling' ? 'Arrived' : 'Resting'
        stop(a)
        enter(a, 'idle', why)
        a.wait = 1.5 + a.rng() * 2.5
        return
      }
      const n = a.path.shift()!
      if (!nav.walkable[n]) {
        // The way ahead stopped being walkable between rebuilds: plan again from here.
        a.replans++
        const to = a.destination
        if (to < 0 || !walkTo(a, nav, to)) {
          const wasSent = a.behavior === 'travelling'
          stop(a)
          enter(a, wasSent ? 'no-route' : 'idle', 'The way ahead is gone')
          return
        }
        continue
      }
      a.next = n
      a.t = 0
    }
    const from = nav.pos(a.cell)
    const to = nav.pos(a.next)
    const d = Math.max(1e-3, len(sub(to, from)))
    const dtT = Math.min(1 - a.t, budget / d)
    a.t += dtT
    budget -= dtT * d
    a.walked += dtT * d
    a.pos = add(from, scale(sub(to, from), a.t))
    a.up = norm(add(scale(nav.normal(a.cell), 1 - a.t), scale(nav.normal(a.next), a.t)))
    // Forward: the direction of travel, laid flat on the surface.
    const dir = norm(sub(to, from))
    const along = sub(dir, scale(a.up, dir[0] * a.up[0] + dir[1] * a.up[1] + dir[2] * a.up[2]))
    if (len(along) > 1e-3) a.heading = norm(along)
    if (a.t >= 1 - 1e-6) {
      a.cell = a.next
      a.next = -1
      a.t = 0
    }
  }
}

/** Where it stands, read off the graph: the building, or the structure it is crossing. */
export function standingOn(a: Inhabitant, nav: NavGraph) {
  const c = a.next >= 0 && a.t > 0.5 ? a.next : a.cell
  if (c < 0) return { mass: -1, structure: -1, region: -1 }
  const p = nav.placeOf(c)
  return { ...p, region: nav.region[c] }
}
