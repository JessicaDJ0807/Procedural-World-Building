import * as THREE from 'three'
import { DAY } from './sky'

/**
 * The seasons made visible: leaf colour, lawn, sky and light, and weather in
 * the air — rain, snow, falling autumn leaves, spring petals — and brown
 * leaves dropping wherever a plant withers.
 *
 * Only the game asks for this (BuildViewport's `look` prop); the Lab and the
 * other pages keep their materials untouched. Nothing here feeds back into
 * the growth: the simulation's seasons are its weather (game/seasons.ts),
 * this only shows them.
 */

/** What the world looks like at a moment, already blended across a change of season. */
export type SeasonLook = {
  /** Leaves are pulled `leafMix` (0–1) toward `leaf`, keeping their own light and dark. */
  leaf: THREE.Color
  leafMix: number
  /** Multiplies the lawn's colours. */
  lawn: THREE.Color
  zenith: THREE.Color
  horizon: THREE.Color
  sun: THREE.Color
  sunIntensity: number
  skyIntensity: number
  /** How much of each weather is in the air, 0–1. */
  rain: number
  snow: number
  leaves: number
  petals: number
}

/** The particles' box, town units, round the buildable grid. */
const SPAN = 16
const TOP = 13

const RAIN = 900
const RAIN_SPEED = 13
const RAIN_LENGTH = 0.32

/** What a particle is drawn as: a soft dot, a leaf, a petal. */
const DOT = 0
const LEAF = 1
const PETAL = 2

type Pool = { start: number; count: number; colours: string[]; size: number; fall: number; sway: number; shape: number }
const SNOW: Pool = { start: 0, count: 700, colours: ['#ffffff', '#f2f6fb'], size: 0.085, fall: 0.8, sway: 0.35, shape: DOT }
const LEAVES: Pool = { start: 700, count: 160, colours: ['#d9772b', '#c2542a', '#e2a33a', '#b8452a'], size: 0.2, fall: 1.0, sway: 0.9, shape: LEAF }
const PETALS: Pool = { start: 860, count: 90, colours: ['#f6c6d6', '#fbe3ea', '#f9d3df'], size: 0.15, fall: 0.6, sway: 0.7, shape: PETAL }
const WITHERED = { start: 950, count: 420, colours: ['#8a5a2b', '#a0702f', '#6e4a26', '#b08a45'], size: 0.22, shape: LEAF }
const POINTS = WITHERED.start + WITHERED.count
/** A withered leaf lies this long on the lawn before it fades. */
const LIE_SECONDS = 2.5

const POINT_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aShape;
attribute vec2 aTurn;
uniform float uHeight;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying vec2 vTurn;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Capped: a flake that drifts past the lens would otherwise fill a quarter
  // of the screen. Leaves get a larger cap — a shape needs pixels to read.
  gl_PointSize = min(aSize * projectionMatrix[1][1] * uHeight * 0.5 / -mv.z, uHeight * (aShape > 0.5 ? 0.03 : 0.012));
  vColor = aColor;
  vAlpha = aAlpha;
  vShape = aShape;
  vTurn = aTurn;
}
`
const POINT_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying vec2 vTurn;
void main() {
  if (vAlpha < 0.01) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  if (vShape < 0.5) {
    float d = dot(p, p);
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(1.0, 0.55, d));
    #include <colorspace_fragment>
    return;
  }
  // Leaves and petals turn in the plane (vTurn.x) and tumble: squeezed across
  // (vTurn.y) as if seen edge-on, so they flutter rather than slide.
  float c = cos(vTurn.x), s = sin(vTurn.x);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  q.x /= max(vTurn.y, 0.15);
  float ax = abs(q.x);
  vec3 col = vColor;
  float a;
  if (vShape < 1.5) {
    // A leaf: pointed oval from base (t = 0) to tip (t = 1), widest below the
    // middle, on a short stalk, with a midrib, side veins and a darker rim.
    float t = (q.y + 0.62) / 1.58;
    float w = 0.5 * pow(sin(3.14159 * clamp(t, 0.0, 1.0)), 0.8) * (1.0 - 0.3 * t);
    float blade = smoothstep(0.0, 0.06, w - ax) * step(0.0, t) * step(t, 1.0);
    float stalk = step(-0.96, q.y) * step(q.y, -0.6) * step(ax, 0.045);
    a = max(blade, stalk);
    if (a < 0.02) discard;
    col *= 0.78 + 0.34 * t;
    col *= 1.0 - 0.35 * smoothstep(0.045, 0.0, ax);
    float vein = abs(fract(t * 5.0 - ax * 2.5) - 0.5);
    col *= 1.0 - 0.15 * smoothstep(0.07, 0.0, vein) * step(0.05, ax);
    col *= 1.0 - 0.25 * smoothstep(w - 0.14, w, ax);
    if (blade < 0.5 && stalk > 0.5) col = vColor * 0.55;
  } else {
    // A petal: rounded, narrow at the base, notched at the tip, paler outward.
    float t = (q.y + 0.85) / 1.7;
    float w = 0.58 * pow(sin(3.14159 * clamp(t, 0.0, 1.0)), 0.55) * (0.55 + 0.45 * t);
    a = smoothstep(0.0, 0.06, w - ax) * step(0.0, t) * step(t, 1.0);
    if (t > 0.86 && ax < 0.14 * (t - 0.86) / 0.14) a = 0.0;
    if (a < 0.02) discard;
    col = mix(col * 0.9, vec3(1.0), 0.35 * t);
  }
  gl_FragColor = vec4(col, vAlpha * a);
  #include <colorspace_fragment>
}
`

