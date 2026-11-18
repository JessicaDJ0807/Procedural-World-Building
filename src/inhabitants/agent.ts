import type { V3 } from '../build/living'
import type { NavGraph } from './nav'
import { DEFAULT_CONDITIONS, GOAL_NAMES, coldLevel, comfortAt, decide, exposedComfort, smooth, traitsFor, type Conditions, type Decision, type Goal, type Needs, type Traits } from './mind'

/**
 * An inhabitant: a small creature that lives on the green, and the one state
 * machine every page runs it with — Play, the Lab and the Inhabitants studio.
 *
 * Two layers. **What it wants** — a goal, chosen by `decide` (mind.ts) from its
 * needs, its nature and the conditions, over places it can actually reach. And
 * **how it goes about it** — the states below, which carry a goal out over the
 * navigation graph (nav.ts). A goal is chosen when it is idle (and looked at
 * again every 1.5 s while it rests or walks); a state changes several times
 * while one goal is carried out.
 *
 * Every state change goes through `enter`, which checks it against
 * `TRANSITIONS`: the table is the machine. The Inhabitants page draws its graph
 * from the same table, so the diagram can't say one thing while the agents do
 * another — and a change the table doesn't list is counted
 * (`invalidTransitions`), which the tests require to stay at zero.
 *
 * Everything runs in real seconds, not growth steps, and nothing here changes
 * the world: an inhabitant reads a NavGraph and moves itself. Not saved — a
 * loaded world gets new inhabitants, with the same natures (seeded by the
 * world and their number) and fresh needs.
 */

export type Behavior = 'idle' | 'exploring' | 'discovering' | 'travelling' | 'resting' | 'observing' | 'no-route' | 'stranded'
export const BEHAVIORS: Behavior[] = ['idle', 'exploring', 'discovering', 'travelling', 'resting', 'observing', 'no-route', 'stranded']

export const BEHAVIOR_NAMES: Record<Behavior, string> = {
  idle: 'Idle',
  exploring: 'Exploring',
  discovering: 'Discovering',
  travelling: 'Travelling',
  resting: 'Resting',
  observing: 'Observing',
  'no-route': 'No route',
  stranded: 'Stranded',
}

/** What each state means, in a line. */
export const BEHAVIOR_TEXT: Record<Behavior, string> = {
  idle: 'Standing still, deciding what to do next. Every goal starts here.',
  exploring: 'Walking somewhere unfamiliar in its region.',
  discovering: 'Walking to a living structure it hasn’t seen yet.',
  travelling: 'Walking to a chosen place — to rest, to shelter, to look out — or where it was sent.',
  resting: 'Staying put while its energy, or its comfort, comes back.',
  observing: 'Standing at a lookout, looking round.',
  'no-route': 'Sent somewhere it can’t reach — another region, or bare wall.',
  stranded: 'The growth under it withered, and nothing walkable is near.',
}

/** One transition the machine allows, and when it happens. `*`: from any state. */
export type Transition = { from: Behavior | '*'; to: Behavior; when: string; goals?: Goal[]; command?: boolean }

export const TRANSITIONS: Transition[] = [
  { from: 'idle', to: 'exploring', when: 'It chose to explore: somewhere unfamiliar', goals: ['explore'] },
  { from: 'idle', to: 'discovering', when: 'It chose to explore, and a structure it hasn’t seen is in reach', goals: ['explore'] },
  { from: 'idle', to: 'travelling', when: 'It chose to rest, shelter or look out somewhere else', goals: ['rest', 'shelter', 'observe'] },
  { from: 'idle', to: 'resting', when: 'It chose to rest or shelter, and where it stands will do', goals: ['rest', 'shelter'] },
  { from: 'idle', to: 'observing', when: 'It chose to look out, and it is standing at the lookout', goals: ['observe'] },
  { from: 'exploring', to: 'idle', when: 'Got there; or too tired, or too uncomfortable, to go on; or the way is gone' },
  { from: 'discovering', to: 'idle', when: 'Reached the new structure; or too uncomfortable to go on; or the way is gone' },
  { from: 'travelling', to: 'resting', when: 'Reached its resting or sheltering place', goals: ['rest', 'shelter'] },
  { from: 'travelling', to: 'observing', when: 'Reached its lookout', goals: ['observe'] },
  { from: 'travelling', to: 'idle', when: 'Got where it was sent; or wants shelter now; or the way is gone' },
  { from: 'travelling', to: 'no-route', when: 'Sent somewhere, and the way there is gone' },
  { from: 'resting', to: 'idle', when: 'Rested, or the weather has cleared; or something has become more urgent (sheltering palls after a while)' },
  { from: 'observing', to: 'idle', when: 'Done looking round' },
  { from: 'no-route', to: 'idle', when: 'Gave up on that destination' },
  { from: 'stranded', to: 'idle', when: 'Found walkable ground again' },
  { from: '*', to: 'stranded', when: 'The growth under it withered' },
  { from: '*', to: 'travelling', when: 'Sent somewhere it can reach (the studio)', command: true },
  { from: '*', to: 'no-route', when: 'Sent somewhere it can’t reach (the studio)', command: true },
]

