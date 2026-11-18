import { add, cross, dist, dot, len, norm, scale, sub, type V3 } from './vec'

/**
 * Two-bone inverse kinematics, solved exactly.
 *
 * A thigh of length a and a shin of length b hang from a root; the foot must
 * reach a target. The two bones and the root-to-target line form a triangle
 * whose three sides are known, so the law of cosines gives the angle at the
 * root, and the knee lies on a circle around the root-to-target line. The
 * pole picks the one point on that circle the knee goes to: forward for a
 * mammal's hind knee, backward for its elbow, up and out for a spider.
 *
 * A target out of reach is clamped to the leg's length, so the leg points at
 * it straight rather than tearing — and the solver reports that it fell
 * short, which is how the stats panel counts contact errors.
 */
export type TwoBone = { mid: V3; end: V3; reached: boolean; distance: number }

export function solveTwoBone(root: V3, target: V3, a: number, b: number, pole: V3): TwoBone {
  const toTarget = sub(target, root)
  const distance = len(toTarget)
  const dir = distance > 1e-9 ? scale(toTarget, 1 / distance) : { x: 0, y: -1, z: 0 }
  const lo = Math.abs(a - b) + 1e-5
  const hi = a + b - 1e-5
  const d = Math.min(hi, Math.max(lo, distance))
  const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)))
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
  // The pole, made perpendicular to the root-to-target line.
  let perp = sub(pole, scale(dir, dot(pole, dir)))
  if (len(perp) < 1e-6) {
    perp = cross(dir, { x: 0, y: 0, z: 1 })
    if (len(perp) < 1e-6) perp = cross(dir, { x: 1, y: 0, z: 0 })
  }
  perp = norm(perp)
  const mid = add(root, add(scale(dir, a * cosA), scale(perp, a * sinA)))
  const end = add(root, scale(dir, d))
  return { mid, end, reached: distance <= hi + 1e-6, distance }
}

/** Bone lengths after a solve, for tests: they must be exactly a and b. */
export const boneLengths = (root: V3, s: TwoBone) => [dist(root, s.mid), dist(s.mid, s.end)]