export class SeasonFx {
  readonly group = new THREE.Group()
  /** Shared by every patched leaf material. */
  private readonly uniforms = { uSeasonColor: { value: new THREE.Color(1, 1, 1) }, uSeasonMix: { value: 0 } }
  private readonly patched = new WeakSet<THREE.Material>()
  private readonly lawnBase: THREE.Color
  private readonly fogBase = new THREE.Color(DAY.haze)
  private readonly horizonBase = new THREE.Color(DAY.horizon)

  private readonly rainLines: THREE.LineSegments
  private readonly rainPos: Float32Array
  private readonly rainMaterial: THREE.LineBasicMaterial
  private readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly alpha: Float32Array
  private readonly vel: Float32Array
  /** Withered leaves: seconds lying on the lawn, or −1 while falling, or −2 when free. */
  private readonly lying: Float32Array
  private readonly phase: Float32Array
  /** Per point: the angle it has turned to, and how open it is as it tumbles (1 face-on). */
  private readonly turn: Float32Array
  private readonly pointMaterial: THREE.ShaderMaterial
  private nextWithered = 0
  private time = 0
  private look: SeasonLook | null = null

  private readonly lights: { sun: THREE.DirectionalLight; sky: THREE.HemisphereLight }
  private readonly lawn: THREE.Mesh
  private readonly dome: THREE.Mesh
  private readonly fog: THREE.Fog