/** Whether the machine allows a change of state. */
export function allowed(from: Behavior, to: Behavior): boolean {
  return TRANSITIONS.some((t) => t.to === to && (t.from === from || t.from === '*'))
}

/** A state in words, from the same table: how it's entered and left, and which goals lead to it. */
export function stateStory(b: Behavior) {
  const into = TRANSITIONS.filter((t) => t.to === b)
  const out = TRANSITIONS.filter((t) => t.from === b)
  const goals = [...new Set(into.flatMap((t) => t.goals ?? []))]
  return { into, out, goals }
}

/** Changes the table doesn't list: a bug. The tests require none. */
export const audit = { invalid: 0 }

/** Coats: one per inhabitant, so they can be told apart. Not species — all behave alike but for their nature. */
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
/** While resting or walking, it looks again at what it wants this often, seconds. */
const RECHECK_SECONDS = 1.5
/** Resting at least this long before something else may call it away. */
const MIN_REST = 4
/** How much a rival goal must beat the current one by to interrupt it. */
const URGENT = 0.25

/** Needs per second. Walking tires it in about a minute; resting brings it back in about twenty seconds. */
// Looking round satisfies curiosity only a little (−0.01): at −0.03 it kept curiosity from ever
// building to the point of exploring.
export const RATES = { walk: -0.011, still: -0.0015, rest: 0.045, comfort: 0.2, curiosity: 0.006, observeCuriosity: -0.01 }

export type LogEntry = { at: number; kind: 'state' | 'goal'; text: string }

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
  /** Why it is in this state, in a few words. */
  why: string
  /** Where it is going: the cell, and its position (to find it again when the building is rebuilt). */
  destination: number
  destinationPos: V3 | null
  /** The cells still to step through. */
  path: number[]
  /** The structure it is walking to discover, or −1. */
  target: number
  /** Structures it already knows of: reaching or crossing one adds it. */
  known: Set<number>
  /** Seconds to wait before choosing again, when idle; how long to look round, when observing. */
  wait: number
  /** Off: it makes no choices of its own and stays idle unless sent somewhere. */
  autoExplore: boolean
  /** Walked distance, units, and the number of times it has replanned. */
  walked: number
  replans: number
  rng: () => number

  // --- the mind ---
  needs: Needs
  traits: Traits
  /** What it is trying to do, and why it chose it; null before its first choice, or when sent. */
  goal: Goal | null
  reason: string
  /** Its latest scoring of every goal — the real one it acted on, or checked its plans against — and when. */
  decision: Decision | null
  decidedAt: number
  /** It was sent (the studio), not choosing for itself. */
  sent: boolean
  /** How often it has stood near a spot (3-unit buckets): familiarity. */
  visits: Map<string, number>
  /** The last change of state, and a short history of states and goals. */
  last: { from: Behavior; to: Behavior; at: number } | null
  log: LogEntry[]
  /** Seconds it has lived; and until its next look at what it wants, while busy. */
  clock: number
  recheck: number
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
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const bucket = (p: V3) => `${Math.floor(p[0] / 3)},${Math.floor(p[1] / 3)},${Math.floor(p[2] / 3)}`

/** How familiar it is with a spot: four visits to its 3-unit neighbourhood and it knows it. */
export function familiarity(a: Inhabitant, p: V3): number {
  return Math.min(1, (a.visits.get(bucket(p)) ?? 0) / 4)
}

/**
 * A new inhabitant standing on a walkable cell. It knows the structures already
 * in its region: it discovers what joins later. Its nature comes from
 * `natureSeed` — in Play, the world's seed and its number, so the same world's
 * inhabitants have the same natures after a reload — and its first needs from
 * the same stream.
 */
