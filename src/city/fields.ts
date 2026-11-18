import { valueNoise } from '../hashNoise'
import type { Vec } from './geometry'
import type { Ground } from './ground'

/**
 * Zoning maps: continuous scalar fields over the site, each in [0, 1].
 *
 * Three come from the ground and the plan, and two are built from them:
 *
 *   elevation   height above the waterline, normalised
 *   moisture    near water, low ground, plus noise
 *   distance    from the city centre, normalised to the site's half-width
 *   density     how built-up a place wants to be: high near the centre and on
 *               flat ground, falling off with distance, plus noise
 *   vegetation  how green: wet ground and low density, plus noise
 *
 * Every formula is a weighted sum a reader can check against the heatmap.
 * The noise is the only term with no physical meaning: it stands in for
 * everything a real plan would know and this one does not — land values,
 * history, a park someone fought for — and its intensity slider is how much
 * of that unexplained variation the maps carry.
 *
 * Fields are computed once on a grid and read back bilinearly, so a plot's
 * value is the same whichever experiment asks for it.
 */
export type FieldName = 'density' | 'vegetation' | 'moisture' | 'elevation' | 'distance'

export const FIELD_NAMES: FieldName[] = ['density', 'vegetation', 'moisture', 'elevation', 'distance']

export type FieldParams = {
  /** Wavelength of the noise in world units. */
  noiseScale: number
  /** 0–1: weight of the noise in density, vegetation and moisture. */
  noiseIntensity: number
  /** World units over which density falls from the centre to nothing. */
  reach: number
  seed: number
}

export type FieldSample = Record<FieldName, number>

export type Fields = {
  res: number
  half: number
  maps: Record<FieldName, Float32Array>
  ms: number
}

const RES = 128

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Three octaves of value noise, centred on zero, roughly in ±0.5. */
function fbm(x: number, z: number, scale: number, seed: number): number {
  let sum = 0
  let amp = 0.5
  let freq = 1 / scale
  for (let o = 0; o < 3; o++) {
    sum += (valueNoise(x * freq, z * freq, seed + o * 101) - 0.5) * amp
    amp *= 0.5
    freq *= 2
  }
  return sum / 0.875
}

export function buildFields(ground: Ground, centre: Vec, params: FieldParams): Fields {
  const started = performance.now()
  const half = ground.half
  const n = RES * RES
  const maps = {
    density: new Float32Array(n),
    vegetation: new Float32Array(n),
    moisture: new Float32Array(n),
    elevation: new Float32Array(n),
    distance: new Float32Array(n),
  } satisfies Record<FieldName, Float32Array>
  const k = params.noiseIntensity
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const x = -half + ((i + 0.5) / RES) * half * 2
      const z = -half + ((j + 0.5) / RES) * half * 2
      const idx = j * RES + i
      const elevation = ground.elevation(x, z)
      const land = ground.isLand(x, z)
      const near = Math.exp(-ground.waterDistance(x, z) / 18)
      const dist = Math.hypot(x - centre.x, z - centre.z)
      const moisture = clamp01(0.6 * near + 0.4 * (1 - elevation) + k * fbm(x, z, params.noiseScale, params.seed + 3))
      const flat = clamp01(1 - ground.slope(x, z) / 18)
      // A smooth bell around the centre: 1 there, half at reach/2, 0 at reach.
      const central = clamp01(1 - dist / params.reach)
      const bell = central * central * (3 - 2 * central)
      const density = land ? clamp01(bell * (0.4 + 0.6 * flat) + k * 0.9 * fbm(x, z, params.noiseScale, params.seed + 7)) : 0
      const vegetation = clamp01(0.55 * moisture + 0.45 * (1 - density) + k * 0.7 * fbm(x, z, params.noiseScale * 0.6, params.seed + 11) - 0.15)
      maps.elevation[idx] = elevation
      maps.moisture[idx] = moisture
      maps.distance[idx] = clamp01(dist / half)
      maps.density[idx] = density
      maps.vegetation[idx] = land ? vegetation : 0
    }
  }
  return { res: RES, half, maps, ms: performance.now() - started }
}

export function sampleMap(f: Fields, map: Float32Array, x: number, z: number): number {
  const gx = ((x + f.half) / (f.half * 2)) * f.res - 0.5
  const gz = ((z + f.half) / (f.half * 2)) * f.res - 0.5
  const cx = Math.min(Math.max(gx, 0), f.res - 1.001)
  const cz = Math.min(Math.max(gz, 0), f.res - 1.001)
  const i = Math.floor(cx)
  const j = Math.floor(cz)
  const fx = cx - i
  const fz = cz - j
  const r = f.res
  const a = map[j * r + i]
  const b = map[j * r + i + 1]
  const c = map[(j + 1) * r + i]
  const d = map[(j + 1) * r + i + 1]
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz
}

export function sampleAll(f: Fields, x: number, z: number): FieldSample {
  return {
    density: sampleMap(f, f.maps.density, x, z),
    vegetation: sampleMap(f, f.maps.vegetation, x, z),
    moisture: sampleMap(f, f.maps.moisture, x, z),
    elevation: sampleMap(f, f.maps.elevation, x, z),
    distance: sampleMap(f, f.maps.distance, x, z),
  }
}
