/**
 * The plants: three species, each a temperament and a look.
 *
 * A species is split the same way the model is. What it *needs* — light,
 * water, something to hold on to, a pull upward — are parameters, adjustable
 * per species in Explore, because those are the questions being asked. How it
 * *grows* — whether it runs in lines or spreads in patches, how often it
 * branches, how many tips it can carry — is fixed here: that is what makes moss
 * moss, and turning it into sliders would be turning one species into another.
 *
 * Ivy is the original single plant: its traits are exactly the constants the
 * growth rule had before species existed, and the Progress page's five
 * experiments are run with ivy alone.
 *
 * Species compete only for space: whichever reaches a cell first holds it.
 */

export type SpeciesId = 'ivy' | 'moss' | 'vine'

export const SPECIES_IDS: SpeciesId[] = ['ivy', 'moss', 'vine']

/** What a species needs. Adjustable in Explore, one species at a time. */
export type SpeciesParams = {
  enabled: boolean
  /** 0 = shade-loving, 1 = sun-loving: the light level it does best at. */
  lightPreference: number
  /** The moisture at which it is fully watered. Below 6% of this, it cannot live. */
  moistureNeed: number
  /** 0–1. How strongly it is drawn to corners, frames and ledges. */
  edgePreference: number
  /** 0–1. Bias toward climbing. */
  upward: number
}

/** How a species grows. Fixed: this is the species. */
export type SpeciesTraits = {
  name: string
  blurb: string
  /** Score per occupied neighbour. Positive keeps strands apart; negative pulls growth into patches. */
  crowding: number
  /** Weight on carrying on in the same direction. High for climbers, zero for something that spreads. */
  straightness: number
  /** Branch probability: base + perEnv × env. */
  branch: number
  branchPerEnv: number
  /** Most tips this species can carry at once. */
  maxTips: number
  /** Seeds planted at the foot of the wall. */
  seeds: number
  /** False for moss, which has no stem worth drawing. */
  stems: boolean
}

export const SPECIES: Record<SpeciesId, SpeciesTraits> = {
  ivy: {
    name: 'Ivy',
    blurb: 'A climber that likes shade and steady moisture, and follows edges. Dense, dark, lobed leaves.',
    crowding: 0.25,
    straightness: 0.3,
    branch: 0.03,
    branchPerEnv: 0.04,
    maxTips: 48,
    seeds: 8,
    stems: true,
  },
  moss: {
    name: 'Moss',
    blurb: 'Needs a lot of water and little light. Barely climbs: it spreads sideways into patches where the wall stays damp.',
    // Negative: a cell next to existing moss scores higher, so it fills in
    // around itself instead of sending out strands.
    crowding: -0.12,
    straightness: 0,
    branch: 0.04,
    branchPerEnv: 0.04,
    maxTips: 16,
    seeds: 6,
    stems: false,
  },
  vine: {
    name: 'Flowering vine',
    blurb: 'A sun-lover that tolerates dry walls. Climbs fast in long runs and flowers on its older growth.',
    crowding: 0.35,
    straightness: 0.4,
    branch: 0.04,
    branchPerEnv: 0.05,
    maxTips: 32,
    seeds: 6,
    stems: true,
  },
}

export const DEFAULT_SPECIES: Record<SpeciesId, SpeciesParams> = {
  // Ivy's defaults are the old single plant's Balanced settings, moisture need
  // included: 0.5 reproduces the old smoothstep(0.03, 0.5).
  ivy: { enabled: true, lightPreference: 0.35, moistureNeed: 0.5, edgePreference: 0.45, upward: 0.5 },
  moss: { enabled: true, lightPreference: 0.15, moistureNeed: 0.85, edgePreference: 0.2, upward: 0.1 },
  vine: { enabled: true, lightPreference: 0.8, moistureNeed: 0.3, edgePreference: 0.5, upward: 0.7 },
}

/**
 * The colours each species is drawn in. sRGB hex; the renderer converts.
 * `young` is new growth, `lush` mature growth in a well-watered cell, `dry`
 * mature growth in a dry one. `swatch` is the UI's and the Species view's.
 */
export const SPECIES_LOOK: Record<SpeciesId, { young: string; lush: string; dry: string; stem: string; swatch: string }> = {
  ivy: { young: '#9dbd52', lush: '#2c5524', dry: '#5f6430', stem: '#7a6a55', swatch: '#4f8a4a' },
  moss: { young: '#d2dc76', lush: '#6f8f2a', dry: '#8e8a4a', stem: '#000000', swatch: '#b9c76a' },
  vine: { young: '#bcd57e', lush: '#4f7c35', dry: '#7b7a3e', stem: '#7d8a55', swatch: '#c995a8' },
}

/** Flowers on the vine: two muted tones, chosen per flower. */
export const FLOWER_COLOURS = ['#e7b6c6', '#f1ece0']
