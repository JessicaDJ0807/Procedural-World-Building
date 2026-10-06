import * as THREE from 'three'

/**
 * The 2D half of a path: a curve on the map, before it knows about the ground.
 *
 * A path here is authored in plan view — x and z only — and gets its height
 * from somewhere else: the terrain under it, a smoothed grade, a descending
 * water surface. Keeping the curve 2D is the point of the study. "Project a
 * line onto a terrain" only means something if the line exists without the
 * terrain first.
 */
export type P2 = { x: number; z: number }

export type Sample = {
  x: number
  z: number
  /** Arc length from the start, in world units. */
  s: number
  /** Unit tangent in plan. */
  tx: number
  tz: number
}

/**
 * Centripetal Catmull–Rom through the points, resampled at even arc length.
 *
 * Centripetal (α = 0.5) rather than uniform because uniform Catmull–Rom
 * overshoots and can loop when two control points are close and the next is
 * far — exactly what dragging a handle produces. Even arc-length spacing
 * matters downstream: the grade smoothing is a moving average over samples,
 * and with uneven spacing its window would change width along the road.
 */
export function sampleSpline(points: P2[], spacing: number): Sample[] {
  if (points.length < 2) return []
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
    false,
    'centripetal',
  )
  const length = curve.getLength()
  const n = Math.max(2, Math.ceil(length / spacing) + 1)
  const pts = curve.getSpacedPoints(n - 1)
  return withTangents(pts.map((p) => ({ x: p.x, z: p.z })))
}

/** Arc length and tangents for a polyline already spaced the way it should be. */
export function withTangents(points: P2[]): Sample[] {
  const out: Sample[] = []
  let s = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) s += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z)
    const a = points[Math.max(i - 1, 0)]
    const b = points[Math.min(i + 1, points.length - 1)]
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
    out.push({ x: points[i].x, z: points[i].z, s, tx: (b.x - a.x) / len, tz: (b.z - a.z) / len })
  }
  return out
}

/**
 * Moving average over arc length, three box passes (close to a Gaussian).
 *
 * The window is in world units, so "smoothing 1.5" means the same thing on a
 * short road and a long one.
 */
export function smoothProfile(values: number[], samples: Sample[], window: number): number[] {
  if (window <= 0 || values.length < 3) return values.slice()
  const spacing = samples[samples.length - 1].s / (samples.length - 1) || 1
  const radius = Math.max(1, Math.round(window / spacing / 2))
  let current = values.slice()
  for (let pass = 0; pass < 3; pass++) {
    const next = new Array<number>(current.length)
    for (let i = 0; i < current.length; i++) {
      let sum = 0
      let count = 0
      for (let j = i - radius; j <= i + radius; j++) {
        // Clamped rather than wrapped: an end must not be averaged with the
        // other end of the road.
        sum += current[Math.min(Math.max(j, 0), current.length - 1)]
        count++
      }
      next[i] = sum / count
    }
    current = next
  }
  return current
}

/**
 * For every grid vertex near the polyline: distance to it, and where along it.
 *
 * Built segment by segment over each segment's bounding box rather than by
 * asking every vertex about every segment. A 129² grid against two hundred
 * segments is 3.3 million distance tests the brute-force way; the boxes cut it
 * to the corridor, which is what keeps a handle drag interactive.
 *
 * `param` is fractional: 12.4 means 40% of the way from sample 12 to 13, so a
 * caller can interpolate the path's height there rather than snap to a sample.
 */
export function corridor(
  grid: { res: number; size: number },
  samples: Sample[],
  reach: number,
): { dist: Float32Array; param: Float32Array } {
  const { res, size } = grid
  const dist = new Float32Array(res * res).fill(Infinity)
  const param = new Float32Array(res * res).fill(-1)
  const step = size / (res - 1)
  const half = size / 2
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]
    const b = samples[i + 1]
    const minI = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach + half) / step))
    const maxI = Math.min(res - 1, Math.ceil((Math.max(a.x, b.x) + reach + half) / step))
    const minJ = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach + half) / step))
    const maxJ = Math.min(res - 1, Math.ceil((Math.max(a.z, b.z) + reach + half) / step))
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz || 1e-9
    for (let j = minJ; j <= maxJ; j++) {
      const z = -half + j * step
      for (let ii = minI; ii <= maxI; ii++) {
        const x = -half + ii * step
        const u = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2))
        const d = Math.hypot(x - (a.x + dx * u), z - (a.z + dz * u))
        const k = j * res + ii
        if (d < dist[k]) {
          dist[k] = d
          param[k] = i + u
        }
      }
    }
  }
  return { dist, param }
}

/** Linear read of a per-sample array at a fractional sample index. */
export function atParam(values: ArrayLike<number>, param: number): number {
  const i = Math.min(Math.max(Math.floor(param), 0), values.length - 1)
  const j = Math.min(i + 1, values.length - 1)
  const f = param - i
  return values[i] + (values[j] - values[i]) * f
}

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}
