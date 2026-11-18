import type { AgentParams } from './simulation'

export type PresetId = 'independent' | 'collective' | 'adaptive'

/**
 * Three settings of the same three numbers. A preset changes parameters and
 * nothing else — not the world, not the agents, not the code path — so
 * switching one mid-run shows the same colony responding to a new rule.
 *
 * Agent count and speed are left alone on purpose: they change how fast
 * things happen, not what happens, and holding them fixed is what makes two
 * presets comparable.
 *
 * Measured over seeds 1–5, 160 agents at 12 units/s, after 180 s
 * (docs/topics/topic-9-agent-systems.md has the table):
 * - Independent: routes 33–38% longer than the shortest walkable ones.
 * - Collective: 7.5–17% longer, with 72–100% of wall crossings through one gap.
 * - Rapid Adaptation: the same trust in trails, forgotten 2.5× faster; 11–28%
 *   longer, and the least time lost in a dead end when a gap is closed.
 */
export const PRESETS: {
  id: PresetId
  label: string
  short: string
  blurb: string
  params: Pick<AgentParams, 'influence' | 'evaporation' | 'exploration'>
}[] = [
  {
    id: 'independent',
    label: 'Independent Exploration',
    short: 'Independent',
    blurb: 'Trails are laid but nobody reads them. Each agent walks by compass and wall alone — the baseline.',
    params: { influence: 0, evaporation: 0.06, exploration: 0.35 },
  },
  {
    id: 'collective',
    label: 'Collective Trails',
    short: 'Collective',
    blurb: 'Agents prefer worn ground and rarely stray. Routes merge into a few shared paths that nobody chose.',
    params: { influence: 2.5, evaporation: 0.06, exploration: 0.1 },
  },
  {
    id: 'adaptive',
    label: 'Rapid Adaptation',
    short: 'Adaptive',
    blurb: 'The same trust in trails, but they fade 2.5× faster and agents stray more. Block a gap and watch the network move.',
    params: { influence: 2.5, evaporation: 0.15, exploration: 0.35 },
  },
]
