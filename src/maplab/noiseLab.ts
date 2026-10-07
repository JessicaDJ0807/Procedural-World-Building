import { mulberry32 } from '../noise'

/**
 * Topic 2's Lab: noise → modify noise → use it as a map.
 *
 * The workbench next to it builds every field from one kind of noise — a
 * lattice of random *values*, interpolated — and spends its controls on what
 * happens afterwards. The Lab is the other half of the lecture: three noise
 * functions that are genuinely different, and the handful of operations that
 * turn any of them into terrain. Everything here is a pure function of
 * `LabSettings`, so a preset is just a settings object and the pseudocode on
 * screen can be generated from the same values the field was.
 */

export type NoiseType = 'white' | 'perlin' | 'cellular'
export type CellularMode = 'distance' | 'edges'
export type LabShaping = 'none' | 'ridged' | 'billow' | 'terrace' | 'power'

export type LabSettings = {
  noise: NoiseType
  cellular: CellularMode
  seed: number
  /** Base-octave features across the tile. */
  frequency: number
  /** Height of the terrain tile, in world units, for a value of 1. */
  amplitude: number
  octaves: number
  persistence: number
  lacunarity: number
  shaping: LabShaping
  ridgeSharpness: number
  terraceSteps: number
  powerExponent: number
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

/** Fixed rather than a control: the Lab is about what the noise does, and 128² is where the workbench's measurements were made. */
export const LAB_RESOLUTION = 128

/** Top of the amplitude slider. */
export const LAB_MAX_AMPLITUDE = 1.5

export const DEFAULT_LAB: LabSettings = {
  noise: 'perlin',
  cellular: 'distance',
  seed: 42,
  frequency: 3,
  amplitude: 0.5,
  octaves: 5,
  persistence: 0.5,
  lacunarity: 2,
  shaping: 'none',
  ridgeSharpness: 2,
  terraceSteps: 6,
  powerExponent: 2,
  warp: false,
  warpStrength: 0.2,
  warpScale: 2,
  island: false,
  islandFalloff: 1,
  seaLevel: 0,
}

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
  /** The fBm's own range before it was stretched — what averaging octaves did to it. */
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

export function generateLab(s: LabSettings, resolution = LAB_RESOLUTION): LabField {
  const start = performance.now()
  const r = resolution
  const raw = new Float32Array(r * r)
  const perm = permutation(s.seed)
  // The offset field gets its own table: built from the terrain's, the warp
  // would push features along their own gradients and read as a smear.
  const warpPerm = permutation(s.seed + 1013)
  const octaves = s.noise === 'white' ? 1 : Math.max(1, Math.round(s.octaves))
  const fold = s.shaping === 'ridged' || s.shaping === 'billow' ? s.shaping : null

  const base = (x: number, y: number, octave: number): number => {
    if (s.noise === 'perlin') return perlin(perm, x, y)
    if (s.noise === 'cellular') return cellular(x, y, s.seed + octave * 131, s.cellular)
    // White noise has no frequency: one independent value per sample, at
    // whatever coordinates the sample is read from.
    return hash2(Math.floor(x * r), Math.floor(y * r), s.seed)
  }

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

      const scale = s.noise === 'white' ? 1 : s.frequency
      let sum = 0
      let amp = 1
      let freq = 1
      let norm = 0
      for (let o = 0; o < octaves; o++) {
        // Each octave is shifted so they do not share a lattice origin — at
        // (0, 0) every octave of gradient noise is exactly 0.5 together.
        let n = base(u * scale * freq + o * 31.7, v * scale * freq + o * 17.3, o)
        // Folded per octave, not after the sum. Folding the sum creases the
        // terrain along one contour only; folding each octave creases it at
        // every scale, which is what reads as a mountain range.
        if (fold === 'ridged') n = Math.pow(1 - Math.abs(n * 2 - 1), s.ridgeSharpness)
        else if (fold === 'billow') n = Math.abs(n * 2 - 1)
        sum += n * amp
        norm += amp
        amp *= s.persistence
        freq *= s.lacunarity
      }
      const value = sum / norm
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
      // 0.70 on average, five span 0.52 — and without this the shaping controls
      // would act on a different field every time the octave count moved.
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
    rawMin,
    rawMax,
    land: s.seaLevel > 0 ? land / (r * r) : 1,
    ms: performance.now() - start,
  }
}

/* ---------------------------------------------------------------------------
 * The pseudocode
 * ------------------------------------------------------------------------- */

export type PipelineLine = {
  /** Which control this line belongs to, so the panel can say where to change it. */
  stage: 'warp' | 'noise' | 'fold' | 'normalize' | 'island' | 'shape' | 'height' | 'water'
  code: string
  comment?: string
  active: boolean
}

