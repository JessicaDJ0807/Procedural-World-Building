import type { P2 } from '../paths/spline'
import type { RoadParams } from '../paths/road'
import type { RiverParams } from '../paths/river'
import { STUDY_SIZE } from '../study/terrain'
import { bool, int, isRecord, num, params as parseParams, pick, type ConfigSpec } from './spec'

export type PathKind = 'road' | 'river'

export const PATH_COLOURS: Record<PathKind, number> = { road: 0xd6b765, river: 0x7d9cc9 }

export type RoadPath = { points: P2[]; params: RoadParams }
export type RiverPath = { points: P2[]; params: RiverParams }

/** Which path the controls are editing: a kind and its position in that kind's list. */
export type PathRef = { kind: PathKind; index: number }

export type PathSettings = {
  terrainSeed: number
  active: PathRef
  debug: boolean
  roads: RoadPath[]
  rivers: RiverPath[]
}

/** Enough to show junctions, crossings and tributaries without crowding a 10-unit map. */
export const MAX_PATHS = 4

export type PathParamSpec<K extends string> = {
  key: K
  label: string
  info: string
  min: number
  max: number
  step: number
  value: number
  format?: (v: number) => string
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export const ROAD_SPECS: PathParamSpec<keyof RoadParams>[] = [
  { key: 'width', label: 'Width', info: 'Paved width in world units. Everything inside it is levelled to the grade.', min: 0.1, max: 0.8, step: 0.01, value: 0.3 },
  { key: 'falloff', label: 'Embankment', info: 'How far either side of the pavement the terrain takes to ease back to itself. Zero is a vertical cutting; wide is a gentle cut-and-fill that blends into the hillside.', min: 0, max: 1.2, step: 0.01, value: 0.35 },
  { key: 'smoothing', label: 'Grade smoothing', info: 'Arc-length window, in world units, over which the projected heights are averaged into a grade. At 0 the road rides every bump of the ground; wider windows trade a gentler road for more earth moved — watch cut and fill in the readout.', min: 0, max: 4, step: 0.05, value: 1.5 },
  { key: 'influence', label: 'Levelling', info: 'How far the corridor is pulled to the grade. At 0 the spline is still projected onto the terrain but changes nothing; at 1 the ground under the pavement meets the grade exactly. This is the spline → terrain half of the study.', min: 0, max: 1, step: 0.01, value: 1, format: pct },
  { key: 'widthVariation', label: 'Width variation', info: 'How much the width wanders along the road, driven by noise over arc length.', min: 0, max: 0.6, step: 0.01, value: 0.15, format: pct },
]

export const RIVER_SPECS: PathParamSpec<keyof RiverParams>[] = [
  { key: 'influence', label: 'Terrain influence', info: 'How each step of the trace is steered: 0 heads straight for the next guide point whatever the ground does, 1 goes only downhill and ignores the guides. Between, the two directions are blended. This is the terrain → spline half of the study — far stronger than for the road, which only takes its heights from the ground.', min: 0, max: 1, step: 0.01, value: 0.7, format: pct },
  { key: 'width', label: 'Width', info: 'Channel width at the source. It widens to 2.3× this by the mouth, as if collecting flow.', min: 0.08, max: 0.8, step: 0.01, value: 0.32 },
  { key: 'depth', label: 'Depth', info: 'Bed depth below the water surface. The channel is carved down to it and never filled up to it.', min: 0.02, max: 0.25, step: 0.005, value: 0.08 },
  { key: 'falloff', label: 'Bank falloff', info: 'How far beyond the channel the carve eases back to the ground. Narrow makes a cut gully; wide makes a broad valley.', min: 0, max: 1.2, step: 0.01, value: 0.3 },
]

/**
 * Routes placed against terrain seed 3, from a height map of it.
 *
 * The first of each list is the scene the page opens with; the rest are where
 * "+ Road" and "+ River" put the next one, so a new path lands somewhere it
 * interacts with what is already there rather than on top of it.
 *
 *  - Road 1 runs round the south shore over the hills at both ends.
 *  - Road 2 comes down the east side and ends where Road 1 does: a junction.
 *  - River 1's guides cross the ridge at about (−2.7, −0.5), so obeying them
 *    means trenching through it — which is what makes terrain influence show
 *    anything at all. With guides that already ran downhill, every setting
 *    gave the same river.
 *  - River 2 falls from the north-east corner to the lake, across Road 2: a
 *    causeway.
 *  - The first "+ River" is a tributary: its source sits on the slope above
 *    River 1, and after 1.12 units it runs into River 1's channel and stops.
 *    It was found by tracing five candidate sources and keeping the one that
 *    joined; three of the others ended in basins and one reached the lake.
 *  - The other spare routes cross Road 1 (a river from the south-west) and
 *    run past River 1's source (a road across the north).
 */
export const ROAD_ROUTES: P2[][] = [
  [{ x: -4.5, z: 1.2 }, { x: -2.6, z: 3.0 }, { x: 0.4, z: 3.1 }, { x: 2.8, z: 2.6 }, { x: 4.5, z: 0.6 }],
  [{ x: 2.6, z: -4.4 }, { x: 3.4, z: -2.6 }, { x: 3.6, z: -0.8 }, { x: 4.5, z: 0.6 }],
  [{ x: -4.4, z: -3.2 }, { x: -2.4, z: -3.6 }, { x: -0.4, z: -3.7 }, { x: 1.4, z: -3.4 }],
  [{ x: -4.4, z: 3.8 }, { x: -3.6, z: 1.0 }, { x: -4.4, z: -1.6 }],
]

export const RIVER_ROUTES: P2[][] = [
  [{ x: -4.3, z: -4.0 }, { x: -3.6, z: -1.6 }, { x: -2.6, z: -0.4 }, { x: -1.1, z: 0.6 }],
  [{ x: 4.3, z: -4.3 }, { x: 3.2, z: -3.0 }, { x: 1.9, z: -2.2 }],
  [{ x: -3.2, z: -4.7 }, { x: -3.4, z: -3.4 }],
  [{ x: -4.3, z: 4.4 }, { x: -3.0, z: 3.0 }, { x: -1.4, z: 1.8 }],
]

/** How many of each the page opens with. */
export const DEFAULT_ROADS = 2
export const DEFAULT_RIVERS = 2

const copy = (points: P2[]) => points.map((p) => ({ ...p }))
export const newRoad = (index: number): RoadPath => ({ points: copy(ROAD_ROUTES[index % ROAD_ROUTES.length]), params: defaultRoadParams() })
export const newRiver = (index: number): RiverPath => ({ points: copy(RIVER_ROUTES[index % RIVER_ROUTES.length]), params: defaultRiverParams() })
/** The route a path is reset to: its own slot's. */
export const routeFor = (ref: PathRef): P2[] =>
  copy((ref.kind === 'road' ? ROAD_ROUTES : RIVER_ROUTES)[ref.index % MAX_PATHS])

export const pathLabel = (ref: PathRef) => `${ref.kind === 'road' ? 'Road' : 'River'} ${ref.index + 1}`

export const MIN_POINTS = 2
export const MAX_POINTS = 9

const specDefaults = <K extends string>(specs: PathParamSpec<K>[]) =>
  Object.fromEntries(specs.map((s) => [s.key, s.value])) as Record<K, number>

export const defaultRoadParams = (): RoadParams => specDefaults(ROAD_SPECS)
export const defaultRiverParams = (): RiverParams => specDefaults(RIVER_SPECS)

export function defaultPathSettings(): PathSettings {
  return {
    terrainSeed: 3,
    active: { kind: 'road', index: 0 },
    debug: false,
    roads: Array.from({ length: DEFAULT_ROADS }, (_, i) => newRoad(i)),
    rivers: Array.from({ length: DEFAULT_RIVERS }, (_, i) => newRiver(i)),
  }
}

const LIMIT = STUDY_SIZE / 2 - 0.15

function parsePoints(raw: unknown, fallback: P2[]): P2[] {
  if (!Array.isArray(raw) || raw.length < MIN_POINTS || raw.length > MAX_POINTS) return fallback
  const out: P2[] = []
  for (const p of raw) {
    if (!isRecord(p)) return fallback
    out.push({ x: num(p.x, -LIMIT, LIMIT, 0), z: num(p.z, -LIMIT, LIMIT, 0) })
  }
  return out
}

const asSpecs = <K extends string>(specs: PathParamSpec<K>[]) =>
  specs.map((s) => ({ key: s.key, min: s.min, max: s.max, defaultValue: s.value }))

function parseList<T>(
  raw: unknown,
  build: (entry: Record<string, unknown>, index: number) => T,
): T[] | null {
  if (!Array.isArray(raw)) return null
  return raw.slice(0, MAX_PATHS).filter(isRecord).map(build)
}

function parse(raw: unknown): { settings: PathSettings; repairs: string[] } {
  const d = defaultPathSettings()
  if (!isRecord(raw)) return { settings: d, repairs: ['the document had no settings; defaults were used'] }
  const repairs: string[] = []
  const road = (r: Record<string, unknown>, i: number): RoadPath => ({
    points: parsePoints(r.points, newRoad(i).points),
    params: parseParams(r.params, asSpecs(ROAD_SPECS)) as RoadParams,
  })
  const river = (r: Record<string, unknown>, i: number): RiverPath => ({
    points: parsePoints(r.points, newRiver(i).points),
    params: parseParams(r.params, asSpecs(RIVER_SPECS)) as RiverParams,
  })
  // Schema 1 stored one `road` and one `river`. Read as a list of one each,
  // so a world saved before there could be several opens as it was saved.
  let roads = parseList(raw.roads, road)
  let rivers = parseList(raw.rivers, river)
  if (!roads && isRecord(raw.road)) roads = [road(raw.road, 0)]
  if (!rivers && isRecord(raw.river)) rivers = [river(raw.river, 0)]
  if (!roads || !rivers) repairs.push('missing paths were replaced with the defaults')
  const settings: PathSettings = {
    terrainSeed: int(raw.terrainSeed, 1, 999, d.terrainSeed),
    active: d.active,
    debug: bool(raw.debug, d.debug),
    roads: roads ?? d.roads,
    rivers: rivers ?? d.rivers,
  }
  // The active path is a pointer into those lists, so it is checked against
  // what was actually loaded — and schema 1 stored it as a bare kind.
  const stored = isRecord(raw.active) ? raw.active : { kind: raw.active, index: 0 }
  const kind = pick(stored.kind, ['road', 'river'] as const, 'road')
  const list = kind === 'road' ? settings.roads : settings.rivers
  const index = int(stored.index, 0, MAX_PATHS - 1, 0)
  settings.active = index < list.length ? { kind, index } : firstPath(settings)
  return { settings, repairs }
}

/** Whatever path exists, for when the active one is deleted. Null-safe: lists can be empty. */
export function firstPath(s: Pick<PathSettings, 'roads' | 'rivers'>): PathRef {
  if (s.roads.length > 0) return { kind: 'road', index: 0 }
  if (s.rivers.length > 0) return { kind: 'river', index: 0 }
  return { kind: 'road', index: -1 }
}

export const pathSpec: ConfigSpec<PathSettings> = {
  topic: 'paths',
  schemaVersion: 2,
  defaults: defaultPathSettings,
  parse,
  summary: (s) =>
    `terrain ${s.terrainSeed} · ${s.roads.length} road${s.roads.length === 1 ? '' : 's'} · ${s.rivers.length} river${s.rivers.length === 1 ? '' : 's'}`,
}
