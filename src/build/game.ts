import type { Building } from '../green/building'
import { WildSim } from '../wildform/sim'
import { SPECIES_NAMES } from '../wildform/names'
import { BUDGET, EAST, Town, WEST } from './town'
import { Drapers, type Draper, type DraperEvent, type Edge } from './draper'
import type { GrowthState } from '../wildform/growth'
import { appendSurfaces, livingPatches, roofPatches, surfaceOverlay, type SurfaceInfo } from './surfaces'
import { townToBuilding } from './townBuilding'
import { COMBO_NAMES, MATURE_AT, connects, findNode, livingSupport, livingVolumes, planLiving, type Combo, type Living, type NodeSurfaces } from './living'

/**
 * The Build page's game: the town the player builds, the plants growing on
 * it, and the living architecture their meetings make — one state, carried
 * through every edit.
 *
 *   build → plant → grow → plants meet → living architecture → build again
 *
 * The player controls the starting conditions — where rigid blocks go, from
 * a budget, and where seeds go — but not the final form: that is the plants'
 * and the grammar's (living.ts). Editing the town never resets the growth:
 * the town becomes a new building, the plants are carried onto it
 * (WildGrowth.restoreFrom), and living structures persist and keep shading.
 *
 * The goal: join the two existing buildings through living architecture,
 * within the budget. They stand eight columns apart and a living bridge
 * reaches five, so the plants cannot do it alone: blocks have to bring them
 * within reach — a wing pushed out, or a stepping-stone tower between them
 * and two living links. A rigid bridge of blocks makes them one building, and
 * the goal asks that they stay two: spending blocks on the connection itself
 * undoes the point of it.
 */
/** Steps between looks for a mutation node. */
const NODE_EVERY = 10
/** Events kept: the sidebar shows the last few, and the rest as history. */
const EVENT_LOG = 40
/**
 * Balconies at most. A Climber + Spreader node with no building in reach
 * becomes one, and they are by far the commonest outcome: uncapped, they
 * took every structure there was room for before a layered node formed.
 */
const MAX_BALCONIES = 3

export type GameEvent = { step: number; text: string }

/** The game's own bookkeeping a saved world carries. */
export type Counters = { goalMet: boolean; connected: number; wasJoined: boolean; lastNodeCheck: number; declined: number[] }

/** A saved world, decoded (worldState.ts): what `load` puts back. */
export type LoadableWorld = {
  seed: number
  env: Environment
  cells: Uint8Array
  locked: Uint8Array
  living: Living[]
  drapers: { nextId: number; list: Draper[] }
  growth: GrowthState
  counters: Counters
  events: GameEvent[]
  simEvents: GameEvent[]
}

/** Structure names for the event log, capitalised. */
const TITLE: Record<Living['kind'], string> = { bridge: 'Bridge', balcony: 'Balcony', scaffold: 'Scaffold', terrace: 'Terrace', canopy: 'Canopy' }

export type Environment = { rain: number; sunAzimuth: number }

export const DEFAULT_ENV: Environment = { rain: 0.55, sunAzimuth: -58 }

