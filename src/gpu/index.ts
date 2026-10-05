import { createBoids } from './boids'
import { createShading } from './shading'
import { createErosion } from './erosion'
import { createReactionDiffusion } from './reactionDiffusion'
import { createRipples } from './ripples'
import type { Simulation } from './simulation'

/**
 * The strategies the page swaps between.
 *
 * Each entry is a factory rather than an instance: a simulation owns GPU
 * resources from the moment it is built, and holding four live at once would
 * mean four sets of float render targets for three views nobody is looking at.
 */
export type SimulationGroup = 'Shading' | 'Simulation'

export type SimulationMeta = {
  id: string
  group: SimulationGroup
  label: string
  blurb: string
  params: Simulation['params']
  presets: Simulation['presets']
  /** False for a study with no state to advance, so the page can say so. */
  accumulates: boolean
  create: () => Simulation
}

/**
 * Reads a simulation's parameters without starting it.
 *
 * A factory allocates nothing until `init` runs, so this probe is inert — it
 * exists so the sidebar can describe a strategy that is not the running one.
 */
function describe(group: SimulationGroup, create: () => Simulation): SimulationMeta {
  const probe = create()
  return {
    id: probe.id,
    group,
    label: probe.label,
    blurb: probe.blurb,
    params: probe.params,
    presets: probe.presets,
    accumulates: probe.accumulates ?? true,
    create,
  }
}

export const SIMULATIONS: SimulationMeta[] = [
  // Shading first: it is the study the page is named for, and the one that
  // holds its geometry still so the strategies can be compared.
  describe('Shading', createShading),
  describe('Simulation', createRipples),
  describe('Simulation', createReactionDiffusion),
  describe('Simulation', createErosion),
  describe('Simulation', createBoids),
]

export const GROUPS: SimulationGroup[] = ['Shading', 'Simulation']

export function getSimulation(id: string): SimulationMeta {
  return SIMULATIONS.find((option) => option.id === id) ?? SIMULATIONS[0]
}

export function createSimulation(id: string): Simulation {
  return getSimulation(id).create()
}