  constructor(lights: { sun: THREE.DirectionalLight; sky: THREE.HemisphereLight }, lawn: THREE.Mesh, dome: THREE.Mesh, fog: THREE.Fog) {
    this.lights = lights
    this.lawn = lawn
    this.dome = dome
    this.fog = fog
    this.lawnBase = (lawn.material as THREE.MeshStandardMaterial).color.clone()
    const r = () => Math.random()

    this.rainPos = new Float32Array(RAIN * 6)
    for (let i = 0; i < RAIN; i++) this.placeDrop(i, r() * TOP)
    const rainGeo = new THREE.BufferGeometry()
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3))
    rainGeo.setDrawRange(0, 0)
    this.rainMaterial = new THREE.LineBasicMaterial({ color: '#c9d6e4', transparent: true, opacity: 0.55, depthWrite: false })
    this.rainLines = new THREE.LineSegments(rainGeo, this.rainMaterial)
    this.rainLines.frustumCulled = false

    this.pos = new Float32Array(POINTS * 3)
    this.alpha = new Float32Array(POINTS)
    this.vel = new Float32Array(POINTS * 3)
    this.lying = new Float32Array(POINTS).fill(-2)
    this.phase = new Float32Array(POINTS)
    this.turn = new Float32Array(POINTS * 2).fill(1)
    const shape = new Float32Array(POINTS)
    const colour = new Float32Array(POINTS * 3)
    const size = new Float32Array(POINTS)
    const c = new THREE.Color()
    const fill = (start: number, count: number, colours: string[], s: number, kind: number) => {
      for (let i = start; i < start + count; i++) {
        shape[i] = kind
        c.set(colours[i % colours.length]).toArray(colour, i * 3)
        size[i] = s * (0.75 + 0.5 * r())
        this.phase[i] = r() * Math.PI * 2
        this.pos[i * 3] = (r() * 2 - 1) * SPAN
        this.pos[i * 3 + 1] = r() * TOP
        this.pos[i * 3 + 2] = (r() * 2 - 1) * SPAN
      }
    }
    for (const p of [SNOW, LEAVES, PETALS]) fill(p.start, p.count, p.colours, p.size, p.shape)
    fill(WITHERED.start, WITHERED.count, WITHERED.colours, WITHERED.size, WITHERED.shape)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(colour, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1))
    geo.setAttribute('aShape', new THREE.BufferAttribute(shape, 1))
    geo.setAttribute('aTurn', new THREE.BufferAttribute(this.turn, 2))
    this.pointMaterial = new THREE.ShaderMaterial({
      uniforms: { uHeight: { value: 800 } },
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
    })
    this.points = new THREE.Points(geo, this.pointMaterial)
    this.points.frustumCulled = false
    this.group.add(this.rainLines, this.points)
  }

  /**
   * Pulls a leaf material's colour toward the season's. Wraps whatever the
   * material already does to its shader (vegetation.ts ages leaves from a
   * young colour), applied after it, so a spring leaf is still young-green
   * first. The cache key changes too: three shares compiled programs by
   * key, and two leaf materials whose wrapped shaders differ must not share.
   */
  tint(materials: Iterable<THREE.Material | THREE.Material[]>) {
    for (const entry of materials) {
      for (const m of Array.isArray(entry) ? entry : [entry]) {
        if (this.patched.has(m)) continue
        this.patched.add(m)
        const inner = m.onBeforeCompile
        const key = m.customProgramCacheKey() + '|season'
        m.onBeforeCompile = (shader, renderer) => {
          inner.call(m, shader, renderer)
          Object.assign(shader.uniforms, this.uniforms)
          shader.fragmentShader = 'uniform vec3 uSeasonColor;\nuniform float uSeasonMix;\n' + shader.fragmentShader.replace(
            '#include <alphamap_fragment>',
            /* glsl */ `
            // The season's colour at the leaf's own brightness, so veins, young tips and shading survive.
            float seasonLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
            diffuseColor.rgb = mix(diffuseColor.rgb, uSeasonColor * (0.55 + 1.1 * seasonLum), uSeasonMix);
            #include <alphamap_fragment>
            `,
          )
        }
        m.customProgramCacheKey = () => key
        m.needsUpdate = true
      }
    }
  }

  /** Sets the look: the leaf tint, lawn, sky, fog and light. Cheap; call when it changes. */
  apply(look: SeasonLook) {
    this.look = look
    this.uniforms.uSeasonColor.value.copy(look.leaf)
    this.uniforms.uSeasonMix.value = look.leafMix
    ;(this.lawn.material as THREE.MeshStandardMaterial).color.copy(this.lawnBase).multiply(look.lawn)
    const sky = (this.dome.material as THREE.ShaderMaterial).uniforms
    sky.uZenith.value.copy(look.zenith)
    sky.uHorizon.value.copy(look.horizon)
    // The haze follows the horizon by the same ratio, so the far lawn fades into this season's sky.
    this.fog.color.copy(this.fogBase).multiply(look.horizon).multiply(new THREE.Color(1 / this.horizonBase.r, 1 / this.horizonBase.g, 1 / this.horizonBase.b))
    this.lights.sun.color.copy(look.sun)
    this.lights.sun.intensity = look.sunIntensity
    this.lights.sky.intensity = look.skyIntensity
  }

  /** Brown leaves dropping from these points (town units) — where plants just withered. */
  wither(points: [number, number, number][]) {
    // A cold snap can wither hundreds of cells in one stretch: a sample reads the same, without emptying the pool at once.
    const keep = Math.min(1, 30 / Math.max(1, points.length))
    for (const [x, y, z] of points) {
      if (Math.random() > keep) continue
      const i = WITHERED.start + this.nextWithered
      this.nextWithered = (this.nextWithered + 1) % WITHERED.count
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.3
      this.pos[i * 3 + 1] = y
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3
      this.vel[i * 3] = (Math.random() - 0.5) * 0.6
      this.vel[i * 3 + 1] = -(0.7 + Math.random() * 0.5)
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.6
      this.lying[i] = -1
      this.alpha[i] = 1
    }
  }

  /** Moves the weather on by `dt` seconds. */
  update(dt: number, heightPx: number) {
    const look = this.look
    if (!look) return
    dt = Math.min(dt, 0.1)
    this.time += dt
    this.pointMaterial.uniforms.uHeight.value = heightPx

    // Rain: straight down with a little slant, as many drops as it's wet.
    const drops = Math.round(RAIN * look.rain)
    for (let i = 0; i < drops; i++) {
      const o = i * 6
      const fall = RAIN_SPEED * dt
      this.rainPos[o + 1] -= fall
      this.rainPos[o + 4] -= fall
      this.rainPos[o] += fall * 0.08
      this.rainPos[o + 3] += fall * 0.08
      if (this.rainPos[o + 4] < 0) this.placeDrop(i, TOP)
    }
    this.rainLines.geometry.setDrawRange(0, drops * 2)
    this.rainLines.geometry.attributes.position.needsUpdate = true

    // Snow, leaves and petals drift down, swaying; each pool shows as many as its weather calls for, fading in and out.
    const levels: [Pool, number][] = [[SNOW, look.snow], [LEAVES, look.leaves], [PETALS, look.petals]]
    for (const [p, level] of levels) {
      const shown = p.count * level
      for (let k = 0; k < p.count; k++) {
        const i = p.start + k
        const target = k < shown ? 1 : 0
        this.alpha[i] += (target - this.alpha[i]) * Math.min(1, dt * 2)
        if (this.alpha[i] < 0.01 && target === 0) continue
        const ph = this.phase[i]
        this.pos[i * 3] += (Math.sin(this.time * 1.3 + ph) * p.sway + 0.25) * dt
        this.pos[i * 3 + 1] -= p.fall * (0.8 + 0.4 * Math.sin(ph * 3.7)) * dt
        this.pos[i * 3 + 2] += Math.cos(this.time * 1.1 + ph * 1.7) * p.sway * dt
        if (p.shape !== DOT) this.tumble(i)
        if (this.pos[i * 3 + 1] < 0 || this.pos[i * 3] > SPAN) {
          this.pos[i * 3] = (Math.random() * 2 - 1) * SPAN
          this.pos[i * 3 + 1] = TOP
          this.pos[i * 3 + 2] = (Math.random() * 2 - 1) * SPAN
        }
      }
    }

    // Withered leaves: fall from the wall, lie on the lawn a moment, fade.
    for (let i = WITHERED.start; i < WITHERED.start + WITHERED.count; i++) {
      const t = this.lying[i]
      if (t === -2) continue
      if (t >= 0) {
        this.lying[i] = t + dt
        this.alpha[i] = Math.max(0, 1 - Math.max(0, t - LIE_SECONDS))
        if (this.alpha[i] === 0) this.lying[i] = -2
        continue
      }
      const ph = this.phase[i]
      this.tumble(i)
      this.pos[i * 3] += (this.vel[i * 3] + Math.sin(this.time * 2.1 + ph) * 0.5) * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += (this.vel[i * 3 + 2] + Math.cos(this.time * 1.7 + ph) * 0.5) * dt
      if (this.pos[i * 3 + 1] <= 0.02) {
        this.pos[i * 3 + 1] = 0.02
        // Landed: it settles open, at whatever angle it came down.
        this.turn[i * 2 + 1] = 1
        this.lying[i] = 0
      }
    }
    const attrs = this.points.geometry.attributes
    attrs.position.needsUpdate = true
    attrs.aAlpha.needsUpdate = true
    attrs.aTurn.needsUpdate = true
  }

  /** A falling leaf or petal turns slowly and flips, each at its own rate. */
  private tumble(i: number) {
    const ph = this.phase[i]
    this.turn[i * 2] = ph + this.time * (0.6 + 0.8 * Math.sin(ph * 5.3))
    this.turn[i * 2 + 1] = 0.2 + 0.8 * Math.abs(Math.cos(this.time * (1.6 + Math.cos(ph * 2.9)) + ph))
  }

  private placeDrop(i: number, y: number) {
    const x = (Math.random() * 2 - 1) * SPAN
    const z = (Math.random() * 2 - 1) * SPAN
    const o = i * 6
    this.rainPos.set([x, y + RAIN_LENGTH, z, x + RAIN_LENGTH * 0.08, y, z], o)
  }

  dispose() {
    this.rainLines.geometry.dispose()
    this.rainMaterial.dispose()
    this.points.geometry.dispose()
    this.pointMaterial.dispose()
  }
}
