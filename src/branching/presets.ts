import type { Strategy } from './distribution'
import type { LeafPlacement } from './skeleton'
import type { LeafShape, Palette } from './treeGeometry'

/**
 * Everything the page can set, grouped by pipeline stage, and the presets
 * that fill it in.
 *
 * A preset is a whole settings object, not a patch: grammar, turtle, leaves,
 * colours and a forest to put them in. The point of the presets is that every
 * one of them is the same pipeline with different numbers — including the
 * coral, which is not a tree at all.
 */
export type TreeSettings = {
  axiom: string
  /** One production per line, `X = F[+X]F[-X]+X`. */
  rules: string
  iterations: number
  angle: number
  segmentLength: number
  lengthDecay: number
  trunkRadius: number
  thicknessDecay: number
  angleJitter: number
  lengthJitter: number
  branchRoll: number
  tropism: number
  seed: number
  leafSize: number
  leafDensity: number
  leafShape: LeafShape
  leafPlacement: LeafPlacement
  palette: PaletteId
}

export type ForestSettings = {
  strategy: Strategy
  count: number
  scatterSeed: number
  minSpacing: number
  clusterCount: number
  clusterRadius: number
  jitter: number
  treeScale: number
  scaleVariation: number
  rotationVariation: number
  /** How many differently seeded trees the forest is drawn from. */
  treeTypes: number
}

export type LodSettings = {
  auto: boolean
  /** The level every tree uses when auto is off. */
  manual: number
  near: number
  mid: number
  far: number
  hysteresis: number
}

export type View = 'tree' | 'lineup' | 'forest'

export type DisplaySettings = {
  view: View
  showSkeleton: boolean
  colourByGeneration: boolean
  showLeaves: boolean
  showLodColours: boolean
  showRings: boolean
  /** Fraction of the turtle's walk drawn, in the single-tree view. */
  progress: number
}

export type BranchingSettings = {
  preset: PresetId | 'custom'
  tree: TreeSettings
  forest: ForestSettings
  lod: LodSettings
  display: DisplaySettings
}

export type PaletteId = 'pine' | 'oak' | 'young' | 'coral'

/**
 * Bark and leaves per preset, plus the ground the forest stands on.
 *
 * Muted and warm, in the register of the Topic 5 scatter, so the four
 * presets read as four places rather than four colour schemes; the coral is
 * the one exception, and is meant to be.
 */
export const PALETTES: Record<PaletteId, Palette & { ground: string; groundHigh: string }> = {
  pine: { bark: '#6b5444', leafLow: '#2f5a45', leafHigh: '#4f7d5c', ground: '#3d4536', groundHigh: '#4c5440' },
  oak: { bark: '#7a6450', leafLow: '#5d7a3e', leafHigh: '#93a85a', ground: '#4a4a36', groundHigh: '#5a5a40' },
  young: { bark: '#8a7660', leafLow: '#6f9a4c', leafHigh: '#a9c46a', ground: '#47503a', groundHigh: '#566046' },
  coral: { bark: '#d0727c', leafLow: '#7ee0d2', leafHigh: '#e9f7a8', ground: '#2f4a58', groundHigh: '#3d5d69' },
}

/**
 * The grammar library: the four presets' own grammars, and six from
 * Prusinkiewicz and Lindenmayer, *The Algorithmic Beauty of Plants* (1990),
 * figure 1.24 a–f — the standard first examples, each shown at the book's
 * angle and iteration count.
 */
export const GRAMMARS: { id: string; label: string; axiom: string; rules: string; angle: number; iterations: number }[] = [
  { id: 'pine', label: 'Pine — leader and whorls', axiom: 'FA', rules: 'A = F[+B][+B][+B][+B]A\nB = F[-C][+C]B\nC = F', angle: 72, iterations: 10 },
  { id: 'oak', label: 'Oak — three-way forks', axiom: 'FFA', rules: 'A = F[+A][-A][+A]', angle: 40, iterations: 6 },
  { id: 'young', label: 'Sapling — three-way forks', axiom: 'FA', rules: 'A = F[+A][-A][+A]', angle: 32, iterations: 4 },
  { id: 'coral', label: 'Coral — pure dichotomy', axiom: '[+X][-X][&X][^X]', rules: 'X = FF[+X][-X]', angle: 20, iterations: 5 },
  { id: 'abop-a', label: 'ABOP 1.24a — F[+F]F[−F]F', axiom: 'F', rules: 'F = F[+F]F[-F]F', angle: 25.7, iterations: 5 },
  { id: 'abop-b', label: 'ABOP 1.24b — F[+F]F[−F][F]', axiom: 'F', rules: 'F = F[+F]F[-F][F]', angle: 20, iterations: 5 },
  { id: 'abop-c', label: 'ABOP 1.24c — FF−[−F+F+F]+[+F−F−F]', axiom: 'F', rules: 'F = FF-[-F+F+F]+[+F-F-F]', angle: 22.5, iterations: 4 },
  { id: 'abop-d', label: 'ABOP 1.24d — X → F[+X]F[−X]+X', axiom: 'X', rules: 'X = F[+X]F[-X]+X\nF = FF', angle: 20, iterations: 7 },
  { id: 'abop-e', label: 'ABOP 1.24e — X → F[+X][−X]FX', axiom: 'X', rules: 'X = F[+X][-X]FX\nF = FF', angle: 25.7, iterations: 7 },
  { id: 'abop-f', label: 'ABOP 1.24f — X → F−[[X]+X]+F[+FX]−X', axiom: 'X', rules: 'X = F-[[X]+X]+F[+FX]-X\nF = FF', angle: 22.5, iterations: 5 },
]

export type PresetId = 'pine' | 'oak' | 'young' | 'coral'

