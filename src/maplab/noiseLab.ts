import { mulberry32 } from '../noise'

/**
 * Topic 2's Noise tab: noise → modify noise → use it as a map.
 *
 * Topic 2's original generator builds every field from one kind of noise — a
 * lattice of random *values*, interpolated — and spends its controls on what
 * happens afterwards. The Noise tab is the other half of the lecture: three noise
 * functions that are genuinely different, stacked in layers, and the handful
 * of operations that turn the stack into terrain. Everything here is a pure
 * function of `LabSettings`, so a preset is just a settings object and the
 * pseudocode on screen can be generated from the same values the field was.
 */

export type NoiseType = 'white' | 'perlin' | 'cellular'
export type CellularMode = 'distance' | 'edges'
/** Applied to every octave of one layer, before it is summed. */
export type LabFold = 'none' | 'ridged' | 'billow'
/** How a layer combines with everything beneath it. */
export type LabBlend = 'add' | 'subtract' | 'multiply' | 'max'
/** Applied once, to the finished stack. */
export type LabShaping = 'none' | 'terrace' | 'power'

export type LabLayer = {
  /** A React key. Kept in storage only because stripping it buys nothing. */
  id: string
  enabled: boolean
  noise: NoiseType
  cellular: CellularMode
  /** Base-octave features across the tile. */
  frequency: number
  octaves: number
  persistence: number
  lacunarity: number
  fold: LabFold
  ridgeSharpness: number
  /** Ignored on the bottom layer, which is what the others blend onto. */
  blend: LabBlend
  weight: number
  /**
   * Offsets this layer's randomness from the field seed. Stored per layer
   * rather than taken from its position, so deleting or reordering one layer
   * does not redraw every layer above it.
   */
  seed: number
}

export type LabSettings = {
  seed: number
  /** Bottom first. */
  layers: LabLayer[]
  shaping: LabShaping
  terraceSteps: number
  powerExponent: number
  /** Height of the terrain tile, in world units, for a value of 1. */
  amplitude: number
  warp: boolean
  /** Maximum displacement as a fraction of the tile. */
  warpStrength: number
  /** Features across the tile in the offset field. */
  warpScale: number
  island: boolean
  islandFalloff: number
  /** 0 is no water. */
  seaLevel: number
}

/**
 * Fixed rather than a control: the Noise tab is about what the noise does, and 128²
 * is where the layer stack's erosion measurements were made — which matters
 * now that Simulate erodes this field.
 */
export const LAB_RESOLUTION = 128

/** Top of the amplitude slider. */
export const LAB_MAX_AMPLITUDE = 1.5

/** Four is enough to build every preset with one to spare; past that the list outgrows the sidebar. */
export const MAX_LAB_LAYERS = 4

const newId = () => crypto.randomUUID()

const LAYER_DEFAULTS: Omit<LabLayer, 'id' | 'seed'> = {
  enabled: true,
  noise: 'perlin',
  cellular: 'distance',
  frequency: 3,
  octaves: 5,
  persistence: 0.5,
  lacunarity: 2,
  fold: 'none',
  ridgeSharpness: 2,
  blend: 'add',
  weight: 0.5,
}

export function createLabLayer(patch: Partial<LabLayer> = {}): LabLayer {
  return { ...LAYER_DEFAULTS, id: newId(), seed: 0, ...patch }
}

const SETTINGS_DEFAULTS: Omit<LabSettings, 'layers'> = {
  seed: 42,
  shaping: 'none',
  terraceSteps: 6,
  powerExponent: 2,
  amplitude: 0.5,
  warp: false,
  warpStrength: 0.2,
  warpScale: 2,
  island: false,
  islandFalloff: 1,
  seaLevel: 0,
}

export const DEFAULT_LAB: LabSettings = { ...SETTINGS_DEFAULTS, layers: [createLabLayer()] }

/* ---------------------------------------------------------------------------
 * The three noise functions. Each returns a value in [0, 1].
 * ------------------------------------------------------------------------- */

/**
 * An integer hash to [0, 1). Hashing the lattice coordinates rather than
 * walking a PRNG makes every sample a function of where it is, so a warped
 * lookup or a different resolution reads the same field instead of a new one.
 */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** A shuffled 0–255, doubled so `perm[perm[x] + y]` never needs a wrap. */
function permutation(seed: number): Uint8Array {
  const rand = mulberry32(seed)
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = p[i]
    p[i] = p[j]
    p[j] = t
  }
  const out = new Uint8Array(512)
  out.set(p)
  out.set(p, 256)
  return out
}

