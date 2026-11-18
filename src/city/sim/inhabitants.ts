import { mulberry32 } from '../../noise'
import { findRoute, type Graph } from './graph'
import type { Place } from './places'

/**
 * Inhabitants: people with a home, a job, a favourite park and a schedule.
 *
 * Each runs the same loop, one day after another:
 *
 *   home ──(leave time)──► to work ──► work ──(shift ends)──► to park
 *     ▲                                 │ closed?                  │
 *     │                                 └──── turned away ─────────┤
 *     └────────── to home ◄──(stay ends)──── park ◄────────────────┘
 *
 * The schedule is personal and drawn from the seed: leaving between 06:45 and
 * 09:15, a shift of 7–9 hours, 20–110 minutes in the park. A trip is a route
 * found by A* between the junctions nearest the two doors, with the doors
 * added at each end; it is walked at the inhabitant's speed — the shared
 * walking speed × a personal 0.85–1.15 — and nothing else. Inhabitants do not
 * see each other; congestion is not modelled.
 *
 * Time is a fixed step of one simulated minute, and every random draw comes
 * from one seeded stream, so a run replays exactly.
 */
export type Task = 'home' | 'toWork' | 'work' | 'toPark' | 'park' | 'toHome'
export const TASKS: Task[] = ['home', 'toWork', 'work', 'toPark', 'park', 'toHome']

export const MINUTES_PER_DAY = 1440
/** The clock starts here, so the first morning's commute is moments away. */
export const START_MINUTE = 6 * 60 + 30

export type Inhabitant = {
  id: number
  home: number
  work: number
  /** -1 when the city has no parks. */
  park: number
  task: Task
  /** Minute-of-day this inhabitant leaves home. */
  leave: number
  shift: number
  parkStay: number
  pace: number
  /** Absolute minute the current stay ends. */
  until: number
  /** The trip: a polyline, its cumulative lengths, and how far along it. */
  route: Float64Array
  cum: Float64Array
  along: number
  x: number
  z: number
  heading: number
  trips: number
  turnedAway: number
  /** What happened last, in words, for the inspector. */
  note: string
}

const EMPTY = new Float64Array(0)

export class Population {
  readonly agents: Inhabitant[] = []
  private readonly rand: () => number
  private readonly routes = new Map<number, number[] | null>()
  private readonly homes: number[]
  private readonly homeWeights: number[]
  private readonly works: number[]
  private readonly workWeights: number[]
  private readonly parks: number[]
  /** Distinct routes searched, and junctions A* expanded doing it. */
  searches = 0
  expanded = 0
  private readonly places: Place[]
  private readonly graph: Graph

  constructor(places: Place[], graph: Graph, seed: number) {
    this.places = places
    this.graph = graph
    this.rand = mulberry32(seed * 1013 + 77)
    this.homes = places.filter((p) => p.residents > 0).map((p) => p.id)
    this.homeWeights = this.homes.map((i) => places[i].residents)
    this.works = places.filter((p) => p.jobs > 0).map((p) => p.id)
    this.workWeights = this.works.map((i) => places[i].jobs)
    this.parks = places.filter((p) => p.kind === 'park').map((p) => p.id)
  }

  get canHouse() {
    return this.homes.length > 0 && this.works.length > 0
  }

  private weighted(ids: number[], weights: number[]): number {
    let total = 0
    for (const w of weights) total += w
    let r = this.rand() * total
    for (let i = 0; i < ids.length; i++) {
      r -= weights[i]
      if (r <= 0) return ids[i]
    }
    return ids[ids.length - 1]
  }

