import type { Ground } from '../ground'
import type { RoadNetwork } from '../roads'
import type { SiteLayout } from '../site'
import type { Zone } from '../zoning'
import { buildGraph, type Graph } from './graph'
import { MINUTES_PER_DAY, Population, START_MINUTE, isTravelling, type Task } from './inhabitants'
import { buildPlaces, type Place } from './places'
import { PER_PERSON, RESOURCES, allocate, buildNetwork, placePlants, type Allocation, type Network, type Policy, type ResourceId } from './resources'

/**
 * The city simulation, in three modes, on one fixed step of one minute.
 *
 *   agents     (F) inhabitants follow their schedules; every place is open.
 *   resources  (G) no inhabitants: each building's demand follows a daily
 *              curve, and water, energy and waste are allocated along the
 *              networks.
 *   dynamics   (H) both, coupled by five rules:
 *
 *     1. Demand comes from people. A building asks, per minute, for
 *        PER_PERSON × the people inside it, plus a standing 10% of what it
 *        would ask if full.
 *     2. Supply is allocated along each network by the chosen policy —
 *        nearest first, or shared equally — and limited by the pipes
 *        (resources.ts).
 *     3. A building's activity drifts toward its worst-supplied share of
 *        water and energy — uncollected waste counts half — with a time
 *        constant of an hour.
 *     4. A building whose activity falls under 0.4 closes, and opens again
 *        above 0.6; the gap keeps it from flickering. Workers who arrive at a
 *        closed workplace are turned away, to the park; people still go home
 *        to a closed home.
 *     5. Everything on the statistics panel is counted from 1–4.
 *
 * So the loop closes: more inhabitants → more demand → shortages at the end
 * of the line → closures → turned-away workers. Nothing is scripted; each
 * rule is a line or two below.
 */
export type SimMode = 'agents' | 'resources' | 'dynamics'

export type SimParams = {
  population: number
  /** World units per simulated minute. */
  walkSpeed: number
  /** Plant output as a share of the reference demand. */
  supply: number
  /** Multiplier on every building's demand. */
  demand: number
  /** Pipe capacity as a share of the reference. */
  capacity: number
  /** Who goes short when supply runs out. */
  policy: Policy
}

/** The population supply 100% is sized for, in Experiment H. */
export const REFERENCE_POPULATION = 300
export const STANDING_SHARE = 0.1
export const CLOSE_BELOW = 0.4
export const OPEN_ABOVE = 0.6
/** Activity moves 1/60 of the way to its target each minute: about an hour. */
export const ACTIVITY_RATE = 1 / 60
/** A trunk pipe carries this share of the reference demand at capacity 100%. */
export const PIPE_SHARE = 1

export type ResourceStats = {
  supply: number
  demand: number
  given: number
  shortSupply: number
  shortNetwork: number
  unreachable: number
  saturated: number
  used: number
  utilisation: number
  /** Buildings getting less than 99% of what they ask. */
  shortBuildings: number
}

export type SimStats = {
  minute: number
  population: number
  counts: Record<Task, number>
  travelling: number
  turnedAway: number
  resources: Record<ResourceId, ResourceStats> | null
  open: number
  closed: number
  meanActivity: number
  /** Inhabitants at an open workplace now. */
  working: number
  stepMs: number
  searches: number
}

export type HistorySample = { minute: number; demand: number; supply: number; given: number; open: number; travelling: number }

export class CitySim {
  readonly mode: SimMode
  readonly graph: Graph
  readonly places: Place[]
  readonly population: Population
  readonly networks: Record<ResourceId, Network>
  readonly plants: Record<ResourceId, number>
  minute = START_MINUTE
  /** Per place: 0–1 activity, and whether open. */
  readonly activity: Float64Array
  readonly open: Uint8Array
  readonly occupancy: Int32Array
  allocations: Record<ResourceId, Allocation> | null = null
  /** Per resource, the reference demand that 100% supply is sized for. */
  readonly reference: Record<ResourceId, number>
  history: HistorySample[] = []
  /** The live parameters; replaced, never mutated, by setParams. */
  params: SimParams
  private stepMs = 0
  private readonly demandBuf: Record<ResourceId, Float64Array>

