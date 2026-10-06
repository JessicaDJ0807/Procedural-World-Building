import * as THREE from 'three'
import { compositeLayers, fbmOctaves, type NoiseLayer } from '../noise'
import { erodeStep, getPreset } from '../erosion'

/**
 * The small terrain Topics 5 and 6 stand on.
 *
 * Both topics are about something *on* a terrain — where things grow, where a
 * line runs — so the ground itself has to be ordinary and fixed. It is Topic 2's
 * own machinery: a five-octave value-noise stack, carved by droplet erosion so
 * there are real valley floors and real valley walls for a rule to tell apart.
 * Raw fBm has neither; its slope histogram is one broad hump, and a slope rule
 * run over it selects a speckle rather than a landform.
 *
 * Everything a placement or path rule wants to ask about a point is computed
 * once here, per grid vertex, and read back bilinearly:
 *
 *     height     world units
 *     slope      degrees from horizontal
 *     waterDist  world units to the nearest flooded vertex (0 under water)
 *
 * The waterline is a quantile of the heights rather than a fixed number, so
 * every seed has the same share of its ground under water. A fixed level would
 * drown one seed and leave the next bone dry, and a rule that prefers "near
 * water" would mean something different on each.
 */
export type StudyTerrain = {
  seed: number
  /** Vertices per side. */
  res: number
  /** World units across. The terrain is centred on the origin. */
  size: number
  /** World units between neighbouring vertices. */
  cell: number
  height: Float32Array
  slope: Float32Array
  waterDist: Float32Array
  waterLevel: number
  minHeight: number
  maxHeight: number
  buildMs: number
}

export const STUDY_RES = 129
export const STUDY_SIZE = 10
export const STUDY_RELIEF = 1.8
/** Share of the ground below the waterline, for every seed. */
export const WATER_SHARE = 0.16

export function buildStudyTerrain(
  seed: number,
  { res = STUDY_RES, size = STUDY_SIZE, relief = STUDY_RELIEF } = {},
): StudyTerrain {
  const started = performance.now()
  const layers: NoiseLayer[] = fbmOctaves(5, 2, 0.5, res).map((octave, index) => ({
    id: `octave-${index}`,
    name: `Octave ${index + 1}`,
    enabled: true,
    frequency: octave.frequency,
    spread: 0.6,
    seed: seed * 31 + index + 1,
    shapingName: 'none',
    shapingParams: {},
    blendName: 'normal',
    opacity: octave.opacity,
  }))
  const base = compositeLayers(res, 2, layers)

  // Two droplets per vertex with the gentlest preset: enough to cut valley
  // floors a slope rule can find, without the gorges that would leave no flat
  // ground to plant on.
  const run = erodeStep(null, base, res, res * res * 2, seed, getPreset('valleys').params, {
    talus: 0.02,
    strength: 0.5,
    passes: 2,
  })

  let lo = Infinity
  let hi = -Infinity
  for (const v of run.height) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const span = Math.max(hi - lo, 1e-6)
  const height = new Float32Array(res * res)
  for (let i = 0; i < height.length; i++) height[i] = ((run.height[i] - lo) / span) * relief

  const cell = size / (res - 1)
  const sorted = Float32Array.from(height).sort()
  const waterLevel = sorted[Math.floor(sorted.length * WATER_SHARE)]

  return {
    seed,
    res,
    size,
    cell,
    height,
    slope: slopeField(height, res, cell),
    waterDist: distanceToWater(height, res, cell, waterLevel),
    waterLevel,
    minHeight: 0,
    maxHeight: relief,
    buildMs: performance.now() - started,
  }
}

/** Degrees from horizontal, by central differences (one-sided at the border). */
export function slopeField(height: Float32Array, res: number, cell: number): Float32Array {
  const out = new Float32Array(res * res)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const l = height[j * res + Math.max(i - 1, 0)]
      const r = height[j * res + Math.min(i + 1, res - 1)]
      const d = height[Math.max(j - 1, 0) * res + i]
      const u = height[Math.min(j + 1, res - 1) * res + i]
      const dx = (r - l) / (cell * (i === 0 || i === res - 1 ? 1 : 2))
      const dz = (u - d) / (cell * (j === 0 || j === res - 1 ? 1 : 2))
      out[j * res + i] = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
    }
  }
  return out
}

/**
 * Distance to the nearest flooded vertex, by a two-pass chamfer transform.
 *
 * 3–4 weights: straight steps cost 3, diagonals 4, then the total is divided
 * by 3. The largest error against true Euclidean distance is about 8%, on
 * lines at 22.5° — invisible in a falloff that is smooth anyway, and two linear
 * passes instead of a search per vertex.
 */
