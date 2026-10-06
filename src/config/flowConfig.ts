import { generateVortices, type Vortex } from '../flow/field'
import { MAX_PARTICLES } from '../flow/particles'
import { bool, int, isRecord, num, params as parseParams, type ConfigSpec } from './spec'

export type FlowNumbers = {
  particles: number
  speed: number
  current: number
  vortexCount: number
  vortexStrength: number
  vortexRadius: number
  noise: number
  persistence: number
}

export type FlowSettings = FlowNumbers & {
  seed: number
  showField: boolean
  showHandles: boolean
  /** Positions are stored, not regenerated, because a dragged vortex is part of the world. */
  vortices: Vortex[]
}

export type FlowSpec = {
  key: keyof FlowNumbers
  label: string
  info: string
  min: number
  max: number
  step: number
  value: number
  format?: (v: number) => string
}

export const FLOW_SPECS: FlowSpec[] = [
  { key: 'particles', label: 'Particles', info: 'How many particles sample the field. Each costs two field evaluations a frame (the midpoint method) and one line segment. The structure is the field\'s at any count; more particles only resolve it more finely.', min: 2000, max: MAX_PARTICLES, step: 1000, value: 18000, format: (v) => v.toLocaleString() },
  { key: 'speed', label: 'Flow speed', info: 'Multiplies the time step. The field is unchanged — everything moves along the same paths, faster or slower.', min: 0.1, max: 3, step: 0.05, value: 1, format: (v) => `${v.toFixed(2)}×` },
  { key: 'current', label: 'Base current', info: 'Speed of the uniform left-to-right flow, in half-viewport-heights per second. At zero the vortices are left spinning in still water, each a closed eddy.', min: 0, max: 1, step: 0.01, value: 0.3 },
  { key: 'vortexCount', label: 'Vortices', info: 'How many vortices the seed places. Spin directions alternate and are then shuffled, because an all-one-way set sums to a single gyre that hides the individual ones.', min: 0, max: 12, step: 1, value: 6, format: (v) => v.toFixed(0) },
  { key: 'vortexStrength', label: 'Vortex strength', info: 'Peak tangential speed at each vortex\'s radius. Compare it with the base current: weaker and the current only bends; stronger and the vortex captures fluid in a closed eddy that the current flows around.', min: 0, max: 3, step: 0.05, value: 0.9 },
  { key: 'vortexRadius', label: 'Vortex radius', info: 'Radius of peak speed, in half-viewport-heights. Inside it the vortex turns like a solid disc; outside, its influence falls away as a Gaussian rather than as 1/r, so a vortex never reaches across the whole frame.', min: 0.05, max: 0.6, step: 0.01, value: 0.2 },
  { key: 'noise', label: 'Noise strength', info: 'Peak speed of the curl-noise turbulence. Curl noise is the rotated gradient of a smooth noise, so it stirs without creating sources or sinks; it also drifts slowly, which keeps a steady field from looking frozen.', min: 0, max: 0.6, step: 0.01, value: 0.08 },
  { key: 'persistence', label: 'Trail persistence', info: 'How much of last frame\'s image survives into this one, per sixtieth of a second — corrected for the actual frame time, so trails are the same length at any frame rate. High values draw long streamlines; low values show only the latest motion.', min: 0.5, max: 0.995, step: 0.005, value: 0.92, format: (v) => v.toFixed(3) },
]

export function defaultFlowSettings(): FlowSettings {
  const numbers = Object.fromEntries(FLOW_SPECS.map((s) => [s.key, s.value])) as FlowNumbers
  return {
    ...numbers,
    seed: 4,
    showField: false,
    showHandles: true,
    vortices: generateVortices(4, numbers.vortexCount),
  }
}

function parseVortices(raw: unknown, fallback: Vortex[]): Vortex[] {
  if (!Array.isArray(raw) || raw.length > 12) return fallback
  const out: Vortex[] = []
  for (const v of raw) {
    if (!isRecord(v)) return fallback
    out.push({
      u: num(v.u, 0, 1, 0.5),
      v: num(v.v, 0, 1, 0.5),
      spin: num(v.spin, -1, 1, 1) < 0 ? -1 : 1,
      strength: num(v.strength, 0.1, 3, 1),
      radius: num(v.radius, 0.1, 3, 1),
    })
  }
  return out
}

function parse(raw: unknown): { settings: FlowSettings; repairs: string[] } {
  const d = defaultFlowSettings()
  if (!isRecord(raw)) return { settings: d, repairs: ['the document had no settings; defaults were used'] }
  const numbers = parseParams(raw, FLOW_SPECS.map((s) => ({ key: s.key, min: s.min, max: s.max, defaultValue: s.value }))) as FlowNumbers
  return {
    settings: {
      ...numbers,
      seed: int(raw.seed, 1, 999, d.seed),
      showField: bool(raw.showField, d.showField),
      showHandles: bool(raw.showHandles, d.showHandles),
      vortices: parseVortices(raw.vortices, generateVortices(int(raw.seed, 1, 999, d.seed), numbers.vortexCount)),
    },
    repairs: [],
  }
}

export const flowSpec: ConfigSpec<FlowSettings> = {
  topic: 'flow',
  schemaVersion: 1,
  defaults: defaultFlowSettings,
  parse,
  summary: (s) => `${s.vortices.length} vortices · current ${s.current.toFixed(2)} · ${s.particles.toLocaleString()} particles`,
}