export function spawn(id: number, nav: NavGraph, cell: number, seed: number, natureSeed = seed): Inhabitant {
  const r = nav.region[cell]
  const nature = seeded(natureSeed * 31 + 7)
  const traits = traitsFor(nature)
  const a: Inhabitant = {
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
    needs: { energy: 0.55 + 0.35 * nature(), comfort: 0.75, curiosity: 0.35 + 0.3 * nature() },
    traits,
    goal: null,
    reason: '',
    decision: null,
    decidedAt: 0,
    sent: false,
    visits: new Map(),
    last: null,
    log: [],
    clock: 0,
    recheck: RECHECK_SECONDS,
  }
  a.visits.set(bucket(a.pos), 4)
  return a
}

function note(a: Inhabitant, kind: LogEntry['kind'], text: string) {
  // The same entry twice in a row says nothing new.
  const prev = a.log[a.log.length - 1]
  if (prev && prev.text === text) return
  a.log.push({ at: a.clock, kind, text })
  if (a.log.length > 40) a.log.shift()
}

function enter(a: Inhabitant, behavior: Behavior, why: string) {
  if (behavior !== a.behavior) {
    if (!allowed(a.behavior, behavior)) {
      audit.invalid++
      if (import.meta.env?.DEV) console.warn(`inhabitant ${a.id}: ${a.behavior} → ${behavior} isn't in TRANSITIONS`)
    }
    a.last = { from: a.behavior, to: behavior, at: a.clock }
    note(a, 'state', `${BEHAVIOR_NAMES[a.behavior]} → ${BEHAVIOR_NAMES[behavior]}: ${why.charAt(0).toLowerCase()}${why.slice(1)}`)
  }
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
 * architecture joins that place to where it stands. Sent, it has no goal of
 * its own until it gets there.
 */
export function sendTo(a: Inhabitant, nav: NavGraph, cell: number) {
  a.target = -1
  a.sent = true
  a.goal = null
  a.reason = 'Sent there'
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
  if (a.destinationPos && (a.behavior === 'exploring' || a.behavior === 'discovering' || a.behavior === 'travelling')) {
    const to = nav.nearest(a.destinationPos, 0.6)
    a.replans++
    if (to < 0 || !walkTo(a, nav, to)) {
      const wasSent = a.sent && a.behavior === 'travelling'
      stop(a)
      if (wasSent) enter(a, 'no-route', 'The way there is gone')
      else {
        enter(a, 'idle', 'The way it was going is gone')
        a.wait = 0.5
      }
    }
  }
}

/** Carries out a goal it has chosen: picks the state, and routes to the place. */
function pursue(a: Inhabitant, nav: NavGraph, d: Decision): boolean {
  const o = d.options.find((x) => x.goal === d.chosen)
  if (!o) return false
  const standing = a.next >= 0 ? a.next : a.cell
  if (a.goal !== o.goal) note(a, 'goal', `Goal: ${GOAL_NAMES[o.goal]} — ${d.reason.charAt(0).toLowerCase()}${d.reason.slice(1)}`)
  a.goal = o.goal
  a.reason = d.reason
  a.sent = false
  // Stays only if the chosen place is where it stands: "near enough" once left one resting a step
  // short of the canopy, in the rain.
  if (o.goal !== 'explore' && o.dest === standing) {
    stop(a)
    if (o.goal === 'observe') {
      enter(a, 'observing', `Looking out from ${o.place}`)
      a.wait = 4 + a.rng() * 3
    } else {
      enter(a, 'resting', o.goal === 'shelter' ? `Sheltering on ${o.place}` : 'Resting where it stands')
      a.recheck = RECHECK_SECONDS
    }
    return true
  }
  // Route to the best place; if the graph has no way there after all, the next best.
  for (const to of [o.dest, ...o.fallbacks]) {
    if (to < 0 || to === standing || !walkTo(a, nav, to)) continue
    const s = nav.placeOf(to).structure
    if (o.goal === 'explore') {
      if (s >= 0 && !a.known.has(s)) {
        a.target = s
        enter(a, 'discovering', `Going to see ${o.place}`)
      } else enter(a, 'exploring', 'Heading somewhere unfamiliar')
    } else enter(a, 'travelling', o.goal === 'rest' ? `Going to rest on ${o.place}` : o.goal === 'shelter' ? `Going to shelter on ${o.place}` : `Going to look out from ${o.place}`)
    a.recheck = RECHECK_SECONDS
    return true
  }
  return false
}

/** Its needs, over `dt` seconds of what it's doing. */
function live(a: Inhabitant, nav: NavGraph, c: Conditions, dt: number) {
  const n = a.needs
  const here = a.next >= 0 ? a.next : a.cell
  const moving = a.behavior === 'exploring' || a.behavior === 'discovering' || a.behavior === 'travelling'
  const comfortHere = here >= 0 ? comfortAt(nav, here, c) : 0.3
  n.comfort += (comfortHere - n.comfort) * Math.min(1, RATES.comfort * dt)
  // Walking in the cold tires it faster.
  if (moving) n.energy += RATES.walk * (1 + 0.5 * coldLevel(c)) * dt
  else if (a.behavior === 'resting') n.energy += RATES.rest * (0.6 + 0.4 * n.comfort) * dt
  else n.energy += RATES.still * dt
  if (a.behavior === 'observing') n.curiosity += RATES.observeCuriosity * dt
  else if (a.behavior !== 'exploring' && a.behavior !== 'discovering') n.curiosity += RATES.curiosity * (0.5 + a.traits.curiosity) * dt
  n.energy = clamp01(n.energy)
  n.curiosity = clamp01(n.curiosity)
  n.comfort = clamp01(n.comfort)
}

/**
 * What staying put is worth to it while resting. Resting, it's the rest option's score. Sheltering,
 * "seek shelter" scores nothing — it is comfortable where it is — so staying is worth how much worse
 * it would be out in the open: measured against nothing, any goal looked urgent enough to walk back
 * out into the rain.
 */
function stayScore(a: Inhabitant, now: Decision['options'][number] | undefined, c: Conditions): number {
  if (a.goal !== 'shelter') return now?.available ? now.score : 0
  const out = exposedComfort(c)
  // And less the longer it has sat there: after half a minute or so a curious one goes out
  // anyway. Without it, they hid through a whole winter.
  return (0.8 * Math.max(0, a.needs.comfort - out) + 0.4 * (1 - out)) * (1 - 0.6 * smooth(25, 80, a.age))
}

function record(a: Inhabitant, d: Decision) {
  a.decision = d
  a.decidedAt = a.clock
}

/** What it knows of itself, for `decide`. */
function self(a: Inhabitant) {
  // Idle, it is choosing afresh: no goal to favour, only the one it just finished.
  const idle = a.behavior === 'idle'
  return { cell: a.next >= 0 ? a.next : a.cell, pos: a.pos, needs: a.needs, traits: a.traits, known: a.known, familiar: (p: V3) => familiarity(a, p), goal: idle ? null : a.goal, recent: idle ? a.goal : null, rng: a.rng }
}

/**
 * Scores its goals now without acting on them — for tests and experiments. Uses its own random
 * stream, not the inhabitant's, so asking doesn't change what it goes on to do.
 */
export function consider(a: Inhabitant, nav: NavGraph, c: Conditions = DEFAULT_CONDITIONS): Decision | null {
  if (a.cell < 0) return null
  return decide({ ...self(a), rng: seeded(a.id * 7919 + 1) }, nav, c)
}

/** Advances an inhabitant by `dt` seconds on a graph, under the given conditions. */
export function step(a: Inhabitant, nav: NavGraph, dt: number, c: Conditions = DEFAULT_CONDITIONS) {
  a.age += dt
  a.clock += dt
  if (a.cell < 0) {
    // Stranded: look again now and then for walkable ground underfoot.
    if (a.age > 1) rehome(a, nav)
    return
  }
  live(a, nav, c, dt)
  const thinking = a.autoExplore && !a.sent

  switch (a.behavior) {
    case 'idle':
      a.wait -= dt
      if (a.wait <= 0 && thinking) {
        const d = decide(self(a), nav, c)
        record(a, d)
        if (!d.chosen || !pursue(a, nav, d)) {
          // Nothing it can do, or no way to where it wanted to go: wait, and look again.
          a.reason = d.chosen ? 'No way to where it wanted to go' : d.reason
          a.wait = 1.5
        }
      }
      break
    case 'resting': {
      a.recheck -= dt
      if (a.recheck > 0 || !thinking) break
      a.recheck = RECHECK_SECONDS
      const d = decide(self(a), nav, c)
      record(a, d)
      const now = d.options.find((o) => o.goal === a.goal)
      const best = d.options.find((o) => o.goal === d.chosen)
      if (a.goal === 'rest' && a.needs.energy >= 0.92) {
        enter(a, 'idle', 'Rested')
        a.wait = 0.5
      } else if (a.goal === 'shelter' && exposedComfort(c) > 0.7 && a.age > MIN_REST) {
        // Sheltering lasts until the weather clears, not until it feels comfortable under cover —
        // which it does at once, and it walked straight back out into the rain.
        enter(a, 'idle', 'The weather has cleared')
        a.wait = 0.5
      } else if (a.age > MIN_REST && best && best.goal !== a.goal && best.score > stayScore(a, now, c) + URGENT) {
        enter(a, 'idle', `${GOAL_NAMES[best.goal]} has become more urgent`)
        a.wait = 0
      }
      break
    }
    case 'observing':
      a.wait -= dt
      if (a.wait <= 0) {
        enter(a, 'idle', 'Done looking round')
        a.wait = 0.8 + a.rng() * 1.2
      }
      break
    case 'no-route':
    case 'stranded':
      if (a.age > NO_ROUTE_SECONDS) {
        stop(a)
        a.sent = false
        enter(a, 'idle', a.behavior === 'no-route' ? 'Gave up on that destination' : 'Waiting')
        a.wait = 1.5
      }
      break
    default: {
      // On the way: now and then, check it still wants to be going.
      a.recheck -= dt
      if (thinking && a.recheck <= 0) {
        a.recheck = RECHECK_SECONDS
        if (a.needs.energy < 0.1 && a.goal === 'explore') {
          stop(a)
          enter(a, 'idle', 'Too tired to go on')
          a.wait = 0
          break
        }
        {
          const d = decide(self(a), nav, c)
          record(a, d)
          const sh = d.options.find((o) => o.goal === 'shelter')!
          const now = d.options.find((o) => o.goal === a.goal)
          if (a.goal !== 'shelter' && sh.available && sh.score > (now?.score ?? 0) + URGENT) {
            stop(a)
            enter(a, 'idle', 'Conditions changed: it wants shelter')
            a.wait = 0
            break
          }
        }
      }
      move(a, nav, dt)
    }
  }
}

function arrive(a: Inhabitant) {
  const goal = a.goal
  if (a.behavior === 'discovering' && a.target >= 0) {
    a.known.add(a.target)
    a.needs.curiosity = clamp01(a.needs.curiosity - 0.35)
  }
  if (a.behavior === 'exploring') a.needs.curiosity = clamp01(a.needs.curiosity - 0.12)
  const was = a.behavior
  const sent = a.sent
  stop(a)
  if (was === 'travelling' && !sent && (goal === 'rest' || goal === 'shelter')) {
    enter(a, 'resting', goal === 'shelter' ? 'Reached shelter' : 'Reached its resting place')
    a.recheck = RECHECK_SECONDS
    return
  }
  if (was === 'travelling' && !sent && goal === 'observe') {
    enter(a, 'observing', 'Reached its lookout')
    a.wait = 4 + a.rng() * 3
    return
  }
  a.sent = false
  enter(a, 'idle', was === 'discovering' ? 'Found the new structure' : was === 'travelling' ? 'Arrived' : 'Got there')
  a.wait = 1.5 + a.rng() * 2.5
}

function move(a: Inhabitant, nav: NavGraph, dt: number) {
  let budget = WALK_SPEED * dt
  while (budget > 0) {
    if (a.next < 0) {
      if (!a.path.length) {
        arrive(a)
        return
      }
      const n = a.path.shift()!
      if (!nav.walkable[n]) {
        // The way ahead stopped being walkable between rebuilds: plan again from here.
        a.replans++
        const to = a.destination
        if (to < 0 || !walkTo(a, nav, to)) {
          const wasSent = a.sent && a.behavior === 'travelling'
          stop(a)
          if (wasSent) enter(a, 'no-route', 'The way ahead is gone')
          else {
            enter(a, 'idle', 'The way ahead is gone')
            a.wait = 0.5
          }
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
      // Learning the ground: a new neighbourhood satisfies a little curiosity.
      const k = bucket(a.pos)
      const v = a.visits.get(k) ?? 0
      if (v === 0) a.needs.curiosity = clamp01(a.needs.curiosity - 0.03)
      a.visits.set(k, v + 1)
      // Walking onto a structure is seeing it.
      const s = nav.placeOf(a.cell).structure
      if (s >= 0) a.known.add(s)
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
