import { FLOOR_HEIGHT, LEDGE } from '../green/building'
import { evaluate, type Evaluation } from './grammar'
import { WildGrowth, type Seed } from './growth'
import { MUTATION_NAMES, SPECIES_NAMES } from './names'
import { CLIMBER, SPREADER } from './species'
import type { Building } from '../green/building'
import { World, type Platform } from './world'

/**
 * One run of Wildform: the world, the two species, the grammar, and what
 * happened — as simulation state, advanced one step at a time.
 *
 * Every decision is made in `advance`, from the seeded stream, never from the
 * clock or the frame rate: the same preset grows the same platform at the same
 * step at any speed, in the browser or in Node.
 *
 *   each step:      grow
 *   every 10 steps: find where the species overlap → evaluate the grammar
 *                   → if a rule is satisfied, the mutation forms:
 *                     the building gains geometry, the fields are recomputed,
 *                     plants that lost their conditions start to wither
 *   every step:     withering, where it has started
 */

export type Preset = 'demo' | 'random'

export type Settings = {
  preset: Preset
  seed: number
  rain: number
  sunAzimuth: number
  /** Off, the grammar never fires: the same run without architecture emerging, for comparison. */
  mutations: boolean
}

/**
 * The Midterm Demo: seeds chosen, not random, so the two species are planted
 * where their paths will cross on the main front, in sun, below a stretch of
 * wall with room for a platform — and a Living Platform reliably forms. The
 * simulation still runs every step; only the start is chosen. Positions are
 * along the foot of the front wall (segment 1, x from −8 to 3).
 */
export const DEMO = {
  seed: 11,
  rain: 0.55,
  sunAzimuth: -15,
  /**
   * Chosen from sweeps of layouts (sun direction, seed positions, seed
   * number), re-run each time the rule changed — last when plants began to
   * grow in layers — and scored by how cleanly the platform's shade changes
   * the growth against the same run with mutations off. Here the platform
   * forms at step 870 on the main front's floor-3 line; 800 steps later its
   * shade holds 66 Climber and 13 Spreader cells, against 34 and 71 without.
   */
  seeds: [
    { species: CLIMBER, along: 10.4 },
    { species: CLIMBER, along: 2.9 },
    { species: SPREADER, along: 5.5 },
  ],
}

export const DEFAULT_SETTINGS: Settings = { preset: 'demo', seed: DEMO.seed, rain: DEMO.rain, sunAzimuth: DEMO.sunAzimuth, mutations: true }

export type SimEvent = { step: number; text: string }

/** Steps between grammar evaluations: often enough to catch an encounter within a second at 1×. */
const EVALUATE_EVERY = 10
/** Platforms at most, so the demo stays one clear idea. */
const MAX_PLATFORMS = 2
/** How many events the log keeps. */
const EVENT_LOG = 5

export class WildSim {
  readonly world: World
  readonly growth: WildGrowth
  /** Seeds to plant on reset instead of a preset's — a building made on the Build page has no demo. */
  customSeeds: Seed[] | null = null
  settings: Settings = { ...DEFAULT_SETTINGS }
  events: SimEvent[] = []
  /** Cells both species hold right now, refreshed with each evaluation. */
  contacts: number[] = []
  /** The grammar's latest verdict on the most promising encounter. */
  candidate: Evaluation | null = null
  /** Steps of the milestones, once reached. */
  milestones: { met: number | null; formed: number | null } = { met: null, formed: null }
  /** Incremented whenever growth is removed, so a renderer knows to rebuild rather than append. */
  revision = 0
  stepMs = 0
  private floorReached = [0, 0]
  private ledgeReached = false
  private witheredSince = [0, 0]
  private detectedOnce = false

  /** On the invented building by default; on any other — a town from the Build page — when given. */
  constructor(base?: Building, seeds?: Seed[]) {
    this.world = new World(base)
    this.customSeeds = seeds ?? null
    // Tips scale with the planting: the caps were set for a seed or two of
    // each species, and a town planted at several walls needs more.
    const perSpecies = seeds ? Math.max(...[0, 1].map((k) => seeds.filter((s) => s.species === k).length)) : 0
    this.growth = new WildGrowth(this.world.building, Math.max(1, perSpecies / 1.5))
    this.reset()
  }

  /** Plants one seed by hand, now. Returns false where nothing can be planted. */
  plant(species: number, cell: number): boolean {
    const ok = this.growth.plant(species, cell, this.world)
    if (ok) this.revision++
    return ok
  }

  get platforms(): Platform[] {
    return this.world.platforms
  }

  get step() {
    return this.growth.step
  }

  seeds(): Seed[] {
    const b = this.world.building
    if (this.customSeeds) return this.customSeeds
    if (this.settings.preset === 'random') return WildGrowth.randomSeeds(b, this.settings.seed, [2, 2])
    // The ground cell on the front wall nearest each chosen position.
    return DEMO.seeds.map((s) => {
      let best = b.ground[0]
      let bestD = Infinity
      for (const g of b.ground) {
        if (b.segment[g] !== 1) continue
        const d = Math.abs(b.along[g] - s.along)
        if (d < bestD) {
          bestD = d
          best = g
        }
      }
      return { species: s.species, cell: best }
    })
  }

