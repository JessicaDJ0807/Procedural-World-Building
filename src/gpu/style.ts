import * as THREE from 'three'
import { CONTINUOUS, PALETTES, buildLut } from '../palette'
import { ACCENT_BLUE, VIEWPORT_BACKGROUND, VIEWPORT_BACKGROUND_LOW } from '../theme'

/**
 * The visual language of Topic 4.
 *
 * Two registers, because the page shows two different kinds of thing:
 *
 * **Dusk after dark** for anything lit in 3D — the shading study and the fish.
 * Warm key, shadows tinted lavender rather than crushed to black, on a warm
 * ink ground. Warm light against a cool shadow tint is the arrangement doing
 * the work; the ground joins the light's side of it, not the shadow's.
 *
 * **Slate and chalk** for the flat field views, which are maps rather than
 * photographs. Blue-grey slate ground, chalky pale marks, contour lines drawn
 * in chalk instead of ink. There is barely any lighting model here on purpose:
 * colour carries the value, not light.
 *
 * ## Why a dark ground did not bring the old look back
 *
 * The first version of this page was dark, and read as wet plastic. Three
 * things caused that, and only one of them was the darkness:
 *
 *   near-black background   #0C141F      the ground had no hue to sit against
 *   saturated cyan          #1A7395      surfaces glowed by contrast
 *   pow(dot(n,h), 64)       full strength a tight, bright specular dot
 *
 * The last two are gone — the sheen is exponent 16 capped at 0.035, and every
 * hue here is muted. The first is fixed by giving the background a colour and
 * some lightness rather than making it black: on near-black, anything at all
 * glows by contrast, and that is what reads as neon.
 *
 * ## The two rules a dark ground adds
 *
 * **The shadow tint is the floor, and the background sits below it.** In a
 * light scheme shadows are darker than the page. Inverted, a shadow darker
 * than the background would dissolve the silhouette into it, so the ambient
 * term is kept clearly lighter than the ground.
 *
 * **The lighting term has to reach past 1.** Albedo times a light that peaks
 * below 1 always darkens, which on a light ground is fine and on a dark one
 * sinks every surface into the background. The key is therefore a *gain*
 * slightly above unity rather than a colour multiplied straight in.
 *
 * Colours are authored and used as sRGB and written straight to the
 * framebuffer — the shading maths runs in that space rather than in linear
 * light. That is not physically correct, and it is the point: lighting in
 * gamma space compresses the shadow end, which is exactly the flat, chalky
 * falloff this look wants.
 */

/** Hex to a vec3 in 0–1, with no colour-space conversion. */
export function srgb(hex: number): THREE.Vector3 {
  return new THREE.Vector3(
    ((hex >> 16) & 255) / 255,
    ((hex >> 8) & 255) / 255,
    (hex & 255) / 255,
  )
}

/** Dusk after dark — the shading study and the school. */
export const DUSK = {
  background: VIEWPORT_BACKGROUND,
  backgroundLow: VIEWPORT_BACKGROUND_LOW,
  key: 0xe8d6bc,
  shadow: 0x4a4657,
  sky: 0x605c70,
  clay: 0xa8937f,
  sage: 0x7e8c7b,
  peach: 0xc08f74,
  softBlue: 0x7c8ea3,
  steep: 0x6e5e52,
}

/** Slate and chalk — the flat field views. */
export const SLATE = {
  background: 0x22242a,
  backgroundLow: 0x1a1c21,
  chalk: 0xe6e0d4,
  shade: 0x2e3138,
  bone: 0xd8d2c6,
  sage: 0x9ba894,
  sand: 0xc9b694,
}

type Stop = { at: number; hex: number }

/**
 * A 256-entry ramp, smoothstepped between stops.
 *
 * Smoothstep rather than a straight lerp: with stops this close together in
 * value, linear interpolation leaves visible creases where two segments meet,
 * and the whole point of these palettes is that nothing draws attention to
 * itself.
 */
