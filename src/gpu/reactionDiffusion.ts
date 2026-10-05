import * as THREE from 'three'
import {
  Field,
  GLSL_FIT_SQUARE,
  createPass,
  dataTexture,
  rampTexture,
  runPass,
  seedField,
  type Uniforms,
} from './core'
import { defaults, param, type ParamSpec, type Pointer, type Simulation } from './simulation'
import { mulberry32 } from '../noise'
import { GLSL_SLATE, RAMPS, rampData } from './style'

const SIZE = 512

/**
 * Gray–Scott reaction–diffusion.
 *
 *   A' = A + (Da∇²A − AB² + f(1−A)) Δt
 *   B' = B + (Db∇²B + AB² − (f+k)B) Δt
 *
 * Two chemicals. B consumes A to make more of itself — the AB² term, which is
 * why B needs a seed to exist at all — while feed `f` replenishes A and kill
 * `k` removes B. Nothing in those two lines knows what a stripe is, yet the
 * parameter plane is full of them. This is Turing's 1952 result, and it is the
 * current best explanation for how coral and fish skin get their patterns.
 */
const STEP = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uState;   // r = A, g = B
  uniform vec2 uTexel;
  uniform float uFeed;
  uniform float uKill;
  uniform float uDa;
  uniform float uDb;
  uniform float uDt;
  uniform vec3 uPointer;
  uniform float uRadius;

  // The nine-point stencil, not the five-point one used for the wave. A
  // five-point Laplacian is anisotropic enough that the patterns visibly align
  // to the grid axes; the diagonal terms are what make them look organic.
  vec2 laplacian9(vec2 uv) {
    vec2 sum = vec2(0.0);
    sum += texture2D(uState, uv + vec2(-uTexel.x, -uTexel.y)).rg * 0.05;
    sum += texture2D(uState, uv + vec2( 0.0,      -uTexel.y)).rg * 0.20;
    sum += texture2D(uState, uv + vec2( uTexel.x, -uTexel.y)).rg * 0.05;
    sum += texture2D(uState, uv + vec2(-uTexel.x,  0.0)).rg      * 0.20;
    sum += texture2D(uState, uv).rg                              * -1.0;
    sum += texture2D(uState, uv + vec2( uTexel.x,  0.0)).rg      * 0.20;
    sum += texture2D(uState, uv + vec2(-uTexel.x,  uTexel.y)).rg * 0.05;
    sum += texture2D(uState, uv + vec2( 0.0,       uTexel.y)).rg * 0.20;
    sum += texture2D(uState, uv + vec2( uTexel.x,  uTexel.y)).rg * 0.05;
    return sum;
  }

  void main() {
    vec2 s = texture2D(uState, vUv).rg;
    float a = s.r;
    float b = s.g;
    vec2 lap = laplacian9(vUv);

    float reaction = a * b * b;
    float na = a + (uDa * lap.r - reaction + uFeed * (1.0 - a)) * uDt;
    float nb = b + (uDb * lap.g + reaction - (uFeed + uKill) * b) * uDt;

    if (uPointer.z > 0.0) {
      float d = length(vUv - uPointer.xy);
      // A hard disc, not a Gaussian: B has a threshold below which the
      // reaction dies out, so a soft brush mostly paints nothing.
      if (d < uRadius) nb = 0.5;
    }

    gl_FragColor = vec4(clamp(na, 0.0, 1.0), clamp(nb, 0.0, 1.0), 0.0, 1.0);
  }
`

const DISPLAY = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uState;
  uniform sampler2D uRamp;
  uniform vec2 uViewport;
  uniform float uGain;

  ${GLSL_FIT_SQUARE}
  ${GLSL_SLATE}

  void main() {
    vec2 uv = fitSquare(vUv, uViewport);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(SLATE_BG, 1.0);
      return;
    }
    // B rarely exceeds about 0.4, so the ramp is fitted to what the field
    // actually reaches rather than to [0,1] — the same argument Topic 2 makes
    // for fitting a palette to its data.
    float b = texture2D(uState, uv).g;
    float t = clamp(b * uGain, 0.0, 1.0);
    vec3 colour = texture2D(uRamp, vec2(t, 0.5)).rgb;
    gl_FragColor = vec4(grain(colour, gl_FragCoord.xy, 0.007), 1.0);
  }
`

