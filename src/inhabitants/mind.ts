import type { V3 } from '../build/living'
import type { NavGraph } from './nav'

/**
 * What an inhabitant wants, and why: needs, a nature, the conditions it reads
 * from the world, and a small utility system that turns them into a goal and a
 * destination. The state machine (agent.ts) then carries the goal out, and the
 * navigation graph (nav.ts) decides whether it can.
 *
 *   perception → needs + nature → goal (here) → state machine → route → walking
 *
 * Nothing here moves an inhabitant or changes the world.
 */

export type Goal = 'explore' | 'rest' | 'shelter' | 'observe'
export const GOALS: Goal[] = ['explore', 'rest', 'shelter', 'observe']
export const GOAL_NAMES: Record<Goal, string> = { explore: 'Explore', rest: 'Rest', shelter: 'Seek shelter', observe: 'Observe' }
export const GOAL_TEXT: Record<Goal, string> = {
  explore: 'Go somewhere unfamiliar — above all a structure it hasn’t seen.',
  rest: 'Find a comfortable place it can reach, and stay until its energy is back.',
  shelter: 'Get somewhere more comfortable than here — under cover in rain or cold, out of the sun in summer.',
  observe: 'Climb to a lookout and stay a while, looking round.',
}

/** Needs: they change all the time. 0–1. */
export type Needs = { energy: number; comfort: number; curiosity: number }
/** Nature: it never changes. 0–1. */
export type Traits = { curiosity: number; caution: number; sociability: number }

/** What the world is like right now, as an inhabitant feels it. */
export type Conditions = {
  /** The real rain, 0–1 (game.env.rain). */
  rain: number
  /** The growth's warmth: 1 in spring and summer, 0.15 in winter (game.warmth). */
  warmth: number
  /** How much of summer is in the air, 0–1 (the seasons' weights): sun becomes something to avoid. */
  heat: number
  /** The season's name, for reasons; empty where there are no seasons (the Lab). */
  season: string
}

export const DEFAULT_CONDITIONS: Conditions = { rain: 0.55, warmth: 1, heat: 0, season: '' }

/** A seeded nature: the same inhabitant of the same world has the same one, every load. */
export function traitsFor(rng: () => number): Traits {
  return { curiosity: 0.25 + 0.6 * rng(), caution: 0.2 + 0.6 * rng(), sociability: rng() }
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * How heavy the rain feels: nothing at 0.6, full at 0.95 — spring's 0.55 is dry to them, autumn's
 * 0.72 about a third, a downpour (0.92) nearly all. From 0.45 to 0.8, autumn felt like 85% of a
 * downpour, and in Play five of six inhabitants sheltered through the whole season.
 */
export const rainLevel = (c: Conditions) => smooth(0.6, 0.95, c.rain)
/** How cold it is: 0 at full warmth, 1 at winter's 0.15. */
export const coldLevel = (c: Conditions) => clamp01((1 - c.warmth) / 0.85)

// --- what a place is like ---

/** Storeys are 3 growth units. */
const STOREY = 3

/**
 * Overhead cover, from the building's own cells — no new simulation. A cell is
 * covered if a horizontal surface (a roof, a deck, a structure's underside) lies
 * 0.8–10 units above, within 0.55 of, the point just in front of it: for a wall cell, 0.6 out
 * from the wall, so a wall counts as sheltered only under an eave, a canopy or
 * a bridge that projects over it, not under its own roof. Cells facing down
 * don't count as cover for themselves. Built once per navigation graph.
 */
class Cover {
  // Horizontal surfaces in 1-unit columns, as [x, z, y] triples.
  private columns = new Map<number, number[]>()
  private cache: Float32Array
  private nav: NavGraph
  constructor(nav: NavGraph) {
    this.nav = nav
    const b = nav.building
    for (let i = 0; i < b.count; i++) {
      if (Math.abs(b.ny[i]) < 0.5) continue
      const k = this.key(Math.floor(b.px[i]), Math.floor(b.pz[i]))
      const list = this.columns.get(k)
      if (list) list.push(b.px[i], b.pz[i], b.py[i])
      else this.columns.set(k, [b.px[i], b.pz[i], b.py[i]])
    }
    this.cache = new Float32Array(b.count).fill(-1)
  }
  private key(ix: number, iz: number) {
    return (ix + 4096) * 8192 + (iz + 4096)
  }
  at(cell: number): number {
    if (this.cache[cell] >= 0) return this.cache[cell]
    const b = this.nav.building
    const wall = Math.abs(b.ny[cell]) < 0.5
    const x = b.px[cell] + (wall ? b.nx[cell] * 0.6 : 0)
    const z = b.pz[cell] + (wall ? b.nz[cell] * 0.6 : 0)
    let cover = 0
    // Within 0.55 of the point, not the same 1-unit square: in a coarser grid a wall's
    // outside point shared a square with its own roof's edge cells, and 70% of walkable cells
    // came out "covered".
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.columns.get(this.key(Math.floor(x) + dx, Math.floor(z) + dz))
        if (!list) continue
        for (let k = 0; k < list.length; k += 3) {
          if ((list[k] - x) ** 2 + (list[k + 1] - z) ** 2 > 0.55 * 0.55) continue
          const above = list[k + 2] - b.py[cell]
          if (above > 0.8 && above < 10) cover = Math.max(cover, 1 - smooth(4, 10, above) * 0.5)
        }
      }
    this.cache[cell] = cover
    return cover
  }
}
const covers = new WeakMap<NavGraph, Cover>()
export function coverAt(nav: NavGraph, cell: number): number {
  let c = covers.get(nav)
  if (!c) {
    c = new Cover(nav)
    covers.set(nav, c)
  }
  return c.at(cell)
}