export function distanceToWater(
  height: Float32Array,
  res: number,
  cell: number,
  level: number,
): Float32Array {
  const big = 1e9
  const d = new Float32Array(res * res)
  for (let i = 0; i < d.length; i++) d[i] = height[i] < level ? 0 : big
  const relax = (i: number, j: number, di: number, dj: number, w: number) => {
    const ni = i + di
    const nj = j + dj
    if (ni < 0 || nj < 0 || ni >= res || nj >= res) return
    const k = j * res + i
    const candidate = d[nj * res + ni] + w
    if (candidate < d[k]) d[k] = candidate
  }
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      relax(i, j, -1, 0, 3); relax(i, j, 0, -1, 3); relax(i, j, -1, -1, 4); relax(i, j, 1, -1, 4)
    }
  }
  for (let j = res - 1; j >= 0; j--) {
    for (let i = res - 1; i >= 0; i--) {
      relax(i, j, 1, 0, 3); relax(i, j, 0, 1, 3); relax(i, j, 1, 1, 4); relax(i, j, -1, 1, 4)
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = (d[i] / 3) * cell
  return d
}

/** World position to fractional grid coordinates. */
export function toGrid(t: { res: number; size: number }, x: number, z: number): [number, number] {
  const scale = (t.res - 1) / t.size
  return [(x + t.size / 2) * scale, (z + t.size / 2) * scale]
}

/** Bilinear read of any per-vertex field, clamped at the border. */
export function sampleField(
  t: { res: number; size: number },
  field: Float32Array,
  x: number,
  z: number,
): number {
  const [gx, gz] = toGrid(t, x, z)
  const max = t.res - 1
  const cx = Math.min(Math.max(gx, 0), max)
  const cz = Math.min(Math.max(gz, 0), max)
  const i0 = Math.min(Math.floor(cx), max - 1)
  const j0 = Math.min(Math.floor(cz), max - 1)
  const fx = cx - i0
  const fz = cz - j0
  const a = field[j0 * t.res + i0]
  const b = field[j0 * t.res + i0 + 1]
  const c = field[(j0 + 1) * t.res + i0]
  const d = field[(j0 + 1) * t.res + i0 + 1]
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz
}

/** Unit surface normal from the height field, by central differences. */
export function normalAt(
  t: { res: number; size: number; cell: number },
  height: Float32Array,
  x: number,
  z: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const e = t.cell
  const dx = sampleField(t, height, x + e, z) - sampleField(t, height, x - e, z)
  const dz = sampleField(t, height, x, z + e) - sampleField(t, height, x, z - e)
  return out.set(-dx, 2 * e, -dz).normalize()
}

/**
 * The terrain as an indexed grid with a colour attribute.
 *
 * Vertex (i, j) is grid sample (i, j), so a per-vertex field and a per-vertex
 * colour line up one-to-one — recolouring for a debug view is a loop over the
 * colour buffer, with no resampling.
 */
export function terrainGeometry(t: { res: number; size: number }, height: Float32Array): THREE.BufferGeometry {
  const { res, size } = t
  const positions = new Float32Array(res * res * 3)
  const colours = new Float32Array(res * res * 3)
  const step = size / (res - 1)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i
      positions[k * 3] = -size / 2 + i * step
      positions[k * 3 + 1] = height[k]
      positions[k * 3 + 2] = -size / 2 + j * step
    }
  }
  const index: number[] = []
  for (let j = 0; j < res - 1; j++) {
    for (let i = 0; i < res - 1; i++) {
      const a = j * res + i
      const b = a + 1
      const c = a + res
      const d = c + 1
      index.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** Writes new heights into an existing terrain geometry, in place. */
export function updateTerrainHeights(geometry: THREE.BufferGeometry, height: Float32Array) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let k = 0; k < height.length; k++) position.setY(k, height[k])
  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
}

const tmp = new THREE.Color()

/**
 * The plain ground colour both studies use when nothing is being debugged.
 *
 * Deliberately quiet — sand at the waterline, sage on the flats, clay and then
 * stone as it steepens and rises — because on these pages the ground is the
 * stage, not the subject. Written as linear values, which is what a colour
 * attribute is read as.
 */
export function groundColour(elevation: number, slope: number, out: THREE.Color): THREE.Color {
  const shore = THREE.MathUtils.smoothstep(elevation, 0, 0.05)
  out.setHex(0xb8a98a).lerp(tmp.setHex(0x7b8a6c), shore)
  out.lerp(tmp.setHex(0x8f8a70), THREE.MathUtils.smoothstep(elevation, 0.35, 0.7))
  out.lerp(tmp.setHex(0x8a7b6c), THREE.MathUtils.smoothstep(slope, 22, 38))
  out.lerp(tmp.setHex(0xa8a39b), THREE.MathUtils.smoothstep(elevation, 0.72, 0.95))
  return out
}

/** Normalised elevation above the waterline: 0 at the shore, 1 at the summit. */
export function elevationAbove(t: StudyTerrain, h: number): number {
  return (h - t.waterLevel) / Math.max(t.maxHeight - t.waterLevel, 1e-6)
}

/** A slate water plane at the waterline. */
export function waterPlane(t: StudyTerrain): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(t.size, t.size),
    new THREE.MeshStandardMaterial({
      color: 0x5f7488,
      roughness: 0.35,
      metalness: 0,
      transparent: true,
      opacity: 0.82,
    }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = t.waterLevel
  return mesh
}

/**
 * Lights shared by the two terrain studies: a low warm key, a cool sky fill.
 * Low enough that slope reads from shading alone — which matters on a page
 * whose rules are about slope.
 */
export function studyLights(scene: THREE.Scene) {
  const key = new THREE.DirectionalLight(0xf2e2c8, 2.1)
  key.position.set(-6, 7, 4)
  scene.add(key)
  scene.add(new THREE.HemisphereLight(0xa9b8cc, 0x4a4438, 0.9))
}
