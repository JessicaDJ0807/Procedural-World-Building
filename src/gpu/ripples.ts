import * as THREE from 'three'
import {
  Field,
  GLSL_FIT_SQUARE,
  GLSL_LAPLACIAN,
  createPass,
  runPass,
  type Uniforms,
} from './core'
import { GLSL_SLATE } from './style'
import { defaults, param, type ParamSpec, type Pointer, type Simulation } from './simulation'

const SIZE = 512

/**
 * The discrete wave equation.
 *
 * ∂²h/∂t² = c²∇²h, written as a three-term recurrence: the next height comes
 * from this one, the previous one, and the Laplacian. That needs two states in
 * flight, so the texture carries height in R and the previous height in G.
 *
 * The `uSpeed` uniform is the Courant number C = c²Δt²/Δx², and it is the whole
 * story of this simulation's stability. Past the CFL limit a wave advances more
 * than one cell per step, the stencil can no longer see where it came from, and
 * the field diverges. Measured here with damping off: 0.500 is bounded, 0.510
 * reaches 4.4e30 in about 300 steps — the theoretical bound for this scheme in
 * two dimensions is exactly 1/2, and it holds to the resolution of the slider.
 */
const STEP = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform float uSpeed;
  uniform float uDamping;
  uniform vec3 uPointer;   // xy in field space, z = strength (0 when idle)
  uniform float uRadius;

  ${GLSL_LAPLACIAN}

  void main() {
    vec2 state = texture2D(uState, vUv).rg;
    float lap = laplacian(uState, vUv, uTexel).r;

    float next = 2.0 * state.r - state.g + uSpeed * lap;
    next *= uDamping;

    if (uPointer.z > 0.0) {
      float d = length(vUv - uPointer.xy);
      next += uPointer.z * exp(-(d * d) / (uRadius * uRadius));
    }

    gl_FragColor = vec4(next, state.r, 0.0, 1.0);
  }
`

const DISPLAY = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform vec2 uViewport;
  uniform float uRelief;
  uniform float uMode;      // 0 = water surface, 1 = raw field

  ${GLSL_FIT_SQUARE}
  ${GLSL_SLATE}

  void main() {
    vec2 uv = fitSquare(vUv, uViewport);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(SLATE_BG, 1.0);
      return;
    }

    float h = texture2D(uState, uv).r;

    if (uMode > 0.5) {
      // The same state shaded as data: signed value through a muted diverging
      // ramp, soft blue for negative and ember for positive, meeting at the
      // colour of the board rather than at white — so a still field reads as
      // empty rather than as a flat grey slab.
      float t = clamp(h * uRelief * 0.5 + 0.5, 0.0, 1.0);
      vec3 low = vec3(0.427, 0.541, 0.612);   // #6D8A9C
      vec3 mid = SLATE_BG;
      vec3 high = vec3(0.788, 0.580, 0.451);  // #C99473
      vec3 c = t < 0.5 ? mix(low, mid, t * 2.0) : mix(mid, high, (t - 0.5) * 2.0);
      gl_FragColor = vec4(grain(c, gl_FragCoord.xy, 0.006), 1.0);
      return;
    }

    // Central differences give the slope; the normal follows from it. The
    // height is tiny in absolute terms, so uRelief is what makes the slope
    // visible at all — it is a display gain, not part of the physics.
    float hx = texture2D(uState, uv + vec2(uTexel.x, 0.0)).r
             - texture2D(uState, uv - vec2(uTexel.x, 0.0)).r;
    float hy = texture2D(uState, uv + vec2(0.0, uTexel.y)).r
             - texture2D(uState, uv - vec2(0.0, uTexel.y)).r;
    vec3 n = normalize(vec3(-hx * uRelief, -hy * uRelief, 1.0));

    vec3 lightDir = normalize(vec3(0.42, 0.55, 0.72));
    // Wrapped diffuse, so the light falls off over the whole surface instead
    // of terminating. Paired with a pale palette this is what keeps still
    // water reading as a matte sheet rather than as something varnished.
    float diffuse = dot(n, lightDir) * 0.5 + 0.5;

    // Both ends deepened for the dark register. A filled field has no
    // background of its own — the water *is* the ground — so a mid-value
    // surface fills the frame with grey no matter how dark the letterbox is.
    vec3 shallow = vec3(0.306, 0.376, 0.431);  // #4E606E
    vec3 deep = vec3(0.137, 0.169, 0.200);     // #232B33
    vec3 colour = mix(deep, shallow, diffuse);

    // A sheen, not a highlight: exponent 12 at 4% against the pow(...,64) at
    // full strength this shader used to carry, which was the single thing
    // most responsible for the surface looking like wet plastic.
    vec3 halfway = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    colour += pow(max(dot(n, halfway), 0.0), 12.0) * 0.03;

    gl_FragColor = vec4(grain(colour, gl_FragCoord.xy, 0.005), 1.0);
  }
`

