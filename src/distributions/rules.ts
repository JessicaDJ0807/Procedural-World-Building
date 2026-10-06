import { valueNoise } from '../explore/terrain'
import { elevationAbove, sampleField, type StudyTerrain } from '../study/terrain'

/**
 * Where a thing may grow, as a product of answers to separate questions.
 *
 *     p = density × elevation × slope × water × cluster  [× sparse, rocks only]
 *
 * Every factor is 0–1 and answers one question about the ground, so a rule
 * that refuses a point can always say *which* question refused it — that is
 * what the probe in the viewport prints. A product rather than a sum because
 * each factor is a veto: a perfect elevation must not buy a tree onto a cliff.
 *
 * The factors are soft at their edges (smoothsteps rather than thresholds).
 * A hard cutoff draws the threshold on the terrain as a visible line of
 * instances stopping dead, which reads as a rule rather than as growth.
 */
export type AssetKind = 'tree' | 'bush' | 'rock'

export const KINDS: AssetKind[] = ['tree', 'bush', 'rock']

export type Rule = {
  /** Scales the probability. Above 1 saturates the good ground first. */
  density: number
  /** Degrees. Both edges fade over SLOPE_SOFT. */
  slopeMin: number
  slopeMax: number
  /** Normalised elevation above the waterline, 0 at the shore, 1 at the summit. */
  elevMin: number
  elevMax: number
  /** −1 avoids water, 0 ignores it, +1 grows only beside it. */
  water: number
  /** 0 is uniform; 1 confines the asset to the high patches of its noise. */
  cluster: number
}

export type Rules = Record<AssetKind, Rule>

export type AssetInfo = {
  kind: AssetKind
  label: string
  plural: string
  /** Candidate spacing in world units — the densest this asset can ever be. */
  spacing: number
  /** Keep-out radius against anything already placed. */
  radius: number
  /** Cycles per world unit of the cluster noise: forest patches are large, bush clumps small. */
  clusterFrequency: number
  /** The colour this asset is drawn in on the debug masks. */
  mask: number
  /** One line for the sidebar. */
  summary: string
}

export const ASSETS: Record<AssetKind, AssetInfo> = {
  tree: {
    kind: 'tree',
    label: 'Tree',
    plural: 'Trees',
    spacing: 0.2,
    radius: 0.11,
    clusterFrequency: 0.42,
    mask: 0x8fb47e,
    summary:
      'Flat to moderate ground at low and middle elevations, a little more likely near water, in large forest patches.',
  },
  bush: {
    kind: 'bush',
    label: 'Bush',
    plural: 'Bushes',
    spacing: 0.13,
    radius: 0.06,
    clusterFrequency: 0.95,
    mask: 0xd6b765,
    summary:
      'Tolerates steeper ground than trees and crowds the shoreline, in tight clumps at higher local density.',
  },
  rock: {
    kind: 'rock',
    label: 'Rock',
    plural: 'Rocks',
    spacing: 0.17,
    radius: 0.07,
    clusterFrequency: 1.3,
    mask: 0xb0a8cf,
    summary:
      'Steep and high ground, and wherever vegetation thins out — rocks fill the space the plants leave.',
  },
}

/**
 * Defaults set from the measured terrain, not from taste.
 *
 * Over four seeds the study terrain's slope has a median of 18.5–23.3° and a
 * 75th percentile of 25–34° (see the Topic 5 chapter). Trees stop just above
 * the median, so they take the flatter half; bushes reach about the 75th
 * percentile; rocks start a little above the median and run to the cliffs.
 */
export function defaultRules(): Rules {
  return {
    tree: { density: 0.75, slopeMin: 0, slopeMax: 22, elevMin: 0.04, elevMax: 0.62, water: 0.35, cluster: 0.55 },
    bush: { density: 0.7, slopeMin: 0, slopeMax: 30, elevMin: 0, elevMax: 0.5, water: 0.85, cluster: 0.7 },
    rock: { density: 0.55, slopeMin: 24, slopeMax: 70, elevMin: 0.3, elevMax: 1.05, water: -0.4, cluster: 0.25 },
  }
}

