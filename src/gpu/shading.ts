import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { rampTexture } from './core'
import { createCameraGate } from '../renderLoop'
import { defaults, param, type ParamSpec, type Simulation } from './simulation'
import { DUSK, GLSL_DUSK, RAMPS, createBackdrop, rampData, srgb } from './style'
import { compositeLayers, fbmOctaves, type NoiseLayer } from '../noise'
import { erodeStep, getPreset } from '../erosion'

const GRID = 192
const WORLD = 3

/**
 * One surface, shaded six ways.
 *
 * The geometry never changes between strategies — that is the whole design.
 * Everything you see differ is the last shader in the chain, so the comparison
 * is honest: same vertices, same normals, same light, different answer to the
 * question "what colour is this pixel?".
 *
 * The terrain is built by Topic 2's own droplet erosion, run once at startup
 * over a six-octave fBm stack. Raw fBm is too blobby to show a slope-based
 * material anything interesting; erosion puts real ridges and valley walls in
 * it, which is exactly what the slope and height strategies need to read
 * against.
 */

const VERTEX = /* glsl */ `
  uniform sampler2D uHeight;
  uniform float uRelief;
  uniform vec2 uTexel;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;

  void main() {
    float h = texture2D(uHeight, uv).r;
    vec3 displaced = position + vec3(0.0, 0.0, h * uRelief);

    // The normal is derived here rather than baked into the geometry, so
    // relief stays a uniform. Baking it would mean rebuilding 36,864 vertices
    // on every movement of the slider.
    float span = ${WORLD.toFixed(1)} * uTexel.x * 2.0;
    float dx = (texture2D(uHeight, uv + vec2(uTexel.x, 0.0)).r
              - texture2D(uHeight, uv - vec2(uTexel.x, 0.0)).r) * uRelief;
    float dy = (texture2D(uHeight, uv + vec2(0.0, uTexel.y)).r
              - texture2D(uHeight, uv - vec2(0.0, uTexel.y)).r) * uRelief;
    vec3 n = normalize(vec3(-dx / span, -dy / span, 1.0));

    vNormal = normalize(normalMatrix * n);
    vWorld = (modelMatrix * vec4(displaced, 1.0)).xyz;
    vHeight = h;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`

const PRELUDE = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;

  uniform sampler2D uRamp;
  uniform vec3 uLight;
  uniform vec3 uCamera;
  uniform vec3 uBackground;
  uniform float uNoiseScale;
  uniform float uNoiseAmount;
  uniform float uFresnel;
  uniform float uHaze;

  ${GLSL_DUSK}

  const vec3 CLAY = vec3(${(DUSK.clay >> 16 & 255) / 255}, ${(DUSK.clay >> 8 & 255) / 255}, ${(DUSK.clay & 255) / 255});
  const vec3 SAGE = vec3(${(DUSK.sage >> 16 & 255) / 255}, ${(DUSK.sage >> 8 & 255) / 255}, ${(DUSK.sage & 255) / 255});
  const vec3 STEEP = vec3(${(DUSK.steep >> 16 & 255) / 255}, ${(DUSK.steep >> 8 & 255) / 255}, ${(DUSK.steep & 255) / 255});
  const vec3 PEACH = vec3(${(DUSK.peach >> 16 & 255) / 255}, ${(DUSK.peach >> 8 & 255) / 255}, ${(DUSK.peach & 255) / 255});

  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float valueNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
          mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
          mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  /** Three octaves. Enough for gentle variation, not enough to look busy. */
  float fbm3(vec3 p) {
    return valueNoise(p) * 0.55 + valueNoise(p * 2.03) * 0.3 + valueNoise(p * 4.11) * 0.15;
  }

  /** 0 on flat ground, 1 on a vertical wall. */
  float steepness(vec3 n) {
    return 1.0 - clamp(n.y, 0.0, 1.0);
  }

  /** Distance haze toward the background, so far ground recedes. */
  vec3 recede(vec3 colour, float amount) {
    float d = clamp((length(vWorld - uCamera) - 2.0) / 5.0, 0.0, 1.0);
    return mix(colour, uBackground, d * amount);
  }

  vec3 shade(vec3 albedo, vec3 n, vec3 viewDir) {
    return albedo * duskLight(n, uLight) + duskSheen(n, uLight, viewDir);
  }
