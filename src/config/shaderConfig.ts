import { SIMULATIONS, getSimulation } from '../gpu'
import { defaults } from '../gpu/simulation'
import { bool, isRecord, params as parseParams, pick, type ConfigSpec } from './spec'

export type ShaderSettings = {
  simulationId: string
  /** Every simulation's tuning, so switching away and back keeps it. */
  allParams: Record<string, Record<string, number>>
  presetName: Record<string, string>
  running: boolean
}

const SIM_IDS = SIMULATIONS.map((s) => s.id)

function allDefaults(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const sim of SIMULATIONS) out[sim.id] = defaults(sim.params)
  return out
}

export function defaultShaderSettings(): ShaderSettings {
  return {
    simulationId: SIMULATIONS[0].id,
    allParams: allDefaults(),
    presetName: {},
    // Paused on arrival. A simulation that is already running when the page
    // opens has started without being asked, and the first thing you see is a
    // state several hundred steps from its initial condition.
    running: false,
  }
}

function parse(raw: unknown): { settings: ShaderSettings; repairs: string[] } {
  const repairs: string[] = []
  const d = defaultShaderSettings()
  if (!isRecord(raw)) {
    return { settings: d, repairs: ['the document had no settings; defaults were used'] }
  }

  const simulationId = pick(raw.simulationId, SIM_IDS, d.simulationId)
  if (raw.simulationId !== undefined && simulationId !== raw.simulationId) {
    repairs.push('unknown simulation, reset to the first one')
  }

  // Rebuilt from each simulation's own parameter list rather than trusted, so a
  // renamed or removed parameter cannot survive in a stored document. ParamSpec
  // calls its default `value`.
  const storedParams = isRecord(raw.allParams) ? raw.allParams : {}
  const allParams: Record<string, Record<string, number>> = {}
  for (const sim of SIMULATIONS) {
    allParams[sim.id] = parseParams(
      storedParams[sim.id],
      sim.params.map((p) => ({ key: p.key, min: p.min, max: p.max, defaultValue: p.value })),
    )
  }

  const storedPresets = isRecord(raw.presetName) ? raw.presetName : {}
  const presetName: Record<string, string> = {}
  for (const sim of SIMULATIONS) {
    const value = storedPresets[sim.id]
    if (typeof value === 'string' && sim.presets.some((p) => p.value === value)) {
      presetName[sim.id] = value
    }
  }

  return {
    settings: { simulationId, allParams, presetName, running: bool(raw.running, d.running) },
    repairs,
  }
}

export const shaderSpec: ConfigSpec<ShaderSettings> = {
  topic: 'shaders',
  schemaVersion: 1,
  defaults: defaultShaderSettings,
  parse,
  summary: (s) => {
    const meta = getSimulation(s.simulationId)
    const preset = meta.presets.find((p) => p.value === s.presetName[s.simulationId])
    return preset ? `${meta.label} · ${preset.label}` : meta.label
  },
}
