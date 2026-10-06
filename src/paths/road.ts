import { valueNoise } from '../explore/terrain'
import { sampleField, type StudyTerrain } from '../study/terrain'
import { atParam, corridor, sampleSpline, smoothProfile, smoothstep, type P2, type Sample } from './spline'

/**
 * A road: the spline is authored, and then it is the terrain that gives way.
 *
 *     control points → 2D spline → projected onto the ground → smoothed grade
 *                    → corridor levelled to the grade (cut and fill) → ribbon
 *
 * The first half is terrain → spline: the road takes its heights from the
 * ground beneath it. The second half is spline → terrain: once the grade has
 * been smoothed, the ground under and beside it is pulled to meet it — cut
 * through the rises, filled across the dips. A road that only did the first
 * half would ride every bump of the terrain like a draped ribbon; one that only
 * did the second would have nothing to level toward.
 */
export type RoadParams = {
  /** Paved width, world units. */
  width: number
  /** Embankment width either side, over which the terrain eases back to itself. */
  falloff: number
  /** Arc-length window of the grade smoothing, world units. 0 drapes the road on the ground. */
  smoothing: number
  /** How far the corridor is pulled to the grade: 0 leaves the ground alone, 1 levels it exactly. */
  influence: number
  /** ± fraction the width wanders along the road. */
  widthVariation: number
}

export type RoadResult = {
  samples: Sample[]
  /** Ground under each sample before the road — the raw projection. */
  raw: number[]
  /** The smoothed grade the road is built to. */
  grade: number[]
  halfWidth: number[]
  /** Per vertex, 0–1: how hard the road pulled it. For the debug tint. */
  weight: Float32Array
  stats: { length: number; rawMaxGrade: number; roadMaxGrade: number; cut: number; fill: number }
}

/** Steepest rise over any 0.5 units of the profile, as a percentage. */
function maxGrade(samples: Sample[], heights: number[]): number {
  let worst = 0
  let j = 0
  for (let i = 0; i < samples.length; i++) {
    while (j < samples.length - 1 && samples[j].s - samples[i].s < 0.5) j++
    const run = samples[j].s - samples[i].s
    if (run > 0.25) worst = Math.max(worst, Math.abs(heights[j] - heights[i]) / run)
  }
  return worst * 100
}

/** Builds the road over `height`, writing the levelled corridor into it. */
export function buildRoad(
  terrain: StudyTerrain,
  height: Float32Array,
  points: P2[],
  params: RoadParams,
): RoadResult {
  const samples = sampleSpline(points, terrain.cell * 0.75)
  const field = { res: terrain.res, size: terrain.size }
  const raw = samples.map((p) => sampleField(field, height, p.x, p.z))
  // Never below the waterline: where the projection dips into the lake the
  // grade becomes a causeway rather than a road along the lake bed.
  const floor = terrain.waterLevel + 0.05
  const grade = smoothProfile(raw, samples, params.smoothing).map((y) => Math.max(y, floor))
  const halfWidth = samples.map(
    (p) => (params.width / 2) * (1 + params.widthVariation * (valueNoise(p.s * 0.9, 3.7, 71) - 0.5) * 2),
  )

  const reach = Math.max(...halfWidth) + params.falloff
  const { dist, param } = corridor(field, samples, reach)
  const weight = new Float32Array(height.length)
  let cut = 0
  let fill = 0
  const area = terrain.cell * terrain.cell
  for (let k = 0; k < height.length; k++) {
    if (param[k] < 0) continue
    const hw = atParam(halfWidth, param[k])
    // Flat across the paved width, then an embankment that eases back into
    // whatever the ground was already doing.
    const w = 1 - smoothstep(hw, hw + Math.max(params.falloff, 1e-3), dist[k])
    if (w <= 0) continue
    const target = atParam(grade, param[k])
    const before = height[k]
    const after = before + (target - before) * w * params.influence
    height[k] = after
    weight[k] = w * params.influence
    if (after < before) cut += (before - after) * area
    else fill += (after - before) * area
  }

  return {
    samples,
    raw,
    grade,
    halfWidth,
    weight,
    stats: {
      length: samples[samples.length - 1]?.s ?? 0,
      rawMaxGrade: maxGrade(samples, raw),
      roadMaxGrade: maxGrade(samples, grade),
      cut,
      fill,
    },
  }
}
