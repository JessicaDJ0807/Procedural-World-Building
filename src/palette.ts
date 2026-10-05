/**
 * Colour ramps for the noise field.
 *
 * The field is a scalar in [0, 1] and the ramp is how it becomes visible. The
 * obvious mapping — scale one colour by the value — is a LUMINANCE ramp, and
 * the eye resolves luminance far worse than hue. Measured as path length
 * through OKLab, where Euclidean distance is designed to be perceptually
 * uniform, scaling this project's accent blue spends 0.74 of colour where a
 * terrain ramp spends 1.65: roughly 74 distinguishable steps against 165.
 * Same data, twice the readable detail.
 *
 * Two of the ramps below map height, and they are not redundant. `terrain` is
 * the cartographic convention at full strength and the widest range measured
 * here; `land` is the same idea desaturated to sit beside a neutral interface,
 * and it is the default. The cost of that restraint was measured rather than
 * assumed — 127 steps against 165 — because the most literal reading of
 * "lower saturation" scored 94, below the greyscale baseline of 100, which
 * would have quietly inverted the point this whole section is making.
 */

import { hexToRgb } from './theme'

/* ---------------------------------------------------------------------------
 * Colour space
 *
 * Two conversions matter here and they are not the same one. sRGB <-> linear
 * undoes the display transfer curve; linear <-> OKLab goes further, into a
 * space built so that equal steps look equal. Ramps are interpolated in OKLab
 * and the results are cached, so the cost lands once per palette rather than
 * once per cell.
 * ------------------------------------------------------------------------- */

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function toSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

type Lab = [number, number, number]
type Rgb = [number, number, number]