  reset(settings?: Partial<Settings>) {
    if (settings) this.settings = { ...this.settings, ...settings }
    if (this.settings.preset === 'demo') this.settings = { ...this.settings, seed: DEMO.seed }
    this.world.rain = this.settings.rain
    this.world.sunAzimuth = this.settings.sunAzimuth
    this.world.reset()
    this.growth.reset(this.settings.seed, this.seeds(), this.world)
    this.events = []
    this.contacts = []
    this.candidate = null
    this.milestones = { met: null, formed: null }
    this.floorReached = [0, 0]
    this.ledgeReached = false
    this.witheredSince = [0, 0]
    this.detectedOnce = false
    this.revision++
  }

  /** Rain and sun mid-run: the fields change, and plants that lose their conditions wither. */
  setEnvironment(rain: number, sunAzimuth: number) {
    this.settings = { ...this.settings, rain, sunAzimuth }
    this.world.setEnvironment(rain, sunAzimuth)
    this.growth.markStress(this.world)
  }

  private log(text: string) {
    this.events.push({ step: this.growth.step, text })
    if (this.events.length > EVENT_LOG) this.events.shift()
  }

  advance(n: number) {
    const started = performance.now()
    for (let k = 0; k < n; k++) this.stepOnce()
    this.stepMs = (performance.now() - started) / Math.max(1, n)
  }

  private stepOnce() {
    const { world, growth } = this
    growth.advance(world)
    const removed = growth.wither(world)
    if (removed) {
      this.revision++
      for (let sp = 0; sp < 2; sp++) this.witheredSince[sp] = growth.witheredBy[sp]
    }
    this.milestonesFor()
    if (growth.step % EVALUATE_EVERY !== 0) return
    this.contacts = growth.contacts()
    if (this.contacts.length && this.milestones.met === null) {
      this.milestones.met = growth.step
      const y = world.building.py[this.contacts[0]]
      this.log(`${SPECIES_NAMES[CLIMBER]} and ${SPECIES_NAMES[SPREADER]} began to overlap, ${y.toFixed(1)} m up`)
    }
    if (!this.settings.mutations || world.platforms.length >= MAX_PLATFORMS) {
      this.candidate = null
      return
    }
    const { ready, best } = evaluate(world, growth, this.contacts)
    // Said once a run, the first time the species meet at a place a platform
    // could stand — every condition about the place holds, and the grammar is
    // waiting only on the plants.
    if (!this.detectedOnce && best && best.checks.every((c) => c.ok || !c.place)) {
      this.detectedOnce = true
      const missing = best.checks.find((c) => !c.ok)
      this.log(missing ? `Interaction detected — waiting on: ${missing.label.toLowerCase()}` : 'Interaction detected where a platform can stand')
    }
    this.candidate = best
    if (!ready) return
    const platform = ready.rule.build(ready.site, growth.step)
    const shaded = world.addPlatform(platform)
    const stressed = growth.markStress(world)
    if (this.milestones.formed === null) this.milestones.formed = growth.step
    // Floors counted from 1, as in the other events: the slab on the 6 m floor line is floor 3's.
    this.log(`${MUTATION_NAMES[platform.kind]} formed at floor ${platform.y / FLOOR_HEIGHT + 1}`)
    this.log(`Sunlight updated: ${shaded} cells now in its shade`)
    if (stressed[SPREADER]) this.log(`${stressed[SPREADER]} ${SPECIES_NAMES[SPREADER]} cells lost their light`)
    this.candidate = null
  }

  private milestonesFor() {
    const { growth, world } = this
    const b = world.building
    // Only the cells grown this step can set a new record.
    for (let k = growth.grown - 1; k >= 0; k--) {
      const e = growth.order[k]
      if (growth.entryBirth[e] !== growth.step) break
      const sp = growth.entrySpecies[e]
      const cell = growth.entryCell[e]
      if (sp === CLIMBER) {
        const floor = Math.floor(b.py[cell] / FLOOR_HEIGHT)
        if (floor > this.floorReached[CLIMBER] && floor >= 1) {
          this.floorReached[CLIMBER] = floor
          if (floor <= 3) this.log(`${SPECIES_NAMES[CLIMBER]} reached floor ${floor + 1}`)
        }
      } else if (!this.ledgeReached && b.flags[cell] & LEDGE && b.py[cell] >= FLOOR_HEIGHT - 0.3) {
        this.ledgeReached = true
        this.log(`${SPECIES_NAMES[SPREADER]} reached the floor ${Math.round(b.py[cell] / FLOOR_HEIGHT) + 1} ledge`)
      }
    }
  }

  /** Re-runs from the start to `step`: a deterministic jump, used for the Before / After timeline. */
  jumpTo(step: number) {
    this.reset()
    this.advance(step)
  }
}