const PARAMS: ParamSpec[] = [
  {
    key: 'feed',
    label: 'Feed (f)',
    info: 'Rate A is replenished at. Together with kill this is the entire parameter space — the two numbers decide whether you get spots, stripes, a maze, or a field that dies out completely.',
    min: 0.01,
    max: 0.09,
    step: 0.0002,
    value: 0.0545,
    format: (v) => v.toFixed(4),
  },
  {
    key: 'kill',
    label: 'Kill (k)',
    info: 'Rate B is removed at. The interesting behaviour lives in a narrow band: move kill by 0.002 and a growing coral can become a static blob or vanish entirely.',
    min: 0.04,
    max: 0.075,
    step: 0.0002,
    value: 0.062,
    format: (v) => v.toFixed(4),
  },
  {
    key: 'da',
    label: 'Diffusion A',
    info: 'How fast A spreads. Patterns need A to diffuse faster than B — that difference in rates is the whole mechanism, and setting them equal produces nothing at all.',
    min: 0.2,
    max: 1.4,
    step: 0.01,
    value: 1,
  },
  {
    key: 'db',
    label: 'Diffusion B',
    info: 'How fast B spreads. The classic ratio is half of A. Raising it toward A flattens the pattern into a smooth wash.',
    min: 0.1,
    max: 1,
    step: 0.01,
    value: 0.5,
  },
  {
    key: 'dt',
    label: 'Time step',
    info: 'Δt per sub-step. Above about 1.4 the explicit integration goes unstable and the field fills with grid-aligned noise.',
    min: 0.2,
    max: 1.8,
    step: 0.02,
    value: 1,
  },
  {
    key: 'steps',
    label: 'Steps per frame',
    info: 'Sub-steps run before the frame is drawn. Gray-Scott evolves slowly per step, so one step per frame is almost motionless — this is the dial that makes it watchable, and the one that decides the frame cost.',
    min: 1,
    max: 40,
    step: 1,
    value: 14,
    format: (v) => v.toFixed(0),
  },
  {
    key: 'radius',
    label: 'Brush size',
    info: 'Radius of the disc of B the pointer paints, as a fraction of the field.',
    min: 0.005,
    max: 0.08,
    step: 0.001,
    value: 0.02,
    format: (v) => v.toFixed(3),
  },
  {
    key: 'gain',
    label: 'Contrast (display)',
    info: 'Display gain on B before the colour ramp. Changes nothing about the chemistry.',
    min: 1,
    max: 8,
    step: 0.1,
    value: 3.2,
  },
  {
    key: 'palette',
    label: 'Palette',
    info: "The ramp concentration maps through, as a 256-entry lookup texture. Topic 4's slate ramps come first; Topic 2's OKLab palettes follow and are kept because they separate many levels better than a muted ramp can.",
    min: 0,
    max: RAMPS.length - 1,
    step: 1,
    value: 1,
    format: (v) => RAMPS[Math.round(v)]?.label ?? '',
    options: RAMPS.map((option) => ({ value: option.value, label: option.label })),
  },
]

/** A=1, B=0, with a handful of square seeds of B. */
function seedData(seed: number): Float32Array {
  const data = new Float32Array(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) {
    data[i * 4] = 1
    data[i * 4 + 3] = 1
  }
  const random = mulberry32(seed)
  for (let blob = 0; blob < 14; blob++) {
    const cx = Math.floor(random() * SIZE)
    const cy = Math.floor(random() * SIZE)
    const half = 4 + Math.floor(random() * 8)
    for (let y = cy - half; y <= cy + half; y++) {
      for (let x = cx - half; x <= cx + half; x++) {
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
        const index = (y * SIZE + x) * 4
        data[index] = 0.5
        data[index + 1] = 0.25
      }
    }
  }
  return data
}

