import { combine, computeGeometry, computeMoisture, type Fields } from '../green/fields'
import { Growth } from '../green/growth'
import type { GrowthParams } from '../green/params'
import type { DaySun, Season } from '../green/sunPath'
import type { Building } from '../green/building'

/**
 * Sun hours at which a cell counts as fully lit for the growth model.
 *
 * The species' light preferences were set on the invented building's 0–1
 * scale. Dividing a cell's real hours of direct sun by eight puts them on that
 * scale so that the defaults land on the gardeners' categories without being
 * touched: moss's 0.15 is about an hour (shade), ivy's 0.35 about three (shade
 * to part sun), the flowering vine's 0.8 about six and a half (full sun).
 * Anything over eight hours is as good as it gets.
 */
export const FULL_LIGHT_HOURS = 8

/** The invented building's walls measure 64 m round at the foot; the species' seed counts and tip caps were set for that. */
const REFERENCE_GROUND = 64

/**
 * One simulated year. 600 steps a season: long enough for a season's growth
 * to show — June alone took the campus from 0 to a quarter covered in 1,000
 * steps — and short enough that a year passes in under five seconds at 64×.
 */
export const STEPS_PER_YEAR = 2400
/**
 * The year's light and moisture are refreshed this often: twelve times a
 * year. Each refresh rebuilds moisture and three species' suitability over
 * 202,639 cells; every 100 steps it was most of the cost of a step.
 */
const FIELD_EVERY = 200
/** Die-back is swept this often, as one draw standing for every step since. */
const DIEBACK_EVERY = 25
/**
 * Die-back strength: the per-step chance of withering for a cell its species
 * can't live in at all, and the env at and above which nothing withers.
 * Measured choice — see the Roosevelt Island doc's die-back section.
 */
export const DIEBACK_RATE = 0.01
export const DIEBACK_SURVIVE = 0.5

export type SunSet = Record<Season, DaySun>

export type HistoryPoint = { step: number; coverage: number; bySpecies: number[] }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Where in the year a step falls: 0 is the December solstice, 0.5 the June
 * one. Step 0 is the March equinox — a run starts when planting would, not
 * in the dead of winter.
 */
export function yearPhase(step: number): number {
  return ((step + STEPS_PER_YEAR / 4) % STEPS_PER_YEAR) / STEPS_PER_YEAR
}

/** The month a phase falls in, counting from 21 December. */
export function monthOf(phase: number): string {
  const day = (355 + phase * 365) % 365 // 21 December is day 355
  const date = new Date(Date.UTC(2025, 0, 1 + Math.floor(day)))
  return MONTHS[date.getUTCMonth()]
}

/** The sun's declination on a phase of the year: −23.44° at the December solstice, +23.44° at the June one. */
export function declinationOf(phase: number): number {
  return -23.44 * Math.cos(2 * Math.PI * phase)
}

/**
 * How warm the season is, 0 to 1: a cosine through the year, lagging the sun
 * by a month, because the air is coldest in January and warmest in July
 * rather than at the solstices. Not New York's temperature record — the
 * smallest curve with the right shape.
 */
export function warmthOf(phase: number): number {
  return (1 - Math.cos(2 * Math.PI * (phase - 1 / 12))) / 2
}

/** Growth's vigour from warmth: a tenth of full in deep winter, full at the height of summer. */
export function vigourOf(phase: number): number {
  return 0.1 + 0.9 * warmthOf(phase)
}

/**
 * What the simulation runs on. The campus is a building, scaled by its length
 * of wall, with the building's moisture rule; the roadside is ground, with
 * its own moisture rule, its own scale, and a habitat factor per cell for how
 * much a plant can make of each surface.
 */
export type SimSurface = {
  building: Building
  /** Seed counts and tip caps multiply by this. Default: the length of the foot of the walls ÷ 64 m. */
  scale?: number
  /** Moisture from light and rain. Default: the building's rule. */
  moisture?: (light: Float32Array, rain: number) => Float32Array
  /** A per-cell multiplier on every species' env and suitability. */
  habitat?: Float32Array
}

export type SimMode = {
  /** 'year' cycles the light through the seasons; otherwise one fixed day. */
  day: Season | 'year'
  dieBack: boolean
}

/**
 * The growth model on the Cornell Tech buildings.
 *
 * Everything here is the same code Explore runs — fields, combination, the
 * growth rule — on the campus cells, with the campus's own inputs:
 *
 * - **Light** from the real sun: hours of direct sun ÷ 8, capped at 1. On a
 *   fixed day, that day's hours. Over a year, the hours interpolated between
 *   the three computed days by the sun's declination — December to equinox in
 *   winter and spring, equinox to June in spring and summer — and refreshed
 *   24 times a year.
 * - **Moisture** from the same rule as the invented building, recomputed with
 *   the light.
 * - **Geometry**: corners, roof edges and the line where a wall meets a lower
 *   roof — all the data can say.
 * - **Vigour**, over a year only: growth slows to a tenth in deep winter.
 * - **Die-back**, when on: cells wither where their species can't live.
 *
 * Seeds and tips are scaled to the campus's length of wall (see `Growth`).
 */