const f = (n: number, digits = 2) => {
  const text = n.toFixed(digits)
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

/**
 * The current settings, written out as the program they amount to.
 *
 * Every stage is listed whether it is on or not, in the order it runs, so
 * turning one on is seen to slot into a fixed pipeline rather than replace
 * what was there — procedural terrain as composition.
 */
export function describePipeline(s: LabSettings, field: LabField): PipelineLine[] {
  const fbm = s.noise !== 'white' && s.octaves > 1
  const [x, z] = s.warp ? ['x2', 'z2'] : ['x', 'z']
  const k = fbm ? `${f(s.frequency)} * freq` : f(s.frequency)
  const noiseCall =
    s.noise === 'white'
      ? `white(${x}, ${z})`
      : `${s.noise === 'perlin' ? 'perlin' : s.cellular === 'distance' ? 'cellF1' : 'cellF2_F1'}(${x} * ${k}, ${z} * ${k})`

  const lines: PipelineLine[] = [
    {
      stage: 'warp',
      code: `x2 = x + snoise(x * ${f(s.warpScale)}, z * ${f(s.warpScale)}) * ${f(s.warpStrength)}`,
      comment: 'snoise is in [-1, 1]',
      active: s.warp,
    },
    {
      stage: 'warp',
      code: `z2 = z + snoise(x * ${f(s.warpScale)} + 100, z * ${f(s.warpScale)} + 100) * ${f(s.warpStrength)}`,
      active: s.warp,
    },
  ]

  if (fbm) {
    lines.push({
      stage: 'noise',
      code: `for each octave o < ${Math.round(s.octaves)}:`,
      comment: `freq *= ${f(s.lacunarity)}, amp *= ${f(s.persistence)}`,
      active: true,
    })
    lines.push({ stage: 'noise', code: `  n = ${noiseCall}`, active: true })
  } else {
    lines.push({ stage: 'noise', code: `n = ${noiseCall}`, comment: 'in [0, 1]', active: true })
  }
  const pad = fbm ? '  ' : ''
  lines.push(
    s.shaping === 'billow'
      ? { stage: 'fold', code: `${pad}n = abs(n * 2 - 1)`, comment: 'billow', active: true }
      : {
          stage: 'fold',
          code: `${pad}n = pow(1 - abs(n * 2 - 1), ${f(s.ridgeSharpness)})`,
          comment: 'ridged',
          active: s.shaping === 'ridged',
        },
  )
  if (fbm) {
    lines.push({ stage: 'noise', code: '  value += n * amp', active: true })
    lines.push({ stage: 'noise', code: 'value /= sum of amps', active: true })
  } else {
    lines.push({ stage: 'noise', code: 'value = n', active: true })
  }

  lines.push(
    {
      stage: 'normalize',
      code: 'value = (value - min) / (max - min)',
      comment: `measured ${f(field.rawMin, 3)}–${f(field.rawMax, 3)}`,
      active: true,
    },
    {
      stage: 'island',
      code: `value *= max(0, 1 - ${f(s.islandFalloff)} * d * d)`,
      comment: 'd = distance from centre',
      active: s.island,
    },
    s.shaping === 'power'
      ? { stage: 'shape', code: `value = pow(value, ${f(s.powerExponent)})`, active: true }
      : {
          stage: 'shape',
          code: `value = min(floor(value * ${Math.round(s.terraceSteps)}), ${Math.round(s.terraceSteps) - 1}) / ${Math.round(s.terraceSteps) - 1}`,
          comment: 'terrace',
          active: s.shaping === 'terrace',
        },
    { stage: 'height', code: `height = value * ${f(s.amplitude)}`, active: true },
    {
      stage: 'water',
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

export type LabPreset = {
  id: string
  label: string
  /** The recipe, in a line — the point is that each is a composition. */
  recipe: string
  /** Everything but the seed, which a preset keeps so the comparison is on the same ground. */
  settings: Omit<LabSettings, 'seed'>
}

const preset = (patch: Partial<LabSettings>): Omit<LabSettings, 'seed'> => {
  const { seed, ...rest } = { ...DEFAULT_LAB, ...patch }
  void seed
  return rest
}

export const LAB_PRESETS: LabPreset[] = [
  {
    id: 'baseline',
    label: 'Baseline',
    recipe: 'Plain fBm: five octaves of Perlin, nothing else',
    settings: preset({}),
  },
  {
    id: 'hills',
    label: 'Rolling Hills',
    recipe: 'Low-frequency Perlin, few quiet octaves',
    settings: preset({ frequency: 2, octaves: 3, persistence: 0.35, amplitude: 0.5 }),
  },
  {
    id: 'mountains',
    label: 'Mountains',
    recipe: 'Fractal Perlin, ridged in every octave',
    settings: preset({ frequency: 2.5, octaves: 6, persistence: 0.5, shaping: 'ridged', ridgeSharpness: 2, amplitude: 0.75 }),
  },
  {
    id: 'terraces',
    label: 'Terraces',
    recipe: 'Perlin, quantised into steps',
    settings: preset({ frequency: 2, octaves: 4, persistence: 0.45, shaping: 'terrace', terraceSteps: 7, amplitude: 0.7 }),
  },
  {
    id: 'islands',
    label: 'Islands',
    recipe: 'Perlin × radial falloff, with a sea',
    settings: preset({ frequency: 3, octaves: 5, island: true, islandFalloff: 1, seaLevel: 0.32, amplitude: 0.6 }),
  },
  {
    id: 'rocky',
    label: 'Rocky',
    recipe: 'High-frequency fractal Perlin, loud octaves',
    settings: preset({ frequency: 6, octaves: 7, persistence: 0.62, lacunarity: 2.2, amplitude: 0.45 }),
  },
  {
    id: 'organic',
    label: 'Organic',
    recipe: 'Perlin read through a domain warp',
    settings: preset({ frequency: 2.5, octaves: 5, warp: true, warpStrength: 0.25, warpScale: 2, amplitude: 0.7 }),
  },
  {
    id: 'cells',
    label: 'Cells',
    recipe: 'Cellular F2 − F1: domes split by cracks',
    settings: preset({ noise: 'cellular', cellular: 'edges', frequency: 5, octaves: 2, persistence: 0.35, amplitude: 0.45 }),
  },
]

/** Which preset the settings still match, if any — nudging a slider makes it Custom. */
export function matchPreset(s: LabSettings): string | null {
  const { seed, ...rest } = s
  void seed
  const key = JSON.stringify(rest, Object.keys(rest).sort())
  const hit = LAB_PRESETS.find(
    (p) => JSON.stringify(p.settings, Object.keys(p.settings).sort()) === key,
  )
  return hit?.id ?? null
}