export class BuildGame {
  readonly town = new Town()
  sim!: WildSim
  building!: Building
  /** What every cell is: wall, roof slope, ridge, deck top, support… (surfaces.ts). */
  surface!: SurfaceInfo
  /** Pitched roofs and living architecture as places a node can form. */
  private nodeSurfaces!: NodeSurfaces
  living: Living[] = []
  /** The hanging plants: their own model (draper.ts), reading the same world. */
  readonly drapers = new Drapers()
  /** Draper events with a place, for the scene to label; the renderer empties it. */
  notes: DraperEvent[] = []
  events: GameEvent[] = []
  env: Environment = { ...DEFAULT_ENV }
  /**
   * The world's seed: the growth's random numbers start from it, and from it
   * and the step after every rebuild. 1 for the page's own first world — the
   * runs in docs/project/build.md — and a new one for each New World.
   */
  seed = 1
  /** 0–1, kept on the growth across rebuilds: the game's seasons set it; 1 elsewhere. */
  warmth = 1
  /** Incremented when the whole world is replaced (restart, New World, load): a renderer drops everything it drew. */
  epoch = 0
  /**
   * Incremented by the player's own changes — blocks, plantings, weather, a
   * new or loaded world. Growth is not counted here: it is measured by the
   * step (WorldMenu), so a world saved while growing isn't unsaved a frame later.
   */
  changes = 0
  /** Incremented whenever the building is rebuilt or growth removed, so a renderer rebuilds rather than appends. */
  revision = 0
  convertMs = 0
  private goalMet = false
  private connected = 0
  private wasJoined = false
  private lastNodeCheck = 0
  /** Cells whose node was declined (another balcony past the cap), not asked again. */
  private declined = new Set<number>()

  constructor() {
    this.town.lawn()
    this.rebuild(false)
  }

  /** Back to the scenario's start: the two buildings, no plants, nothing grown. */
  restart() {
    this.changes++
    this.epoch++
    this.town.lawn()
    this.living = []
    this.drapers.clear()
    this.notes = []
    this.events = []
    this.goalMet = false
    this.connected = 0
    this.wasJoined = false
    this.lastNodeCheck = 0
    this.declined = new Set()
    this.rebuild(false)
  }

  private log(text: string) {
    this.events.push({ step: this.sim?.step ?? 0, text })
    if (this.events.length > EVENT_LOG) this.events.shift()
  }

  /**
   * The town changed: make its building, carry the plants onto it, and lay
   * the mature living structures back into the world.
   */
  rebuild(carry = true) {
    const old = carry ? this.sim : null
    const { building: blocks, ms } = townToBuilding(this.town)
    // Pitched roofs, and every mature structure, become surfaces too: grown
    // on, and so grown into more architecture.
    const mature = this.living.filter((l) => l.matured)
    const { building, info } = appendSurfaces(blocks, [...roofPatches(this.town), ...mature.flatMap(livingPatches)])
    this.convertMs = ms
    this.building = building
    this.surface = info
    this.nodeSurfaces = {
      site: (i) => i >= info.baseCount && (info.planX[i] !== 0 || info.planZ[i] !== 0),
      facing: (i) => [info.planX[i], 0, info.planZ[i]],
    }
    const sim = new WildSim(building, [])
    sim.world.overlay = surfaceOverlay(info)
    sim.reset({ preset: 'random', seed: this.seed, rain: this.env.rain, sunAzimuth: this.env.sunAzimuth, mutations: false })
    if (mature.length) sim.world.addLiving(mature.flatMap(livingVolumes), mature.flatMap((l) => livingSupport(l, building)))
    if (old) {
      sim.growth.restoreFrom(old.growth, sim.world, this.seed)
      sim.growth.markStress(sim.world)
      sim.events = old.events
    }
    sim.growth.warmth = this.warmth
    this.sim = sim
    this.revision++
    // Drapers find their edges again on the new town; one whose edge is gone falls.
    this.draperEvents(this.drapers.relayout(this.town, building, sim.world, sim.growth, this.living))
    this.updateConnections()
  }

  private draperEvents(events: DraperEvent[]) {
    for (const e of events) {
      this.log(e.text)
      if (e.at) this.notes.push(e)
    }
  }

  /** Plants a Draper on an edge (draper.ts finds it from the click); false if refused. */
  plantDraper(edge: Edge, s: number): boolean {
    const d = this.drapers.plant(edge, s, this.sim.step)
    if (!d) return false
    this.changes++
    this.drapers.relayout(this.town, this.building, this.sim.world, this.sim.growth, this.living)
    this.drapers.advance(0, this.sim.step, this.town, this.building, this.sim.world, this.sim.growth, this.living)
    this.log(edge.kind === 'living' ? 'Draper planted on living architecture' : `Draper planted on a ${edge.kind === 'roof' ? 'roof edge' : edge.kind}`)
    return true
  }