// Eight unit directions. Perlin's 2002 set is twelve 3D edge vectors; in 2D the
// eight compass directions are the usual reduction and keep the field isotropic.
const GX = new Float32Array(8)
const GY = new Float32Array(8)
for (let i = 0; i < 8; i++) {
  GX[i] = Math.cos((i * Math.PI) / 4)
  GY[i] = Math.sin((i * Math.PI) / 4)
}

/** Quintic fade (6t⁵ − 15t⁴ + 10t³): continuous second derivative, so no lattice creases under lighting. */
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/**
 * The theoretical peak of 2D gradient noise with unit gradients is √2 / 2 —
 * the dot product of a unit gradient with a half-diagonal offset. Dividing by
 * twice that maps the signed result onto [0, 1] without clipping.
 */
const PERLIN_PEAK = Math.SQRT1_2

/**
 * Gradient noise. The value at every lattice point is 0, and what is random is
 * the *slope* there — which is why it has no blocky cells: the extremes fall
 * between lattice points rather than on them.
 */
function perlin(perm: Uint8Array, x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const X = xi & 255
  const Y = yi & 255

  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const k = perm[perm[ix] + iy] & 7
    return GX[k] * dx + GY[k] * dy
  }
  const n00 = g(X, Y, xf, yf)
  const n10 = g(X + 1, Y, xf - 1, yf)
  const n01 = g(X, Y + 1, xf, yf - 1)
  const n11 = g(X + 1, Y + 1, xf - 1, yf - 1)

  const u = fade(xf)
  const v = fade(yf)
  const a = n00 + (n10 - n00) * u
  const b = n01 + (n11 - n01) * u
  return (a + (b - a) * v) / (2 * PERLIN_PEAK) + 0.5
}

/**
 * Worley noise: one jittered feature point per lattice cell, and the value is
 * a distance. F1, the distance to the nearest point, is 0 at every point and
 * rises toward the cell walls; F2 − F1 is 0 exactly on the walls, where the
 * nearest and second-nearest points are equally close, so it draws the cells'
 * outlines.
 */
function cellular(x: number, y: number, seed: number, mode: CellularMode): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  let f1 = Infinity
  let f2 = Infinity
  // 3×3 is enough: a point outside the neighbouring cells is always further
  // than the one in the sample's own cell.
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox
      const cy = yi + oy
      const px = cx + hash2(cx, cy, seed)
      const py = cy + hash2(cx, cy, seed + 7919)
      const d = Math.hypot(px - x, py - y)
      if (d < f1) {
        f2 = f1
        f1 = d
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  const value = mode === 'distance' ? f1 : f2 - f1
  return value > 1 ? 1 : value
}


/* ---------------------------------------------------------------------------
 * The pipeline
 * ------------------------------------------------------------------------- */

export type LabField = {
  /** `LAB_RESOLUTION²` values in [0, 1], row-major in z. */
  values: Float32Array
  /** The stack's own range before it was stretched — what averaging and blending did to it. */
  rawMin: number
  rawMax: number
  /** Share of samples above the sea level, or 1 with no water. */
  land: number
  ms: number
}

/** Distance from the centre, scaled so the middle of each edge is 1. */
const radial = (u: number, v: number) => Math.hypot(u - 0.5, v - 0.5) / 0.5

/** Kept identical to the line the pseudocode prints, so the two cannot disagree. */
export function terrace(value: number, steps: number): number {
  const n = Math.max(2, Math.round(steps))
  // floor(value * steps) / steps alone reaches 1 only at the single highest
  // sample, which then stands as a one-vertex spike on the top plateau.
  return Math.min(Math.floor(value * n), n - 1) / (n - 1)
}

/**
 * Layer seeds are spaced far apart so that two layers never share a table.
 * The bottom layer's offset is 0, which keeps a one-layer stack identical to
 * the Noise tab before it had layers — every measurement taken then still holds.
 */
const LAYER_SEED_STRIDE = 7919

/** Everything a layer needs per sample, built once per field rather than once per pixel. */
type PreparedLayer = {
  layer: LabLayer
  perm: Uint8Array
  seed: number
  octaves: number
  scale: number
}

