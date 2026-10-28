import type { Building } from '../green/building'
import { ROOT, type WildGrowth } from '../wildform/growth'
import { BuildGame } from '../build/game'
import { anchorForLiving, blockEdge, type Draper } from '../build/draper'
import { readCurtain } from '../build/draperLiving'
import { comboOf, growthDirections, type Combo, type Kind, type Living, type V3 } from '../build/living'
import { D, H, W, type Town } from '../build/town'

/**
 * The catalog's specimens: real Build games, each grown until Build itself
 * forms the structure on show.
 *
 * Each specimen is a recipe — a few blocks, Climber and Spreader seeds at the
 * foot of chosen walls, a world seed and the rain — and a `BuildGame` run on
 * it, ten steps at a time as Build plays, until its first living structure
 * forms. That structure is the specimen: planned by Build's planner from the
 * real growth around its node, so it bows, leans and reaches as the plants
 * made it. Nothing is modelled, and nothing is forced: the recipes were found
 * by searching layouts and seeds for runs where the wanted kind forms first
 * (432 runs, docs/project/architecture.md). If a recipe ever grows a
 * different structure first — because Build changed — `grow` throws rather
 * than show the wrong thing.
 *
 * What the Growth view shows is the game's own state at the step the node
 * formed: every plant layer and the stem it grew from, the seeds, the cells
 * whose meeting made the node, and the growth directions the planner read.
 */

export type Recipe = {
  kind: Kind
  /** What distinguishes this variation, in a few words. */
  label: string
  /** Blocks: x, z, storeys. */
  columns: [number, number, number][]
  /** Seed pairs at the foot of a face: block x, z, facing dx, dz. */
  plant: [number, number, number, number][]
  /** What is sown at each foot, in order (0 Climber, 1 Spreader); a Climber and a Spreader twice if not given. */
  sow?: number[]
  seed: number
  rain: number
  /** Drapers planted with the seeds, on a block's edge: block x, y, z, side dx, dz, top or bottom edge. */
  drape?: [number, number, number, number, number, 'top' | 'bottom'][]
  /** Plant a Draper on the first structure to mature, at the far end of its deck — as a player would. */
  drapeOnLiving?: boolean
}

const TOWER = (h: number): Recipe['columns'] => [[6, 6, h]]
const ROW = (h: number): Recipe['columns'] => [[6, 6, h], [7, 6, h]]
const PAIR = (gap: number, a: number, b: number): Recipe['columns'] => [[4, 6, a], [5 + gap, 6, b]]
const PAIR_PLANT = (gap: number): Recipe['plant'] => [[4, 6, 1, 0], [5 + gap, 6, -1, 0]]

/**
 * Variations of each kind: different contexts, each a run where that kind
 * formed first. Labels describe what Build actually grew (checked in Node),
 * not what the recipe hoped for. Terraces have two: in every layout searched
 * a terrace either stands free on columns at the roof line of a two-storey
 * block, or spans to a neighbour in reach — a third would repeat one of them.
 */
