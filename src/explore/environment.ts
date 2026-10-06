import * as THREE from 'three'
import type { River } from './river'
import { valueNoise } from './terrain'
import type { WorldSpec } from './worlds'

/**
 * The derived environment: everything downstream reads this and nothing else.
 *
 * The pipeline the worlds are built on is
 *
 *     height → slope → water → moisture → material → object probability
 *
 * and this module is the middle of it. The height function knows only about
 * shape; the renderer and the scatter want to know what *kind of place* a
 * coordinate is. A `Site` is that answer, computed once per point and read by
 * both — so a tree and the grass it stands on are agreeing about the same
 * ground rather than each applying its own rules and happening to match.
 *
 * Keeping it in one place is also what makes the relationship explainable. A
 * material band and a scatter rule are both written against the same six
 * fields, so "trees stop at the waterline" and "the bank is wet soil" are the
 * same fact stated twice rather than two unrelated thresholds.
 */

export type Site = {
  /** World height at the point. */
  height: number
  /** 0 on the flat, 1 on a wall. Derived from the surface normal. */
  slope: number
  /** Units below the waterline. 0 anywhere dry. */
  depth: number
  /** 1 at the waterline, falling to 0 over the world's shore band. */
  shore: number
  /** Height across the world's own colour range, clamped to 0..1. */
  altitude: number
  /**
   * How wet the ground is: near water, low, and sheltered. Drives where the
   * dark grass grows and where the trees crowd, which is the same question.
   */
  moisture: number
  /** Fine noise, for breaking a boundary up so it does not read as a contour. */
  grain: number
  /** Medium noise, for regional variation within one material. */
  patch: number
}

export type Environment = {
  /** From a height and normal already to hand — no extra height evaluations. */
  at(x: number, z: number, height: number, normalY: number): Site
  /** The same, when only the coordinate is known. Costs one height call. */
  sample(x: number, z: number): Site
}

export function createEnvironment(
  spec: WorldSpec,
  height: (x: number, z: number) => number,
  river: River | null = null,
): Environment {
  const seed = spec.terrain.seed
  const sea = spec.terrain.seaLevel
  const [lo, hi] = spec.colorRange
  const span = hi - lo || 1
  const shoreBand = spec.ground.shoreBand
  const grainScale = spec.ground.tintScale * 11
  const patchScale = spec.ground.tintScale * 2.4

  const at = (x: number, z: number, h: number, normalY: number): Site => {
    // normalY is 1 on the flat and falls toward 0 on a wall, so slope is its
    // complement. Squaring would exaggerate gentle ground into cliffs.
    const slope = Math.min(1, Math.max(0, 1 - normalY))

    /*
     * Depth and shore come from the river where there is one.
     *
     * A global waterline cannot describe a river that descends: its surface is
     * 53 units up at the source and -15 at the outlet, so any single elevation
     * is wrong almost everywhere along it. Worse, "near the waterline" as a
     * height test marks every hollow in the world at that elevation, whether or
     * not it has anything to do with the river.
     *
     * Lateral distance to the course answers both properly: the bank is the
     * river's own edge, and it follows the water downhill for free.
     */
    let depth: number
    let above: number
    let shore: number
    if (river) {
      const hit = river.at(x, z)
      if (hit) {
        depth = Math.max(0, hit.node.water - h)
        above = h - hit.node.water
        /*
         * Height above the local water surface, not lateral distance.
         *
         * Lateral was wrong, and the cross-section said so: the carved bank
         * rises gradually, so a point a few units outside the channel edge is
         * still well below the water. Everywhere `shore` was high the ground
         * was underwater, and by the time it surfaced `shore` had decayed to
         * zero — the tan band existed in the list and never once appeared.
         *
         * Measured against this node's own water height, so it still follows
         * the river downhill rather than ringing a global elevation.
         */
        const aboveWater = h - hit.node.water
        shore =
          aboveWater < 0 || shoreBand <= 0 ? 0 : Math.max(0, 1 - aboveWater / shoreBand)
      } else {
        depth = 0
        above = 40
        shore = 0
      }
    } else {
      depth = sea === null ? 0 : Math.max(0, sea - h)
      above = sea === null ? h - lo : h - sea
      shore =
        sea === null || shoreBand <= 0
          ? 0
          : Math.max(0, 1 - Math.abs(h - sea) / shoreBand)
    }

    const grain = valueNoise(x * grainScale, z * grainScale, seed + 313)
    const patch = valueNoise(x * patchScale, z * patchScale, seed + 919)

    /*
     * Moisture: close to the water, low-lying, and not on a slope.
     *
     * Three terms because each one alone is wrong. Height above water alone
     * makes a wet ring and a dry everywhere-else; a noise field alone puts
     * marsh on a ridge; and without the slope term the steepest ground holds
     * water, which it does not. The noise is a third of the weight, enough to
     * stop the wet band being a perfect contour of the river.
     */
    const nearWater = Math.max(0, 1 - Math.max(0, above) / 26)
    const moisture = Math.min(
      1,
      Math.max(0, nearWater * 0.55 + patch * 0.33 + (1 - slope) * 0.12 - slope * 0.5),
    )

    return {
      height: h,
      slope,
      depth,
      shore,
      altitude: Math.min(1, Math.max(0, (h - lo) / span)),
      moisture,
      grain,
      patch,
    }
  }

  return {
    at,
    sample(x, z) {
      const h = height(x, z)
      // Central difference at a world distance rather than a grid step, so a
      // site sampled by the scatter matches one sampled by the mesh.
      const d = 1.2
      const dx = height(x + d, z) - height(x - d, z)
      const dz = height(x, z + d) - height(x, z - d)
      const ny = 2 * d / (Math.hypot(-dx, 2 * d, -dz) || 1)
      return at(x, z, h, ny)
    },
  }
}