  /** The park nearest the workplace, as the crow flies: on the way home, roughly. */
  private parkFor(work: number): number {
    let best = -1
    let bestD = Infinity
    const w = this.places[work]
    for (const p of this.parks) {
      const d = Math.hypot(this.places[p].x - w.x, this.places[p].z - w.z)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }

  /** Grow or shrink to `n`: new people start at home, the newest leave first. */
  resize(n: number, now: number) {
    if (!this.canHouse) return
    while (this.agents.length > n) this.agents.pop()
    while (this.agents.length < n) {
      const home = this.weighted(this.homes, this.homeWeights)
      const work = this.weighted(this.works, this.workWeights)
      const leave = 6 * 60 + 45 + Math.floor(this.rand() * 150)
      const h = this.places[home]
      const a: Inhabitant = {
        id: this.agents.length,
        home,
        work,
        park: this.parkFor(work),
        task: 'home',
        leave,
        shift: 420 + Math.floor(this.rand() * 120),
        parkStay: 20 + Math.floor(this.rand() * 90),
        pace: 0.85 + this.rand() * 0.3,
        until: nextOccurrence(now, leave),
        route: EMPTY,
        cum: EMPTY,
        along: 0,
        x: h.doorX,
        z: h.doorZ,
        heading: 0,
        trips: 0,
        turnedAway: 0,
        note: 'At home.',
      }
      this.agents.push(a)
    }
  }

  private route(from: number, to: number): number[] | null {
    const key = from * 100003 + to
    if (this.routes.has(key)) return this.routes.get(key)!
    const r = findRoute(this.graph, from, to)
    this.searches++
    if (r) this.expanded += r.expanded
    const nodes = r ? r.nodes : null
    this.routes.set(key, nodes)
    return nodes
  }

  private depart(a: Inhabitant, fromPlace: number, toPlace: number, task: Task) {
    const p = this.places[fromPlace]
    const q = this.places[toPlace]
    const nodes = this.route(p.node, q.node)
    if (!nodes) {
      a.note = 'No road connects these two places; staying put.'
      return false
    }
    const pts: number[] = [p.doorX, p.doorZ]
    for (const n of nodes) pts.push(this.graph.x[n], this.graph.z[n])
    pts.push(q.doorX, q.doorZ)
    const route = Float64Array.from(pts)
    const cum = new Float64Array(route.length / 2)
    for (let i = 1; i < cum.length; i++) cum[i] = cum[i - 1] + Math.hypot(route[i * 2] - route[i * 2 - 2], route[i * 2 + 1] - route[i * 2 - 1])
    a.route = route
    a.cum = cum
    a.along = 0
    a.task = task
    a.trips++
    return true
  }

  /**
   * One minute. `open(place)` says whether a workplace is open — Experiment H
   * closes the ones whose resources ran short; F keeps every one open.
   */
  step(now: number, speed: number, open: (place: number) => boolean) {
    for (const a of this.agents) {
      switch (a.task) {
        case 'home':
          if (now >= a.until) {
            if (this.depart(a, a.home, a.work, 'toWork')) a.note = `Left home for work.`
            else a.until = nextOccurrence(now + 1, a.leave)
          }
          break
        case 'work':
          if (now >= a.until) this.afterWork(a, now, 'Shift over.')
          break
        case 'park':
          if (now >= a.until) {
            if (this.depart(a, a.park, a.home, 'toHome')) a.note = 'Leaving the park for home.'
          }
          break
        default:
          this.walk(a, speed)
          if (a.along >= a.cum[a.cum.length - 1]) this.arrive(a, now, open)
      }
    }
  }

  private afterWork(a: Inhabitant, now: number, why: string) {
    if (a.park >= 0 && this.depart(a, a.work, a.park, 'toPark')) a.note = `${why} Heading to the park.`
    else if (this.depart(a, a.work, a.home, 'toHome')) a.note = `${why} Heading home.`
    else {
      a.task = 'home'
      a.until = nextOccurrence(now + 60, a.leave)
    }
  }

  private arrive(a: Inhabitant, now: number, open: (place: number) => boolean) {
    const end = this.places[a.task === 'toWork' ? a.work : a.task === 'toPark' ? a.park : a.home]
    a.x = end.doorX
    a.z = end.doorZ
    a.route = EMPTY
    a.cum = EMPTY
    if (a.task === 'toWork') {
      if (open(a.work)) {
        a.task = 'work'
        a.until = now + a.shift
        a.note = 'At work.'
      } else {
        a.turnedAway++
        a.task = 'work'
        this.afterWork(a, now, 'Workplace closed — short of resources.')
      }
    } else if (a.task === 'toPark') {
      a.task = 'park'
      a.until = now + a.parkStay
      a.note = 'In the park.'
    } else {
      a.task = 'home'
      a.until = nextOccurrence(now + 60, a.leave)
      a.note = 'Home for the night.'
    }
  }

  private walk(a: Inhabitant, speed: number) {
    a.along = Math.min(a.along + speed * a.pace, a.cum[a.cum.length - 1])
    const cum = a.cum
    let i = 1
    while (i < cum.length - 1 && cum[i] < a.along) i++
    const seg = cum[i] - cum[i - 1] || 1
    const t = (a.along - cum[i - 1]) / seg
    const x0 = a.route[i * 2 - 2]
    const z0 = a.route[i * 2 - 1]
    const x1 = a.route[i * 2]
    const z1 = a.route[i * 2 + 1]
    a.x = x0 + (x1 - x0) * t
    a.z = z0 + (z1 - z0) * t
    if (x1 !== x0 || z1 !== z0) a.heading = Math.atan2(x1 - x0, z1 - z0)
  }

  /** Where each inhabitant is counted: the place they are in, or -1 on the road. */
  placeOf(a: Inhabitant): number {
    return a.task === 'home' ? a.home : a.task === 'work' ? a.work : a.task === 'park' ? a.park : -1
  }
}

/** The first time at or after `from` that the clock reads `minuteOfDay`. */
export function nextOccurrence(from: number, minuteOfDay: number): number {
  const day = Math.floor(from / MINUTES_PER_DAY)
  const t = day * MINUTES_PER_DAY + minuteOfDay
  return t >= from ? t : t + MINUTES_PER_DAY
}

export const isTravelling = (t: Task) => t === 'toWork' || t === 'toPark' || t === 'toHome'