`

/** Each strategy is a whole fragment shader, sharing only the prelude above. */
const STRATEGIES: { key: string; label: string; hint: string; body: string }[] = [
  {
    key: 'matte',
    label: 'Matte / diffuse',
    hint: 'One clay colour, lit only. No palette, no texture, no rim — this is the baseline every other strategy is a change from, and the only one where the form is doing all the work.',
    body: /* glsl */ `
      vec3 n = normalize(vNormal);
      vec3 viewDir = normalize(uCamera - vWorld);
      gl_FragColor = vec4(shade(CLAY, n, viewDir), 1.0);
    `,
  },
  {
    key: 'height',
    label: 'Height palette',
    hint: "Albedo comes from elevation through a colour ramp. The same lighting as Matte — the only change is what colour the surface was before it was lit, which is why the two read as the same landscape in different materials.",
    body: /* glsl */ `
      vec3 n = normalize(vNormal);
      vec3 viewDir = normalize(uCamera - vWorld);
      vec3 albedo = texture2D(uRamp, vec2(vHeight, 0.5)).rgb;
      gl_FragColor = vec4(shade(albedo, n, viewDir), 1.0);
    `,
  },
  {
    key: 'slope',
    label: 'Slope material',
    hint: 'Albedo comes from the normal instead of the position: flat ground is sage, anything steeper than about 25° becomes bare earth. This is how grass-and-rock materials are usually driven, and it needs no texture and no authoring — the geometry already knows which faces are cliffs.',
    body: /* glsl */ `
      vec3 n = normalize(vNormal);
      vec3 viewDir = normalize(uCamera - vWorld);
      float bare = smoothstep(0.22, 0.55, steepness(n));
      vec3 albedo = mix(SAGE, STEEP, bare);
      gl_FragColor = vec4(shade(albedo, n, viewDir), 1.0);
    `,
  },
  {
    key: 'noise',
    label: 'Procedural noise',
    hint: 'Three octaves of value noise, evaluated per pixel in world space, moving the albedo between two close colours. Deliberately weak: it is there to stop large faces reading as flat vinyl, not to add pattern. Turn the amount up to see where it stops being a material and starts being a texture.',
    body: /* glsl */ `
      vec3 n = normalize(vNormal);
      vec3 viewDir = normalize(uCamera - vWorld);
      float v = fbm3(vWorld * uNoiseScale);
      vec3 albedo = mix(CLAY, PEACH, v * uNoiseAmount);
      gl_FragColor = vec4(shade(albedo, n, viewDir), 1.0);
    `,
  },
  {
    key: 'fresnel',
    label: 'Fresnel / atmosphere',
    hint: 'Grazing faces sink toward the background instead of lighting up, and distance fades the surface into it. Inverted from the usual additive rim, which on a dark ground reads as a light source however faint it is.',
    body: /* glsl */ `
      vec3 n = normalize(vNormal);
      vec3 viewDir = normalize(uCamera - vWorld);
      vec3 colour = shade(CLAY, n, viewDir);
      // Inverted: grazing faces sink toward the background rather than picking
      // up sky colour. Additively on a dark ground, even a faint rim reads as
      // a light source and puts the whole image back into sci-fi territory.
      float rim = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 4.0);
      colour = mix(colour, DUSK_BG, rim * uFresnel);
      gl_FragColor = vec4(recede(colour, uHaze), 1.0);
    `,
  },
  {
    key: 'combined',
    label: 'All together',
    hint: 'Every technique layered in the order they are usually applied: elevation sets the base colour, slope overrides it on cliffs, noise breaks up what is left, then the lighting, then the rim and the haze. Each of the five above is this with one term removed.',
    body: /* glsl */ `
      vec3 n = normalize(vNormal);
      vec3 viewDir = normalize(uCamera - vWorld);

      vec3 albedo = texture2D(uRamp, vec2(vHeight, 0.5)).rgb;
      float bare = smoothstep(0.24, 0.58, steepness(n));
      albedo = mix(albedo, STEEP, bare * 0.85);
      float v = fbm3(vWorld * uNoiseScale) - 0.5;
      albedo *= 1.0 + v * uNoiseAmount;

      vec3 colour = shade(albedo, n, viewDir);
      float rim = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 4.0);
      colour = mix(colour, DUSK_BG, rim * uFresnel);
      gl_FragColor = vec4(recede(colour, uHaze), 1.0);
    `,
  },
]

const PARAMS: ParamSpec[] = [
  {
    key: 'strategy',
    label: 'Strategy',
    info: 'Which fragment shader draws the surface. The geometry, the light and the camera are identical across all six — everything that changes is the answer to "what colour is this pixel?".',
    min: 0,
    max: STRATEGIES.length - 1,
    step: 1,
    value: STRATEGIES.length - 1,
    format: (v) => STRATEGIES[Math.round(v)]?.label ?? '',
    options: STRATEGIES.map((s, index) => ({ value: index, label: s.label })),
  },
  {
    key: 'relief',
    label: 'Relief',
    info: 'Vertical scale of the terrain, in world units. The vertex shader derives the normal from this rather than the geometry carrying it, so the surface can be flattened to a plate or pushed into mountains without rebuilding 36,864 vertices.',
    min: 0.05,
    max: 0.9,
    step: 0.01,
    value: 0.3,
  },
  {
    key: 'azimuth',
    label: 'Light direction',
    info: 'Where the key light sits around the scene, in degrees. Worth sweeping on the Matte strategy: with no colour information at all, direction is the only thing telling you the shape.',
    min: 0,
    max: 360,
    step: 1,
    value: 132,
    format: (v) => `${v.toFixed(0)}°`,
  },
  {
    key: 'elevation',
    label: 'Light height',
    info: 'How high the key light sits, in degrees above the horizon. Low light rakes across the slopes and exaggerates relief; high light flattens it and lets the palette carry the image.',
    min: 5,
    max: 85,
    step: 1,
    value: 30,
    format: (v) => `${v.toFixed(0)}°`,
  },
  {
    key: 'ramp',
    label: 'Height ramp',
    info: "Which colour ramp elevation maps through. Used by the Height palette and All together strategies. Topic 4's paper ramps come first; Topic 2's OKLab palettes are kept available below them.",
    min: 0,
    max: RAMPS.length - 1,
    step: 1,
    value: 0,
    format: (v) => RAMPS[Math.round(v)]?.label ?? '',
    options: RAMPS.map((r) => ({ value: r.value, label: r.label })),
  },
  {
    key: 'noiseScale',
    label: 'Noise scale',
    info: 'Frequency of the procedural noise, in cycles per world unit. Low values tint whole hillsides; high values become a fine grain that fights the form.',
    min: 0.5,
    max: 14,
    step: 0.1,
    value: 3.4,
  },
  {
    key: 'noiseAmount',
    label: 'Noise amount',
    info: 'How far the noise moves the albedo. The default is deliberately small — this is meant to read as a material that is not perfectly uniform, not as a pattern.',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.22,
  },
  {
    key: 'fresnel',
    label: 'Fresnel',
    info: 'How much sky colour grazing faces pick up. Restrained by default; past about 0.4 it stops being atmosphere and becomes a rim light.',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.16,
  },
  {
    key: 'haze',
    label: 'Distance haze',
    info: 'How far the surface fades toward the background with distance. Does most of the work of making the terrain feel large rather than like a tabletop model.',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.35,
  },
  {
    key: 'spin',
    view: true,
    // "Spin", matching the other three topics, and off by default for the same
    // reason they are: the page should open on a still frame you chose to move,
    // not one already moving. Worth turning on, though — a still matte render
    // is ambiguous about which way a slope faces, and movement resolves it.
    label: 'Spin',
    info: 'Degrees per second the surface turns. Off by default; worth turning on, because a still matte render is ambiguous about which way a slope faces and movement resolves it immediately. Drag to orbit manually at any time.',
    min: 0,
    max: 30,
    step: 0.5,
    value: 0,
    format: (v) => (v === 0 ? 'off' : `${v.toFixed(1)}°/s`),
  },
]

/** The six-octave fBm stack Topic 2 opens on, carved by its droplet erosion. */
function buildTerrain(): { data: Float32Array; ms: number } {
  const started = performance.now()
  const layers: NoiseLayer[] = fbmOctaves(6, 2, 0.5, GRID).map((octave, index) => ({
    id: `octave-${index}`,
    name: `Octave ${index + 1}`,
    enabled: true,
    frequency: octave.frequency,
    spread: 0.6,
    seed: index + 1,
    shapingName: 'none',
    shapingParams: {},
    blendName: 'normal',
    opacity: octave.opacity,
  }))
  const base = compositeLayers(GRID, 2, layers)

  // Three droplets per cell, with thermal slippage. Enough to cut valley
  // walls a slope-based material can find; far short of Topic 2's cap, which
  // would cost seconds of blocked main thread at startup.
  const run = erodeStep(null, base, GRID, GRID * GRID * 3, 1337, getPreset('gorges').params, {
    talus: 0.02,
    strength: 0.5,
    passes: 2,
  })

  let min = Infinity
  let max = -Infinity
  for (const value of run.height) {
    if (value < min) min = value
    if (value > max) max = value
  }
  const span = Math.max(max - min, 1e-5)

  // Normalised to 0–1 so `relief` is the only thing setting vertical scale.
  const data = new Float32Array(GRID * GRID * 4)
  for (let i = 0; i < run.height.length; i++) {
    data[i * 4] = (run.height[i] - min) / span
    data[i * 4 + 3] = 1
  }
  return { data, ms: performance.now() - started }
}

export function createShading(): Simulation {
  let scene: THREE.Scene
  let camera: THREE.PerspectiveCamera
  let controls: OrbitControls | null = null
  let surface: THREE.Mesh | null = null
  let heightTexture: THREE.DataTexture | null = null
  let ramp: THREE.DataTexture | null = null
  let rampIndex = -1
  const materials: THREE.ShaderMaterial[] = []
  let uniforms: Record<string, THREE.IUniform>
  let active = -1
  let turntable = 0
  let buildMs = 0
  // Set from OrbitControls.update(), which reports whether it moved the
  // camera. Damping keeps moving it for a second or so after the pointer is
  // released, and the loop has to stay awake for all of it.
  let cameraMoving = false
  const cameraGate = createCameraGate()

  const selectRamp = (index: number) => {
    if (index === rampIndex) return
    rampIndex = index
    ramp?.dispose()
    ramp = rampTexture(rampData(index))
    uniforms.uRamp.value = ramp
  }

  return {
    id: 'shading',
    label: 'Surface shading',
    blurb:
      'One eroded terrain, six fragment shaders. The geometry, the light and the camera never change — only the shader that decides what colour a pixel is.',
    params: PARAMS,
    // Nothing accumulates here — the terrain is built once and held.
    accumulates: false,
    presets: [
      {
        value: 'study',
        label: 'Study',
        hint: 'Low raking light and no haze, so the shading model is as legible as possible.',
        params: { azimuth: 132, elevation: 22, haze: 0.12, fresnel: 0.15, relief: 0.42, spin: 0 },
      },
      {
        value: 'dusk',
        label: 'Dusk',
        hint: 'The palette at its intended settings: low warm key, lavender shadow, gentle haze.',
        params: { azimuth: 152, elevation: 28, haze: 0.4, fresnel: 0.34, relief: 0.38, spin: 0 },
      },
      {
        value: 'overcast',
        label: 'Overcast',
        hint: 'High, soft light. Relief almost disappears and the palette carries the whole image.',
        params: { azimuth: 90, elevation: 74, haze: 0.3, fresnel: 0.22, relief: 0.34, spin: 0 },
      },
    ],

    init(_renderer, canvas) {
      scene = new THREE.Scene()
      camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
      camera.position.set(0, 2.05, 4.35)
      controls = new OrbitControls(camera, canvas)
      controls.enableDamping = true
      // The plate's visual centre sits above y=0, because relief only ever
      // adds height. Aiming there rather than at the origin is what stops the
      // subject riding high with dead space beneath it.
      controls.target.set(0, 0.15, 0)
      controls.minPolarAngle = 0.15
      controls.maxPolarAngle = Math.PI * 0.49

      scene.add(createBackdrop(DUSK.background, DUSK.backgroundLow))

      const terrain = buildTerrain()
      buildMs = terrain.ms
      heightTexture = new THREE.DataTexture(
        terrain.data, GRID, GRID, THREE.RGBAFormat, THREE.FloatType,
      )
      // Linear here, unlike every simulation texture on this page: these
      // samples are a surface being interpolated across, not cell states.
      heightTexture.minFilter = THREE.LinearFilter
      heightTexture.magFilter = THREE.LinearFilter
      heightTexture.wrapS = THREE.ClampToEdgeWrapping
      heightTexture.wrapT = THREE.ClampToEdgeWrapping
      heightTexture.needsUpdate = true

      uniforms = {
        uHeight: { value: heightTexture },
        uRelief: { value: 0.38 },
        uTexel: { value: new THREE.Vector2(1 / GRID, 1 / GRID) },
        uRamp: { value: null },
        uLight: { value: new THREE.Vector3(0, 1, 0) },
        uCamera: { value: new THREE.Vector3() },
        uBackground: { value: srgb(DUSK.background) },
        uNoiseScale: { value: 3.4 },
        uNoiseAmount: { value: 0.22 },
        uFresnel: { value: 0.3 },
        uHaze: { value: 0.35 },
      }
      selectRamp(0)

      for (const strategy of STRATEGIES) {
        materials.push(new THREE.ShaderMaterial({
          vertexShader: VERTEX,
          fragmentShader: `${PRELUDE}\nvoid main() {${strategy.body}}`,
          uniforms,
        }))
      }

      const geometry = new THREE.PlaneGeometry(WORLD, WORLD, GRID - 1, GRID - 1)
      surface = new THREE.Mesh(geometry, materials[0])
      // Displacement happens in the vertex shader, so three cannot know the
      // real bounds and would cull the surface as soon as it is raised.
      surface.frustumCulled = false
      surface.rotation.x = -Math.PI / 2
      scene.add(surface)

      const start = defaults(PARAMS)
      active = Math.round(start.strategy)
      surface.material = materials[active]
    },

    reset() {
      controls?.reset()
      camera.position.set(0, 2.05, 4.35)
      turntable = 0
    },

    step(params) {
      if (!surface) return
      const wanted = Math.round(param(params, PARAMS, 'strategy'))
      if (wanted !== active && materials[wanted]) {
        active = wanted
        surface.material = materials[wanted]
      }

      uniforms.uRelief.value = param(params, PARAMS, 'relief')
      uniforms.uNoiseScale.value = param(params, PARAMS, 'noiseScale')
      uniforms.uNoiseAmount.value = param(params, PARAMS, 'noiseAmount')
      uniforms.uFresnel.value = param(params, PARAMS, 'fresnel')
      uniforms.uHaze.value = param(params, PARAMS, 'haze')

      const azimuth = (param(params, PARAMS, 'azimuth') * Math.PI) / 180
      const elevation = (param(params, PARAMS, 'elevation') * Math.PI) / 180
      ;(uniforms.uLight.value as THREE.Vector3)
        .set(
          Math.cos(elevation) * Math.cos(azimuth),
          Math.sin(elevation),
          Math.cos(elevation) * Math.sin(azimuth),
        )
        .normalize()

      turntable += (param(params, PARAMS, 'spin') * Math.PI) / 180 / 60
      surface.rotation.z = turntable
    },

    draw(webglRenderer, params) {
      if (!surface) return
      selectRamp(Math.round(param(params, PARAMS, 'ramp')))
      ;(uniforms.uCamera.value as THREE.Vector3).copy(camera.position)
      controls?.update()
      cameraMoving = cameraGate(camera.position, controls?.target ?? camera.position)
      webglRenderer.setRenderTarget(null)
      webglRenderer.render(scene, camera)
    },

    animating(params) {
      return param(params, PARAMS, 'spin') !== 0 || cameraMoving
    },

    resize(width, height) {
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    },

    stats() {
      return [
        { label: 'surface', value: `${GRID}² = ${(GRID * GRID).toLocaleString()} vertices` },
        { label: 'strategy', value: STRATEGIES[active]?.label ?? '' },
        { label: 'terrain built in', value: `${buildMs.toFixed(0)} ms` },
      ]
    },

    dispose() {
      controls?.dispose()
      surface?.geometry.dispose()
      for (const material of materials) material.dispose()
      materials.length = 0
      heightTexture?.dispose()
      ramp?.dispose()
      surface = null
      controls = null
    },
  }
}

/** The strategy list, so the write-up and the sidebar cannot disagree. */
export const SHADING_STRATEGIES = STRATEGIES.map(({ key, label, hint }) => ({ key, label, hint }))
