import type { GeometryMode } from '../NoiseViewport'
import {
  BLEND_MODES,
  SHAPING_OPS,
  fbmOctaves,
  getShapingOp,
  type BlendName,
  type NoiseLayer,
  type ShapingName,
} from '../noise'
import { EROSION_PARAM_SPECS, EROSION_PRESETS, getPreset, type ErosionParams } from '../erosion'
import { PALETTES, type PaletteName } from '../palette'
import { CONTINUOUS } from '../palette'
import { VIZ_ACCENT } from '../theme'
import {
  DEFAULT_LAB,
  LAB_MAX_AMPLITUDE,
  MAX_LAB_LAYERS,
  createLabLayer,
  type CellularMode,
  type LabBlend,
  type LabFold,
  type LabLayer,
  type LabSettings,
  type LabShaping,
  type NoiseType,
} from '../maplab/noiseLab'
import { bool, hex, int, isRecord, num, params as parseParams, pick, type ConfigSpec } from './spec'

/** A layer as stored: the live layer without its id, which is a React key. */
export type StoredLayer = Omit<NoiseLayer, 'id'>

/**
 * Where the Simulate tab's ground comes from. `lab` is the field the Noise tab
 * built; `stack` is the layered value-noise generator Topic 2 started with,
 * kept so that every measurement in the chapter can still be reproduced.
 */
export type TerrainSource = 'lab' | 'stack'

export type NoiseSettings = {
  source: TerrainSource
  /** The Noise tab's settings, stored with the world so a lab-sourced world reloads as the same ground. */
  lab: LabSettings
  mode: GeometryMode
  resolution: number
  heightScale: number
  relief: number
  slice: number
  spin: number
  wireframe: boolean
  tint: string
  paletteName: PaletteName
  bands: number
  fitRamp: boolean
  presetName: string
  erosionParams: ErosionParams
  density: number
  erosionSeed: number
  showCutFill: boolean
  caThreshold: number
  survive: number
  warpAmount: number
  warpFrequency: number
  warpSeed: number
  talus: number
  talusStrength: number
  thermalPasses: number
  octaves: number
  persistence: number
  layers: StoredLayer[]
  outputShapingName: ShapingName
  outputParams: Record<string, number>
}

const MODES: GeometryMode[] = ['surface', 'volume', 'planet']
const SHAPING_NAMES = SHAPING_OPS.map((o) => o.value)
const BLEND_NAMES = BLEND_MODES.map((b) => b.value)
const PALETTE_NAMES = PALETTES.map((p) => p.value)
const PRESET_NAMES = EROSION_PRESETS.map((p) => p.value)

const DEFAULT_PRESET = 'gorges'

export const FBM_BASE_FREQUENCY = 2
const FBM_SPREAD = 0.6
export const DEFAULT_OCTAVES = 6
export const DEFAULT_PERSISTENCE = 0.5
export const DEFAULT_NOISE_RESOLUTION = 128

/**
 * Seeds are the octave index rather than a running counter, so rebuilding at a
 * different persistence redraws the same terrain at a different roughness
 * instead of an unrelated one — which is the only way the dial is readable.
 *
 * Stored layers carry no id: it is a React key, minted fresh on load.
 */
export function fbmStack(
  octaves: number,
  persistence: number,
  maxFrequency: number,
): StoredLayer[] {
  return fbmOctaves(octaves, FBM_BASE_FREQUENCY, persistence, maxFrequency).map(
    (octave, index) => ({
      name: `Octave ${index + 1}`,
      enabled: true,
      frequency: octave.frequency,
      spread: FBM_SPREAD,
      seed: index + 1,
      shapingName: 'none' as ShapingName,
      shapingParams: {},
      blendName: 'normal' as BlendName,
      opacity: octave.opacity,
    }),
  )
}

export function defaultNoiseSettings(): NoiseSettings {
  const preset = getPreset(DEFAULT_PRESET)
  return {
    source: 'lab',
    lab: { ...DEFAULT_LAB, layers: DEFAULT_LAB.layers.map((l) => ({ ...l })) },
    mode: 'surface',
    resolution: DEFAULT_NOISE_RESOLUTION,
    heightScale: 1.4,
    relief: 0.18,
    slice: 0,
    spin: 0,
    wireframe: false,
    tint: VIZ_ACCENT,
    paletteName: 'land',
    bands: CONTINUOUS,
    fitRamp: true,
    presetName: DEFAULT_PRESET,
    erosionParams: { ...preset.params },
    density: preset.density,
    erosionSeed: 1,
    showCutFill: false,
    caThreshold: 0.5,
    survive: 14,
    warpAmount: 0,
    warpFrequency: 4,
    warpSeed: 1,
    talus: 0.02,
    talusStrength: 0.5,
    thermalPasses: 0,
    octaves: DEFAULT_OCTAVES,
    persistence: DEFAULT_PERSISTENCE,
    // Six octaves rather than the two this started with: measured against a
    // structure function, two layers four octaves apart score 0.960 for
    // straightness where real topography is above 0.99, and six score 0.990.
    layers: fbmStack(DEFAULT_OCTAVES, DEFAULT_PERSISTENCE, DEFAULT_NOISE_RESOLUTION),
    outputShapingName: 'none',
    outputParams: {},
  }
}

