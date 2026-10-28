import type { GrowthState } from '../wildform/growth'
import type { Draper } from './draper'
import type { BuildGame, Counters, Environment, GameEvent, LoadableWorld } from './game'
import type { Living } from './living'
import { D, H, W } from './town'

/**
 * A Wildform world as data: what is saved, and how it is read back.
 *
 * The rule is **save what can't be rebuilt, rebuild the rest**. Nothing
 * rendered is saved — no meshes, no instances, not even the growth cells,
 * which are rebuilt from the blocks. Saved:
 *
 * - the **town**: one byte per grid cell (empty, or colour + 1) and whether it
 *   is an existing building. Walls, roofs, arches, stilts and every growth
 *   cell follow from it, as they do after any edit;
 * - the **living architecture** as planned — its curves, decks, ends, the
 *   step it was born and whether it has matured — from which it is drawn,
 *   shades, supports and becomes a surface again;
 * - the **growth**: every plant layer in birth order — where (cell position
 *   and facing, not index, so it lands on the rebuilt building), species,
 *   birth step, parent, the env it grew in — and the growing tips. Layered is
 *   not stored: it is what a cell is when its stack is two deep, and the stacks
 *   are rebuilt by laying the layers down again;
 * - the **Drapers**: anchors, edges and strands' lengths, births and roots;
 *   their paths are laid out again against the rebuilt town;
 * - the **environment**, the **seed**, the **step**, the game's counters and
 *   its event log.
 *
 * Loading takes the same path as an edit (`BuildGame.load`): town → building →
 * world and fields → growth laid back on → Drapers laid out. The random
 * numbers restart from the seed and the step, as they do after every edit.
 *
 * Split in two for storage: a small **head** — the version, scenario, seed,
 * step, weather and a summary, enough to list worlds without opening them —
 * and a **body**, a JSON string of everything else, which firebase/worlds.ts
 * cuts into chunks so no document comes near Firestore's 1 MiB limit.
 *
 * **Versions.** Every world carries `version`. `deserializeWorld` refuses a
 * version newer than this build knows, and passes older ones through
 * `migrate`, which is where a v1 → v2 step will go.
 */

export const WORLD_VERSION = 1

export type Scenario = 'lawn'

export type WorldSummary = { blocks: number; living: number; drapers: number; step: number; coverage: number }

/** The small half: on the world document itself, listed without opening the world. */
export type WorldHead = {
  version: number
  scenario: Scenario
  seed: number
  step: number
  env: Environment
  summary: WorldSummary
}

/** Typed arrays travel as base64 of their bytes. Little-endian, as every browser this runs in is. */
type Packed = string

type BodyV1 = {
  version: 1
  town: { cells: Packed; locked: Packed }
  living: Living[]
  drapers: { nextId: number; list: Draper[] }
  growth: {
    step: number
    lastGrowth: number
    withered: number
    witheredBy: number[]
    smothered: number
    layers: { pos: Packed; facing: Packed; species: Packed; birth: Packed; parent: Packed; env: Packed }
    tips: { pos: Packed; facing: Packed; dir: Packed; species: Packed }
  }
  counters: Counters
  events: GameEvent[]
  simEvents: GameEvent[]
}

/** A saved world that can't be read: too new, malformed, or missing pieces. */
export class WorldFormatError extends Error {}

// --- base64 for typed arrays ---

