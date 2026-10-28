/**
 * The game's voice: the simulation's own event log, said playfully.
 *
 * Nothing here decides anything. Every line answers an event the game already
 * logs — the same events the Lab lists plainly ("Climber reached floor 2") —
 * so the voice can never claim something that didn't happen. Events with no
 * line here stay silent.
 *
 * The plants have personalities: the Climber is fearless, the Spreader wants
 * everything, the Draper is dramatic.
 */

type Line = { test: RegExp; say: (m: RegExpMatchArray) => string }

const STRUCTURE_DONE: Record<string, string> = {
  Bridge: 'Bridge complete! Sturdy, leafy, slightly lopsided.',
  Balcony: 'Balcony done. Great view, questionable railings.',
  Scaffold: 'Scaffold up! The Climber built itself a staircase.',
  Terrace: 'Terrace open! Sunbathing Spreaders welcome.',
  Canopy: 'Canopy grown. Instant shade, no assembly required.',
  Walkway: 'Walkway strung! A bit swingy, but it holds.',
  Pod: 'Hanging pod finished. Cosy, if you don’t look down.',
  Column: 'Root column planted. That’s not going anywhere.',
}

const STRUCTURE_BEGINS: Record<string, string> = {
  Balcony: 'A Balcony is sprouting. Nobody asked for it, but here we are.',
  Scaffold: 'A Scaffold is coiling upward. The Climber has plans.',
  Terrace: 'A Terrace is spreading out at the roof. Fancy.',
  Canopy: 'A Canopy is unfurling. Shade incoming.',
  Bridge: 'A Bridge is starting to grow…',
  Walkway: 'The Draper is stringing a walkway across. Hold on.',
  Pod: 'Something’s nesting under that edge… a pod!',
  Column: 'The Draper’s strands are twisting into a column.',
}

const LINES: Line[] = [
  { test: /^Climber planted$/, say: () => 'Climber planted. It’s already eyeing the roof.' },
  { test: /^Spreader planted$/, say: () => 'Spreader planted. It wants to go everywhere.' },
  { test: /^Draper planted on living architecture$/, say: () => 'Draper hung from the living architecture. Look at it go.' },
  { test: /^Draper planted on /, say: () => 'Draper hung up. It’s not falling, it’s draping.' },
  { test: /^Climber reached floor (\d+)$/, say: (m) => `Floor ${m[1]}! The Climber is not afraid of heights.` },
  { test: /^Spreader reached the floor (\d+) ledge$/, say: () => 'The Spreader found a ledge. It’s moving in.' },
  { test: /^Climber and Spreader began to overlap/, say: () => 'They’ve met. It’s getting crowded in here.' },
  { test: /^Mutation node: .*, floor (\d+)$/, say: (m) => `Uh oh. Something’s happening on floor ${m[1]}…` },
  { test: /^(\w+) growing toward another building$/, say: (m) => `A ${m[1]} is reaching for the other building!` },
  { test: /^(\w+) begins to grow$/, say: (m) => STRUCTURE_BEGINS[m[1]] ?? `A ${m[1]} begins to grow.` },
  { test: /^(\w+) matured/, say: (m) => STRUCTURE_DONE[m[1]] ?? `${m[1]} complete!` },
  { test: /^Living connection made/, say: () => 'Connected! That’s a living link.' },
  { test: /^A living connection was lost$/, say: () => 'Oops — a living link let go.' },
  { test: /^A veil forms/, say: () => 'Draper over Climber: curtains. Very dramatic.' },
  { test: /^A Draper reached the lawn and took root$/, say: () => 'A Draper touched the lawn and dug in.' },
  { test: /^A Draper spreads onto the living architecture$/, say: () => 'The Draper found a fresh edge to hang off.' },
  { test: /^A Draper lost its edge, and fell$/, say: () => 'A Draper lost its edge. Down it goes.' },
]

/** The playful line for a logged event, or null to stay quiet. */
export function narrate(text: string): string | null {
  for (const line of LINES) {
    const m = text.match(line.test)
    if (m) return line.say(m)
  }
  return null
}

/** Said when the blocks run low: at these counts left. */
export const LOW_BLOCKS: Record<number, string> = {
  10: 'Ten blocks left. Still plenty. Probably.',
  3: 'Three blocks left. No pressure. (Some pressure.)',
  0: 'Out of blocks! Time to let the plants do the heavy lifting.',
}

/** Asks the game to open with My worlds showing; set by the Play page's "Continue". */
export const OPEN_WORLDS_KEY = 'wildform.game.open-worlds'

export const MERGED = 'Nice try! Gluing them together with blocks doesn’t count. Let the plants do it.'

/** How a planted cell suits its plant, and why, from the same fields the growth reads. */
export type PlantVerdict = { rating: 'good' | 'fair' | 'poor' | 'stuck'; reason: 'sunny' | 'dark' | 'dry' | null }

/**
 * Rates a planting the way the plant note does — suitability good from 0.45,
 * fair from 0.2, poor from 0.1, and under 0.1 a tip can't spread — and, if it
 * isn't good, names the worse of its two factors: the light (too sunny or too
 * dark for the species' preference) or the water.
 */
export function verdict(suitability: number, sun: number, lightPreference: number, moistureMatch: number): PlantVerdict {
  const rating = suitability >= 0.45 ? 'good' : suitability >= 0.2 ? 'fair' : suitability >= 0.1 ? 'poor' : 'stuck'
  if (rating === 'good') return { rating, reason: null }
  const light = Math.min(1, Math.max(0.08, 1 - 1.1 * Math.abs(sun - lightPreference)))
  const reason = light < moistureMatch ? (sun > lightPreference ? 'sunny' : 'dark') : 'dry'
  return { rating, reason }
}

const PLANT_LINES: Record<number, Record<string, string>> = {
  0: {
    good: 'Climber planted. Great spot — it’s already eyeing the roof.',
    fair: 'Climber planted. Not bad, not great.',
    sunny: 'Climber in full sun. It’d rather have a bit of shade.',
    dark: 'Climber in deep shade. Bit gloomy, even for a Climber.',
    dry: 'Climber on a dry wall. It’s parched already.',
  },
  1: {
    good: 'Spreader planted in the sun. It wants to go everywhere.',
    fair: 'Spreader planted. It’ll make do.',
    sunny: 'Spreader in blazing sun. Even it thinks that’s a lot.',
    dark: 'Spreader on a shady wall… it’ll sulk.',
    dry: 'Spreader planted somewhere dry. It’s thirsty.',
  },
}

/** The playful line for a planting, given its verdict. */
export function plantLine(species: number, v: PlantVerdict): string {
  const lines = PLANT_LINES[species]
  if (v.rating === 'good') return lines.good
  const why = lines[v.reason ?? 'dry']
  if (v.rating === 'fair') return lines.fair
  return v.rating === 'stuck' ? `${why} It won’t spread from here.` : why
}