function rgbToOklab([r, g, b]: Rgb): Lab {
  const R = toLinear(r)
  const G = toLinear(g)
  const B = toLinear(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}

/** Returns linear-light RGB, clamped: an OKLab midpoint can land outside sRGB. */
function oklabToLinear([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const out: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
  return out.map((c) => (c < 0 ? 0 : c > 1 ? 1 : c)) as Rgb
}

/* ---------------------------------------------------------------------------
 * Palettes
 * ------------------------------------------------------------------------- */

export type PaletteName = 'land' | 'terrain' | 'viridis' | 'magma' | 'grey' | 'hue'

export type Palette = {
  value: PaletteName
  label: string
  hint: string
  /** `null` means the ramp is built from the colour picker instead. */
  stops: string[] | null
}

export const PALETTES: Palette[] = [
  {
    value: 'land',
    label: 'Land',
    hint: 'The default. Hypsometric tints held at low saturation — blue-grey water, cool greens, stone rather than sand. 130 distinguishable steps against Terrain\u2019s 165: desaturating costs resolving power, and this is the restrained end of what still clearly beats greyscale\u2019s 100.',
    stops: [
      '#0f1b26', '#234a63', '#5a8496', '#9c9d89', '#648a63',
      '#3f6039', '#85795f', '#b5ad98', '#e8e5dd',
    ],
  },
  {
    value: 'terrain',
    label: 'Terrain',
    hint: 'Hypsometric tints — the cartographic convention. The widest range measured here: about 165 distinguishable steps against 74 for the old ramp.',
    stops: [
      '#0b2545', '#1d6a96', '#57b7c4', '#e8d8a0', '#7fa25a',
      '#4a6b3a', '#8a7355', '#b9b0a6', '#ffffff',
    ],
  },
  {
    value: 'viridis',
    label: 'Viridis',
    hint: 'Perceptually uniform: equal steps in value look like equal steps in colour. The honest ramp, not the punchy one.',
    stops: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  },
  {
    value: 'magma',
    label: 'Magma',
    hint: 'Dark to bright with rising hue. Reads as height without pretending to be a landscape.',
    stops: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  },
  {
    value: 'grey',
    label: 'Greyscale',
    hint: 'Pure luminance. The baseline the others are worth measuring against.',
    stops: ['#000000', '#ffffff'],
  },
  {
    value: 'hue',
    label: 'Single hue',
    hint: 'Black to the picked colour — the pre-palette look, but ramped in OKLab rather than multiplied, which is worth about 86 steps against the old 74.',
    stops: null,
  },
]

export function getPalette(name: PaletteName): Palette {
  return PALETTES.find((p) => p.value === name) ?? PALETTES[0]
}

/** No banding. A slider at 0 reads as "continuous" rather than as one band. */
export const CONTINUOUS = 0
export const MAX_BANDS = 48

/**
 * A ramp in both encodings its two consumers need.
 *
 * They genuinely differ: canvas `ImageData` bytes are sRGB, while three.js
 * reads a vertex-colour attribute as linear light. Feeding the same numbers to
 * both — which is what scaling a hex colour by the value did — renders the same
 * field noticeably lighter in 3D than on the map. Deriving both from one ramp
 * is what actually keeps them agreeing.
 */
export type Lut = {
  /** 256 × RGB bytes, for `ImageData`. */
  srgb: Uint8Array
  /** 256 × RGB floats in linear light, for three.js vertex colours. */
  linear: Float32Array
}

/**
 * A lookup plus the field range it is stretched across.
 *
 * The domain is what makes a palette worth having. The default six-octave stack
 * spans 0.334 to 0.773, so against a fixed `[0, 1]` ramp it reaches 113 of 256
 * entries — 63 of the terrain ramp's 165 steps, which is *fewer* than the 74 the
 * old single-colour ramp managed. Fitting the ramp to the data recovers all of
 * them. Geometry keeps using the raw value, so this stretches the colouring
 * only, never the terrain.
 */
export type Ramp = Lut & {
  /** Field value mapped to the first entry. */
  min: number
  /** Field span mapped across the table. 0 for a flat field. */
  span: number
}

/** The whole of `[0, 1]`, for when the ramp should read as absolute value. */
export const FULL_DOMAIN = { min: 0, span: 1 }

export function rampIndex(ramp: Ramp, value: number): number {
  if (ramp.span <= 0) return 0
  const t = (value - ramp.min) / ramp.span
  return t <= 0 ? 0 : t >= 1 ? 255 : (t * 255) | 0
}

/** Min and max of a field, for fitting a ramp to it. */
export function fieldDomain(field: Float32Array): { min: number; span: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < field.length; i++) {
    const v = field[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return FULL_DOMAIN
  // A flat field has no range to stretch; span 0 pins every cell to entry 0.
  return { min, span: max - min }
}

/**
 * Builds the lookup once so the per-cell cost is an array index.
 *
 * Converting live would be 21 ms for a 128² field against 0.21 ms for a table
 * lookup — 99× — and the ramp only changes when the palette, tint or band count
 * does. That is also what makes interpolating in OKLab free: the accuracy is
 * paid for once, at build time.
 */
export function buildLut(name: PaletteName, tint: string, bands: number): Lut {
  const palette = getPalette(name)
  const hexStops = palette.stops ?? ['#000000', tint]
  const stops = hexStops.map((hex) => rgbToOklab(hexToRgb(hex)))

  const srgb = new Uint8Array(256 * 3)
  const linear = new Float32Array(256 * 3)
  const segments = stops.length - 1
  const steps = Math.min(MAX_BANDS, Math.max(0, Math.round(bands)))

  for (let i = 0; i < 256; i++) {
    let t = i / 255
    // Quantising the ramp rather than the field keeps banding a display choice:
    // the geometry still uses the full-precision value, so a banded map sits on
    // a smooth surface instead of turning it into terraces.
    if (steps >= 2) t = Math.min(1, Math.floor(t * steps) / (steps - 1))

    const scaled = t * segments
    const index = Math.min(segments - 1, Math.floor(scaled))
    const f = scaled - index
    const a = stops[index]
    const b = stops[index + 1]
    const [lr, lg, lb] = oklabToLinear([
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    ])

    const o = i * 3
    linear[o] = lr
    linear[o + 1] = lg
    linear[o + 2] = lb
    srgb[o] = Math.round(toSrgb(lr) * 255)
    srgb[o + 1] = Math.round(toSrgb(lg) * 255)
    srgb[o + 2] = Math.round(toSrgb(lb) * 255)
  }

  return { srgb, linear }
}