function pack(a: ArrayBufferView): Packed {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  let s = ''
  // In slices: String.fromCharCode with a whole large array overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function unpackBytes(s: unknown, what: string): Uint8Array {
  if (typeof s !== 'string') throw new WorldFormatError(`${what} is missing`)
  let bin: string
  try {
    bin = atob(s)
  } catch {
    throw new WorldFormatError(`${what} is not valid data`)
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function unpack<T extends ArrayBufferView>(s: unknown, what: string, make: (buf: ArrayBuffer) => T, size: number): T {
  const bytes = unpackBytes(s, what)
  if (bytes.length % size) throw new WorldFormatError(`${what} has a broken length`)
  // Copied into a fresh buffer, so its alignment is right for the type.
  return make(bytes.slice().buffer)
}

// --- saving ---

export function summarize(game: BuildGame): WorldSummary {
  const g = game.sim.growth
  return {
    blocks: game.town.placed(),
    living: game.living.length,
    drapers: game.drapers.list.length,
    step: game.sim.step,
    coverage: Math.round(g.coverage() * 1000) / 1000,
  }
}

/** The world as data: a head for the world document, and a body string to store in chunks. */
export function serializeWorld(game: BuildGame): { head: WorldHead; body: string } {
  const g: GrowthState = game.sim.growth.exportState()
  const body: BodyV1 = {
    version: 1,
    town: { cells: pack(game.town.cells), locked: pack(game.town.locked) },
    living: game.living,
    drapers: game.drapers.exportState(),
    growth: {
      step: g.step,
      lastGrowth: g.lastGrowth,
      withered: g.withered,
      witheredBy: g.witheredBy,
      smothered: g.smothered,
      layers: {
        pos: pack(g.layers.pos),
        facing: pack(g.layers.facing),
        species: pack(g.layers.species),
        birth: pack(g.layers.birth),
        parent: pack(g.layers.parent),
        env: pack(g.layers.env),
      },
      tips: { pos: pack(g.tips.pos), facing: pack(g.tips.facing), dir: pack(g.tips.dir), species: pack(g.tips.species) },
    },
    counters: game.counters,
    events: game.events,
    simEvents: game.sim.events,
  }
  const head: WorldHead = { version: WORLD_VERSION, scenario: 'lawn', seed: game.seed, step: game.sim.step, env: { ...game.env }, summary: summarize(game) }
  return { head, body: JSON.stringify(body) }
}

// --- loading ---

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new WorldFormatError(`${what} is not a number`)
  return v
}

/** Reads a head from a world document; throws WorldFormatError if this build can't. */
export function readHead(raw: unknown): WorldHead {
  if (!isObject(raw)) throw new WorldFormatError('The world has no data')
  const version = raw.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new WorldFormatError('The world has no version this app understands')
  if (version > WORLD_VERSION) throw new WorldFormatError(`This world was saved by a newer version of Wildform (format ${version}); this one reads up to ${WORLD_VERSION}`)
  const env = isObject(raw.env) ? raw.env : {}
  const summary = isObject(raw.summary) ? raw.summary : {}
  return {
    version,
    scenario: raw.scenario === 'lawn' ? 'lawn' : 'lawn',
    seed: num(raw.seed, 'The seed'),
    step: num(raw.step, 'The step'),
    env: { rain: num(env.rain, 'Rain'), sunAzimuth: num(env.sunAzimuth, 'Sun direction') },
    summary: {
      blocks: Number(summary.blocks) || 0,
      living: Number(summary.living) || 0,
      drapers: Number(summary.drapers) || 0,
      step: Number(summary.step) || 0,
      coverage: Number(summary.coverage) || 0,
    },
  }
}

/** Three non-negative whole counts, or undefined if the save has none (or none that make sense). */
function seedCounts(v: unknown): [number, number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined
  const n = v.map(Number)
  return n.every((x) => Number.isInteger(x) && x >= 0) ? (n as [number, number, number]) : undefined
}

/** Older bodies brought up to the current version. Only v1 exists; a v2 adds its step here. */
function migrate(body: Record<string, unknown>): BodyV1 {
  switch (body.version) {
    case 1:
      return body as unknown as BodyV1
    default:
      throw new WorldFormatError(`Unsupported world format ${String(body.version)}`)
  }
}

/** A head and its body string, read back and checked: what `BuildGame.load` takes. */
export function deserializeWorld(rawHead: unknown, bodyText: string): LoadableWorld {
  const head = readHead(rawHead)
  let raw: unknown
  try {
    raw = JSON.parse(bodyText)
  } catch {
    throw new WorldFormatError('The world’s saved state is incomplete or corrupt')
  }
  if (!isObject(raw)) throw new WorldFormatError('The world’s saved state is empty')
  if (raw.version !== head.version) throw new WorldFormatError('The world’s parts were saved by different versions')
  const body = migrate(raw)

  const cells = unpackBytes(body.town?.cells, 'The town')
  const locked = unpackBytes(body.town?.locked, 'The existing buildings')
  if (cells.length !== W * H * D || locked.length !== W * H * D) throw new WorldFormatError('The town is the wrong size')

  const G = body.growth
  if (!isObject(G) || !isObject(G.layers) || !isObject(G.tips)) throw new WorldFormatError('The plants are missing')
  const L = G.layers
  const T = G.tips
  const species = unpack(L.species, 'Plant species', (b) => new Uint8Array(b), 1)
  const n = species.length
  const layers = {
    pos: unpack(L.pos, 'Plant positions', (b) => new Int16Array(b), 2),
    facing: unpack(L.facing, 'Plant facings', (b) => new Int8Array(b), 1),
    species,
    birth: unpack(L.birth, 'Plant ages', (b) => new Int32Array(b), 4),
    parent: unpack(L.parent, 'Plant parents', (b) => new Int32Array(b), 4),
    env: unpack(L.env, 'Plant conditions', (b) => new Float32Array(b), 4),
  }
  if (layers.pos.length !== n * 3 || layers.facing.length !== n * 3 || layers.birth.length !== n || layers.parent.length !== n || layers.env.length !== n) throw new WorldFormatError('The plants’ data doesn’t agree with itself')
  const tipSpecies = unpack(T.species, 'Growing tips', (b) => new Uint8Array(b), 1)
  const tips = {
    pos: unpack(T.pos, 'Tip positions', (b) => new Int16Array(b), 2),
    facing: unpack(T.facing, 'Tip facings', (b) => new Int8Array(b), 1),
    dir: unpack(T.dir, 'Tip directions', (b) => new Float32Array(b), 4),
    species: tipSpecies,
  }
  const t = tipSpecies.length
  if (tips.pos.length !== t * 3 || tips.facing.length !== t * 3 || tips.dir.length !== t * 3) throw new WorldFormatError('The growing tips’ data doesn’t agree with itself')

  if (!Array.isArray(body.living)) throw new WorldFormatError('The living architecture is missing')
  if (!isObject(body.drapers) || !Array.isArray(body.drapers.list)) throw new WorldFormatError('The Drapers are missing')
  const c = isObject(body.counters) ? body.counters : ({} as Record<string, unknown>)
  const events = (v: unknown): GameEvent[] => (Array.isArray(v) ? v.filter((e) => isObject(e) && typeof e.text === 'string').map((e) => ({ step: Number(e.step) || 0, text: String(e.text) })) : [])

  return {
    seed: head.seed,
    env: head.env,
    cells,
    locked,
    living: body.living,
    drapers: { nextId: num(body.drapers.nextId, 'The Drapers’ count'), list: body.drapers.list },
    growth: {
      step: num(G.step, 'The growth step'),
      lastGrowth: Number(G.lastGrowth) || 0,
      withered: Number(G.withered) || 0,
      witheredBy: Array.isArray(G.witheredBy) ? G.witheredBy.map(Number) : [0, 0],
      smothered: Number(G.smothered) || 0,
      layers,
      tips,
    },
    counters: {
      goalMet: Boolean(c.goalMet),
      connected: Number(c.connected) || 0,
      wasJoined: Boolean(c.wasJoined),
      lastNodeCheck: Number(c.lastNodeCheck) || 0,
      declined: Array.isArray(c.declined) ? c.declined.map(Number) : [],
      // Older worlds have no seed counts: left absent, and the game says its count is partial.
      seeds: seedCounts(c.seeds),
      seedsPartial: c.seedsPartial === true,
    },
    events: events(body.events),
    simEvents: events(body.simEvents),
  }
}