export class CampusSim {
  readonly growth: Growth
  readonly surface: SimSurface
  /** Light on the model's 0–1 scale, now. */
  readonly light: Float32Array
  /** Hours of direct sun and the sunlight share, now — a fixed day's, or the interpolated year's. */
  readonly hours: Float32Array
  readonly energy: Float32Array
  private readonly geometry: Float32Array
  private moisture: Float32Array
  fields: Fields
  private params: GrowthParams
  private suns: SunSet
  private mode: SimMode
  /** How much longer than the invented building's the campus's walls are at the foot. */
  readonly scale: number
  /** Bumped whenever the fields change, so a renderer knows to repaint what depends on them. */
  fieldsVersion = 0
  /** Cells that died since the renderer last asked, by `takeDied`. */
  private diedSince: number[] = []
  readonly history: HistoryPoint[] = []
  /** Milliseconds for the last field rebuild, and per step over the last advance. */
  fieldMs = 0
  stepMs = 0

  constructor(surface: SimSurface, suns: SunSet, params: GrowthParams, mode: SimMode) {
    this.surface = surface
    const b = surface.building
    this.scale = surface.scale ?? (b.ground.length * b.cell) / REFERENCE_GROUND
    this.growth = new Growth(b, this.scale)
    this.geometry = computeGeometry(b)
    this.light = new Float32Array(b.count)
    this.hours = new Float32Array(b.count)
    this.energy = new Float32Array(b.count)
    this.params = params
    this.suns = suns
    this.mode = mode
    this.moisture = new Float32Array(b.count)
    this.fields = combine(b, { sun: this.light, moisture: this.moisture, geometry: this.geometry }, params)
    this.refreshLight()
  }

  get phase(): number {
    return yearPhase(this.growth.step)
  }

  get year(): number {
    return Math.floor(this.growth.step / STEPS_PER_YEAR) + 1
  }

  get cycling(): boolean {
    return this.mode.day === 'year'
  }

  setMode(mode: SimMode) {
    this.mode = mode
    this.refreshLight()
  }

  setParams(params: GrowthParams) {
    this.params = params
    this.rebuild()
  }

  /** The light for now: the fixed day's, or the year's at this step. */
  private refreshLight() {
    const { june, equinox, december } = this.suns
    if (this.mode.day !== 'year') {
      const sun = this.suns[this.mode.day]
      this.hours.set(sun.hours)
      this.energy.set(sun.light)
    } else {
      const d = declinationOf(this.phase)
      // Between December and the equinox below 0°, the equinox and June above.
      const [a, b, t] = d < 0 ? [december, equinox, (d + 23.44) / 23.44] : [equinox, june, d / 23.44]
      for (let i = 0; i < this.hours.length; i++) {
        this.hours[i] = a.hours[i] + (b.hours[i] - a.hours[i]) * t
        this.energy[i] = a.light[i] + (b.light[i] - a.light[i]) * t
      }
    }
    for (let i = 0; i < this.light.length; i++) this.light[i] = Math.min(1, this.hours[i] / FULL_LIGHT_HOURS)
    this.rebuild()
  }

  private rebuild() {
    const start = performance.now()
    const b = this.surface.building
    this.moisture = this.surface.moisture ? this.surface.moisture(this.light, this.params.rain) : computeMoisture(b, this.params.rain, this.light)
    this.fields = combine(b, { sun: this.light, moisture: this.moisture, geometry: this.geometry }, this.params)
    const habitat = this.surface.habitat
    if (habitat) {
      for (const field of [...this.fields.env, ...this.fields.suitability]) {
        for (let i = 0; i < field.length; i++) field[i] *= habitat[i]
      }
    }
    this.fieldsVersion++
    this.fieldMs = performance.now() - start
  }

  reset(autoSeed: boolean) {
    this.growth.reset(this.params.seed, this.params, autoSeed)
    this.diedSince = []
    this.history.length = 0
    this.refreshLight()
    this.record()
  }

  plant(cell: number, species: number): boolean {
    return this.growth.plant(cell, species)
  }

  private record() {
    const g = this.growth
    this.history.push({ step: g.step, coverage: g.coverage(), bySpecies: Array.from(g.grownBy, (_, k) => g.coverageOf(k)) })
  }

  advance(steps: number) {
    const start = performance.now()
    const g = this.growth
    for (let k = 0; k < steps; k++) {
      const vigour = this.cycling ? vigourOf(this.phase) : 1
      g.advance(this.fields, this.params, vigour)
      if (this.mode.dieBack && g.step % DIEBACK_EVERY === 0) {
        g.dieBack(this.fields, DIEBACK_EVERY, DIEBACK_RATE, DIEBACK_SURVIVE)
        for (let d = 0; d < g.diedCount; d++) this.diedSince.push(g.died[d])
      }
      if (g.step % FIELD_EVERY === 0) {
        if (this.cycling) this.refreshLight()
        this.record()
      }
    }
    if (steps > 0) this.stepMs = (performance.now() - start) / steps
  }

  /** The cells that died since the last call; the renderer clears them. */
  takeDied(): number[] {
    const out = this.diedSince
    this.diedSince = []
    return out
  }

  /** The month now, over a year; null on a fixed day. */
  get month(): string | null {
    return this.cycling ? monthOf(this.phase) : null
  }
}