  constructor(mode: SimMode, net: RoadNetwork, layout: SiteLayout, zones: Zone[], ground: Ground, params: SimParams, seed: number) {
    this.mode = mode
    this.params = params
    this.graph = buildGraph(net)
    this.places = buildPlaces(layout, zones, this.graph, ground)
    this.population = new Population(this.places, this.graph, seed)
    this.plants = placePlants(this.graph, net.centre, ground.waterDistance)
    this.networks = Object.fromEntries(RESOURCES.map((r) => [r, buildNetwork(r, this.graph, this.places, this.plants[r])])) as Record<ResourceId, Network>
    const n = this.places.length
    this.activity = new Float64Array(n).fill(1)
    this.open = new Uint8Array(n).fill(1)
    this.occupancy = new Int32Array(n)
    this.demandBuf = Object.fromEntries(RESOURCES.map((r) => [r, new Float64Array(n)])) as Record<ResourceId, Float64Array>
    this.reference = Object.fromEntries(RESOURCES.map((r) => [r, this.referenceDemand(r)])) as Record<ResourceId, number>
    if (mode !== 'resources') this.population.resize(params.population, this.minute)
    if (mode !== 'agents') this.allocateAll()
  }

  /**
   * What 100% supply means. In G, the peak of the daily demand curve summed
   * over every building. In H, REFERENCE_POPULATION people indoors plus every
   * building's standing load — so raising the population past 300 is, by
   * construction, asking for more than the plants make.
   */
  private referenceDemand(r: ResourceId): number {
    if (this.mode === 'resources') {
      let peak = 0
      for (let h = 0; h < 24; h++) {
        let sum = 0
        for (const p of this.places) sum += PER_PERSON[r] * (p.residents * homeCurve(h) + p.jobs * workCurve(h))
        peak = Math.max(peak, sum)
      }
      return peak
    }
    let standing = 0
    for (const p of this.places) standing += STANDING_SHARE * (p.residents + p.jobs)
    return PER_PERSON[r] * (REFERENCE_POPULATION + standing)
  }

  setParams(p: SimParams) {
    this.params = p
    if (this.mode !== 'resources') this.population.resize(p.population, this.minute)
  }

  step() {
    const t0 = performance.now()
    this.minute++
    if (this.mode !== 'resources') {
      this.population.step(this.minute, this.params.walkSpeed, (place) => this.mode !== 'dynamics' || this.open[place] === 1)
    }
    if (this.mode !== 'agents') {
      this.allocateAll()
      if (this.mode === 'dynamics') this.updateActivity()
    }
    if (this.minute % 10 === 0) this.sample()
    this.stepMs = this.stepMs * 0.9 + (performance.now() - t0) * 0.1
  }

  private allocateAll() {
    const { places } = this
    const hour = (this.minute % MINUTES_PER_DAY) / 60
    if (this.mode === 'dynamics') {
      this.occupancy.fill(0)
      for (const a of this.population.agents) {
        const at = this.population.placeOf(a)
        if (at >= 0) this.occupancy[at]++
      }
    }
    const out = {} as Record<ResourceId, Allocation>
    for (const r of RESOURCES) {
      const d = this.demandBuf[r]
      for (const p of places) {
        if (p.kind === 'park') {
          d[p.id] = 0
          continue
        }
        // Rule 1 (H), or the daily curve (G).
        const people =
          this.mode === 'dynamics'
            ? this.occupancy[p.id] + STANDING_SHARE * (p.residents + p.jobs)
            : p.residents * homeCurve(hour) + p.jobs * workCurve(hour)
        d[p.id] = PER_PERSON[r] * people * this.params.demand
      }
      const ref = this.reference[r]
      out[r] = allocate(this.networks[r], places, d, ref * this.params.supply, ref * PIPE_SHARE * this.params.capacity, this.params.policy)
    }
    this.allocations = out
  }

