import { mulberry32 } from '../noise'
import {
  buildStudyTerrain,
  distanceToWater,
  elevationAbove,
  sampleField,
  slopeField,
  type StudyTerrain,
} from '../study/terrain'

/**
 * The site the city is laid on.
 *
 * Topics 5 and 6's terrain, at city scale: the same five-octave value-noise
 * stack carved by droplet erosion. Reused because what this topic needs from
 * a terrain is what those two did — valley floors for roads to prefer, slopes
 * for them to avoid, and water to keep off.
 *
 * Two changes, both for a city rather than a landscape. The ground is tilted
 * along a seeded direction, so the low ground — and the water — collects
 * along one side as a shore. Untilted, the 16% of the site the study terrain
 * floods can lie as one lake across the middle — on seed 1 it did, cutting
 * the site in two. And the water share is
 * 12%, so there is room for a city beside it.
 *
 * Everything downstream asks the ground a few questions, through `Ground`:
 * is this land, how steep, how high, how far from water. Wildform can answer
 * the same questions about its own world and use the road and plot code
 * unchanged.
 */
export const SITE = 400
export const HALF = SITE / 2
export const RELIEF = 22
const RES = 161
const WATER_SHARE = 0.12
/** How much of the relief the tilt adds across the site. */
const TILT = 0.5

export type Ground = {
  half: number
  /** Above the waterline, with a margin so a road never runs along the shore. */
  isLand(x: number, z: number): boolean
  /** Degrees from horizontal. */
  slope(x: number, z: number): number
  height(x: number, z: number): number
  /** World units to the nearest water. */
  waterDistance(x: number, z: number): number
  /** 0 at the waterline, 1 at the highest ground. */
  elevation(x: number, z: number): number
}

export type Site = { terrain: StudyTerrain; ground: Ground }

/** Land must clear the water by this much, so shorelines are not built to the edge. */
const SHORE = 0.3

export function buildSite(seed: number): Site {
  const base = buildStudyTerrain(seed, { res: RES, size: SITE, relief: RELIEF })
  const angle = mulberry32(seed * 613 + 1)() * Math.PI * 2
  const dx = Math.cos(angle)
  const dz = Math.sin(angle)
  const height = new Float32Array(base.height.length)
  let lo = Infinity
  let hi = -Infinity
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const k = j * RES + i
      const x = -HALF + i * base.cell
      const z = -HALF + j * base.cell
      const h = base.height[k] + TILT * RELIEF * ((x * dx + z * dz) / HALF)
      height[k] = h
      if (h < lo) lo = h
      if (h > hi) hi = h
    }
  }
  for (let k = 0; k < height.length; k++) height[k] = ((height[k] - lo) / (hi - lo)) * RELIEF
  const sorted = Float32Array.from(height).sort()
  const waterLevel = sorted[Math.floor(sorted.length * WATER_SHARE)]
  const terrain: StudyTerrain = {
    ...base,
    height,
    slope: slopeField(height, RES, base.cell),
    waterDist: distanceToWater(height, RES, base.cell, waterLevel),
    waterLevel,
    minHeight: 0,
    maxHeight: RELIEF,
  }
  const ground: Ground = {
    half: HALF,
    isLand: (x, z) => sampleField(terrain, terrain.height, x, z) > terrain.waterLevel + SHORE,
    slope: (x, z) => sampleField(terrain, terrain.slope, x, z),
    height: (x, z) => sampleField(terrain, terrain.height, x, z),
    waterDistance: (x, z) => sampleField(terrain, terrain.waterDist, x, z),
    elevation: (x, z) =>
      Math.min(1, Math.max(0, elevationAbove(terrain, sampleField(terrain, terrain.height, x, z)))),
  }
  return { terrain, ground }
}