const PARAMS: ParamSpec[] = [
  {
    key: 'speed',
    label: 'Wave speed',
    info: 'The Courant number C = c²Δt²/Δx². The one dial that can break the simulation rather than just change it. Measured on this grid with damping off: C = 0.500 stays bounded, C = 0.510 reaches a peak amplitude of 4.4e30 within about 300 steps. That threshold is the CFL condition for the five-point explicit scheme in two dimensions, which puts it at exactly 1/2.',
    min: 0.05,
    max: 0.75,
    step: 0.005,
    value: 0.4,
    format: (v) => v.toFixed(3),
  },
  {
    key: 'damping',
    label: 'Damping',
    info: 'Energy kept per step. 1.0 is a frictionless basin where nothing ever settles; below about 0.99 a ripple dies before it crosses the field.',
    min: 0.98,
    max: 1,
    step: 0.0005,
    value: 0.9965,
    format: (v) => v.toFixed(4),
  },
  {
    key: 'radius',
    label: 'Drop size',
    info: 'Width of the Gaussian the pointer adds, as a fraction of the field. A small drop contains high frequencies the grid cannot represent, which come straight back out as grid-aligned speckle.',
    min: 0.004,
    max: 0.08,
    step: 0.001,
    value: 0.018,
    format: (v) => v.toFixed(3),
  },
  {
    key: 'strength',
    label: 'Drop force',
    info: 'Height added at the centre of the drop each step the pointer is held down.',
    min: 0.02,
    max: 1,
    step: 0.01,
    value: 0.35,
  },
  {
    key: 'relief',
    label: 'Relief (display)',
    info: 'Display gain on the surface slope. Changes nothing about the simulation — it decides how steep the shading pretends the wave is.',
    min: 2,
    max: 120,
    step: 1,
    value: 30,
    format: (v) => v.toFixed(0),
  },
  {
    key: 'shading',
    label: 'Shade as data',
    info: 'Swaps the display shader while the simulation keeps running: 0 shades the state as a water surface, 1 shows the signed height straight through a diverging ramp. The clearest demonstration on this page that shading and simulation are separate jobs.',
    min: 0,
    max: 1,
    step: 1,
    value: 0,
    format: (v) => (v > 0.5 ? 'field' : 'water'),
    options: [
      { value: 0, label: 'Water surface' },
      { value: 1, label: 'Raw field' },
    ],
  },
]