const NOISE_TYPES: NoiseType[] = ['white', 'perlin', 'cellular']
const CELLULAR_MODES: CellularMode[] = ['distance', 'edges']
const LAB_FOLDS: LabFold[] = ['none', 'ridged', 'billow']
const LAB_BLENDS: LabBlend[] = ['add', 'subtract', 'multiply', 'max']
const LAB_SHAPINGS: LabShaping[] = ['none', 'terrace', 'power']

/** One Noise-tab layer, clamped to the ranges its own controls allow. */
function parseLabLayer(raw: Record<string, unknown>, fallbackSeed: number, fold: unknown = raw.fold): LabLayer {
  const d = createLabLayer()
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : d.id,
    enabled: bool(raw.enabled, true),
    noise: pick<NoiseType>(raw.noise, NOISE_TYPES, d.noise),
    cellular: pick<CellularMode>(raw.cellular, CELLULAR_MODES, d.cellular),
    frequency: num(raw.frequency, 0.5, 12, d.frequency),
    octaves: int(raw.octaves, 1, 8, d.octaves),
    persistence: num(raw.persistence, 0.2, 0.9, d.persistence),
    lacunarity: num(raw.lacunarity, 1.5, 3, d.lacunarity),
    fold: pick<LabFold>(fold, LAB_FOLDS, d.fold),
    ridgeSharpness: num(raw.ridgeSharpness, 1, 4, d.ridgeSharpness),
    blend: pick<LabBlend>(raw.blend, LAB_BLENDS, d.blend),
    weight: num(raw.weight, 0, 1, d.weight),
    seed: int(raw.seed, 0, 999, fallbackSeed),
  }
}

/**
 * The Noise tab's settings, clamped to the ranges its own controls allow.
 *
 * Also reads the shape the Noise tab had before it could stack — one noise, with
 * ridged and billow sharing a single Shaping control with terrace and power.
 * That becomes one layer, the fold moving onto it and terrace or power
 * staying global, which is exactly the field it produced.
 */
function parseLab(raw: unknown): LabSettings {
  const d = DEFAULT_LAB
  if (!isRecord(raw)) return { ...d, layers: d.layers.map((l) => ({ ...l })) }

  let layers: LabLayer[]
  let shaping: unknown = raw.shaping
  if (Array.isArray(raw.layers)) {
    layers = raw.layers
      .filter(isRecord)
      .slice(0, MAX_LAB_LAYERS)
      .map((layer, i) => parseLabLayer(layer, i))
  } else {
    const legacyFold = raw.shaping === 'ridged' || raw.shaping === 'billow' ? raw.shaping : 'none'
    if (legacyFold !== 'none') shaping = 'none'
    // The flat shape's `seed` is the field seed, not a layer offset — read as
    // one, a converted world would load as different terrain under its name.
    layers = [parseLabLayer({ ...raw, seed: 0 }, 0, legacyFold)]
  }
  if (layers.length === 0) layers = d.layers.map((l) => ({ ...l }))

  return {
    seed: int(raw.seed, 0, 99999, d.seed),
    layers,
    shaping: pick<LabShaping>(shaping, LAB_SHAPINGS, d.shaping),
    amplitude: num(raw.amplitude, 0.05, LAB_MAX_AMPLITUDE, d.amplitude),
    terraceSteps: int(raw.terraceSteps, 2, 16, d.terraceSteps),
    powerExponent: num(raw.powerExponent, 0.25, 4, d.powerExponent),
    warp: bool(raw.warp, d.warp),
    warpStrength: num(raw.warpStrength, 0, 0.5, d.warpStrength),
    warpScale: num(raw.warpScale, 0.5, 8, d.warpScale),
    island: bool(raw.island, d.island),
    islandFalloff: num(raw.islandFalloff, 0.2, 2, d.islandFalloff),
    seaLevel: num(raw.seaLevel, 0, 0.8, d.seaLevel),
  }
}

function parseLayer(raw: unknown): StoredLayer | null {
  if (!isRecord(raw)) return null
  const shapingName = pick<ShapingName>(raw.shapingName, SHAPING_NAMES, 'none')
  return {
    name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 60) : 'Layer',
    enabled: bool(raw.enabled, true),
    frequency: int(raw.frequency, 1, 512, 8),
    spread: num(raw.spread, 0, 4, 1),
    seed: int(raw.seed, 0, 1e6, 1),
    shapingName,
    shapingParams: parseParams(raw.shapingParams, getShapingOp(shapingName).params),
    blendName: pick<BlendName>(raw.blendName, BLEND_NAMES, 'normal'),
    opacity: num(raw.opacity, 0, 1, 1),
  }
}