/**
 * What living architecture offers, by kind — a design intention, applied only to
 * cells the graph says are walkable (an underside never is). Shelter and height
 * are measured; these add what can't be: a pod's hoops close round whoever is
 * inside (enclosure), a terrace or a pod is somewhere to settle (rest), a
 * balcony is built to look out from (lookout), a bridge or walkway leads
 * somewhere new (passage).
 */
export const AFFORDANCES: Record<string, { enclosure?: number; rest?: number; lookout?: number; passage?: number }> = {
  pod: { enclosure: 0.3, rest: 0.2 },
  terrace: { rest: 0.15 },
  balcony: { lookout: 0.2, rest: 0.05 },
  bridge: { passage: 0.15, lookout: 0.05 },
  walkway: { passage: 0.15 },
  canopy: { rest: 0.05 },
}

/** What it feels like to stand on a cell under these conditions, 0–1. */
export function comfortAt(nav: NavGraph, cell: number, c: Conditions): number {
  const cover = coverAt(nav, cell)
  const sun = nav.sun ? nav.sun[cell] : 0.5
  const s = nav.placeOf(cell).structure
  const enclosure = s >= 0 ? (AFFORDANCES[nav.kinds.get(s) ?? '']?.enclosure ?? 0) : 0
  const shelter = Math.min(1, cover + enclosure)
  return clamp01(1 - 0.55 * rainLevel(c) * (1 - shelter) - 0.4 * coldLevel(c) * (1 - 0.7 * shelter) - 0.3 * c.heat * sun * (1 - cover))
}

/** How it would feel out in the open — no cover, middling sun: what going anywhere means in this weather. */
export function exposedComfort(c: Conditions): number {
  return clamp01(1 - 0.55 * rainLevel(c) - 0.4 * coldLevel(c) - 0.15 * c.heat)
}

/** How good a lookout a cell is, 0–1: height above the ground, open to the sky, and a balcony's purpose. */
export function viewAt(nav: NavGraph, cell: number): number {
  const s = nav.placeOf(cell).structure
  const lookout = s >= 0 ? (AFFORDANCES[nav.kinds.get(s) ?? '']?.lookout ?? 0) : 0
  const up = nav.building.ny[cell] > 0.5 ? 1 : 0.6
  return clamp01(smooth(1.5, 3 * STOREY, nav.building.py[cell]) * (1 - 0.7 * coverAt(nav, cell)) * up + lookout)
}

// --- the decision ---