export const RECIPES: Record<Kind, Recipe[]> = {
  bridge: [
    { kind: 'bridge', label: 'Two-column gap', columns: PAIR(2, 3, 3), plant: PAIR_PLANT(2), seed: 4, rain: 0.55 },
    { kind: 'bridge', label: 'Three columns, to a taller tower', columns: PAIR(3, 4, 2), plant: PAIR_PLANT(3), seed: 4, rain: 0.55 },
    { kind: 'bridge', label: 'Four-column gap', columns: PAIR(4, 3, 3), plant: PAIR_PLANT(4), seed: 4, rain: 0.55 },
  ],
  balcony: [
    { kind: 'balcony', label: 'Swung west', columns: TOWER(3), plant: [[6, 6, 0, 1]], seed: 3, rain: 0.8 },
    { kind: 'balcony', label: 'Swung east', columns: ROW(2), plant: [[6, 6, 0, 1], [7, 6, 0, 1]], seed: 3, rain: 0.55 },
    { kind: 'balcony', label: 'Straight out, higher', columns: TOWER(5), plant: [[6, 6, 0, 1]], seed: 5, rain: 0.55 },
  ],
  scaffold: [
    { kind: 'scaffold', label: 'Arm to a taller neighbour', columns: PAIR(3, 4, 2), plant: PAIR_PLANT(3), seed: 6, rain: 0.55 },
    { kind: 'scaffold', label: 'Arm down to a lower roof', columns: PAIR(2, 2, 3), plant: PAIR_PLANT(2), seed: 6, rain: 0.55 },
    { kind: 'scaffold', label: 'Nothing in reach', columns: PAIR(4, 3, 3), plant: PAIR_PLANT(4), seed: 6, rain: 0.55 },
  ],
  terrace: [
    { kind: 'terrace', label: 'Free, on columns', columns: PAIR(4, 4, 2), plant: PAIR_PLANT(4), seed: 5, rain: 0.55 },
    { kind: 'terrace', label: 'Spanning to the neighbour', columns: PAIR(2, 4, 2), plant: PAIR_PLANT(2), seed: 3, rain: 0.8 },
  ],
  canopy: [
    { kind: 'canopy', label: 'Low, on columns', columns: ROW(3), plant: [[6, 6, 0, 1], [7, 6, 0, 1]], seed: 3, rain: 0.55 },
    { kind: 'canopy', label: 'Spanning a short gap', columns: PAIR(2, 3, 3), plant: PAIR_PLANT(2), seed: 5, rain: 0.55 },
    { kind: 'canopy', label: 'High, neighbour out of reach', columns: PAIR(3, 5, 3), plant: PAIR_PLANT(3), seed: 5, rain: 0.55 },
  ],
  // The Draper's forms: a Draper planted on the edge named, as a player clicks it. Found by a search of
  // 357 runs over two searches (docs/project/architecture.md#the-drapers-forms).
  walkway: [
    { kind: 'walkway', label: 'Level, roof to roof', columns: PAIR(3, 3, 3), plant: [[4, 6, 1, 0]], sow: [0, 0], drape: [[4, 2, 6, 1, 0, 'top']], seed: 2, rain: 0.55 },
    { kind: 'walkway', label: 'Down two storeys to a low roof', columns: PAIR(2, 3, 1), plant: [[4, 6, 1, 0]], sow: [0, 0], drape: [[4, 2, 6, 1, 0, 'top']], seed: 2, rain: 0.55 },
    { kind: 'walkway', label: 'Up to a taller neighbour', columns: PAIR(3, 3, 5), plant: [[4, 6, 1, 0]], sow: [0, 0], drape: [[4, 2, 6, 1, 0, 'top']], seed: 2, rain: 0.55 },
  ],
  pod: [
    { kind: 'pod', label: 'Under a two-storey eave', columns: TOWER(2), plant: [[6, 6, 0, 1]], sow: [1, 1], drape: [[6, 1, 6, 0, 1, 'top']], seed: 1, rain: 0.55 },
    { kind: 'pod', label: 'High, four storeys up', columns: TOWER(4), plant: [[6, 6, 0, 1]], sow: [1, 1], drape: [[6, 3, 6, 0, 1, 'top']], seed: 1, rain: 0.55 },
    { kind: 'pod', label: 'Under a wing, beside a tower', columns: [[6, 6, 4], [6, 7, 2]], plant: [[6, 7, 0, 1]], sow: [1, 1], drape: [[6, 1, 7, 0, 1, 'top']], seed: 1, rain: 0.55 },
  ],
  column: [
    { kind: 'column', label: 'Holding up a walkway', columns: PAIR(2, 3, 3), plant: [[4, 6, 1, 0]], sow: [0, 0], drape: [[4, 2, 6, 1, 0, 'top']], seed: 2, rain: 0.55 },
    { kind: 'column', label: 'Down a layered wall', columns: [[5, 6, 3], [6, 6, 3], [7, 6, 3]], plant: [[5, 6, 0, 1]], drape: [[7, 2, 6, 0, 1, 'top']], seed: 5, rain: 0.55 },
    { kind: 'column', label: 'Onto a lower wing’s roof', columns: [[6, 6, 3], [6, 7, 1]], plant: [[6, 6, 0, 1]], drape: [[6, 2, 6, 0, 1, 'top']], seed: 3, rain: 0.55 },
  ],
}

