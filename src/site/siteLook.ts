import * as THREE from 'three'
import type { SurfaceKind } from './siteData'

/**
 * Roosevelt Island at golden hour.
 *
 * The page's look rests on one rule: **the light makes it warm, not the
 * paint.** Materials stay neutral-warm — cream, sandstone, taupe, a little
 * clay — and a low orange sun from the west-south-west, setting over
 * Manhattan, gives the sun-facing walls their peach and gold; a cool
 * lavender-grey sky light fills the shadows, so the faces turned away read
 * mauve. Planted context (lawns, trees) is muted sage and olive, so the
 * simulated plants, in cooler, deeper greens, are the greens that stand out.
 * The river is slate, the far shores are haze.
 *
 * Data views (sun hours, moisture, sunlight) keep their own ramps and are
 * drawn unlit and untinted: the mood never touches a number.
 */

/** Ground colours, shared by the viewport and the sidebar's swatches. Muted, so the simulated plants are the greens that read. */
export const SURFACE_COLOURS: Record<SurfaceKind, string> = {
  recreation: '#87905f',
  park: '#7f8a5a',
  openSpace: '#8c9466',
  vacant: '#a09a70',
  median: '#7d8657',
  roadbed: '#56514f',
  sidewalk: '#c4b8a4',
  parking: '#7b736b',
}

export const SCENE = {
  /** Sky, horizon to zenith: peach at the horizon toward the sun, dusty blue-violet overhead. */
  skyHorizon: '#f1b58c',
  skyLow: '#d99a87',
  skyHigh: '#6f7ca3',
  /** The haze distant things fade into: a dusty rose-grey, between the warm horizon and the cool sky. */
  haze: '#c6aaa4',
  water: '#5f6d7e',
  land: '#a8997f',
  /** The low sun and the sky light that fills its shadows. */
  sun: '#ffb877',
  sky: '#9ea4c2',
  bounce: '#8a7378',
  /**
   * The far shores' real buildings: a pale, slightly warm grey, lit but low in
   * contrast so the haze takes them. As unlit boxes a paler grey read
   * near-white; lit, the cooler '#8b8e9c' went a heavy mauve that competed
   * with the island from the island view.
   */
  distant: '#b3abab',
  /** Generic street and park trees: sage and olive, quieter than the simulation. */
  trees: ['#6f7a52', '#7b8459', '#66724e', '#818a63', '#727b56'],
  trunk: '#5e5047',
  edges: '#5b4a42',
}

/**
 * The island's buildings: mostly warm off-white, sandstone, cream and taupe,
 * with a little muted clay and terracotta for variation. Chosen per building
 * by a hash of its index, so the same building is always the same stone.
 */
export const BUILDING_STONE: [string, number][] = [
  ['#e6dccb', 0.24], // warm off-white
  ['#dccbb0', 0.22], // sandstone
  ['#e2d6c4', 0.18], // cream
  ['#c9b8a2', 0.18], // taupe
  ['#c79e80', 0.1], // warm clay
  ['#b98a6d', 0.08], // muted terracotta
]

/** The Cornell Tech buildings: a pale limestone, a touch brighter than the island's stone — the foreground subject. */
export const CAMPUS_STONE = '#efe5d4'

/**
 * The simulated plants on this page. Cooler and deeper than the planted
 * context, and distinct from one another:
 *
 * - **Ivy**, the dominant plant: dense, dark forest green.
 * - **Moss**: softer, flatter, cool teal-sage.
 * - **Flowering vine**: a mid green, lighter than ivy, with lavender flowers.
 *
 * Each has a *fresh* green for the growth front, a *lush* one it settles to,
 * a *dry* olive it drifts toward where it is stressed, and a *withered*
 * brown-grey it fades through when it dies back. `swatch` is its colour in the
 * Species view, legends and bars.
 */
export const SITE_SPECIES = [
  { fresh: '#7fae66', lush: '#33603f', dry: '#5d6844', withered: '#7a6c5e', swatch: '#3f7a52' },
  { fresh: '#a9c2a0', lush: '#5f8576', dry: '#868a66', withered: '#857a68', swatch: '#86ad9e' },
  { fresh: '#9fcb85', lush: '#4b7a52', dry: '#6e7a52', withered: '#80705f', swatch: '#a993d6' },
].map((s) => ({
  fresh: new THREE.Color(s.fresh),
  lush: new THREE.Color(s.lush),
  dry: new THREE.Color(s.dry),
  withered: new THREE.Color(s.withered),
  swatch: new THREE.Color(s.swatch),
  css: s.swatch,
}))

export const VINE_FLOWERS = ['#b9a1d9', '#cdbbe8'].map((c) => new THREE.Color(c))

