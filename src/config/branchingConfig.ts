import { STRATEGIES } from '../branching/distribution'
import {
  DEFAULT_DISPLAY,
  PALETTES,
  PRESETS,
  presetSettings,
  type BranchingSettings,
  type ForestSettings,
  type LodSettings,
  type PaletteId,
  type TreeSettings,
} from '../branching/presets'
import { bool, int, isRecord, num, pick, type ConfigSpec } from './spec'

/** One definition per numeric control: the slider, and the stored document's bounds. */
export type NumberSpec<K extends string> = {
  key: K
  label: string
  info: string
  min: number
  max: number
  step: number
  format?: (v: number) => string
}

type TreeNumber = { [K in keyof TreeSettings]: TreeSettings[K] extends number ? K : never }[keyof TreeSettings]
type ForestNumber = { [K in keyof ForestSettings]: ForestSettings[K] extends number ? K : never }[keyof ForestSettings]
type LodNumber = { [K in keyof LodSettings]: LodSettings[K] extends number ? K : never }[keyof LodSettings]

const deg = (v: number) => `${v.toFixed(v % 1 ? 1 : 0)}°`
const pct = (v: number) => `${Math.round(v * 100)}%`
const fixed2 = (v: number) => v.toFixed(2)

export const GRAMMAR_SPECS: NumberSpec<TreeNumber>[] = [
  { key: 'iterations', label: 'Iterations', info: 'How many times every symbol is rewritten. Each iteration multiplies the string — by 2 for F → FF, by 5 for F → F[+F]F[−F]F — so this is the slider that decides the tree\'s complexity, and the one that can make it explode.', min: 0, max: 10, step: 1, format: (v) => v.toFixed(0) },
  { key: 'angle', label: 'Branch angle', info: 'Degrees the turtle turns per + or −. Narrow angles make columnar trees; wide angles, spreading crowns.', min: 0, max: 90, step: 0.5, format: deg },
  { key: 'angleJitter', label: 'Angle variation', info: 'Up to this many degrees added to every turn at random. Zero draws the grammar exactly; a little makes it look grown rather than computed.', min: 0, max: 30, step: 0.5, format: deg },
  { key: 'branchRoll', label: 'Branch roll', info: 'Each new branch is rolled about its own axis by this angle times its index, which is what lifts a 2D grammar into three dimensions. 137.5° is the golden angle, the arrangement real plants use. 0 draws the flat textbook figure.', min: 0, max: 180, step: 0.5, format: deg },
  { key: 'tropism', label: 'Tropism', info: 'Bends every step toward the sky (positive) or lets it droop (negative), in proportion to the step\'s length. The trunk is unaffected when it already points straight up.', min: -0.4, max: 0.4, step: 0.01, format: fixed2 },
  { key: 'seed', label: 'Seed', info: 'The random draws for angle and length variation. Same grammar and seed, same tree, on any machine.', min: 1, max: 999, step: 1, format: (v) => v.toFixed(0) },
]

export const GEOMETRY_SPECS: NumberSpec<TreeNumber>[] = [
  { key: 'segmentLength', label: 'Segment length', info: 'World length of one generation-0 F. The tree\'s overall height is this times the number of F the trunk is drawn with.', min: 0.05, max: 3, step: 0.01, format: fixed2 },
  { key: 'lengthDecay', label: 'Length decay', info: 'Each generation\'s segments are this fraction as long as the previous one\'s. Below 1, side branches are shorter than the limb they leave.', min: 0.3, max: 1.2, step: 0.01, format: fixed2 },
  { key: 'trunkRadius', label: 'Trunk thickness', info: 'Radius of the trunk at the ground, world units.', min: 0.02, max: 1, step: 0.01, format: fixed2 },
  { key: 'thicknessDecay', label: 'Thickness decay', info: 'Each generation\'s radius is this fraction of the previous one\'s. Each limb tapers from its own generation\'s radius to the next, so a branch and the limb it leaves meet at about the same thickness.', min: 0.2, max: 1, step: 0.01, format: fixed2 },
  { key: 'lengthJitter', label: 'Length variation', info: 'Random fraction added to every segment\'s length.', min: 0, max: 0.6, step: 0.01, format: pct },
  { key: 'leafSize', label: 'Leaf size', info: 'Size of one leaf clump, world units. At lower LODs fewer clumps are drawn and each is grown so the canopy covers about the same area.', min: 0.05, max: 1.2, step: 0.01, format: fixed2 },
  { key: 'leafDensity', label: 'Leaf density', info: 'Expected clumps per eligible segment: every segment of the last two generations, and the tip of every limb. 1.5 means one always and a second half the time.', min: 0, max: 4, step: 0.05, format: fixed2 },
]

