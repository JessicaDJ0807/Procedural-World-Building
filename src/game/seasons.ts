import { UNGROWABLE } from '../green/building'
import { vigourOf } from '../build/draper'
import type { BuildGame, Environment } from '../build/game'

/**
 * The game's year: four seasons that turn on their own, each setting the real
 * rain, sun direction and warmth the simulation grows by.
 *
 * Derived from the step alone, so a saved world comes back in its season with
 * nothing extra saved, and every visit to the same step is the same season.
 *
 * Tuned by goal rate, not by a single run: whether bridges form is sensitive
 * to small differences, so each tuning played the stepping-stone run on ten
 * world seeds for 3,600 steps (docs/project/play.md#seasons). Without seasons
 * 4 of 10 reached the goal (median step 840). A first tuning, harsh from
 * summer on, cut that to 1 of 10; one gentle all year kept 3 but winter did
 * nothing (plants grew 3% through it). These — 500-step seasons, spring the
 * lawn's default weather, a mild summer, a cool autumn and a cold, shifted
 * winter, after most goals have formed — keep 4 of 10 at the same median and
 * cost a third of the plants each winter, which spring regrows.
 *
 * The sun stays near the default direction (−58°): four of five other
 * directions lost the goal outright. The model's sun has one elevation, so a
 * season can't bring "more" sun, only light from a little further round.
 */

export type Season = {
  id: 'spring' | 'summer' | 'autumn' | 'winter'
  name: string
  emoji: string
  env: Environment
  warmth: number
  /** Said when it arrives. */
  arrives: string
  /** Said a little before. */
  coming: string
}

/** Steps per season: a year is 2,000. */
export const SEASON_STEPS = 500
/** How many steps before a change the voice warns of it. */
export const WARNING_STEPS = 60

export const SEASONS: Season[] = [
  {
    id: 'spring',
    name: 'Spring',
    emoji: '🌱',
    env: { rain: 0.55, sunAzimuth: -58 },
    warmth: 1,
    arrives: '🌱 Spring! Everything’s waking up.',
    coming: '🌱 Spring’s nearly here. Hang in there.',
  },
  {
    id: 'summer',
    name: 'Summer',
    emoji: '☀️',
    env: { rain: 0.45, sunAzimuth: -58 },
    warmth: 1,
    arrives: '☀️ Summer. A bit drier out. The Climber notices first.',
    coming: '☀️ Summer’s coming. Thirsty plants, brace yourselves.',
  },
  {
    id: 'autumn',
    name: 'Autumn',
    emoji: '🍂',
    env: { rain: 0.72, sunAzimuth: -62 },
    warmth: 0.8,
    arrives: '🍂 Autumn rains. Climbers, rejoice.',
    coming: '🍂 Autumn’s on its way. Things are slowing down.',
  },
  {
    id: 'winter',
    name: 'Winter',
    emoji: '❄️',
    env: { rain: 0.5, sunAzimuth: -70 },
    warmth: 0.15,
    arrives: '❄️ Winter’s here. Everyone’s huddling.',
    coming: '❄️ Winter’s coming. Grow while you can!',
  },
]

/** The season at a step, how far into it, and how many steps until the next. */
export function seasonAt(step: number, length = SEASON_STEPS): { season: Season; index: number; year: number; left: number; next: Season } {
  const n = Math.floor(Math.max(0, step) / length)
  const index = n % SEASONS.length
  return {
    season: SEASONS[index],
    index,
    year: Math.floor(n / SEASONS.length) + 1,
    left: (n + 1) * length - step,
    next: SEASONS[(index + 1) % SEASONS.length],
  }
}

/** Steps a change of season takes: the weather blends from one to the next, centred on the boundary. */
export const BLEND_STEPS = 150

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/**
 * The weather at a step: the season's own, except within BLEND_STEPS of a
 * change, where rain, sun direction and warmth ease from one season's to the
 * next. A switch at the boundary moved the sun a dozen degrees in one frame.
 */