  /** A fresh lawn: default weather, a new seed, nothing built or planted. */
  newWorld(seed: number) {
    this.seed = seed
    this.env = { ...DEFAULT_ENV }
    this.restart()
  }

  /**
   * Puts a saved world back (build/worldState.ts): the town, the weather, the
   * living architecture, then the building rebuilt from them — so every
   * surface a plant was on exists again — then the growth laid onto it, and
   * the Drapers' strands laid out. The same path an edit takes, which is what
   * makes a loaded world a continuing simulation rather than a picture of one.
   */
  load(w: LoadableWorld) {
    this.town.restore(w.cells, w.locked)
    this.seed = w.seed
    this.env = { ...w.env }
    this.living = w.living
    this.drapers.restoreState(w.drapers)
    this.notes = []
    this.events = w.events
    // Set before the rebuild, so recounting connections doesn't log them as new.
    this.goalMet = w.counters.goalMet
    this.connected = w.counters.connected
    this.wasJoined = w.counters.wasJoined
    this.lastNodeCheck = w.counters.lastNodeCheck
    this.declined = new Set(w.counters.declined)
    this.rebuild(false)
    this.sim.growth.restoreState(w.growth, this.sim.world, this.seed)
    this.sim.growth.markStress(this.sim.world)
    this.sim.events = w.simEvents
    this.sim.revision++
    // Again, now the growth is there: a Draper's veil reads the Climber under it.
    this.drapers.relayout(this.town, this.building, this.sim.world, this.sim.growth, this.living)
    this.epoch++
    this.revision++
  }

  /** What a saved world needs from the game, beyond what it can rebuild (worldState.ts). */
  get counters(): Counters {
    return { goalMet: this.goalMet, connected: this.connected, wasJoined: this.wasJoined, lastNodeCheck: this.lastNodeCheck, declined: [...this.declined] }
  }

  /** Seasons (game/seasons.ts): how warm it is, carried onto the growth. */
  setWarmth(w: number) {
    this.warmth = w
    this.sim.growth.warmth = w
  }

  /** `byPlayer` false for the seasons: weather that follows from the step isn't an unsaved change. */
  setEnvironment(env: Partial<Environment>, byPlayer = true) {
    if (byPlayer) this.changes++
    this.env = { ...this.env, ...env }
    this.sim.setEnvironment(this.env.rain, this.env.sunAzimuth)
  }

  /** Places or removes a block; false if the budget or an existing building refuses it. */
  edit(x: number, y: number, z: number, value: number): boolean {
    if (!this.town.set(x, y, z, value)) return false
    this.changes++
    this.rebuild()
    return true
  }

  undo(): boolean {
    if (!this.town.undo()) return false
    this.changes++
    this.rebuild()
    return true
  }

  clearBlocks() {
    this.changes++
    this.town.clear()
    this.rebuild()
  }

  plant(species: number, cell: number): boolean {
    const ok = this.sim.plant(species, cell)
    if (ok) this.changes++
    if (ok) this.log(`${SPECIES_NAMES[species]} planted`)
    return ok
  }

  /**
   * Advances the growth, forming nodes and maturing structures as it goes —
   * in stretches of at most NODE_EVERY steps, so a long advance looks for
   * nodes as often as a frame-by-frame one. Returns new structures.
   */
  advance(steps: number): Living[] {
    const added: Living[] = []
    let left = steps
    while (left > 0) {
      const n = Math.min(left, NODE_EVERY - (this.sim.step % NODE_EVERY) || NODE_EVERY)
      added.push(...this.advanceStretch(n))
      left -= n
    }
    return added
  }