/** The plants at the step the node formed, as the Growth view draws them (growth units). */
export type GrowthPicture = {
  /** Per layer: cell position, outward normal, species, how many layers deep it sits (0 at the wall). */
  layers: { p: V3; n: V3; species: number; level: number }[]
  /** Each grown layer's stem: from its parent's cell to its own. */
  stems: { a: V3; b: V3; species: number }[]
  seeds: { p: V3; species: number }[]
  /** The cells of the node's combination within its radius: the meeting that made it. */
  meeting: V3[]
  /** The average heading of each species near the node — what the planner read. */
  heading: { climber: V3; spreader: V3 }
  /** For the Draper's forms: the curtain's strands as grown, and which Draper made it. */
  strands: V3[][]
}

export type Specimen = {
  recipe: Recipe
  town: Town
  building: Building
  living: Living
  /** Structures already standing when it formed. The one it hangs from, if any (`hostOf`), is drawn as part of the site. */
  context: Living[]
  /** The Drapers as they hung when it formed: the curtain that made it, and any others. */
  drapers: Draper[]
  combo: Combo
  /** The step the node formed. */
  bornAt: number
  growth: GrowthPicture
  /** How long growing it took here, ms. */
  ms: number
}

const MAX_STEPS = 3000

function picture(g: WildGrowth, b: Building, l: Living, drapers: Draper[]): GrowthPicture {
  const pos = (c: number): V3 => [b.px[c], b.py[c], b.pz[c]]
  const layers: GrowthPicture['layers'] = []
  const stems: GrowthPicture['stems'] = []
  const seeds: GrowthPicture['seeds'] = []
  for (let k = 0; k < g.grown; k++) {
    const e = g.order[k]
    const c = g.entryCell[e]
    const sp = g.entrySpecies[e]
    layers.push({ p: pos(c), n: [b.nx[c], b.ny[c], b.nz[c]], species: sp, level: g.levelOf(e) })
    const parent = g.entryParent[e]
    if (parent === ROOT) seeds.push({ p: pos(c), species: sp })
    else if (parent >= 0) stems.push({ a: pos(g.entryCell[parent]), b: pos(c), species: sp })
  }
  const meeting: V3[] = []
  const curtain = l.draper !== undefined ? drapers.find((d) => d.id === l.draper) : undefined
  if (curtain) {
    // The Draper's meeting is what its curtain hung over: those cells, as the game read them.
    for (const i of readCurtain(curtain, g, b).cells) meeting.push(pos(i))
  } else {
    for (let i = 0; i < g.N; i++) {
      if (comboOf(g, i) !== l.combo) continue
      const p = pos(i)
      if (Math.hypot(p[0] - l.node[0], p[1] - l.node[1], p[2] - l.node[2]) <= 1.35) meeting.push(p)
    }
  }
  const strands = curtain ? curtain.strands.map((st) => st.path.slice(0, Math.min(st.path.length, Math.floor(st.length / 0.22) + 1))) : []
  const [climber, spreader] = growthDirections(g, b, l.node)
  return { layers, stems, seeds, meeting, heading: { climber, spreader }, strands }
}

const DRAPER_KINDS: Kind[] = ['walkway', 'pod', 'column']

/**
 * Grows a recipe in a real Build game until its structure forms. For the
 * wall's kinds that is the first structure, and it must be the recipe's
 * kind. For the Draper's, other structures may come first — a column needs
 * one to hang from, and a walkway can be it — and the specimen is the first
 * of the recipe's kind; what came before is shown with it, as context.
 */
