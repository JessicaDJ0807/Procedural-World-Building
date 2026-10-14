import { DEFAULT_SPECIES, type SpeciesId, type SpeciesParams } from './species'

/**
 * Everything a person can change about the growth, and the presets built from it.
 *
 * The environment (rain, sun), what each species needs, one randomness for all
 * of them, and three switches. The switches turn whole rules off, which is
 * what makes the Progress page's experiments reproducible here rather than
 * described.
 */
export type GrowthParams = {
  /** 0–1. How much rain reaches the building; the moisture field scales with it. */
  rain: number
  /** Degrees, the compass direction the sun shines from. 0 is straight at the front wall. */
  sunAzimuth: number
  /** 0–1. How much chance outweighs the environment when a tip picks its next cell. */
  randomness: number
  useMoisture: boolean
  useSunlight: boolean
  useGeometry: boolean
  seed: number
  species: Record<SpeciesId, SpeciesParams>
}

export const SUN_ELEVATION_DEG = 38

export const DEFAULT_PARAMS: GrowthParams = {
  rain: 0.5,
  sunAzimuth: 35,
  randomness: 0.3,
  useMoisture: true,
  useSunlight: true,
  useGeometry: true,
  seed: 1,
  species: DEFAULT_SPECIES,
}

export type PresetId = 'balanced' | 'wet' | 'dry' | 'architecture'

type SpeciesPatch = Partial<Record<SpeciesId, Partial<SpeciesParams>>>

/**
 * Presets change parameters and nothing else — no preset carries a layout.
 * The seed is left alone, so switching preset compares conditions from the
 * same starting seeds. Every preset switches all three species on: the point
 * is to watch the same three plants sort themselves under different weather.
 */
export const PRESETS: {
  id: PresetId
  name: string
  blurb: string
  params: Partial<Omit<GrowthParams, 'species'>>
  species?: SpeciesPatch
}[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    blurb: 'Moderate rain and light; all three species at their defaults.',
    params: { rain: 0.5, sunAzimuth: 35, randomness: 0.3 },
  },
  {
    id: 'wet',
    name: 'Wet + shaded',
    blurb: 'Heavy rain, and ivy that wants deep shade. Moss and ivy take the damp, shaded walls; the vine is left the sunny front.',
    params: { rain: 0.9, sunAzimuth: 35, randomness: 0.3 },
    species: { ivy: { lightPreference: 0.1, edgePreference: 0.35, upward: 0.45 } },
  },
  {
    id: 'dry',
    name: 'Dry + sunny',
    blurb: 'Little rain. Moss barely survives, ivy hangs on at the foot of the wall, and the drought-tolerant vine takes the sunny faces.',
    params: { rain: 0.18, sunAzimuth: 35, randomness: 0.3 },
  },
  {
    id: 'architecture',
    name: 'Architecture-driven',
    blurb: 'High edge preference for every species and little noise: growth traces corners, ledges, window frames and roof edges.',
    params: { rain: 0.55, sunAzimuth: 35, randomness: 0.12 },
    // 0.7, and the history is worth keeping. With ivy alone on the original
    // building, 1.0 left one seed in ten with no growth and 0.9 fixed it.
    // With three species, 0.9 wiped a species out in 9 of 30 runs and 0.8 in
    // none. With the wing and roofs added, 0.8 lost a species in 3 of 30 and
    // 0.7 in none (×1.23 toward features). The counts are small and noisy —
    // 0.6 lost 2 of 30 — so 0.7 is a setting that held, not a threshold.
    species: {
      ivy: { lightPreference: 0.45, edgePreference: 0.7, upward: 0.35 },
      moss: { edgePreference: 0.7 },
      vine: { edgePreference: 0.7 },
    },
  },
]

/** A preset applied to the defaults: every species on, then the preset's changes. */
export function presetParams(id: PresetId, base: GrowthParams): GrowthParams {
  const preset = PRESETS.find((p) => p.id === id)!
  const species = { ...DEFAULT_SPECIES }
  for (const key of Object.keys(species) as SpeciesId[]) {
    species[key] = { ...DEFAULT_SPECIES[key], enabled: true, ...preset.species?.[key] }
  }
  return { ...base, ...preset.params, useMoisture: true, useSunlight: true, useGeometry: true, species }
}

export type SliderSpec<K extends string> = {
  key: K
  label: string
  info: string
  min: number
  max: number
  step: number
  format: (v: number) => string
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export const ENVIRONMENT_SLIDERS: SliderSpec<'rain' | 'sunAzimuth'>[] = [
  {
    key: 'rain',
    label: 'Rain',
    info: 'Water reaching the building. It lands on exposed wall, runs down each column, pools on ledges and is shed by glass. Balconies keep it off the wall below them.',
    min: 0,
    max: 1,
    step: 0.01,
    format: pct,
  },
  {
    key: 'sunAzimuth',
    label: 'Sun direction',
    info: 'Where the sun shines from, around the compass. 0° is straight at the long front wall. Moves the lit faces and the balcony shadows, and dries what it lights.',
    min: 0,
    max: 359,
    step: 1,
    format: (v) => `${Math.round(v)}°`,
  },
]

export const RANDOMNESS_SLIDER: SliderSpec<'randomness'> = {
  key: 'randomness',
  label: 'Randomness',
  info: 'For every species: how much chance outweighs the environment when a tip chooses its next cell. Low values follow the fields closely; high values wander.',
  min: 0,
  max: 1,
  step: 0.01,
  format: pct,
}

export const SPECIES_SLIDERS: SliderSpec<'lightPreference' | 'moistureNeed' | 'edgePreference' | 'upward'>[] = [
  {
    key: 'lightPreference',
    label: 'Light preference',
    info: 'The light level this species does best at: left is shade-loving, right is sun-loving. A cell lit far from this is less suitable.',
    min: 0,
    max: 1,
    step: 0.01,
    format: (v) => (v < 0.34 ? 'shade' : v > 0.66 ? 'sun' : 'either') + ` · ${pct(v)}`,
  },
  {
    key: 'moistureNeed',
    label: 'Moisture need',
    info: 'The moisture at which this species is fully watered. Higher means it needs a wetter wall; below 6% of this value it cannot live at all.',
    min: 0.05,
    max: 1,
    step: 0.01,
    format: pct,
  },
  {
    key: 'edgePreference',
    label: 'Edge preference',
    info: 'How strongly this species is drawn to architectural features — corners, the frame around each window, and the ledges at every floor line.',
    min: 0,
    max: 1,
    step: 0.01,
    format: pct,
  },
  {
    key: 'upward',
    label: 'Upward tendency',
    info: 'A bias toward climbing. At zero a tip is as happy to go sideways or down as up.',
    min: 0,
    max: 1,
    step: 0.01,
    format: pct,
  },
]