export function weatherAt(step: number, length = SEASON_STEPS): { env: Environment; warmth: number } {
  const s = Math.max(0, step)
  const boundary = Math.round(s / length) * length
  const half = BLEND_STEPS / 2
  const here = seasonAt(s, length).season
  if (boundary === 0 || Math.abs(s - boundary) >= half) return { env: { ...here.env }, warmth: here.warmth }
  const from = seasonAt(boundary - 1, length).season
  const to = seasonAt(boundary, length).season
  const t = smooth((s - (boundary - half)) / BLEND_STEPS)
  const mix = (a: number, b: number) => a + (b - a) * t
  return {
    env: { rain: mix(from.env.rain, to.env.rain), sunAzimuth: mix(from.env.sunAzimuth, to.env.sunAzimuth) },
    warmth: mix(from.warmth, to.warmth),
  }
}

/**
 * How much of each season is in the air at a step, summing to 1: one season
 * at 1, except across a change, where the two blend as the weather does.
 * The look of the world (seasonLook.ts) follows these.
 */
export function seasonWeights(step: number, length = SEASON_STEPS): number[] {
  const s = Math.max(0, step)
  const w = [0, 0, 0, 0]
  const boundary = Math.round(s / length) * length
  const half = BLEND_STEPS / 2
  const here = seasonAt(s, length).index
  if (boundary === 0 || Math.abs(s - boundary) >= half) {
    w[here] = 1
    return w
  }
  const t = smooth((s - (boundary - half)) / BLEND_STEPS)
  w[seasonAt(boundary - 1, length).index] += 1 - t
  w[seasonAt(boundary, length).index] += t
  return w
}

// --- the badge: the conditions in a few words, from the real values ---

export function rainBadge(rain: number): { emoji: string; word: string } {
  if (rain < 0.2) return { emoji: '🏜️', word: 'Dry' }
  if (rain < 0.45) return { emoji: '🌤️', word: 'Dryish' }
  if (rain < 0.7) return { emoji: '💧', word: 'Damp' }
  return { emoji: '🌧️', word: 'Rainy' }
}

/** Which way the sun comes from, as the game names the buildings (west, east) and the camera's first view (front, back). */
export function sunBadge(azimuth: number): string {
  const dirs = ['front', 'front-east', 'east', 'back-east', 'back', 'back-west', 'west', 'front-west']
  return `from the ${dirs[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8]}`
}

// --- moods: how each plant feels about the conditions overall ---

/**
 * Each plant's score on the lawn in spring (the default weather), measured:
 * what "normal" is for it. The scores barely move in absolute terms — a
 * Climber reads 0.62–0.66 through the year, a Spreader 0.42–0.50, a Draper
 * 0.52–0.55 — so a face compares a plant with its own normal, not with a
 * fixed scale, or it would never change.
 */
export const MOOD_NORMAL: [number, number, number] = [0.64, 0.5, 0.54]

/** A face for a plant's score against its normal; in the cold, everyone freezes. */
export function moodFace(score: number, normal: number, warmth: number): { face: string; word: string } {
  if (warmth < 0.5) return { face: '🥶', word: 'Freezing' }
  const r = score / normal
  if (r >= 1.02) return { face: '😄', word: 'Loving it' }
  if (r >= 0.97) return { face: '🙂', word: 'Happy' }
  if (r >= 0.88) return { face: '😐', word: 'Meh' }
  return { face: '😟', word: 'Struggling' }
}

/**
 * Each plant's fit to the conditions now, 0–1: for Climber and Spreader the
 * mean env — moisture match × light match, what the growth reads — over every
 * growable wall cell; for the Draper the mean of its vigour (draper.ts) over
 * the same walls.
 */
export function moodScores(game: BuildGame): [number, number, number] {
  const b = game.building
  const w = game.sim.world
  let c = 0
  let s = 0
  let d = 0
  let n = 0
  for (let i = 0; i < b.count; i++) {
    if (b.segment[i] < 0 || b.flags[i] & UNGROWABLE) continue
    c += w.env[0][i]
    s += w.env[1][i]
    d += Math.min(1, vigourOf(w.sun[i], w.moisture[i], false, false))
    n++
  }
  return n ? [c / n, s / n, d / n] : [0, 0, 0]
}