/** What the inhabitant knows of itself, for deciding. */
export type Self = {
  cell: number
  pos: V3
  needs: Needs
  traits: Traits
  /** Living structures it has seen. */
  known: Set<number>
  /** How familiar it is with a spot, 0–1. */
  familiar: (p: V3) => number
  /** The goal it is carrying out — favoured a little (hysteresis); null when idle, choosing afresh. */
  goal: Goal | null
  /** The goal it has just finished: a little less appealing straight away, for variety. */
  recent: Goal | null
  rng: () => number
}

export type Factor = { label: string; value: number }
export type Option = {
  goal: Goal
  /** The utility: what it is worth doing now. Meaningless when not available, and not shown as a choice. */
  score: number
  available: boolean
  /** Why it isn't available. */
  unavailable?: string
  factors: Factor[]
  /** The cell to go to (its own, to stay), and a few words on what's there. */
  dest: number
  place: string
  /** Other candidates, best first, in case the route to the first can't be found. */
  fallbacks: number[]
}
export type Decision = { options: Option[]; chosen: Goal | null; reason: string }

/** Names a cell for reasons: the kind of structure, or the kind of surface. */
export function placeName(nav: NavGraph, cell: number): string {
  const s = nav.placeOf(cell).structure
  if (s >= 0) {
    const k = nav.kinds.get(s)
    return k === 'pod' ? 'the hanging pod' : k === 'walkway' ? 'the suspended walkway' : k === 'column' ? 'the root column' : k ? `the ${k}` : 'living architecture'
  }
  const ny = nav.building.ny[cell]
  if (ny > 0.5) return 'a roof'
  if (ny < -0.5) return 'an overhang'
  return coverAt(nav, cell) > 0.4 ? 'a sheltered wall' : 'a wall'
}

const HYSTERESIS = 0.08
const CANDIDATES = 28

/**
 * Scores the four goals over places it can reach (its own region of the
 * graph: a route never leaves one), and picks the best, favouring the goal it
 * already has a little so it doesn't flip between near-equals. Places are
 * judged by straight-line distance here; only the chosen one is routed.
 *
 * Each score is a sum of named factors — what the inspector shows:
 * - **Explore** — curiosity, a curious nature, less for a cautious one; held
 *   back by tiredness and discomfort; and how new the best place is (a
 *   structure it hasn't seen, ground it hasn't walked).
 * - **Rest** — tiredness; a cautious nature settles a little sooner.
 * - **Seek shelter** — how much better somewhere reachable feels than here,
 *   and how uncomfortable it is. Only if somewhere is at least 0.12 better.
 * - **Observe** — a good lookout within reach, a little curiosity; held back by
 *   tiredness and discomfort. Only if there's a lookout worth the name (0.35).
 */