export function createRipples(): Simulation {
  let field: Field | null = null
  let stepUniforms: Uniforms
  let displayUniforms: Uniforms
  let stepMaterial: THREE.ShaderMaterial
  let displayMaterial: THREE.ShaderMaterial
  let renderer: THREE.WebGLRenderer | null = null
  let drops = 0
  // Peak height, sampled occasionally. A wave equation past its stability
  // limit does not look subtly wrong, it diverges — and the only way to say
  // where that limit actually is, rather than quoting the textbook bound, is
  // to watch this number.
  let peak = 0
  let sinceProbe = 0
  const readback = new Float32Array(SIZE * SIZE * 4)

  const measurePeak = (): number => {
    if (!renderer || !field) return 0
    renderer.readRenderTargetPixels(field.source, 0, 0, SIZE, SIZE, readback)
    let most = 0
    for (let i = 0; i < SIZE * SIZE; i++) {
      const value = Math.abs(readback[i * 4])
      if (value > most) most = value
    }
    return most
  }

  return {
    id: 'ripples',
    label: 'Water ripples',
    blurb:
      'The wave equation on a 512² grid. Two stored heights per cell, one Laplacian, and a stability limit you can cross on purpose.',
    params: PARAMS,
    presets: [
      {
        value: 'pond',
        label: 'Still pond',
        hint: 'Slow, long-lived ripples that cross the basin and come back.',
        params: { speed: 0.28, damping: 0.999, radius: 0.018, strength: 0.35 },
      },
      {
        value: 'chop',
        label: 'Surface chop',
        hint: 'Fast and heavily damped — closer to wind texture than to a dropped stone.',
        params: { speed: 0.5, damping: 0.992, radius: 0.008, strength: 0.6 },
      },
      {
        value: 'unstable',
        label: 'Past the CFL limit',
        hint: 'Deliberately past the measured limit of 0.500. The field diverges within a few hundred steps; Reset brings it back.',
        params: { speed: 0.72, damping: 1, radius: 0.02, strength: 0.4 },
      },
    ],

    init(webglRenderer) {
      renderer = webglRenderer
      field = new Field(SIZE, SIZE)
      const texel = new THREE.Vector2(1 / SIZE, 1 / SIZE)

      stepUniforms = {
        uState: { value: null },
        uTexel: { value: texel },
        uSpeed: { value: 0.4 },
        uDamping: { value: 0.9965 },
        uPointer: { value: new THREE.Vector3(0, 0, 0) },
        uRadius: { value: 0.018 },
      }
      displayUniforms = {
        uState: { value: null },
        uTexel: { value: texel },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uRelief: { value: 30 },
        uMode: { value: 0 },
      }
      stepMaterial = createPass(STEP, stepUniforms)
      displayMaterial = createPass(DISPLAY, displayUniforms)
      this.reset(defaults(PARAMS))
    },

    reset() {
      if (!renderer || !field) return
      drops = 0
      peak = 0
      sinceProbe = 0
      // A flat, still surface: both stored heights zero. Clearing is a pass
      // like any other, so the zeroing uses the step shader with no impulse.
      const clear = createPass(
        `precision highp float;
         void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }`,
        {},
      )
      runPass(renderer, clear, field.target)
      field.swap()
      runPass(renderer, clear, field.target)
      field.swap()
      clear.dispose()
    },

    step(params, pointer: Pointer) {
      if (!renderer || !field) return
      const strength = param(params, PARAMS, 'strength')
      stepUniforms.uSpeed.value = param(params, PARAMS, 'speed')
      stepUniforms.uDamping.value = param(params, PARAMS, 'damping')
      stepUniforms.uRadius.value = param(params, PARAMS, 'radius')

      const impulse = stepUniforms.uPointer.value as THREE.Vector3
      const inside =
        pointer.active && pointer.x >= 0 && pointer.x <= 1 && pointer.y >= 0 && pointer.y <= 1
      impulse.set(pointer.x, pointer.y, inside ? strength : 0)
      if (inside) drops += 1

      stepUniforms.uState.value = field.texture
      runPass(renderer, stepMaterial, field.target)
      field.swap()

      sinceProbe += 1
      if (sinceProbe >= 20) {
        sinceProbe = 0
        peak = measurePeak()
      }
    },

    draw(webglRenderer, params) {
      if (!field) return
      displayUniforms.uState.value = field.texture
      displayUniforms.uRelief.value = param(params, PARAMS, 'relief')
      displayUniforms.uMode.value = param(params, PARAMS, 'shading')
      runPass(webglRenderer, displayMaterial, null)
    },

    resize(width, height) {
      ;(displayUniforms.uViewport.value as THREE.Vector2).set(width, height)
    },

    stats() {
      return [
        { label: 'grid', value: `${SIZE}² = ${(SIZE * SIZE).toLocaleString()} cells` },
        { label: 'steps per frame', value: '1' },
        { label: 'impulses applied', value: drops.toLocaleString() },
        {
          label: 'peak amplitude',
          value: Number.isFinite(peak) ? peak.toExponential(2) : 'diverged',
        },
      ]
    },

    dispose() {
      field?.dispose()
      stepMaterial?.dispose()
      displayMaterial?.dispose()
      field = null
      renderer = null
    },
  }
}