function prepare(s: LabSettings): PreparedLayer[] {
  return s.layers
    .filter((layer) => layer.enabled)
    .map((layer) => {
      const seed = s.seed + layer.seed * LAYER_SEED_STRIDE
      return {
        layer,
        perm: permutation(seed),
        seed,
        // White noise has no frequency and nothing to stack: an octave of it
        // would just be another independent value per sample.
        octaves: layer.noise === 'white' ? 1 : Math.max(1, Math.round(layer.octaves)),
        scale: layer.noise === 'white' ? 1 : layer.frequency,
      }
    })
}

/** One layer's fBm at (u, v), averaged back into [0, 1]. */
function sampleLayer(p: PreparedLayer, u: number, v: number, r: number): number {
  const { layer } = p
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let o = 0; o < p.octaves; o++) {
    // Each octave is shifted so they do not share a lattice origin — at (0, 0)
    // every octave of gradient noise is exactly 0.5 together.
    const x = u * p.scale * freq + o * 31.7
    const y = v * p.scale * freq + o * 17.3
    let n =
      layer.noise === 'perlin'
        ? perlin(p.perm, x, y)
        : layer.noise === 'cellular'
          ? cellular(x, y, p.seed + o * 131, layer.cellular)
          : hash2(Math.floor(x * r), Math.floor(y * r), p.seed)
    // Folded per octave, not after the sum. Folding the sum creases the
    // terrain along one contour only; folding each octave creases it at every
    // scale, which is what reads as a mountain range.
    if (layer.fold === 'ridged') n = Math.pow(1 - Math.abs(n * 2 - 1), layer.ridgeSharpness)
    else if (layer.fold === 'billow') n = Math.abs(n * 2 - 1)
    sum += n * amp
    norm += amp
    amp *= layer.persistence
    freq *= layer.lacunarity
  }
  return sum / norm
}

/**
 * The bottom layer is taken as it is; each layer above combines with the
 * running value. Multiply is written as a lerp toward the product so that
 * weight 0 leaves the value alone and weight 1 is a plain product — a mask.
 */
function combine(value: number, n: number, blend: LabBlend, w: number): number {
  switch (blend) {
    case 'add':
      return value + n * w
    case 'subtract':
      return value - n * w
    case 'multiply':
      return value * (1 - w + w * n)
    case 'max':
      return Math.max(value, n * w)
  }
}

export function generateLab(s: LabSettings, resolution = LAB_RESOLUTION): LabField {
  const start = performance.now()
  const r = resolution
  const raw = new Float32Array(r * r)
  const layers = prepare(s)
  // The offset field gets its own table: built from a layer's, the warp would
  // push features along their own gradients and read as a smear.
  const warpPerm = permutation(s.seed + 1013)

  let rawMin = Infinity
  let rawMax = -Infinity
  for (let z = 0; z < r; z++) {
    for (let x = 0; x < r; x++) {
      let u = x / (r - 1)
      let v = z / (r - 1)
      if (s.warp) {
        const wu = u * s.warpScale
        const wv = v * s.warpScale
        // The +100 is the usual trick for a second, independent field out of
        // one function: far enough along that the two share no lattice cells.
        u += (perlin(warpPerm, wu, wv) * 2 - 1) * s.warpStrength
        v += (perlin(warpPerm, wu + 100, wv + 100) * 2 - 1) * s.warpStrength
      }

      let value = 0
      for (let i = 0; i < layers.length; i++) {
        const n = sampleLayer(layers[i], u, v, r)
        value = i === 0 ? n : combine(value, n, layers[i].layer.blend, layers[i].layer.weight)
      }
      raw[z * r + x] = value
      if (value < rawMin) rawMin = value
      if (value > rawMax) rawMax = value
    }
  }

  const span = rawMax - rawMin
  const values = new Float32Array(r * r)
  let land = 0
  for (let z = 0; z < r; z++) {
    for (let x = 0; x < r; x++) {
      const i = z * r + x
      // Stretched to [0, 1] before anything that cares about absolute value,
      // so a power curve or a terrace means the same thing at one octave as at
      // eight. Averaging octaves narrows the range — one octave of Perlin spans
      // 0.70 on average, five span 0.52 — and blending layers moves it about
      // again; without this the shaping controls would act on a different
      // field every time either changed.
      let value = span > 0 ? (raw[i] - rawMin) / span : 0
      if (s.island) {
        const d = radial(x / (r - 1), z / (r - 1))
        value *= Math.max(0, 1 - s.islandFalloff * d * d)
      }
      if (s.shaping === 'power') value = Math.pow(value, s.powerExponent)
      else if (s.shaping === 'terrace') value = terrace(value, s.terraceSteps)
      values[i] = value
      if (value > s.seaLevel) land++
    }
  }

  return {
    values,
    rawMin: Number.isFinite(rawMin) ? rawMin : 0,
    rawMax: Number.isFinite(rawMax) ? rawMax : 0,
    land: s.seaLevel > 0 ? land / (r * r) : 1,
    ms: performance.now() - start,
  }
}