function ramp(stops: Stop[]): Float32Array {
  const out = new Float32Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let lower = stops[0]
    let upper = stops[stops.length - 1]
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s].at && t <= stops[s + 1].at) {
        lower = stops[s]
        upper = stops[s + 1]
        break
      }
    }
    const span = upper.at - lower.at
    const raw = span <= 0 ? 0 : (t - lower.at) / span
    const k = raw * raw * (3 - 2 * raw)
    for (let c = 0; c < 3; c++) {
      const shift = 16 - c * 8
      const a = ((lower.hex >> shift) & 255) / 255
      const b = ((upper.hex >> shift) & 255) / 255
      out[i * 3 + c] = a + (b - a) * k
    }
  }
  return out
}

/**
 * Elevation on slate: deep water up to a chalk summit.
 *
 * Weighted dark deliberately. A filled map has no background — the ramp *is*
 * the ground — so a ramp balanced around its midpoint fills the frame with
 * mid-tones and the board never shows. Most of the range sits in slate and
 * dark sage, with chalk held back for the summits, which is what keeps the
 * view reading as dark rather than merely tinted.
 */
const SLATE_TERRAIN = ramp([
  { at: 0, hex: 0x232a33 },
  { at: 0.18, hex: 0x33465a },
  { at: 0.38, hex: 0x4a5b4e },
  { at: 0.62, hex: 0x6e7358 },
  { at: 0.82, hex: 0x9a8467 },
  { at: 1, hex: 0xc4b39c },
])

/**
 * Concentration on slate: the empty field is the ground itself.
 *
 * Inverted from the light version, where high concentration was dark ink on a
 * pale page. Here it is chalk on a board — high values are the bright ones, so
 * an empty field disappears into the background instead of covering it.
 */
const SLATE_CHALK = ramp([
  { at: 0, hex: 0x22242a },
  { at: 0.32, hex: 0x3a4a46 },
  { at: 0.68, hex: 0x7e9a86 },
  { at: 1, hex: 0xc9d6c4 },
])

/** A warmer chalk ramp, for when sage reads too cold against the board. */
const SLATE_EMBER = ramp([
  { at: 0, hex: 0x22242a },
  { at: 0.36, hex: 0x4a3d36 },
  { at: 0.72, hex: 0xa8795e },
  { at: 1, hex: 0xdcc3a8 },
])

/**
 * Elevation at dusk, for the shading study's height palette.
 *
 * Capped short of white: the lighting gain peaks a little above 1, so a ramp
 * that reached bone would push the summits to emissive.
 */
export const DUSK_TERRAIN = ramp([
  { at: 0, hex: 0x6e7e92 },
  { at: 0.22, hex: 0x76867e },
  { at: 0.45, hex: 0x7e8c7b },
  { at: 0.7, hex: 0xa8937f },
  { at: 0.88, hex: 0xc08f74 },
  { at: 1, hex: 0xc9baa6 },
])

export type RampOption = { value: number; label: string; data: Float32Array }

/**
 * The ramps offered on this page.
 *
 * Topic 4's own ramps come first and are the defaults; Topic 2's OKLab
 * palettes follow, unchanged, because they are genuinely better at separating
 * many levels and it costs nothing to keep them available.
 */
export const RAMPS: RampOption[] = [
  { value: 0, label: 'Slate — terrain', data: SLATE_TERRAIN },
  { value: 1, label: 'Slate — chalk', data: SLATE_CHALK },
  { value: 2, label: 'Slate — ember', data: SLATE_EMBER },
  ...PALETTES.map((palette, index) => ({
    value: index + 3,
    label: `Topic 2 — ${palette.label}`,
    data: buildLut(palette.value, ACCENT_BLUE, CONTINUOUS).linear,
  })),
]

export function rampData(index: number): Float32Array {
  return (RAMPS[index] ?? RAMPS[0]).data
}