export const FOREST_SPECS: NumberSpec<ForestNumber>[] = [
  { key: 'count', label: 'Trees', info: 'How many trees the strategy is asked for. Poisson disk and clustered may fit fewer when the spacing is too wide; the readout says how many.', min: 1, max: 2500, step: 1, format: (v) => v.toLocaleString() },
  { key: 'minSpacing', label: 'Minimum spacing', info: 'No two trees closer than this. Defines the Poisson disk; thins a crowded grove in the clustered strategy.', min: 0, max: 12, step: 0.1, format: fixed2 },
  { key: 'clusterCount', label: 'Clusters', info: 'How many grove centres are scattered before any tree is placed.', min: 1, max: 40, step: 1, format: (v) => v.toFixed(0) },
  { key: 'clusterRadius', label: 'Cluster radius', info: 'Spread of each grove: trees fall around their centre with a standard deviation of half this.', min: 1, max: 40, step: 0.5, format: (v) => v.toFixed(1) },
  { key: 'jitter', label: 'Jitter', info: 'How far within its grid cell each tree may move. 0 is the plain grid; 1 is anywhere in the cell.', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'treeScale', label: 'Tree scale', info: 'Every tree\'s size, applied as the instance\'s scale — nothing is rebuilt.', min: 0.2, max: 3, step: 0.01, format: (v) => `${v.toFixed(2)}×` },
  { key: 'scaleVariation', label: 'Scale variation', info: 'Each tree is scaled by up to ± this fraction, at random.', min: 0, max: 0.8, step: 0.01, format: (v) => `±${pct(v)}` },
  { key: 'rotationVariation', label: 'Rotation variation', info: 'Each tree is turned about its trunk by up to ± this fraction of a half-turn. At 0 every tree faces the same way, and the repetition is obvious.', min: 0, max: 1, step: 0.01, format: pct },
  { key: 'treeTypes', label: 'Tree types', info: 'How many differently seeded trees the forest picks from. Each is the same grammar with a different random stream, built at all four LODs.', min: 1, max: 4, step: 1, format: (v) => v.toFixed(0) },
  { key: 'scatterSeed', label: 'Scatter seed', info: 'The positions, and each tree\'s scale, rotation, type and shade.', min: 1, max: 999, step: 1, format: (v) => v.toFixed(0) },
]

export const LOD_SPECS: NumberSpec<LodNumber>[] = [
  { key: 'near', label: 'LOD 0 → 1', info: 'Distance from the camera, world units, past which a tree drops to medium detail.', min: 1, max: 150, step: 1, format: (v) => v.toFixed(0) },
  { key: 'mid', label: 'LOD 1 → 2', info: 'Distance past which a tree drops to trunk and main limbs.', min: 1, max: 200, step: 1, format: (v) => v.toFixed(0) },
  { key: 'far', label: 'LOD 2 → 3', info: 'Distance past which a tree becomes a silhouette: sticks and canopy blobs.', min: 1, max: 260, step: 1, format: (v) => v.toFixed(0) },
  { key: 'hysteresis', label: 'Hysteresis', info: 'Each threshold is a band this wide either side. A tree only coarsens once it is this far past the threshold and only refines once it is this far inside, so a tree standing on the line does not flicker as the camera drifts.', min: 0, max: 0.3, step: 0.01, format: (v) => `±${pct(v)}` },
]

