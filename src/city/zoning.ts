import { mulberry32 } from '../noise'
import { sampleAll, type FieldSample, type Fields } from './fields'
import type { Plot } from './plots'

/**
 * Zoning: from continuous maps to a discrete decision per plot.
 *
 * Each plot reads the five maps at its centre and is put through one short
 * decision list. The first rule that applies decides:
 *
 *   1. too small or thin to build on                → open space
 *   2. moisture ≥ 0.8 (wet ground, by the water)     → park
 *   3. density passes the build threshold            → building
 *        …but no road frontage                       → garden (a courtyard)
 *   4. vegetation ≥ the green threshold              → park
 *   5. moisture ≥ 0.5                                → garden
 *   6. otherwise                                     → open space
 *
 * Rule 3 is where a continuous value becomes a yes or no, and there are two
 * ways to do it. A **hard threshold** builds every plot whose density clears
 * it and none that do not, which draws a crisp district boundary along one
 * contour of the map. A **soft band** of width `blend` turns density into a
 * probability — a smoothstep from 0 at threshold − blend to 1 at threshold +
 * blend — and rolls a seeded die per plot, so the edge of the district
 * frays: a park inside the city, a house out in the fields. The die is the
 * plot's own, so moving a slider does not reshuffle plots it does not move.
 *
 * Once a plot is a building, density keeps going: it sets the floor count,
 * and the floor count sets the type.
 */
export type Category = 'building' | 'park' | 'garden' | 'open'
export const CATEGORIES: Category[] = ['building', 'park', 'garden', 'open']

export type RuleId = 'sliver' | 'wet' | 'dense' | 'courtyard' | 'green' | 'moist' | 'rest' | 'random'

export type BuildingType = 'house' | 'apartment' | 'tower'

export type ZoningParams = {
  /** Density a plot needs to be built on. */
  buildThreshold: number
  /** Vegetation a plot needs to become a park, if it is not built on. */
  greenThreshold: number
  /** Half-width of the soft band around the build threshold; 0 is a hard threshold. */
  blend: number
  maxFloors: number
  seed: number
}

export type Zone = {
  plot: Plot
  category: Category
  rule: RuleId
  sample: FieldSample
  /** Rule 3's probability of building, and the plot's roll against it. */
  chance: number
  roll: number
  floors: number
  type: BuildingType | null
}

export const WET = 0.8
export const MOIST = 0.5
/** A plot with less kerb than this has no usable road access. */
export const MIN_FRONTAGE = 3

const smoothstep = (a: number, b: number, x: number) => {
  if (b <= a) return x >= a ? 1 : 0
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Each plot's own die, drawn from its id alone. */
export function plotRoll(seed: number, id: number): number {
  return mulberry32(seed * 7349 + id * 2654435761)()
}

export function floorsFor(density: number, params: ZoningParams): number {
  const f = Math.min(1, Math.max(0, (density - params.buildThreshold) / Math.max(1 - params.buildThreshold, 1e-6)))
  // A power above 1 keeps most of the city low and puts the height in a peak,
  // which is the shape of almost every real skyline.
  return 1 + Math.round((params.maxFloors - 1) * Math.pow(f, 1.6))
}

export function typeFor(floors: number): BuildingType {
  return floors >= 7 ? 'tower' : floors >= 3 ? 'apartment' : 'house'
}

export function zonePlot(plot: Plot, fields: Fields, params: ZoningParams): Zone {
  const sample = sampleAll(fields, plot.centre.x, plot.centre.z)
  const roll = plotRoll(params.seed, plot.id)
  const chance = smoothstep(params.buildThreshold - params.blend, params.buildThreshold + params.blend, sample.density)
  const zone = (category: Category, rule: RuleId): Zone => {
    const floors = category === 'building' ? floorsFor(sample.density, params) : 0
    return { plot, category, rule, sample, chance, roll, floors, type: category === 'building' ? typeFor(floors) : null }
  }
  if (plot.sliver) return zone('open', 'sliver')
  if (sample.moisture >= WET) return zone('park', 'wet')
  const build = params.blend > 0 ? roll < chance : sample.density >= params.buildThreshold
  if (build) return plot.frontage < MIN_FRONTAGE ? zone('garden', 'courtyard') : zone('building', 'dense')
  if (sample.vegetation >= params.greenThreshold) return zone('park', 'green')
  if (sample.moisture >= MOIST) return zone('garden', 'moist')
  return zone('open', 'rest')
}

/**
 * The comparison for Experiment B: the same four categories in fixed shares,
 * dealt out by each plot's die, with no map consulted. Slivers are still open
 * and landlocked plots still gardens — those are facts about the plot, not
 * about the map.
 */
export const RANDOM_MIX: Record<Category, number> = { building: 0.62, park: 0.14, garden: 0.12, open: 0.12 }

export function zoneRandom(plot: Plot, fields: Fields, params: ZoningParams): Zone {
  const sample = sampleAll(fields, plot.centre.x, plot.centre.z)
  const roll = plotRoll(params.seed, plot.id)
  const base = { plot, sample, chance: RANDOM_MIX.building, roll, floors: 0, type: null }
  if (plot.sliver) return { ...base, category: 'open', rule: 'sliver' }
  if (plot.frontage < MIN_FRONTAGE) return { ...base, category: 'garden', rule: 'courtyard' }
  let acc = 0
  for (const c of CATEGORIES) {
    acc += RANDOM_MIX[c]
    if (roll < acc) {
      if (c !== 'building') return { ...base, category: c, rule: 'random' }
      // Heights drawn from the same die, so a random city is not a flat one.
      const floors = 1 + Math.floor((roll / RANDOM_MIX.building) * Math.min(params.maxFloors, 5))
      return { ...base, category: c, rule: 'random', floors, type: typeFor(floors) }
    }
  }
  return { ...base, category: 'open', rule: 'random' }
}

export type ZoningMode = 'random' | 'maps'

export function zoneAll(plots: Plot[], fields: Fields, params: ZoningParams, mode: ZoningMode): Zone[] {
  return plots.map((p) => (mode === 'maps' ? zonePlot(p, fields, params) : zoneRandom(p, fields, params)))
}

export function categoryCounts(zones: Zone[]): Record<Category, number> {
  const out: Record<Category, number> = { building: 0, park: 0, garden: 0, open: 0 }
  for (const z of zones) out[z.category]++
  return out
}

/**
 * Spatial coherence: of each plot's four nearest neighbours, the share in the
 * same category, averaged. Dealing categories at random scores about the sum
 * of their squared shares — 0.43 for RANDOM_MIX — however they are dealt; a
 * map-driven city scores higher because districts are contiguous. It is the
 * number that says the maps are doing something a die cannot.
 */
export function coherence(zones: Zone[], k = 4): number {
  if (zones.length <= k) return 0
  let agree = 0
  let total = 0
  const xs = zones.map((z) => z.plot.centre.x)
  const zs = zones.map((z) => z.plot.centre.z)
  for (let i = 0; i < zones.length; i++) {
    const near: { d: number; j: number }[] = []
    for (let j = 0; j < zones.length; j++) {
      if (j === i) continue
      const d = (xs[i] - xs[j]) ** 2 + (zs[i] - zs[j]) ** 2
      if (near.length < k) {
        near.push({ d, j })
        near.sort((a, b) => a.d - b.d)
      } else if (d < near[k - 1].d) {
        near[k - 1] = { d, j }
        near.sort((a, b) => a.d - b.d)
      }
    }
    for (const n of near) {
      total++
      if (zones[n.j].category === zones[i].category) agree++
    }
  }
  return agree / total
}