  private advanceStretch(steps: number): Living[] {
    const added: Living[] = []
    // Withering is already counted in the simulation's own revision, which a renderer reads.
    this.sim.advance(steps)
    const step = this.sim.step
    this.draperEvents(this.drapers.advance(steps, step, this.town, this.building, this.sim.world, this.sim.growth, this.living))
    // A node, at most one per look.
    if (step - this.lastNodeCheck >= NODE_EVERY) {
      this.lastNodeCheck = step
      const node = findNode(this.sim.growth, this.building, this.living, this.declined, this.nodeSurfaces)
      const l = node ? planLiving(this.sim.growth, this.building, this.town, node, this.living.length + 1, this.nodeSurfaces) : null
      if (node && l && l.kind === 'balcony' && this.living.filter((o) => o.kind === 'balcony').length >= MAX_BALCONIES) {
        this.declined.add(node.cell)
      } else if (node && l) {
        this.living.push(l)
        added.push(l)
        const floor = Math.floor(l.node[1] / 3) + 1
        this.log(`Mutation node: ${COMBO_NAMES[node.combo]}, floor ${floor}`)
        this.log(l.ends.to ? `${TITLE[l.kind]} growing toward another building` : `${TITLE[l.kind]} begins to grow`)
      }
    }
    // Maturity: a structure becomes architecture — it shades, and supports climbers.
    for (const l of this.living) {
      if (l.matured || step - l.born < MATURE_AT) continue
      l.matured = true
      const shaded = this.sim.world.addLiving(livingVolumes(l), livingSupport(l, this.building))
      // Its surfaces join the building — deck top, underside, rims, supports —
      // so the plants carry on onto it rather than stopping at its roots.
      const before = this.building.count
      this.rebuild()
      this.log(`${TITLE[l.kind]} matured · shades ${shaded} cells · ${this.building.count - before} new surface cells`)
    }
    return added
  }

  /**
   * Counts living connections — mature structures joining two separate
   * buildings — and whether they join the west and east buildings, directly
   * or through buildings between. Reports changes, and the goal.
   */
  private updateConnections() {
    const masses = this.town.masses()
    const links = this.living.filter((l) => l.matured && connects(l, this.town, masses))
    const n = links.length
    if (n > this.connected) this.log(`Living connection made (${n})`)
    if (n < this.connected) this.log(`A living connection was lost`)
    this.connected = n
    // Union the masses the links join; are west and east in one group?
    const parent = new Map<number, number>()
    const find = (a: number): number => {
      while (parent.has(a) && parent.get(a) !== a) a = parent.get(a)!
      return a
    }
    for (const l of links) {
      const a = find(masses[Town.index(...l.ends.from)])
      const b = find(masses[Town.index(...l.ends.to!)])
      if (a !== b) parent.set(a, b)
    }
    const west = masses[Town.index(...WEST)]
    const east = masses[Town.index(...EAST)]
    const joined = west !== east && find(west) === find(east)
    if (joined && !this.wasJoined) this.log('West ↔ East joined')
    this.wasJoined = joined
    if (joined && !this.goalMet) {
      this.goalMet = true
      this.log(`Goal complete · ${this.town.placed()} of ${BUDGET} blocks`)
    }
  }

  get connections() {
    return this.connected
  }

  /** Whether the west and east buildings are joined by living architecture now. */
  get joined() {
    return this.wasJoined
  }

  /** Whether blocks have made west and east one building — which the goal forbids. */
  get mergedByBlocks() {
    const masses = this.town.masses()
    return masses[Town.index(...WEST)] === masses[Town.index(...EAST)]
  }

  get goalComplete() {
    return this.goalMet
  }

  byCombo(): Record<Combo, number> {
    const out: Record<Combo, number> = { 'climber+spreader': 0, 'climber+layered': 0, 'spreader+layered': 0 }
    for (const l of this.living) out[l.combo]++
    return out
  }

  /** The last events, the game's and the simulation's, in step order. */
  recentEvents(n = EVENT_LOG): GameEvent[] {
    return [...this.sim.events, ...this.events].sort((a, b) => a.step - b.step).slice(-n)
  }
}