export const SLOPE_SOFT = 4
export const ELEV_SOFT = 0.06
/** World units over which "near water" decays to about a third. */
export const WATER_RANGE = 1.2
/** How much full vegetation suppresses rocks. Not exposed: it is the rule's shape, not a dial. */
export const SPARSE_WEIGHT = 0.75

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** 1 inside [lo, hi], fading to 0 over `soft` either side. */
export function band(x: number, lo: number, hi: number, soft: number): number {
  return smooth(lo - soft, lo + soft, x) * (1 - smooth(hi - soft, hi + soft, x))
}

/** Signed water preference. Positive multiplies toward the shore, negative away from it. */
export function waterFactor(distance: number, preference: number): number {
  const near = Math.exp(-distance / WATER_RANGE)
  return preference >= 0 ? 1 - preference + preference * near : 1 + preference * near
}

/** Two octaves, so a patch has an irregular edge rather than a blob outline. */
export function clusterNoise(x: number, z: number, frequency: number, seed: number): number {
  const a = valueNoise(x * frequency + 17.3, z * frequency - 4.1, seed)
  const b = valueNoise(x * frequency * 2.3 - 8.7, z * frequency * 2.3 + 2.9, seed + 101)
  return a * 0.7 + b * 0.3
}

export function clusterFactor(noise: number, cluster: number): number {
  return 1 - cluster + cluster * smooth(0.38, 0.62, noise)
}

/** The ground at a point, read once and shared by every rule. */
export type Ground = { height: number; elevation: number; slope: number; waterDist: number; underwater: boolean }

export function groundAt(t: StudyTerrain, x: number, z: number): Ground {
  const height = sampleField(t, t.height, x, z)
  return {
    height,
    elevation: elevationAbove(t, height),
    slope: sampleField(t, t.slope, x, z),
    waterDist: sampleField(t, t.waterDist, x, z),
    underwater: height < t.waterLevel,
  }
}

export type Factors = {
  elevation: number
  slope: number
  water: number
  cluster: number
  /** Rocks only; 1 for the others. */
  sparse: number
  /** The product, clamped to 1. */
  p: number
}

const KIND_SEED: Record<AssetKind, number> = { tree: 11, bush: 23, rock: 37 }

/**
 * Each factor for one asset at one point.
 *
 * Rocks are evaluated last because their `sparse` term needs the other two:
 * it is 1 − 0.75 × the stronger of the tree and bush probabilities *here*, so
 * turning tree density down hands the ground to rocks. That is the coupling
 * between layers the brief asks for, kept to one term so it stays legible.
 */
export function factorsFor(
  kind: AssetKind,
  rules: Rules,
  ground: Ground,
  x: number,
  z: number,
  seed: number,
  vegetation = 0,
): Factors {
  const rule = rules[kind]
  if (ground.underwater) return { elevation: 0, slope: 0, water: 0, cluster: 0, sparse: 0, p: 0 }
  const elevation = band(ground.elevation, rule.elevMin, rule.elevMax, ELEV_SOFT)
  const slope = band(ground.slope, rule.slopeMin, rule.slopeMax, SLOPE_SOFT)
  const water = waterFactor(ground.waterDist, rule.water)
  const cluster = clusterFactor(clusterNoise(x, z, ASSETS[kind].clusterFrequency, seed + KIND_SEED[kind]), rule.cluster)
  const sparse = kind === 'rock' ? 1 - SPARSE_WEIGHT * vegetation : 1
  const p = Math.min(1, rule.density * elevation * slope * water * cluster * sparse)
  return { elevation, slope, water, cluster, sparse, p }
}

/** All three at once, in dependency order. */
export function allFactors(
  rules: Rules,
  ground: Ground,
  x: number,
  z: number,
  seed: number,
): Record<AssetKind, Factors> {
  const tree = factorsFor('tree', rules, ground, x, z, seed)
  const bush = factorsFor('bush', rules, ground, x, z, seed)
  const rock = factorsFor('rock', rules, ground, x, z, seed, Math.max(tree.p, bush.p))
  return { tree, bush, rock }
}