/* ---------------------------------------------------------------------------
 * The pseudocode
 * ------------------------------------------------------------------------- */

export type PipelineLine = {
  code: string
  comment?: string
  active: boolean
}

const f = (n: number, digits = 2) => {
  const text = n.toFixed(digits)
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

export const NOISE_LABEL: Record<NoiseType, string> = { white: 'white', perlin: 'perlin', cellular: 'cellular' }

function noiseName(layer: LabLayer): string {
  if (layer.noise !== 'cellular') return layer.noise
  return layer.cellular === 'distance' ? 'cellF1' : 'cellF2_F1'
}

/**
 * The current settings, written out as the program they amount to.
 *
 * Every global stage is listed whether it is on or not, in the order it runs,
 * so turning one on is seen to slot into a fixed pipeline rather than replace
 * what was there — procedural terrain as composition. Layers are listed as
 * they are, since a disabled layer is simply not part of the program.
 */
export function describePipeline(s: LabSettings, field: LabField): PipelineLine[] {
  const [x, z] = s.warp ? ['x2', 'z2'] : ['x', 'z']
  const enabled = s.layers.filter((l) => l.enabled)
  const lines: PipelineLine[] = [
    { code: 'fbm(noise, p, octaves, persistence, lacunarity):', active: true },
    { code: '  for each octave o: sum += noise(p * lacunarity^o) * persistence^o', active: true },
    { code: '  return sum / (sum of persistence^o)', comment: 'an average, so still in [0, 1]', active: true },
    { code: '', active: true },
    {
      code: `x2 = x + snoise(x * ${f(s.warpScale)}, z * ${f(s.warpScale)}) * ${f(s.warpStrength)}`,
      comment: 'domain warp; snoise is in [-1, 1]',
      active: s.warp,
    },
    {
      code: `z2 = z + snoise(x * ${f(s.warpScale)} + 100, z * ${f(s.warpScale)} + 100) * ${f(s.warpStrength)}`,
      active: s.warp,
    },
  ]

  enabled.forEach((layer, i) => {
    const name = `L${i + 1}`
    const p = `(${x}, ${z}) * ${f(layer.frequency)}`
    if (layer.noise === 'white') {
      lines.push({ code: `${name} = white(${x}, ${z})`, comment: 'one independent value per sample', active: true })
    } else {
      lines.push({
        code: `${name} = fbm(${noiseName(layer)}, ${p}, ${Math.round(layer.octaves)}, ${f(layer.persistence)}, ${f(layer.lacunarity)})`,
        active: true,
      })
    }
    if (layer.fold === 'ridged') {
      lines.push({ code: `     each octave n → pow(1 - abs(n * 2 - 1), ${f(layer.ridgeSharpness)})`, comment: 'ridged', active: true })
    } else if (layer.fold === 'billow') {
      lines.push({ code: '     each octave n → abs(n * 2 - 1)', comment: 'billow', active: true })
    }
  })

  enabled.forEach((layer, i) => {
    const name = `L${i + 1}`
    const w = f(layer.weight)
    if (i === 0) lines.push({ code: `value = ${name}`, active: true })
    else if (layer.blend === 'add') lines.push({ code: `value += ${name} * ${w}`, comment: 'add', active: true })
    else if (layer.blend === 'subtract') lines.push({ code: `value -= ${name} * ${w}`, comment: 'subtract', active: true })
    else if (layer.blend === 'multiply')
      lines.push({ code: `value *= 1 - ${w} + ${w} * ${name}`, comment: 'multiply — a mask', active: true })
    else lines.push({ code: `value = max(value, ${name} * ${w})`, comment: 'max', active: true })
  })
  if (enabled.length === 0) lines.push({ code: 'value = 0', comment: 'every layer is off', active: true })

  const steps = Math.round(s.terraceSteps)
  lines.push(
    {
      code: 'value = (value - min) / (max - min)',
      comment: `measured ${f(field.rawMin, 3)}–${f(field.rawMax, 3)}`,
      active: true,
    },
    {
      code: `value *= max(0, 1 - ${f(s.islandFalloff)} * d * d)`,
      comment: 'island; d = distance from centre',
      active: s.island,
    },
    s.shaping === 'power'
      ? { code: `value = pow(value, ${f(s.powerExponent)})`, comment: 'power', active: true }
      : {
          code: `value = min(floor(value * ${steps}), ${steps - 1}) / ${steps - 1}`,
          comment: 'terrace',
          active: s.shaping === 'terrace',
        },
    { code: `height = value * ${f(s.amplitude)}`, active: true },
    {
      code: `water where value < ${f(s.seaLevel)}`,
      comment: s.seaLevel > 0 ? `${Math.round(field.land * 100)}% land` : undefined,
      active: s.seaLevel > 0,
    },
  )
  return lines
}

/* ---------------------------------------------------------------------------
 * Presets
 * ------------------------------------------------------------------------- */

type PresetLayer = Partial<Omit<LabLayer, 'id'>>

export type LabPreset = {
  id: string
  label: string
  /** The recipe, in a line — the point is that each is a composition. */
  recipe: string
  /** Everything but the seed, which a preset keeps so the comparison is on the same ground. */
  settings: Omit<LabSettings, 'seed' | 'layers'>
  layers: PresetLayer[]
}

const preset = (
  id: string,
  label: string,
  recipe: string,
  layers: PresetLayer[],
  patch: Partial<Omit<LabSettings, 'seed' | 'layers'>> = {},
): LabPreset => {
  const { seed, ...rest } = SETTINGS_DEFAULTS
  void seed
  // Seeds follow position unless a layer names its own, so a preset's layers
  // never share randomness by accident.
  return { id, label, recipe, settings: { ...rest, ...patch }, layers: layers.map((l, i) => ({ seed: i, ...l })) }
}

export const LAB_PRESETS: LabPreset[] = [
  preset('baseline', 'Baseline', 'Plain fBm: five octaves of Perlin, nothing else', [{}]),
  preset('hills', 'Rolling Hills', 'Low-frequency Perlin, few quiet octaves', [
    { frequency: 2, octaves: 3, persistence: 0.35 },
  ]),
  preset(
    'mountains',
    'Mountains',
    'Broad Perlin, masking a ridged range',
    [
      { frequency: 1.5, octaves: 3, persistence: 0.45 },
      { frequency: 3, octaves: 6, fold: 'ridged', blend: 'multiply', weight: 0.85 },
    ],
    { amplitude: 0.8 },
  ),
  preset('terraces', 'Terraces', 'Perlin, quantised into steps', [{ frequency: 2, octaves: 4, persistence: 0.45 }], {
    shaping: 'terrace',
    terraceSteps: 7,
    amplitude: 0.7,
  }),
  preset('islands', 'Islands', 'Perlin × radial falloff, with a sea', [{}], {
    island: true,
    seaLevel: 0.32,
    amplitude: 0.6,
  }),
  preset(
    'rocky',
    'Rocky',
    'Gentle hills plus a loud high-frequency layer',
    [
      { frequency: 2, octaves: 3, persistence: 0.4 },
      { frequency: 9, octaves: 4, persistence: 0.6, blend: 'add', weight: 0.3 },
    ],
    { amplitude: 0.55 },
  ),
  preset('organic', 'Organic', 'Perlin read through a domain warp', [{ frequency: 2.5 }], {
    warp: true,
    warpStrength: 0.25,
    amplitude: 0.7,
  }),
  preset(
    'cells',
    'Cells',
    'Cellular F2 − F1: domes split by cracks',
    [{ noise: 'cellular', cellular: 'edges', frequency: 5, octaves: 2, persistence: 0.35 }],
    { amplitude: 0.45 },
  ),
]

/** A preset as live settings, on the given seed, with fresh layer ids. */
export function applyPreset(p: LabPreset, seed: number): LabSettings {
  return { ...p.settings, seed, layers: p.layers.map((l) => createLabLayer(l)) }
}

/** Everything but the field seed and the layer ids, which presets keep and mint. */
const comparable = (s: LabSettings) =>
  JSON.stringify({
    ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'layers' && k !== 'seed').sort()),
    layers: s.layers.map(({ id, ...rest }) => {
      void id
      return Object.fromEntries(Object.entries(rest).sort())
    }),
  })

/** Which preset the settings still match, if any — nudging a slider makes it Custom. */
export function matchPreset(s: LabSettings): string | null {
  const key = comparable(s)
  return LAB_PRESETS.find((p) => comparable(applyPreset(p, 0)) === key)?.id ?? null
}