/* ---------------------------------------------------------------------------
 * Material classification
 *
 * A world is a list of bands. Each one says what it looks like and, as a
 * function of the site, how much of it there is here. The result is the
 * weighted blend — which is what makes the boundaries organic for free: two
 * bands that both claim a point simply mix, and the noise in their masks makes
 * the line where one wins wander instead of following a contour.
 * ------------------------------------------------------------------------- */

export type Band = {
  name: string
  color: string
  /** 0 to 1. Not normalised — the blend does that. */
  mask: (s: Site) => number
}

/** Smooth 0→1 across [edge0, edge1], either direction. */
export function ramp(v: number, edge0: number, edge1: number): number {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0 || 1e-6)))
  return t * t * (3 - 2 * t)
}

/** A soft window: 1 in the middle of [a, b], falling off over `feather`. */
export function band(v: number, a: number, b: number, feather: number): number {
  return ramp(v, a - feather, a + feather) * (1 - ramp(v, b - feather, b + feather))
}

/**
 * Blend a band list down to one linear-light colour.
 *
 * Weighted rather than winner-takes-all. A hard pick would put a visible seam
 * wherever two masks cross, and those crossings follow contours — which is
 * exactly the banded look this replaces. Blending means a slope that is half
 * rock and half grass is drawn as half rock and half grass.
 *
 * Colours are resolved to linear once by `compileBands`, because `THREE.Color`
 * parsing per vertex would be the most expensive thing in the chunk builder.
 */
export type CompiledBands = {
  masks: ((s: Site) => number)[]
  colors: [number, number, number][]
  names: string[]
}

export function classify(bands: CompiledBands, site: Site, out: Float32Array, o: number) {
  let r = 0
  let g = 0
  let b = 0
  let total = 0
  for (let i = 0; i < bands.masks.length; i++) {
    const w = bands.masks[i](site)
    if (w <= 0) continue
    const c = bands.colors[i]
    r += c[0] * w
    g += c[1] * w
    b += c[2] * w
    total += w
  }
  // Nothing claimed this point — possible at the extremes of a hand-written
  // band list. Falling back to the first band is better than a black hole.
  if (total <= 1e-6) {
    const c = bands.colors[0]
    out[o] = c[0]
    out[o + 1] = c[1]
    out[o + 2] = c[2]
    return
  }
  out[o] = r / total
  out[o + 1] = g / total
  out[o + 2] = b / total
}

/** Which band dominates here, for the debug readout. */
export function dominantBand(bands: CompiledBands, site: Site): string {
  let best = 0
  let name = bands.names[0]
  for (let i = 0; i < bands.masks.length; i++) {
    const w = bands.masks[i](site)
    if (w > best) {
      best = w
      name = bands.names[i]
    }
  }
  return name
}

/** Resolves each band's colour to linear light once, at world-build time. */
export function compileBands(bands: Band[]): CompiledBands {
  const c = new THREE.Color()
  return {
    masks: bands.map((b) => b.mask),
    colors: bands.map((b) => {
      c.set(b.color)
      return [c.r, c.g, c.b] as [number, number, number]
    }),
    names: bands.map((b) => b.name),
  }
}
