import type { BuildGame } from '../build/game'
import { Town } from '../build/town'
import { RECIPES, recipeGame, type Recipe } from '../architecture/specimens'
import { navFromGame, type NavGraph } from './nav'
import { rehome, seeded, spawn, step, type Inhabitant } from './agent'

/**
 * The Inhabitants studio's test scenes: each a real Build game, set up from
 * a recipe in the same form as the Architecture page's — two of them its
 * bridge recipes — and grown, then walked by the same agents and navigation
 * as Play. Nothing is scripted: whether an inhabitant can cross is whether
 * the graph joins the two sides.
 *
 * A scenario's game is its own, made fresh on every reset, and never saved:
 * nothing done here reaches a player's worlds.
 */

export type Scenario = {
  id: string
  name: string
  /** What it tests, in a line. */
  blurb: string
  recipe: Recipe
  /** Grown this far before the inhabitants arrive. */
  growTo: number
  /** If the growth runs on while playing: steps a second, and where it stops. */
  growth?: { rate: number; until: number }
  /** Where the inhabitants start: the block (x, z) of the building each stands on; null for the biggest region. */
  starts: ([number, number] | null)[]
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'explore',
    name: 'Exploring',
    blurb: 'One building, grown over. Two inhabitants wander their region, stop, and wander again.',
    recipe: { kind: 'balcony', label: 'Explore', columns: [[6, 6, 4]], plant: [[6, 6, 0, 1]], seed: 5, rain: 0.55 },
    growTo: 900,
    starts: [[6, 6], [6, 6]],
  },
  {
    id: 'apart',
    name: 'No way across',
    blurb: 'Two buildings, each grown over by Climbers alone — no meeting, so no structure. Send one across: there is no route.',
    recipe: { kind: 'bridge', label: 'Apart', columns: [[4, 6, 3], [8, 6, 3]], plant: [[4, 6, 1, 0], [8, 6, -1, 0]], sow: [0, 0, 0, 0], seed: 1, rain: 0.55 },
    growTo: 700,
    starts: [[4, 6], [8, 6]],
  },
  {
    id: 'bridged',
    name: 'Joined by a bridge',
    blurb: 'The Architecture page’s three-column bridge, grown to maturity. Its deck is walkable: they can cross.',
    recipe: RECIPES.bridge[1],
    growTo: 520,
    starts: [[4, 6], [4, 6]],
  },
  {
    id: 'forming',
    name: 'A bridge forms',
    blurb: 'The two-column bridge from before it forms. Play: it grows, matures at step 360, and joins their region — watch them discover it.',
    recipe: RECIPES.bridge[0],
    growTo: 40,
    growth: { rate: 15, until: 520 },
    starts: [null, null],
  },
]

/** How often the graph is rebuilt while growth runs, seconds. */
const REBUILD_SECONDS = 0.25

/** One scenario, running: its game, its graph, its inhabitants. */
export class StudioSim {
  readonly scenario: Scenario
  game: BuildGame
  nav: NavGraph
  agents: Inhabitant[] = []
  rebuilds = 1
  private pendingSteps = 0
  private sinceRebuild = 0
  private navStep: number

  constructor(scenario: Scenario) {
    this.scenario = scenario
    this.game = recipeGame(scenario.recipe)
    this.game.advance(scenario.growTo)
    this.nav = navFromGame(this.game)
    this.navStep = this.game.sim.step
    const masses = this.game.town.masses()
    const rng = seeded(scenario.growTo * 31 + scenario.starts.length)
    scenario.starts.forEach((at, k) => {
      const cell = this.startCell(at ? masses[Town.index(at[0], 0, at[1])] : -1, rng)
      if (cell >= 0) this.agents.push(spawn(k + 1, this.nav, cell, 1000 + k * 97))
    })
  }

  /** A random walkable cell on a building (or anywhere, for −1), in the biggest region there. */
  private startCell(mass: number, rng: () => number): number {
    const nav = this.nav
    const count = new Map<number, number>()
    for (let i = 0; i < nav.region.length; i++) {
      if (nav.region[i] < 0 || (mass >= 0 && nav.placeOf(i).mass !== mass)) continue
      count.set(nav.region[i], (count.get(nav.region[i]) ?? 0) + 1)
    }
    const best = [...count].sort((a, b) => b[1] - a[1])[0]
    if (!best) return -1
    const cells: number[] = []
    for (let i = 0; i < nav.region.length; i++) if (nav.region[i] === best[0] && (mass < 0 || nav.placeOf(i).mass === mass)) cells.push(i)
    return cells[Math.floor(rng() * cells.length)]
  }

  get growing(): boolean {
    const g = this.scenario.growth
    return !!g && this.game.sim.step < g.until
  }

  /** Advances by `dt` seconds: the growth, if this scenario grows; the graph, when the world changed; the inhabitants. */
  update(dt: number) {
    const g = this.scenario.growth
    if (g && this.game.sim.step < g.until) {
      this.pendingSteps += dt * g.rate
      const n = Math.min(Math.floor(this.pendingSteps), g.until - this.game.sim.step)
      if (n > 0) {
        this.game.advance(n)
        this.pendingSteps -= n
      }
    }
    this.sinceRebuild += dt
    const changed = this.nav.building !== this.game.building || this.game.sim.step !== this.navStep
    if (changed && this.sinceRebuild >= REBUILD_SECONDS) {
      const rebuilt = this.nav.building !== this.game.building
      this.nav = navFromGame(this.game)
      this.navStep = this.game.sim.step
      this.sinceRebuild = 0
      this.rebuilds++
      for (const a of this.agents) if (rebuilt || a.cell < 0 || !this.nav.walkable[a.cell] || (a.next >= 0 && !this.nav.walkable[a.next])) rehome(a, this.nav)
    }
    for (const a of this.agents) step(a, this.nav, dt)
  }
}