/**
 * Deliberately absent from the stored shape: the selected cell, the erosion
 * run, whether a run is in flight, the CA generation count, whether it is
 * playing, and which layer is expanded. Four of those are transient UI and two
 * are accumulated simulation state — the parameters that produce them are
 * stored instead, so a loaded world starts from step zero rather than claiming
 * a history it cannot reproduce. Erosion in particular seeds off cumulative
 * droplets, so a stored generation count would be a number with no run behind
 * it.
 */
function parse(raw: unknown): { settings: NoiseSettings; repairs: string[] } {
  const repairs: string[] = []
  const d = defaultNoiseSettings()
  if (!isRecord(raw)) {
    return { settings: d, repairs: ['the document had no settings; defaults were used'] }
  }

  const presetName = pick(raw.presetName, PRESET_NAMES, d.presetName)
  if (raw.presetName !== undefined && presetName !== raw.presetName) {
    repairs.push('unknown erosion preset, reset to the default')
  }
  const presetParams = getPreset(presetName).params

  // Each erosion parameter is clamped to the range its own control allows,
  // falling back to the preset rather than to a global default.
  const storedErosion = isRecord(raw.erosionParams) ? raw.erosionParams : {}
  const erosionParams = { ...presetParams }
  for (const spec of EROSION_PARAM_SPECS) {
    erosionParams[spec.key] = num(
      storedErosion[spec.key],
      spec.min,
      spec.max,
      presetParams[spec.key],
    )
  }

  let layers: StoredLayer[] = []
  if (Array.isArray(raw.layers)) {
    layers = raw.layers
      .map(parseLayer)
      .filter((layer): layer is StoredLayer => layer !== null)
    if (layers.length !== raw.layers.length) repairs.push('some layers were unreadable and dropped')
  }
  if (layers.length === 0) {
    if (Array.isArray(raw.layers)) repairs.push('no usable layers in the document')
    layers = d.layers
  }

  const outputShapingName = pick<ShapingName>(raw.outputShapingName, SHAPING_NAMES, d.outputShapingName)

  const resolution = int(raw.resolution, 16, 256, d.resolution)
  if (typeof raw.resolution === 'number' && raw.resolution !== resolution) {
    repairs.push(`resolution ${raw.resolution} is out of range, clamped to ${resolution}`)
  }

  return {
    settings: {
      // Every world saved before the Noise tab existed was built from the layer
      // stack, so a document with no source is one — defaulting it to the Noise tab
      // would load a different terrain under the old name.
      source: raw.source === 'lab' ? 'lab' : 'stack',
      lab: parseLab(raw.lab),
      mode: pick<GeometryMode>(raw.mode, MODES, d.mode),
      resolution,
      heightScale: num(raw.heightScale, 0, 4, d.heightScale),
      relief: num(raw.relief, 0, 1, d.relief),
      slice: num(raw.slice, 0, 1, d.slice),
      spin: num(raw.spin, 0, 180, d.spin),
      wireframe: bool(raw.wireframe, d.wireframe),
      tint: hex(raw.tint, d.tint),
      paletteName: pick<PaletteName>(raw.paletteName, PALETTE_NAMES, d.paletteName),
      bands: int(raw.bands, 0, 32, d.bands),
      fitRamp: bool(raw.fitRamp, d.fitRamp),
      presetName,
      erosionParams,
      density: num(raw.density, 0, 20, d.density),
      erosionSeed: int(raw.erosionSeed, 0, 1e6, d.erosionSeed),
      showCutFill: bool(raw.showCutFill, d.showCutFill),
      caThreshold: num(raw.caThreshold, 0, 1, d.caThreshold),
      survive: int(raw.survive, 0, 26, d.survive),
      // In cells, 0–40, as the slider is. This clamped to 1 until the Noise tab
      // work: a world saved at 16 cells of warp reloaded at 1.
      warpAmount: num(raw.warpAmount, 0, 40, d.warpAmount),
      warpFrequency: num(raw.warpFrequency, 0.5, 32, d.warpFrequency),
      warpSeed: int(raw.warpSeed, 0, 1e6, d.warpSeed),
      talus: num(raw.talus, 0, 1, d.talus),
      talusStrength: num(raw.talusStrength, 0, 1, d.talusStrength),
      thermalPasses: int(raw.thermalPasses, 0, 200, d.thermalPasses),
      octaves: int(raw.octaves, 1, 10, d.octaves),
      persistence: num(raw.persistence, 0, 1, d.persistence),
      layers,
      outputShapingName,
      outputParams: parseParams(raw.outputParams, getShapingOp(outputShapingName).params),
    },
    repairs,
  }
}

export const noiseSpec: ConfigSpec<NoiseSettings> = {
  topic: 'maps',
  schemaVersion: 1,
  defaults: defaultNoiseSettings,
  parse,
  summary: (s) => {
    if (s.source === 'lab') {
      const on = s.lab.layers.filter((l) => l.enabled)
      return `Noise · ${on.length === 1 ? on[0].noise : `${on.length} noise layers`} · ${s.lab.shaping === 'none' ? 'unshaped' : s.lab.shaping}`
    }
    const enabled = s.layers.filter((l) => l.enabled).length
    return `${enabled} layers · ${s.resolution}² · ${s.mode}`
  },
}