  /** Delivered over demanded for one place and resource; 1 when it asked for nothing. */
  satisfaction(r: ResourceId, place: number): number {
    const want = this.demandBuf[r][place]
    return want > 1e-9 && this.allocations ? this.allocations[r].delivered[place] / want : 1
  }

  private updateActivity() {
    for (const p of this.places) {
      if (p.kind === 'park') continue
      // Rule 3.
      const target = Math.min(this.satisfaction('water', p.id), this.satisfaction('energy', p.id), 0.5 + 0.5 * this.satisfaction('waste', p.id))
      this.activity[p.id] += (target - this.activity[p.id]) * ACTIVITY_RATE
      // Rule 4, with hysteresis.
      if (this.open[p.id] && this.activity[p.id] < CLOSE_BELOW) this.open[p.id] = 0
      else if (!this.open[p.id] && this.activity[p.id] > OPEN_ABOVE) this.open[p.id] = 1
    }
  }

  private sample() {
    const a = this.allocations
    const s = this.stats()
    this.history.push({
      minute: this.minute,
      demand: a ? a.energy.demand : 0,
      supply: a ? a.energy.supply : 0,
      given: a ? a.energy.given : 0,
      open: s.open / Math.max(s.open + s.closed, 1),
      travelling: s.travelling,
    })
    if (this.history.length > 144) this.history.shift()
  }

  stats(): SimStats {
    const counts: Record<Task, number> = { home: 0, toWork: 0, work: 0, toPark: 0, park: 0, toHome: 0 }
    let turnedAway = 0
    let working = 0
    for (const a of this.population.agents) {
      counts[a.task]++
      turnedAway += a.turnedAway
      if (a.task === 'work' && this.open[a.work]) working++
    }
    let open = 0
    let closed = 0
    let act = 0
    let buildings = 0
    for (const p of this.places) {
      if (p.kind === 'park') continue
      buildings++
      act += this.activity[p.id]
      if (this.open[p.id]) open++
      else closed++
    }
    let resources: Record<ResourceId, ResourceStats> | null = null
    if (this.allocations) {
      resources = {} as Record<ResourceId, ResourceStats>
      for (const r of RESOURCES) {
        const al = this.allocations[r]
        let shortBuildings = 0
        for (const p of this.places) if (p.kind !== 'park' && this.satisfaction(r, p.id) < 0.99) shortBuildings++
        resources[r] = {
          supply: al.supply,
          demand: al.demand,
          given: al.given,
          shortSupply: al.shortSupply,
          shortNetwork: al.shortNetwork,
          unreachable: al.unreachable,
          saturated: al.saturated,
          used: al.used,
          utilisation: al.utilisation,
          shortBuildings,
        }
      }
    }
    return {
      minute: this.minute,
      population: this.population.agents.length,
      counts,
      travelling: counts.toWork + counts.toPark + counts.toHome,
      turnedAway,
      resources,
      open,
      closed,
      meanActivity: buildings ? act / buildings : 1,
      working,
      stepMs: this.stepMs,
      searches: this.population.searches,
    }
  }

  travellers() {
    return this.population.agents.filter((a) => isTravelling(a.task))
  }
}

/**
 * Experiment G's demand without people: the share of residents at home and
 * of jobs in use, by hour. Written as steps so they can be read off.
 */
export function homeCurve(hour: number): number {
  if (hour < 6) return 0.35
  if (hour < 9) return 0.9
  if (hour < 17) return 0.45
  if (hour < 23) return 1
  return 0.5
}

export function workCurve(hour: number): number {
  if (hour < 7) return 0.1
  if (hour < 9) return 0.6
  if (hour < 17) return 1
  if (hour < 19) return 0.5
  return 0.1
}

export function clockText(minute: number): string {
  const day = Math.floor(minute / MINUTES_PER_DAY) + 1
  const m = minute % MINUTES_PER_DAY
  return `Day ${day} · ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
