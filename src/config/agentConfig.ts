import { PLACED_RADIUS, WORLD_H, WORLD_W, type Circle } from '../agents/environment'
import { PRESETS, type PresetId } from '../agents/presets'
import { MAX_AGENTS, halfLife, type AgentParams } from '../agents/simulation'
import { bool, int, isRecord, num, params as parseParams, pick, type ConfigSpec } from './spec'

/**
 * What a Topic 9 world stores: the seed, the five parameters, and the blocks
 * placed by hand. Not the agents and not the trail.
 *
 * The run is deterministic — a fixed 1/30 s step and one seeded stream — so
 * seed, parameters and blocks rebuild the same colony from the same start,
 * step for step. What cannot be rebuilt is a run that was steered while it
 * played: parameters changed at 40 s, a block placed at 90 s. Storing that
 * would mean storing ~16,000 trail values and every agent's dozen fields, and
 * the world would then be a recording rather than an experiment. A loaded
 * world starts from its beginning.
 */
export type AgentSettings = AgentParams & {
  preset: PresetId | 'custom'
  seed: number
  /** Blocks placed by clicking, in world units. Part of the world, so stored. */
  placed: Circle[]
  showTrails: boolean
  showSenses: boolean
}

export type AgentSpec = {
  key: keyof AgentParams
  label: string
  info: string
  min: number
  max: number
  step: number
  value: number
  format?: (v: number) => string
}

const collective = PRESETS.find((p) => p.id === 'collective')!.params

export const MAX_PLACED = 24

export const AGENT_SPECS: AgentSpec[] = [
  { key: 'agents', label: 'Agents', info: 'How many agents walk the world. They start spread over the three destinations and leave over the first three seconds rather than in one wave. Changing it mid-run adds agents at a destination or removes the newest.', min: 10, max: MAX_AGENTS, step: 10, value: 160, format: (v) => v.toFixed(0) },
  { key: 'influence', label: 'Trail influence', info: 'How much a worn path pulls, against the compass\'s pull of 1 toward the goal. At 0 trails are still laid and drawn, but nobody reads them. Above 1, a strong trail at right angles to the goal can outscore walking straight at it.', min: 0, max: 4, step: 0.1, value: collective.influence, format: (v) => v.toFixed(1) },
  { key: 'evaporation', label: 'Trail evaporation', info: 'Fraction of the trail lost per second, as exp(−rate·t). Low rates make a long memory: old routes stay attractive after they stop being useful. High rates forget quickly, so only routes in constant use survive.', min: 0.01, max: 0.3, step: 0.005, value: collective.evaporation, format: (v) => `${v.toFixed(3)}/s · ½ in ${halfLife(v).toFixed(0)} s` },
  { key: 'exploration', label: 'Exploration', info: 'How often an agent picks a heading that scored worse than the best. It sets the temperature of the choice — 0 always takes the best heading — and the rate at which an agent on a trail leaves it for a short detour.', min: 0, max: 1, step: 0.05, value: collective.exploration, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'speed', label: 'Agent speed', info: 'Walking speed in world units per second; the world is 160 × 100. Each agent walks at 0.8–1.2× this. Trail is laid per unit walked, not per second, so speed changes how fast things happen but not how much trail a route gets.', min: 4, max: 30, step: 1, value: 12, format: (v) => `${v.toFixed(0)} u/s` },
]

export function defaultAgentSettings(): AgentSettings {
  const numbers = Object.fromEntries(AGENT_SPECS.map((s) => [s.key, s.value])) as AgentParams
  return { ...numbers, preset: 'collective', seed: 1, placed: [], showTrails: true, showSenses: true }
}

function parsePlaced(raw: unknown): Circle[] {
  if (!Array.isArray(raw)) return []
  const out: Circle[] = []
  for (const c of raw.slice(0, MAX_PLACED)) {
    if (!isRecord(c)) continue
    out.push({ x: num(c.x, 0, WORLD_W, WORLD_W / 2), y: num(c.y, 0, WORLD_H, WORLD_H / 2), r: PLACED_RADIUS })
  }
  return out
}

function parse(raw: unknown): { settings: AgentSettings; repairs: string[] } {
  const d = defaultAgentSettings()
  if (!isRecord(raw)) return { settings: d, repairs: ['the document had no settings; defaults were used'] }
  const numbers = parseParams(raw, AGENT_SPECS.map((s) => ({ key: s.key, min: s.min, max: s.max, defaultValue: s.value }))) as AgentParams
  return {
    settings: {
      ...numbers,
      preset: pick(raw.preset, ['independent', 'collective', 'adaptive', 'custom'] as const, 'custom'),
      seed: int(raw.seed, 1, 999, d.seed),
      placed: parsePlaced(raw.placed),
      showTrails: bool(raw.showTrails, d.showTrails),
      showSenses: bool(raw.showSenses, d.showSenses),
    },
    repairs: [],
  }
}

export const agentSpec: ConfigSpec<AgentSettings> = {
  topic: 'agents',
  schemaVersion: 1,
  defaults: defaultAgentSettings,
  parse,
  summary: (s) => {
    const preset = PRESETS.find((p) => p.id === s.preset)
    const blocks = s.placed.length ? ` · ${s.placed.length} block${s.placed.length === 1 ? '' : 's'}` : ''
    return `${preset ? preset.short : 'Custom'} · ${s.agents} agents · seed ${s.seed}${blocks}`
  },
}