/**
 * `short` is the button: one word, so four fit the sidebar's preset grid
 * without wrapping. `label` is the full name, kept for the tooltip and the
 * saved-world summary.
 */
export const PRESETS: { id: PresetId; label: string; short: string; blurb: string; settings: () => Omit<BranchingSettings, 'display' | 'preset'> }[] = [
  {
    id: 'pine',
    label: 'Pine Forest',
    short: 'Pine',
    blurb: 'A leader that keeps growing and whorls of side branches that are longer the older they are — the cone is the grammar\'s doing, not a taper applied afterwards.',
    settings: () => ({
      tree: {
        axiom: 'FA', rules: 'A = F[+B][+B][+B][+B]A\nB = F[-C][+C]B\nC = F', iterations: 10, angle: 72,
        segmentLength: 0.9, lengthDecay: 0.5, trunkRadius: 0.2, thicknessDecay: 0.42,
        angleJitter: 6, lengthJitter: 0.12, branchRoll: 137.5, tropism: -0.14, seed: 3,
        leafSize: 0.3, leafDensity: 1.4, leafShape: 'needles', leafPlacement: 'twigs', palette: 'pine',
      },
      forest: {
        strategy: 'poisson', count: 360, scatterSeed: 2, minSpacing: 3.8, clusterCount: 8, clusterRadius: 14,
        jitter: 0.8, treeScale: 0.8, scaleVariation: 0.3, rotationVariation: 1, treeTypes: 3,
      },
      lod: { auto: true, manual: 0, near: 24, mid: 42, far: 70, hysteresis: 0.08 },
    }),
  },
  {
    id: 'oak',
    label: 'Ancient Oak Grove',
    short: 'Oak',
    blurb: 'Wide forks, a thick short trunk and a lot of irregularity, spread thin over the ground with plenty of room each.',
    settings: () => ({
      tree: {
        axiom: 'FFA', rules: 'A = F[+A][-A][+A]', iterations: 6, angle: 40,
        segmentLength: 1.3, lengthDecay: 0.86, trunkRadius: 0.42, thicknessDecay: 0.62,
        angleJitter: 14, lengthJitter: 0.3, branchRoll: 137.5, tropism: 0.02, seed: 7,
        leafSize: 0.42, leafDensity: 1.6, leafShape: 'cluster', leafPlacement: 'twigs', palette: 'oak',
      },
      forest: {
        strategy: 'poisson', count: 80, scatterSeed: 5, minSpacing: 8.5, clusterCount: 5, clusterRadius: 16,
        jitter: 0.8, treeScale: 1, scaleVariation: 0.35, rotationVariation: 1, treeTypes: 4,
      },
      lod: { auto: true, manual: 0, near: 26, mid: 48, far: 80, hysteresis: 0.08 },
    }),
  },
  {
    id: 'young',
    label: 'Dense Young Forest',
    short: 'Young',
    blurb: 'The oak\'s grammar run for fewer iterations, so it has fewer branch levels — small trees, lots of them, crowded into groves by a clustered distribution.',
    settings: () => ({
      tree: {
        axiom: 'FA', rules: 'A = F[+A][-A][+A]', iterations: 4, angle: 32,
        segmentLength: 0.55, lengthDecay: 0.9, trunkRadius: 0.11, thicknessDecay: 0.62,
        angleJitter: 9, lengthJitter: 0.2, branchRoll: 137.5, tropism: 0.06, seed: 11,
        leafSize: 0.22, leafDensity: 1.6, leafShape: 'cluster', leafPlacement: 'twigs', palette: 'young',
      },
      forest: {
        strategy: 'clustered', count: 1400, scatterSeed: 4, minSpacing: 0.9, clusterCount: 14, clusterRadius: 10,
        jitter: 0.8, treeScale: 1, scaleVariation: 0.4, rotationVariation: 1, treeTypes: 3,
      },
      lod: { auto: true, manual: 0, near: 20, mid: 36, far: 62, hysteresis: 0.08 },
    }),
  },
  {
    id: 'coral',
    label: 'Alien Coral Field',
    short: 'Coral',
    blurb: 'The same turtle and the same grammar machinery, given a rule that only ever forks in two and never keeps a leader. Nothing in the code knows this is not a tree.',
    settings: () => ({
      tree: {
        axiom: '[+X][-X][&X][^X]', rules: 'X = FF[+X][-X]', iterations: 5, angle: 20,
        segmentLength: 0.55, lengthDecay: 0.9, trunkRadius: 0.22, thicknessDecay: 0.84,
        angleJitter: 8, lengthJitter: 0.15, branchRoll: 90, tropism: 0.3, seed: 5,
        leafSize: 0.17, leafDensity: 1, leafShape: 'bulb', leafPlacement: 'tips', palette: 'coral',
      },
      forest: {
        strategy: 'clustered', count: 450, scatterSeed: 9, minSpacing: 1.6, clusterCount: 9, clusterRadius: 12,
        jitter: 0.8, treeScale: 1, scaleVariation: 0.45, rotationVariation: 1, treeTypes: 3,
      },
      lod: { auto: true, manual: 0, near: 22, mid: 40, far: 68, hysteresis: 0.08 },
    }),
  },
]

export const DEFAULT_DISPLAY: DisplaySettings = {
  view: 'tree',
  showSkeleton: false,
  colourByGeneration: false,
  showLeaves: true,
  showLodColours: false,
  showRings: true,
  progress: 1,
}

export function presetSettings(id: PresetId, display: DisplaySettings = DEFAULT_DISPLAY): BranchingSettings {
  const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0]
  const { tree, forest, lod } = preset.settings()
  return { preset: preset.id, tree, forest, lod, display: { ...display, progress: 1 } }
}

/** The distribution square's side, world units. Fixed, so counts compare. */
export const AREA = 90
