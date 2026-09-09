const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Centre of the distribution. The per-layer spread does the tuning. */
export const DISTRIBUTION_MEAN = 0.5

/**
 * Deterministic PRNG (mulberry32) so a given seed always rebuilds the same
 * field. Math.random would resample on every React re-render, which makes a
 * slider drag look like static rather than a parameter change.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Box-Muller: two uniforms in, one standard normal out. The transform also
 * yields a second normal from the same pair, but discarding it keeps each cell
 * a function of its own draws rather than of the iteration order.
 */
function standardNormal(rand: () => number): number {
  let u = rand()
  while (u === 0) u = rand() // log(0) is -Infinity
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/**
 * One independent normal sample per cell, mapped into [0, 1].
 *
 * Out-of-range samples are clamped rather than rescaled, so raising the spread
 * piles mass onto pure black and pure white instead of quietly renormalising
 * the field. At spread 0.5 roughly a third of cells land on an end.
 */
export function createNoiseField(
  cellCount: number,
  seed: number,
  mean: number,
  spread: number,
): Float32Array {
  const rand = mulberry32(seed)
  const field = new Float32Array(cellCount)
  for (let i = 0; i < cellCount; i++) {
    field[i] = clamp01(mean + standardNormal(rand) * spread)
  }
  return field
}

export type ShapingName = 'none' | 'power' | 'gain' | 'smoothstep' | 'terrace' | 'threshold'

export type ShapingParam = {
  key: string
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
  /** Falls back to two decimal places. */
  format?: (value: number) => string
}

export type ShapingOp = {
  value: ShapingName
  label: string
  hint: string
  params: ShapingParam[]
  apply: (x: number, params: Record<string, number>) => number
}

export const SHAPING_OPS: ShapingOp[] = [
  {
    value: 'none',
    label: 'None',
    hint: 'Raw normal samples, clamped to [0, 1].',
    params: [],
    apply: (x) => x,
  },
  {
    value: 'power',
    label: 'Power',
    hint: 'x^k. Above 1 darkens, below 1 brightens.',
    params: [
      { key: 'exponent', label: 'Exponent', min: 0.1, max: 5, step: 0.05, defaultValue: 1 },
    ],
    apply: (x, p) => Math.pow(x, p.exponent),
  },
  {
    value: 'gain',
    label: 'Gain',
    hint: 'S-curve about 0.5. Above 1 adds contrast, below 1 flattens.',
    params: [{ key: 'k', label: 'Strength', min: 0.2, max: 5, step: 0.05, defaultValue: 1 }],
    apply: (x, p) =>
      x < 0.5 ? 0.5 * Math.pow(2 * x, p.k) : 1 - 0.5 * Math.pow(2 * (1 - x), p.k),
  },
  {
    value: 'smoothstep',
    label: 'Smoothstep',
    hint: 'Hermite ramp between the two edges; flat outside them.',
    params: [
      { key: 'edge0', label: 'Edge 0', min: 0, max: 1, step: 0.01, defaultValue: 0.35 },
      { key: 'edge1', label: 'Edge 1', min: 0, max: 1, step: 0.01, defaultValue: 0.65 },
    ],
    apply: (x, p) => {
      // A zero or inverted span would divide by zero or flip the ramp, so it
      // degrades to a hard step at the lower edge instead.
      const span = p.edge1 - p.edge0
      if (span <= 0) return x < p.edge0 ? 0 : 1
      const t = clamp01((x - p.edge0) / span)
      return t * t * (3 - 2 * t)
    },
  },
  {
    value: 'terrace',
    label: 'Terrace',
    hint: 'Quantises into bands - contour steps rather than a gradient.',
    params: [
      {
        key: 'steps',
        label: 'Steps',
        min: 2,
        max: 16,
        step: 1,
        defaultValue: 5,
        format: (v) => String(Math.round(v)),
      },
    ],
    apply: (x, p) => {
      const steps = Math.max(2, Math.round(p.steps))
      // floor(x * steps) reaches `steps` exactly at x = 1, which would exceed
      // the range once divided, so the top band is folded back in.
      return Math.min(Math.floor(x * steps), steps - 1) / (steps - 1)
    },
  },
  {
    value: 'threshold',
    label: 'Threshold',
    hint: 'Binary cut - everything at or above the cutoff becomes 1.',
    params: [{ key: 'cutoff', label: 'Cutoff', min: 0, max: 1, step: 0.01, defaultValue: 0.5 }],
    apply: (x, p) => (x >= p.cutoff ? 1 : 0),
  },
]

export function getShapingOp(name: ShapingName): ShapingOp {
  return SHAPING_OPS.find((op) => op.value === name) ?? SHAPING_OPS[0]
}

export function defaultParamsFor(op: ShapingOp): Record<string, number> {
  return Object.fromEntries(op.params.map((p) => [p.key, p.defaultValue]))
}

/**
 * Kept separate from sampling so dragging a shaping slider reshapes the
 * existing field rather than drawing a fresh set of normals.
 */
export function applyShaping(
  field: Float32Array,
  op: ShapingOp,
  params: Record<string, number>,
): Float32Array {
  if (op.value === 'none') return field
  const out = new Float32Array(field.length)
  for (let i = 0; i < field.length; i++) {
    out[i] = clamp01(op.apply(field[i], params))
  }
  return out
}

/* ---------------------------------------------------------------------------
 * Layers
 *
 * Blending independent white-noise fields at the same frequency is a dead end:
 * a sum of Gaussians is just another Gaussian, so the stack would look like a
 * single noisier layer. What makes a layer stack mean anything is each layer
 * carrying its own FREQUENCY - a coarse lattice interpolated up sits under a
 * fine one, which is the octave stacking that fractal noise is built from.
 * ------------------------------------------------------------------------- */

export type BlendName =
  | 'normal'
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'difference'
  | 'lighten'
  | 'darken'

export type BlendMode = {
  value: BlendName
  label: string
  /** Combines the running composite with the layer, before opacity is applied. */
  blend: (base: number, layer: number) => number
}

export const BLEND_MODES: BlendMode[] = [
  { value: 'normal', label: 'Normal', blend: (_base, layer) => layer },
  { value: 'add', label: 'Add', blend: (base, layer) => base + layer },
  { value: 'subtract', label: 'Subtract', blend: (base, layer) => base - layer },
  { value: 'multiply', label: 'Multiply', blend: (base, layer) => base * layer },
  { value: 'screen', label: 'Screen', blend: (base, layer) => 1 - (1 - base) * (1 - layer) },
  {
    value: 'overlay',
    label: 'Overlay',
    blend: (base, layer) =>
      base < 0.5 ? 2 * base * layer : 1 - 2 * (1 - base) * (1 - layer),
  },
  { value: 'difference', label: 'Difference', blend: (base, layer) => Math.abs(base - layer) },
  { value: 'lighten', label: 'Lighten', blend: (base, layer) => Math.max(base, layer) },
  { value: 'darken', label: 'Darken', blend: (base, layer) => Math.min(base, layer) },
]

export function getBlendMode(name: BlendName): BlendMode {
  return BLEND_MODES.find((mode) => mode.value === name) ?? BLEND_MODES[0]
}

export type NoiseLayer = {
  id: string
  name: string
  enabled: boolean
  /** Lattice cells per side for this layer, interpolated up to the display resolution. */
  frequency: number
  spread: number
  seed: number
  shapingName: ShapingName
  shapingParams: Record<string, number>
  blendName: BlendName
  opacity: number
}

/** Hermite fade, so interpolated lattices meet with a continuous slope. */
const fade = (t: number) => t * t * (3 - 2 * t)

/**
 * A lattice of `frequency` samples per side, interpolated up to `resolution`.
 *
 * Indices wrap, so the field tiles rather than flattening against its edges.
 * When frequency equals resolution every output lands exactly on a lattice
 * point, and the result is per-cell white noise again - the same field the
 * page produced before layers existed.
 */
function sampleLayer2D(resolution: number, layer: NoiseLayer): Float32Array {
  const f = Math.max(1, Math.min(Math.round(layer.frequency), resolution))
  const lattice = createNoiseField(f * f, layer.seed, DISTRIBUTION_MEAN, layer.spread)
  if (f === resolution) return lattice

  const out = new Float32Array(resolution * resolution)
  const scale = f / resolution

  for (let y = 0; y < resolution; y++) {
    const v = y * scale
    const vy = Math.floor(v)
    const ty = fade(v - vy)
    const y0 = vy % f
    const y1 = (vy + 1) % f

    for (let x = 0; x < resolution; x++) {
      const u = x * scale
      const ux = Math.floor(u)
      const tx = fade(u - ux)
      const x0 = ux % f
      const x1 = (ux + 1) % f

      const top = lattice[y0 * f + x0] + (lattice[y0 * f + x1] - lattice[y0 * f + x0]) * tx
      const bottom = lattice[y1 * f + x0] + (lattice[y1 * f + x1] - lattice[y1 * f + x0]) * tx
      out[y * resolution + x] = top + (bottom - top) * ty
    }
  }
  return out
}

function sampleLayer3D(resolution: number, layer: NoiseLayer): Float32Array {
  const f = Math.max(1, Math.min(Math.round(layer.frequency), resolution))
  const lattice = createNoiseField(f * f * f, layer.seed, DISTRIBUTION_MEAN, layer.spread)
  if (f === resolution) return lattice

  const out = new Float32Array(resolution * resolution * resolution)
  const scale = f / resolution
  const at = (x: number, y: number, z: number) => lattice[(z * f + y) * f + x]

  for (let z = 0; z < resolution; z++) {
    const w = z * scale
    const wz = Math.floor(w)
    const tz = fade(w - wz)
    const z0 = wz % f
    const z1 = (wz + 1) % f

    for (let y = 0; y < resolution; y++) {
      const v = y * scale
      const vy = Math.floor(v)
      const ty = fade(v - vy)
      const y0 = vy % f
      const y1 = (vy + 1) % f

      for (let x = 0; x < resolution; x++) {
        const u = x * scale
        const ux = Math.floor(u)
        const tx = fade(u - ux)
        const x0 = ux % f
        const x1 = (ux + 1) % f

        const n00 = at(x0, y0, z0) + (at(x1, y0, z0) - at(x0, y0, z0)) * tx
        const n10 = at(x0, y1, z0) + (at(x1, y1, z0) - at(x0, y1, z0)) * tx
        const n01 = at(x0, y0, z1) + (at(x1, y0, z1) - at(x0, y0, z1)) * tx
        const n11 = at(x0, y1, z1) + (at(x1, y1, z1) - at(x0, y1, z1)) * tx

        const near = n00 + (n10 - n00) * ty
        const far = n01 + (n11 - n01) * ty
        out[(z * resolution + y) * resolution + x] = near + (far - near) * tz
      }
    }
  }
  return out
}

/**
 * Composites the stack bottom-up, starting from 0.
 *
 * The bottom layer blends against 0 like any other rather than being special
 * cased, which keeps the model predictable - though it does mean a bottom
 * layer set to Multiply yields nothing, exactly as it would in an image editor.
 */
export type Octave = { frequency: number; opacity: number }

/**
 * Frequency and opacity for each octave of an fBm (fractal Brownian motion)
 * stack: frequency doubles, amplitude falls by `persistence` each step.
 *
 * The opacities look arbitrary — 1, 0.33, 0.14, 0.07 … — because Normal blend
 * is a LERP, not a sum. A layer's weight in the finished field is its own
 * opacity times ∏(1 − opacity) over every layer above it, so hitting halving
 * weights means inverting that chain from the top down. With the bottom layer
 * opaque the weights telescope to exactly 1, which is what keeps the
 * composite's mean at 0.5 instead of drifting toward black.
 *
 * Why bother: a surface looks like terrain when its structure function is
 * straight on a log-log plot — the same roughness at every scale. Two layers
 * four octaves apart leave a hole in the middle of that plot, and the eye reads
 * the hole as randomness.
 */
export function fbmOctaves(
  octaves: number,
  baseFrequency: number,
  persistence: number,
  maxFrequency: number,
): Octave[] {
  const count = Math.max(1, Math.round(octaves))
  const weights: number[] = []
  for (let i = 0; i < count; i++) weights.push(persistence ** i)
  const total = weights.reduce((a, b) => a + b, 0)

  const opacity = new Array<number>(count).fill(0)
  // Top down: everything above layer k has already claimed 1 - tail of the
  // result, so k's opacity is its share of what is left.
  let tail = 1
  for (let k = count - 1; k >= 1; k--) {
    opacity[k] = Math.min(1, weights[k] / total / tail)
    tail *= 1 - opacity[k]
  }
  opacity[0] = 1

  return opacity.map((value, i) => ({
    // Octaves past the grid collapse onto the finest lattice it can hold; past
    // that a layer is per-cell white noise and adds nothing but speckle.
    frequency: Math.min(maxFrequency, baseFrequency * 2 ** i),
    opacity: value,
  }))
}

export function compositeLayers(
  resolution: number,
  dimensions: 2 | 3,
  layers: NoiseLayer[],
): Float32Array {
  const count = dimensions === 2 ? resolution ** 2 : resolution ** 3
  const out = new Float32Array(count)

  for (const layer of layers) {
    if (!layer.enabled || layer.opacity === 0) continue

    const raw = dimensions === 2 ? sampleLayer2D(resolution, layer) : sampleLayer3D(resolution, layer)
    const shaped = applyShaping(raw, getShapingOp(layer.shapingName), layer.shapingParams)
    const { blend } = getBlendMode(layer.blendName)

    for (let i = 0; i < count; i++) {
      const base = out[i]
      out[i] = clamp01(base + (blend(base, shaped[i]) - base) * layer.opacity)
    }
  }
  return out
}