/** Steps a cell keeps its fresh growth-front green before settling to its species' green. */
export const FRESH_STEPS = 30
/** Steps before a vine cell flowers, and the share that do. */
export const FLOWER_STEPS = 70
export const FLOWER_SHARE = 0.22
/**
 * On the coloured cells, a flower is a softer, rarer mark than up close: a
 * fifth of the vine's cells in full lavender speckled the walls purple from a
 * distance. So only a third of the flowering cells show it there, mixed 55% into the
 * leaf green.
 */
const FLOWER_TEXEL_SHARE = 0.35
const FLOWER_TEXEL_MIX = 0.55
/** Steps a dead cell takes to fade from withered brown-grey back to the bare surface. */
export const FADE_STEPS = 120

function cellHash(cell: number): number {
  let h = Math.imul(cell ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * A grown cell's colour, by species, age and stress.
 *
 * - **Age**: fresh green at the growth front, settling to the species' own
 *   over FRESH_STEPS — the front reads as growth, the mass as vegetation.
 * - **Stress**: toward the dry olive as the species' env on that cell falls —
 *   a plant barely hanging on looks it.
 * - **Flowers**: a fifth of vine cells, once old enough, turn lavender.
 * - A small per-cell nudge in lightness, so coverage reads as foliage.
 */
/** Whether a cell is in flower: vine only, old enough, and one of the fifth chosen by its hash. */
export function flowering(species: number, age: number, cell: number): boolean {
  return species === 2 && age >= FLOWER_STEPS && cellHash(cell * 13 + 5) < FLOWER_SHARE
}

/** Which of the two flower colours a cell's flower is. */
export function flowerColour(cell: number): THREE.Color {
  return VINE_FLOWERS[cellHash(cell * 17 + 3) < 0.6 ? 0 : 1]
}

export function growthColour(species: number, age: number, env: number, cell: number, out: THREE.Color, flowers = true): THREE.Color {
  const look = SITE_SPECIES[species]
  out.copy(look.dry).lerp(look.lush, Math.min(1, Math.max(0, env * 1.25)))
  if (flowers && flowering(species, age, cell) && cellHash(cell * 29 + 1) < FLOWER_TEXEL_SHARE) return out.lerp(flowerColour(cell), FLOWER_TEXEL_MIX)
  if (age < FRESH_STEPS) out.lerp(look.fresh, 1 - age / FRESH_STEPS)
  return out.offsetHSL((cellHash(cell) - 0.5) * 0.025, 0, (cellHash(cell + 7) - 0.5) * 0.12)
}

/** A dead cell's colour while it fades: withered brown-grey, back to the bare surface over FADE_STEPS. */
export function witheredColour(species: number, since: number, base: THREE.Color, out: THREE.Color): THREE.Color {
  return out.copy(SITE_SPECIES[species].withered).lerp(base, Math.min(1, since / FADE_STEPS))
}

export type Ramp = { at: number; colour: THREE.Color }[]

const ramp = (stops: [number, string][]): Ramp => stops.map(([at, c]) => ({ at, colour: new THREE.Color(c) }))

/**
 * Sunlight share, dark to warm white: Explore's three sunlight stops, so the
 * two pages read alike.
 */
export const SUN_RAMP = ramp([
  [0, '#1f2023'],
  [0.5, '#6e5c3a'],
  [1, '#f2e0ae'],
])

/**
 * Sun hours, with its stops on the gardeners' thresholds — 3 h (shade to part
 * sun) and 6 h (part to full sun) — rather than spread evenly to 15. Evenly,
 * a wall with six hours, full sun to anyone choosing a plant, came out a dark
 * brown barely lighter than one with none.
 */
export const HOURS_RAMP = ramp([
  [0, '#1f2023'],
  [3, '#5c4a2e'],
  [6, '#c9a463'],
  [15, '#f7eccb'],
])

/** Moisture, dry to wet: Explore's three moisture stops. */
export const MOISTURE_RAMP = ramp([
  [0, '#24282c'],
  [0.5, '#3a5870'],
  [1, '#a3c8e0'],
])

/** A CSS gradient for a ramp's legend, so the legend and the paint cannot drift apart. */
export function rampGradient(r: Ramp): string {
  const end = r[r.length - 1].at
  return `linear-gradient(90deg, ${r.map((s) => `#${s.colour.getHexString()} ${(100 * s.at) / end}%`).join(', ')})`
}

/** The ramp's colour at `value`, written into `out`. Clamped to the first and last stops. */
export function rampColour(r: Ramp, value: number, out: THREE.Color): THREE.Color {
  if (value <= r[0].at) return out.copy(r[0].colour)
  for (let k = 1; k < r.length; k++) {
    if (value <= r[k].at) return out.copy(r[k - 1].colour).lerp(r[k].colour, (value - r[k - 1].at) / (r[k].at - r[k - 1].at))
  }
  return out.copy(r[r.length - 1].colour)
}