const v3 = (hex: number) =>
  `vec3(${(((hex >> 16) & 255) / 255).toFixed(4)}, ${(((hex >> 8) & 255) / 255).toFixed(4)}, ${((hex & 255) / 255).toFixed(4)})`

/** Shared GLSL: the slate ground, chalk, and value noise for grain. */
export const GLSL_SLATE = /* glsl */ `
  const vec3 SLATE_BG = ${v3(SLATE.background)};
  const vec3 SLATE_CHALK_C = ${v3(SLATE.chalk)};
  const vec3 SLATE_SHADE = ${v3(SLATE.shade)};

  float hash21(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }

  /**
   * Board grain.
   *
   * Half the amplitude the light version used. Per-pixel noise is markedly
   * more visible against a dark ground, and above about 0.007 it stops reading
   * as the texture of a surface and starts reading as sensor noise.
   */
  vec3 grain(vec3 colour, vec2 pixel, float amount) {
    return colour + (hash21(pixel) - 0.5) * amount;
  }
`

/** Shared GLSL: the dusk lighting model. */
export const GLSL_DUSK = /* glsl */ `
  // Gains, not colours. Each is its palette hex scaled so the lit end passes 1
  // and the shadow end stays clearly above the background — on a dark ground a
  // light term that peaks below 1 can only ever sink a surface into the void.
  const vec3 DUSK_KEY = ${v3(DUSK.key)} * 1.22;
  const vec3 DUSK_SHADOW = ${v3(DUSK.shadow)} * 1.25;
  const vec3 DUSK_SKY = ${v3(DUSK.sky)} * 1.30;
  const vec3 DUSK_BG = ${v3(DUSK.background)};

  /**
   * Warm key, cool shadow, nothing crushed.
   *
   * Two things make this matte rather than glossy. The diffuse term is
   * *wrapped* — dot(n,l) mapped to 0..1 instead of clamped at 0 — so the
   * terminator is a broad gradient rather than an edge. And the shadow end
   * lands on a lavender well above the background, so unlit faces keep both
   * their hue and their silhouette.
   */
  vec3 duskLight(vec3 normal, vec3 lightDir) {
    float wrapped = dot(normal, lightDir) * 0.5 + 0.5;
    // Hemispheric fill: sky from above, a dimmer lavender from below.
    float sky = normal.y * 0.5 + 0.5;
    vec3 ambient = mix(DUSK_SHADOW * 0.85, DUSK_SKY, sky);
    return mix(ambient, DUSK_KEY, wrapped * 0.72);
  }

  /**
   * A sheen, not a highlight.
   *
   * Exponent 16 and a ceiling of 0.035 — lower than the light version, because
   * the same amount of specular is far more conspicuous against a dark ground.
   * The original shaders used pow(..., 64) at full strength, which is a tight
   * bright dot and the single change most responsible for surfaces reading as
   * wet plastic.
   */
  float duskSheen(vec3 normal, vec3 lightDir, vec3 viewDir) {
    vec3 halfway = normalize(lightDir + viewDir);
    return pow(max(dot(normal, halfway), 0.0), 16.0) * 0.035;
  }
`

const BACKDROP_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Clip space directly, ignoring the camera, so it always fills the view.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const BACKDROP_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uTop;
  uniform vec3 uBottom;
  void main() {
    gl_FragColor = vec4(mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y)), 1.0);
  }
`

/**
 * A soft vertical gradient behind a 3D scene.
 *
 * A flat fill makes a matte object read as a cut-out — there is no cue that it
 * sits in a space. A gradient of a few percent is enough to fix that, and is
 * cheaper and more controllable than `scene.background`, which would go
 * through colour management while these shaders write sRGB directly.
 */
export function createBackdrop(top: number, bottom: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      uniforms: { uTop: { value: srgb(top) }, uBottom: { value: srgb(bottom) } },
      depthTest: false,
      depthWrite: false,
    }),
  )
  mesh.renderOrder = -1
  mesh.frustumCulled = false
  return mesh
}