export function grow(recipe: Recipe): Specimen {
  const t0 = performance.now()
  const game = new BuildGame()
  game.seed = recipe.seed
  game.env = { ...game.env, rain: recipe.rain }
  const cells = new Uint8Array(W * H * D)
  for (const [x, z, h] of recipe.columns) for (let y = 0; y < h; y++) cells[(y * D + z) * W + x] = 1
  game.town.restore(cells, new Uint8Array(W * H * D))
  game.rebuild(false)
  const b = game.building
  // A Climber and a Spreader side by side, twice, at the foot of each face — as a player plants.
  for (const [x, z, dx, dz] of recipe.plant) {
    const cx = (x - 7 + 0.5) * 3 + dx * 1.5
    const cz = (z - 7 + 0.5) * 3 + dz * 1.5
    const near = [...b.ground]
      .filter((c) => Math.round(b.nx[c]) === dx && Math.round(b.nz[c]) === dz)
      .sort((p, q) => Math.hypot(b.px[p] - cx, b.pz[p] - cz) - Math.hypot(b.px[q] - cx, b.pz[q] - cz))
    ;(recipe.sow ?? [0, 1, 0, 1]).forEach((sp, k) => game.plant(sp, near[[0, 1, 6, 7][k]]))
  }
  for (const [x, y, z, dx, dz, level] of recipe.drape ?? []) {
    const edge = blockEdge(game.town, x, y, z, dx, dz, level)
    if (!edge) throw new Error(`The ${recipe.kind} recipe “${recipe.label}” has no ${level} edge at ${x}, ${y}, ${z}`)
    // Planted at the middle of the block named, along the edge's run.
    const run = edge.path[1]
    const mid: V3 = [(x - W / 2 + 0.5) * 3, run[1], (z - D / 2 + 0.5) * 3]
    const s = Math.hypot(mid[0] - edge.path[0][0], mid[2] - edge.path[0][2])
    game.plantDraper(edge, s)
  }
  const drapersKind = DRAPER_KINDS.includes(recipe.kind)
  const target = () => (drapersKind ? game.living.find((l) => l.kind === recipe.kind) : game.living[0])
  let drapedLiving = false
  while (!target() && game.sim.step < MAX_STEPS) {
    game.advance(10)
    const host = game.living.find((l) => l.matured)
    if (recipe.drapeOnLiving && !drapedLiving && host) {
      drapedLiving = true
      const tip = host.decks[0].centre.at(-1)!
      const a = anchorForLiving(host, tip)
      if (a) game.plantDraper(a.edge, a.s)
    }
  }
  const living = target()
  if (!living) throw new Error(`The ${recipe.kind} recipe “${recipe.label}” grew nothing in ${MAX_STEPS} steps`)
  if (living.kind !== recipe.kind) throw new Error(`The ${recipe.kind} recipe “${recipe.label}” grew a ${living.kind} first`)
  return {
    recipe,
    town: game.town,
    building: game.building,
    living,
    context: game.living.filter((l) => l !== living),
    drapers: game.drapers.list.map((d) => ({ ...d, strands: d.strands.map((st) => ({ ...st })) })),
    combo: living.combo,
    bornAt: living.born,
    growth: picture(game.sim.growth, game.building, living, game.drapers.list),
    ms: performance.now() - t0,
  }
}

/** The structure a specimen hangs from — a column under a walkway's deck — or null. */
export function hostOf(s: Specimen): Living | null {
  const d = s.drapers.find((x) => x.id === s.living.draper)
  const src = d?.edge.source
  return src && 'living' in src ? (s.context.find((l) => l.id === src.living) ?? null) : null
}

/** A few measurements of a structure, from its geometry. */
export function measure(l: Living): { length: number; height: number; decks: number; members: number; roots: number; cables: number } {
  const pts = [...l.decks.flatMap((d) => d.centre), ...l.frame.flat(), ...(l.trunks ?? []).flat()]
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const [x, y, z] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    z0 = Math.min(z0, z); z1 = Math.max(z1, z)
  }
  return { length: Math.hypot(x1 - x0, z1 - z0), height: y1 - y0, decks: l.decks.length, members: l.frame.length + (l.trunks?.length ?? 0), roots: l.roots.length, cables: l.cables?.length ?? 0 }
}
