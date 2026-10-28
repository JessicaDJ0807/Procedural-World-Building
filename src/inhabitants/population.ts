import type { BuildGame } from '../build/game'
import { navFromGame, type NavGraph } from './nav'
import { rehome, spawn, step, type Inhabitant } from './agent'

/**
 * The inhabitants of a game: Play's and the Lab's. Reads the game; never
 * writes to it, and isn't saved with it.
 *
 * - **The graph follows the world.** It is rebuilt when the building is
 *   (an edit, a structure maturing) and as growth spreads or withers — every
 *   10 growth steps, at most twice a second. Building one takes 1–2 ms on a
 *   small town.
 * - **They arrive with the green.** One inhabitant for every 120 walkable
 *   cells, up to six, each on a random cell of a region of at least 30 cells,
 *   the emptiest such region first. None ever leave — a stranded one waits.
 * - **A new world, new inhabitants.** Restart, New world and loading a world
 *   replace the world (`game.epoch`), and the inhabitants with it.
 */

const PER_CELLS = 120
const MAX = 6
const MIN_REGION = 30
const GROWTH_STEPS = 10
const REBUILD_SECONDS = 0.5

export class Population {
  nav: NavGraph | null = null
  agents: Inhabitant[] = []
  private navStep = -Infinity
  private navRevision = -1
  private sinceRebuild = Infinity
  private epoch = -1
  private nextId = 1
  /** How many times the graph has been rebuilt, for the inspector. */
  rebuilds = 0

  update(game: BuildGame, dt: number) {
    if (game.epoch !== this.epoch) {
      this.epoch = game.epoch
      this.agents = []
      this.nextId = 1
      this.nav = null
    }
    this.sinceRebuild += dt
    const changed = !this.nav || this.nav.building !== game.building || game.revision !== this.navRevision
    const grew = game.sim.step - this.navStep >= GROWTH_STEPS
    if ((changed || grew) && this.sinceRebuild >= REBUILD_SECONDS) {
      const rebuilt = !this.nav || this.nav.building !== game.building
      this.nav = navFromGame(game)
      this.navStep = game.sim.step
      this.navRevision = game.revision
      this.sinceRebuild = 0
      this.rebuilds++
      // New cells (a rebuilt building) or changed walkability: every inhabitant finds its footing again.
      for (const a of this.agents) if (rebuilt || a.cell < 0 || !this.nav.walkable[a.cell] || (a.next >= 0 && !this.nav.walkable[a.next])) rehome(a, this.nav)
      this.populate(game)
    }
    const nav = this.nav
    if (!nav) return
    for (const a of this.agents) step(a, nav, dt)
  }

  private populate(game: BuildGame) {
    const nav = this.nav!
    const want = Math.min(MAX, Math.floor(nav.walkableCount / PER_CELLS))
    while (this.agents.length < want) {
      const living = new Map<number, number>()
      for (const a of this.agents) if (a.cell >= 0) living.set(nav.region[a.cell], (living.get(nav.region[a.cell]) ?? 0) + 1)
      const regions = nav.regionSize
        .map((size, r) => ({ r, size, here: living.get(r) ?? 0 }))
        .filter((x) => x.size >= MIN_REGION)
        .sort((p, q) => p.here - q.here || q.size - p.size)
      if (!regions.length) return
      const r = regions[0].r
      const seed = game.seed * 7919 + this.nextId * 104729 + game.epoch
      const pick = Math.floor((((seed * 2654435761) >>> 0) / 4294967296) * regions[0].size)
      let k = 0
      let cell = -1
      for (let i = 0; i < nav.region.length; i++) {
        if (nav.region[i] !== r) continue
        if (k++ === pick) {
          cell = i
          break
        }
      }
      if (cell < 0) return
      this.agents.push(spawn(this.nextId++, nav, cell, seed))
    }
  }
}