export function decide(self: Self, nav: NavGraph, c: Conditions): Decision {
  const region = nav.region[self.cell]
  const { needs, traits } = self
  const here = self.cell
  const comfortHere = comfortAt(nav, here, c)
  const cells = region >= 0 ? nav.cellsIn(region) : []
  // Candidates: a random spread of its region, a cell of each structure in it, and where it stands.
  const cand = new Set<number>([here])
  for (let k = 0; k < CANDIDATES && cells.length; k++) cand.add(cells[Math.floor(self.rng() * cells.length)])
  if (region >= 0)
    for (const s of nav.regionStructures[region]) {
      const sc = nav.cellsOf(s)
      if (sc.length) cand.add(sc[Math.floor(sc.length / 2)])
    }
  const b = nav.building
  const dist = (cell: number) => Math.hypot(b.px[cell] - self.pos[0], b.py[cell] - self.pos[1], b.pz[cell] - self.pos[2])

  const ranked = (score: (cell: number) => number, keep: (cell: number) => boolean = () => true) =>
    [...cand].filter(keep).map((cell) => ({ cell, v: score(cell) })).sort((p, q) => q.v - p.v)

  // Explore: somewhere new — an unseen structure above all — not too far for a cautious one.
  // How strongly a structure it hasn't seen draws it is its nature: 0.73 for a curious one, near
  // nothing for a cautious one, who ranked an unseen bridge first all the same until this did.
  const lure = Math.max(0, 0.3 + 1.2 * traits.curiosity - 0.6 * traits.caution)
  const novelty = (cell: number) => {
    const s = nav.placeOf(cell).structure
    const unseen = s >= 0 && !self.known.has(s) ? 1 : 0
    const passage = s >= 0 ? (AFFORDANCES[nav.kinds.get(s) ?? '']?.passage ?? 0) : 0
    return Math.min(1, 0.55 * unseen * Math.min(1, lure) + 0.45 * (1 - self.familiar(nav.pos(cell))) + passage * (unseen || 1 - self.familiar(nav.pos(cell))))
  }
  const explorePlaces = ranked((cell) => novelty(cell) * (0.7 + 0.6 * traits.curiosity - 0.3 * traits.caution) - (dist(cell) / 40) * (0.6 + traits.caution), (cell) => dist(cell) > 3)
  const bestNew = explorePlaces[0] ? novelty(explorePlaces[0].cell) : 0
  const tired = 1 - smooth(0.15, 0.45, needs.energy)
  const explore: Option = {
    goal: 'explore',
    score: 0,
    available: explorePlaces.length > 0,
    unavailable: 'nowhere else in its region',
    factors: [
      { label: 'Curiosity', value: 0.55 * needs.curiosity },
      { label: 'Curious nature', value: 0.3 * (traits.curiosity - 0.5) },
      { label: 'Caution', value: -0.2 * (traits.caution - 0.5) },
      // How much the new draws it is its nature: a cautious one is wary of what it hasn't seen.
      { label: 'Something new in reach', value: 0.3 * bestNew * Math.max(0, 0.6 + 0.8 * traits.curiosity - 0.5 * traits.caution) },
      { label: 'Tiredness', value: -0.6 * tired },
      { label: 'Discomfort', value: -0.3 * (1 - needs.comfort) },
      // Going anywhere means going out in it: sheltered, its own comfort is high, but the
      // weather isn't — without this, a sheltered one walked back out into the rain within seconds.
      { label: 'Weather out there', value: -0.5 * (1 - exposedComfort(c)) },
      // Cold keeps it near home whether or not there's shelter: in a world with nothing covered in
      // reach, winter had the most exploring of the year (61% of their time).
      { label: 'The cold', value: -0.3 * coldLevel(c) },
    ],
    dest: explorePlaces[0]?.cell ?? -1,
    place: explorePlaces[0] ? placeName(nav, explorePlaces[0].cell) : '',
    fallbacks: explorePlaces.slice(1, 4).map((p) => p.cell),
  }

  // Rest: the most comfortable place near, familiar for a cautious one; here, if here is as good.
  const restQuality = (cell: number) => {
    const s = nav.placeOf(cell).structure
    const settle = s >= 0 ? (AFFORDANCES[nav.kinds.get(s) ?? '']?.rest ?? 0) : 0
    return comfortAt(nav, cell, c) + settle + 0.2 * traits.caution * self.familiar(nav.pos(cell)) - dist(cell) / 30
  }
  const restPlaces = ranked(restQuality)
  const rest: Option = {
    goal: 'rest',
    score: 0,
    available: restPlaces.length > 0,
    unavailable: 'nowhere to stand',
    factors: [
      { label: 'Tiredness', value: 0.95 * smooth(0.75, 0.15, needs.energy) },
      { label: 'Cautious nature', value: 0.1 * (traits.caution - 0.5) },
      { label: 'A good spot in reach', value: 0.1 * Math.max(0, restPlaces[0]?.v ?? 0) },
    ],
    dest: restPlaces[0]?.cell ?? -1,
    place: restPlaces[0] ? placeName(nav, restPlaces[0].cell) : '',
    fallbacks: restPlaces.slice(1, 4).map((p) => p.cell),
  }

  // Seek shelter: only somewhere clearly better than here.
  const shelterPlaces = ranked((cell) => comfortAt(nav, cell, c) - dist(cell) / 60)
  const best = shelterPlaces[0]
  const gain = best ? comfortAt(nav, best.cell, c) - comfortHere : 0
  // What's making it uncomfortable, in words: the strongest of rain, cold and sun.
  const weather = rainLevel(c) >= coldLevel(c) && rainLevel(c) > 0.3 ? 'the rain' : coldLevel(c) > 0.3 ? 'the cold' : c.heat > 0.3 ? 'the summer sun' : c.season ? c.season.toLowerCase() : 'this weather'
  const shelter: Option = {
    goal: 'shelter',
    score: 0,
    available: !!best && gain >= 0.12 && best.cell !== here,
    unavailable: comfortHere > 0.85 ? 'comfortable where it is' : 'nowhere reachable is more comfortable',
    factors: [
      { label: 'Better there than here', value: 1.2 * gain },
      { label: 'Discomfort', value: 0.5 * (1 - needs.comfort) },
      { label: 'Distance', value: best ? -dist(best.cell) / 40 : 0 },
    ],
    dest: best?.cell ?? -1,
    place: best ? placeName(nav, best.cell) : '',
    fallbacks: shelterPlaces.slice(1, 4).map((p) => p.cell),
  }

  // Observe: a lookout worth the name.
  // A lookout it knows well is less of a draw: the view from the same balcony palls.
  const lookout = (cell: number) => viewAt(nav, cell) * (1 - 0.5 * self.familiar(nav.pos(cell)))
  const views = ranked((cell) => lookout(cell) - dist(cell) / 50)
  const bestView = views[0] ? lookout(views[0].cell) : 0
  const observe: Option = {
    goal: 'observe',
    score: 0,
    available: bestView >= 0.35,
    unavailable: 'no lookout in reach',
    factors: [
      // Weaker than exploring's pull for a curious one: a rested, curious inhabitant (curiosity 0.9)
      // chose to look out over going somewhere new at 0.45 here.
      { label: 'A lookout in reach', value: 0.35 * bestView },
      { label: 'Curiosity', value: 0.1 * needs.curiosity },
      { label: 'Tiredness', value: -0.4 * (1 - smooth(0.2, 0.5, needs.energy)) },
      { label: 'Discomfort', value: -0.3 * (1 - needs.comfort) },
      { label: 'Weather out there', value: -0.5 * (1 - exposedComfort(c)) },
    ],
    dest: views[0]?.cell ?? -1,
    place: views[0] ? placeName(nav, views[0].cell) : '',
    fallbacks: views.slice(1, 4).map((p) => p.cell),
  }

  const options = [explore, rest, shelter, observe]
  // Choosing afresh, the goal it has just finished is a little less appealing — without this, a
  // balanced inhabitant looked out from the same balcony 69% of the time and never explored.
  if (!self.goal && self.recent && self.recent !== 'rest') {
    const o = options.find((x) => x.goal === self.recent)!
    o.factors.push({ label: 'Just did that', value: -0.15 })
  }
  for (const o of options) o.score = o.available ? o.factors.reduce((s, f) => s + f.value, 0) : 0
  const pick = options
    .filter((o) => o.available)
    .map((o) => ({ o, v: o.score + (o.goal === self.goal ? HYSTERESIS : 0) }))
    .sort((p, q) => q.v - p.v)[0]
  if (!pick) return { options, chosen: null, reason: 'Nothing it can do from here' }
  const o = pick.o
  // The reason: the factor that counted most.
  const top = [...o.factors].sort((p, q) => q.value - p.value)[0]
  const reason =
    o.goal === 'shelter'
      ? `Uncomfortable in ${weather}; ${o.place} is better`
      : o.goal === 'rest'
        ? needs.energy < 0.45
          ? 'Energy low'
          : needs.energy < 0.7
            ? 'Getting tired'
            : `Nothing else worth doing; ${o.place} is comfortable`
        : o.goal === 'explore'
          ? bestNew > 0.6 && nav.placeOf(o.dest).structure >= 0 && !self.known.has(nav.placeOf(o.dest).structure)
            ? `An unfamiliar ${placeName(nav, o.dest).replace('the ', '')} is in reach`
            : `${top.label} — somewhere unfamiliar`
          : `A lookout in reach: ${o.place}`
  return { options, chosen: o.goal, reason }
}
