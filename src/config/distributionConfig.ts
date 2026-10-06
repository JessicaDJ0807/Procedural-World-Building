import { KINDS, defaultRules, type AssetKind, type Rule, type Rules } from '../distributions/rules'
import type { DebugView } from '../distributions/DistributionViewport'
import { int, isRecord, params as parseParams, pick, type ConfigSpec } from './spec'

export type DistributionSettings = {
  terrainSeed: number
  scatterSeed: number
  debug: DebugView
  rules: Rules
}

export const DEBUG_VIEWS: { value: DebugView; label: string; hint: string }[] = [
  { value: 'natural', label: 'Natural', hint: 'The ground in its own colours. The scatter is the subject.' },
  { value: 'tree', label: 'Probability · trees', hint: 'Where a tree may be placed: black is never, green is certain. Every tree stands on a lit patch.' },
  { value: 'bush', label: 'Probability · bushes', hint: 'Where a bush may be placed. Note how it hugs the shoreline that the tree mask only leans toward.' },
  { value: 'rock', label: 'Probability · rocks', hint: 'Where a rock may be placed. Turn tree density down and watch this mask grow into the space the forest gave up.' },
  { value: 'all', label: 'Probability · all three', hint: 'All three masks mixed, each in its own colour, so the hand-offs between layers are visible.' },
  { value: 'elevation', label: 'Input · elevation', hint: 'Height above the waterline, 0 at the shore to 1 at the summit. One of the three fields every rule reads.' },
  { value: 'slope', label: 'Input · slope', hint: 'Slope in degrees, white at 45° and above. One of the three fields every rule reads.' },
  { value: 'water', label: 'Input · water nearness', hint: 'How close the nearest water is, decaying over 1.2 world units. One of the three fields every rule reads.' },
]

export type RuleSpec = {
  key: keyof Rule
  label: string
  info: string
  min: number
  max: number
  step: number
  format: (v: number) => string
}

const deg = (v: number) => `${v.toFixed(0)}°`

/** One definition for the sliders and for validating a stored document. */
export const RULE_SPECS: RuleSpec[] = [
  { key: 'slopeMin', label: 'Min slope', info: 'Below this slope the asset fades out over 4°. Rocks use it to stay off the flats.', min: 0, max: 60, step: 1, format: deg },
  { key: 'slopeMax', label: 'Max slope', info: 'Above this slope the asset fades out over 4°. Trees stop just above the terrain\'s median slope, so they take the flatter half.', min: 0, max: 75, step: 1, format: deg },
  { key: 'elevMin', label: 'Min elevation', info: 'Height above the waterline, as a fraction of the way to the summit, below which the asset fades out.', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'elevMax', label: 'Max elevation', info: 'Height above the waterline above which the asset fades out — a treeline, for trees.', min: 0, max: 1.1, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'water', label: 'Water influence', info: 'Positive multiplies the probability toward the shore, negative pushes the asset away from it, zero ignores water entirely. The effect decays over about 1.2 world units.', min: -1, max: 1, step: 0.05, format: (v) => (v === 0 ? 'none' : v > 0 ? `+${v.toFixed(2)} near` : `${v.toFixed(2)} away`) },
  { key: 'cluster', label: 'Clustering', info: 'How strongly a low-frequency noise confines the asset to patches. 0 spreads it evenly over every suitable point; 1 leaves it only inside the patches — forests and clumps rather than an even sprinkle.', min: 0, max: 1, step: 0.05, format: (v) => v.toFixed(2) },
]

export const DENSITY_SPEC = { min: 0, max: 2, step: 0.05 }
export const SEED_RANGE = { min: 1, max: 999 }

export function defaultDistributionSettings(): DistributionSettings {
  return { terrainSeed: 3, scatterSeed: 1, debug: 'natural', rules: defaultRules() }
}

function parse(raw: unknown): { settings: DistributionSettings; repairs: string[] } {
  const d = defaultDistributionSettings()
  if (!isRecord(raw)) return { settings: d, repairs: ['the document had no settings; defaults were used'] }
  const storedRules = isRecord(raw.rules) ? raw.rules : {}
  const rules = {} as Rules
  for (const kind of KINDS) {
    rules[kind] = parseParams(storedRules[kind], [
      { key: 'density', min: DENSITY_SPEC.min, max: DENSITY_SPEC.max, defaultValue: d.rules[kind].density },
      ...RULE_SPECS.map((s) => ({ key: s.key, min: s.min, max: s.max, defaultValue: d.rules[kind][s.key] })),
    ]) as Rule
  }
  return {
    settings: {
      terrainSeed: int(raw.terrainSeed, SEED_RANGE.min, SEED_RANGE.max, d.terrainSeed),
      scatterSeed: int(raw.scatterSeed, SEED_RANGE.min, SEED_RANGE.max, d.scatterSeed),
      debug: pick(raw.debug, DEBUG_VIEWS.map((v) => v.value), d.debug),
      rules,
    },
    repairs: [],
  }
}

const count = (kind: AssetKind, r: Rules) => `${kind} ${r[kind].density.toFixed(2)}`

export const distributionSpec: ConfigSpec<DistributionSettings> = {
  topic: 'distributions',
  schemaVersion: 1,
  defaults: defaultDistributionSettings,
  parse,
  summary: (s) => `terrain ${s.terrainSeed} · seed ${s.scatterSeed} · ${KINDS.map((k) => count(k, s.rules)).join(', ')}`,
}