export function createReactionDiffusion(): Simulation {
  let field: Field | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let stepUniforms: Uniforms
  let displayUniforms: Uniforms
  let stepMaterial: THREE.ShaderMaterial
  let displayMaterial: THREE.ShaderMaterial
  let ramp: THREE.DataTexture | null = null
  let rampIndex = -1
  let elapsed = 0
  let lastSteps = 0
  let seed = 1

  const selectRamp = (index: number) => {
    if (index === rampIndex) return
    rampIndex = index
    ramp?.dispose()
    ramp = rampTexture(rampData(index))
    displayUniforms.uRamp.value = ramp
  }

  return {
    id: 'reaction-diffusion',
    label: 'Reaction–diffusion',
    blurb:
      "Gray–Scott on a 512² grid. Two chemicals, four constants, and the pattern space behind coral and fish markings.",
    params: PARAMS,
    presets: [
      {
        value: 'coral',
        label: 'Coral growth',
        hint: 'f 0.0545 / k 0.062 — fronts that branch and thicken outward without ever closing.',
        params: { feed: 0.0545, kill: 0.062 },
      },
      {
        value: 'mitosis',
        label: 'Mitosis',
        hint: 'f 0.0367 / k 0.0649 — blobs that grow to a size and then split in two, indefinitely.',
        params: { feed: 0.0367, kill: 0.0649 },
      },
      {
        value: 'maze',
        label: 'Mazes',
        hint: 'f 0.029 / k 0.057 — labyrinth corridors of even width that fill the field.',
        params: { feed: 0.029, kill: 0.057 },
      },
      {
        value: 'spots',
        label: 'Spots',
        hint: 'f 0.035 / k 0.065 — isolated dots that repel each other into a lattice.',
        params: { feed: 0.035, kill: 0.065 },
      },
      {
        value: 'worms',
        label: 'Worms',
        hint: 'f 0.078 / k 0.061 — short segments that wander and rejoin.',
        params: { feed: 0.078, kill: 0.061 },
      },
    ],

    init(webglRenderer) {
      renderer = webglRenderer
      field = new Field(SIZE, SIZE)
      const texel = new THREE.Vector2(1 / SIZE, 1 / SIZE)
      stepUniforms = {
        uState: { value: null },
        uTexel: { value: texel },
        uFeed: { value: 0.0545 },
        uKill: { value: 0.062 },
        uDa: { value: 1 },
        uDb: { value: 0.5 },
        uDt: { value: 1 },
        uPointer: { value: new THREE.Vector3(0, 0, 0) },
        uRadius: { value: 0.02 },
      }
      displayUniforms = {
        uState: { value: null },
        uRamp: { value: null },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uGain: { value: 3.2 },
      }
      stepMaterial = createPass(STEP, stepUniforms)
      displayMaterial = createPass(DISPLAY, displayUniforms)
      selectRamp(1)
      this.reset(defaults(PARAMS))
    },

    reset() {
      if (!renderer || !field) return
      elapsed = 0
      seed += 1
      const texture = dataTexture(seedData(seed), SIZE, SIZE)
      seedField(renderer, field, texture)
      texture.dispose()
    },

    step(params, pointer: Pointer) {
      if (!renderer || !field) return
      stepUniforms.uFeed.value = param(params, PARAMS, 'feed')
      stepUniforms.uKill.value = param(params, PARAMS, 'kill')
      stepUniforms.uDa.value = param(params, PARAMS, 'da')
      stepUniforms.uDb.value = param(params, PARAMS, 'db')
      stepUniforms.uDt.value = param(params, PARAMS, 'dt')
      stepUniforms.uRadius.value = param(params, PARAMS, 'radius')

      const impulse = stepUniforms.uPointer.value as THREE.Vector3
      const inside =
        pointer.active && pointer.x >= 0 && pointer.x <= 1 && pointer.y >= 0 && pointer.y <= 1
      impulse.set(pointer.x, pointer.y, inside ? 1 : 0)

      const steps = Math.round(param(params, PARAMS, 'steps'))
      lastSteps = steps
      for (let i = 0; i < steps; i++) {
        stepUniforms.uState.value = field.texture
        runPass(renderer, stepMaterial, field.target)
        field.swap()
      }
      elapsed += steps
    },

    draw(webglRenderer, params) {
      if (!field) return
      selectRamp(Math.round(param(params, PARAMS, 'palette')))
      displayUniforms.uState.value = field.texture
      displayUniforms.uGain.value = param(params, PARAMS, 'gain')
      runPass(webglRenderer, displayMaterial, null)
    },

    resize(width, height) {
      ;(displayUniforms.uViewport.value as THREE.Vector2).set(width, height)
    },

    stats() {
      return [
        { label: 'grid', value: `${SIZE}² = ${(SIZE * SIZE).toLocaleString()} cells` },
        { label: 'steps per frame', value: String(lastSteps) },
        { label: 'steps since reset', value: elapsed.toLocaleString() },
      ]
    },

    dispose() {
      field?.dispose()
      ramp?.dispose()
      stepMaterial?.dispose()
      displayMaterial?.dispose()
      field = null
      renderer = null
    },
  }
}