export function defaultBranchingSettings(): BranchingSettings {
  return presetSettings('oak', DEFAULT_DISPLAY)
}

/** A text field: kept when it is a string of plausible length, else the fallback. */
const text = (value: unknown, fallback: string, max: number) =>
  typeof value === 'string' && value.length <= max ? value : fallback

function numbers<K extends string>(raw: unknown, specs: NumberSpec<K>[], fallback: Record<K, number>, integer: K[] = []) {
  const source = isRecord(raw) ? raw : {}
  const out = {} as Record<K, number>
  for (const s of specs) {
    out[s.key] = integer.includes(s.key)
      ? int(source[s.key], s.min, s.max, fallback[s.key])
      : num(source[s.key], s.min, s.max, fallback[s.key])
  }
  return out
}

function parse(raw: unknown): { settings: BranchingSettings; repairs: string[] } {
  const d = defaultBranchingSettings()
  if (!isRecord(raw)) return { settings: d, repairs: ['the document had no settings; defaults were used'] }
  const rawTree = isRecord(raw.tree) ? raw.tree : {}
  const rawForest = isRecord(raw.forest) ? raw.forest : {}
  const rawLod = isRecord(raw.lod) ? raw.lod : {}
  const rawDisplay = isRecord(raw.display) ? raw.display : {}

  const tree: TreeSettings = {
    ...d.tree,
    ...numbers(rawTree, [...GRAMMAR_SPECS, ...GEOMETRY_SPECS], d.tree, ['iterations', 'seed']),
    axiom: text(rawTree.axiom, d.tree.axiom, 200),
    rules: text(rawTree.rules, d.tree.rules, 2000),
    leafShape: pick(rawTree.leafShape, ['cluster', 'needles', 'bulb'] as const, d.tree.leafShape),
    leafPlacement: pick(rawTree.leafPlacement, ['twigs', 'tips'] as const, d.tree.leafPlacement),
    palette: pick(rawTree.palette, Object.keys(PALETTES) as PaletteId[], d.tree.palette),
  }
  const forest: ForestSettings = {
    ...d.forest,
    ...numbers(rawForest, FOREST_SPECS, d.forest, ['count', 'clusterCount', 'treeTypes', 'scatterSeed']),
    strategy: pick(rawForest.strategy, STRATEGIES.map((s) => s.value), d.forest.strategy),
  }
  const thresholds = numbers(rawLod, LOD_SPECS, d.lod)
  const lod: LodSettings = {
    ...thresholds,
    auto: bool(rawLod.auto, d.lod.auto),
    manual: int(rawLod.manual, 0, 3, d.lod.manual),
  }
  const display = {
    ...d.display,
    view: pick(rawDisplay.view, ['tree', 'lineup', 'forest'] as const, d.display.view),
    showSkeleton: bool(rawDisplay.showSkeleton, d.display.showSkeleton),
    colourByGeneration: bool(rawDisplay.colourByGeneration, d.display.colourByGeneration),
    showLeaves: bool(rawDisplay.showLeaves, d.display.showLeaves),
    showLodColours: bool(rawDisplay.showLodColours, d.display.showLodColours),
    showRings: bool(rawDisplay.showRings, d.display.showRings),
    progress: num(rawDisplay.progress, 0, 1, 1),
  }
  const preset = pick(raw.preset, [...PRESETS.map((p) => p.id), 'custom'] as const, 'custom')
  return { settings: { preset, tree, forest, lod, display }, repairs: [] }
}

export const branchingSpec: ConfigSpec<BranchingSettings> = {
  topic: 'branching',
  schemaVersion: 1,
  defaults: defaultBranchingSettings,
  parse,
  summary: (s) => {
    const name = PRESETS.find((p) => p.id === s.preset)?.label ?? 'Custom'
    return `${name} · ${s.tree.iterations} iterations · ${s.forest.count.toLocaleString()} trees`
  },
}
