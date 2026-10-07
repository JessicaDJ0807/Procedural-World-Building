import * as THREE from 'three'

/**
 * A water or road surface as a strip along a centreline: two vertices per
 * sample, left and right, and nothing else.
 *
 * Shared by Explore's river and Topic 6's paths, because both had the same
 * fault. A strip is built by offsetting the centreline sideways by the
 * half-width, and an offset curve has a cusp wherever the offset is larger
 * than the radius of the bend it is going round: the inner edge stops, runs
 * backwards, and the quads there fold over themselves into bow-ties. Verdant's
 * river turned by up to 1.11 rad per 20-unit node — a bend radius of 18 units
 * — while being *widened* on bends to a half-width of up to 33.5.
 *
 * Four things keep the strip clean:
 *
 *  1. **The frame comes from a smoothed curve.** Left and right are the
 *     tangent turned a quarter, and the tangent is taken from the centreline
 *     after Gaussian smoothing, so it turns gradually instead of jumping at
 *     every node. Smoothing, not an interpolating spline: a Catmull–Rom has to
 *     pass through each node, so it squeezes a 64° turn into a few units right
 *     at the node — a tighter bend than the polyline had. That was the first
 *     attempt, and it took Verdant from 1 folded quad to 21.
 *  2. **The half-width is clamped to the bend.** Never more than 80% of the
 *     local radius of curvature, so the inner edge can still move forward.
 *     The clamp is smoothed and re-applied, so a tight bend narrows the water
 *     over a stretch rather than notching it.
 *  3. **Folds are repaired, not just avoided.** If an edge vertex would still
 *     step backwards, it stays where the previous one was — a pinch rather
 *     than an overlap — so a strip from this module cannot fold, whatever it
 *     is given.
 *  4. **Nothing moves.** The strip is static and flat across; any motion —
 *     ripples, streaks, flow — belongs in the shader, reading `uv`.
 *
 * `uv.x` runs 0 → 1 left to right; `uv.y` is distance along the centreline in
 * world units, so a shader can scroll along the flow with no tangent passed in
 * and a ripple keeps its size on a long reach and a short one.
 */

export type RibbonSample = {
  x: number
  z: number
  /** Unit tangent in plan, pointing along the strip. */
  tx: number
  tz: number
  /** Distance along the centreline. */
  s: number
}

/**
 * A polyline resampled at even spacing and then Gaussian-smoothed.
 *
 * Returns, for each sample, the fractional index into the input — 12.4 is 40%
 * of the way from point 12 to 13 — so per-point values such as a water level
 * can be carried onto the samples. Interpolating linearly by index keeps a
 * monotonic profile monotonic. The ends are held in place, so the strip still
 * starts at the source and ends at the mouth.
 *
 * `sigma` is in world units: how far a turn is spread. The smoothed curve cuts
 * inside each corner by roughly that much, so it should stay well under the
 * width of whatever channel the strip has to sit in.
 */
export function smoothCentreline(
  points: { x: number; z: number }[],
  spacing: number,
  sigma: number,
): { samples: RibbonSample[]; index: number[] } {
  if (points.length < 2) return { samples: [], index: [] }
  // Linear resample first, so the smoothing window is a fixed distance rather
  // than a fixed number of unevenly spaced points.
  const xs: number[] = []
  const zs: number[] = []
  const index: number[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing))
    for (let k = 0; k < steps; k++) {
      const f = k / steps
      xs.push(a.x + (b.x - a.x) * f)
      zs.push(a.z + (b.z - a.z) * f)
      index.push(i + f)
    }
  }
  const last = points[points.length - 1]
  xs.push(last.x)
  zs.push(last.z)
  index.push(points.length - 1)

  const n = xs.length
  const radius = Math.max(1, Math.ceil((sigma * 2.5) / spacing))
  const weights: number[] = []
  for (let k = -radius; k <= radius; k++) weights.push(Math.exp(-0.5 * ((k * spacing) / sigma) ** 2))
  const sx = new Array<number>(n)
  const sz = new Array<number>(n)
  // Past either end the line is continued by point reflection through the end
  // point: p(−k) = 2·p(0) − p(k). Averaging a symmetric window over that lands
  // exactly on the end point, so the source and the mouth stay put, while the
  // samples next to them still get the full window. The first version shrank
  // the window toward the ends instead, which left the first and last few
  // samples unsmoothed — exactly where a trace turns hardest, swinging from
  // its first guide onto the fall line — and every fold that survived the
  // rest of the fix was there.
  const at = (k: number, values: number[], end: number) => {
    if (k < 0) return 2 * values[0] - values[Math.min(-k, n - 1)]
    if (k > n - 1) return 2 * values[end] - values[Math.max(2 * end - k, 0)]
    return values[k]
  }
  for (let i = 0; i < n; i++) {
    let wx = 0
    let wz = 0
    let total = 0
    for (let k = -radius; k <= radius; k++) {
      const w = weights[k + radius]
      wx += at(i + k, xs, n - 1) * w
      wz += at(i + k, zs, n - 1) * w
      total += w
    }
    sx[i] = wx / total
    sz[i] = wz / total
  }

  const samples: RibbonSample[] = []
  let s = 0
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(sx[i] - sx[i - 1], sz[i] - sz[i - 1])
    const a = Math.max(i - 1, 0)
    const b = Math.min(i + 1, n - 1)
    const len = Math.hypot(sx[b] - sx[a], sz[b] - sz[a]) || 1
    samples.push({ x: sx[i], z: sz[i], tx: (sx[b] - sx[a]) / len, tz: (sz[b] - sz[a]) / len, s })
  }
  return { samples, index }
}

/** Linear read of a per-point array at a fractional index. */
export function atIndex(values: ArrayLike<number>, index: number): number {
  const i = Math.min(Math.max(Math.floor(index), 0), values.length - 1)
  const j = Math.min(i + 1, values.length - 1)
  return values[i] + (values[j] - values[i]) * (index - i)
}

/**
 * Half-widths that cannot fold: each at most `factor` × the local radius of
 * curvature, measured as the tangent's turn over the neighbouring samples.
 *
 * With `side`, only that side is clamped, and only on bends where it is the
 * inside. The outside of a bend cannot fold — its edge is the longer curve —
 * so a strip with separate widths per side can keep its full width there.
 */
export function clampToBends(
  samples: RibbonSample[],
  halfWidth: number[],
  factor = 0.8,
  side?: 'left' | 'right',
): number[] {
  const n = samples.length
  if (n < 3) return halfWidth.slice()
  const limit = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const a = samples[Math.max(i - 2, 0)]
    const b = samples[Math.min(i + 2, n - 1)]
    const signed = Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz)
    const turn = Math.abs(signed)
    const run = Math.max(b.s - a.s, 1e-6)
    // A positive turn swings toward +z of a tangent along +x, which is the
    // right side (left is (+tz, −tx)); so right is the inside of positive turns.
    const inside = signed > 0 ? 'right' : 'left'
    limit[i] = turn < 1e-6 || (side && side !== inside) ? Infinity : (factor * run) / turn
  }
  const clamped = halfWidth.map((w, i) => Math.min(w, limit[i]))
  // Smoothed, then re-clamped: the smoothing keeps a narrowing gradual, and
  // the second clamp keeps the guarantee the smoothing would otherwise lift.
  const radius = 4
  const smoothed = clamped.map((_, i) => {
    let sum = 0
    let count = 0
    for (let j = i - radius; j <= i + radius; j++) {
      if (j < 0 || j >= n) continue
      sum += clamped[j]
      count++
    }
    return sum / count
  })
  return smoothed.map((w, i) => Math.min(w, limit[i]))
}

export type RibbonEdges = {
  left: Float64Array
  right: Float64Array
  /** Vertices held back to stop a fold. Zero on a well-behaved centreline. */
  pinched: number
}

/**
 * Left and right edge positions in plan, folds repaired.
 *
 * Left is the tangent turned a quarter, (+tz, −tx): with the tangent along +x
 * that is −z, which with the index order in `ribbonGeometry` winds the strip
 * upward.
 */
/** One half-width for both sides, or one per side. */
export type RibbonWidths = number[] | { left: number[]; right: number[] }

export function ribbonEdges(samples: RibbonSample[], widths: RibbonWidths): RibbonEdges {
  const n = samples.length
  const left = new Float64Array(n * 2)
  const right = new Float64Array(n * 2)
  const wl = Array.isArray(widths) ? widths : widths.left
  const wr = Array.isArray(widths) ? widths : widths.right
  let pinched = 0
  for (let i = 0; i < n; i++) {
    const p = samples[i]
    left[i * 2] = p.x + p.tz * wl[i]
    left[i * 2 + 1] = p.z - p.tx * wl[i]
    right[i * 2] = p.x - p.tz * wr[i]
    right[i * 2 + 1] = p.z + p.tx * wr[i]
    if (i === 0) continue
    // Along the centreline segment this sample ends, an edge must advance.
    const tx = p.x - samples[i - 1].x
    const tz = p.z - samples[i - 1].z
    for (const edge of [left, right]) {
      const dx = edge[i * 2] - edge[i * 2 - 2]
      const dz = edge[i * 2 + 1] - edge[i * 2 - 1]
      if (dx * tx + dz * tz <= 0) {
        edge[i * 2] = edge[i * 2 - 2]
        edge[i * 2 + 1] = edge[i * 2 - 1]
        pinched++
      }
    }
  }
  return { left, right, pinched }
}

/**
 * The strip itself. `heightAt` gives each vertex's elevation — the water level
 * for a river, which is the same on both sides; the draped ground for a road.
 */
export function ribbonGeometry(
  samples: RibbonSample[],
  widths: RibbonWidths,
  heightAt: (x: number, z: number, i: number) => number,
): THREE.BufferGeometry {
  const n = samples.length
  const { left, right } = ribbonEdges(samples, widths)
  const positions = new Float32Array(n * 2 * 3)
  const uvs = new Float32Array(n * 2 * 2)
  const index = new Uint32Array(Math.max(n - 1, 0) * 6)
  for (let i = 0; i < n; i++) {
    const lx = left[i * 2]
    const lz = left[i * 2 + 1]
    const rx = right[i * 2]
    const rz = right[i * 2 + 1]
    positions.set([lx, heightAt(lx, lz, i), lz, rx, heightAt(rx, rz, i), rz], i * 6)
    uvs.set([0, samples[i].s, 1, samples[i].s], i * 4)
    if (i < n - 1) {
      const a = i * 2
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeVertexNormals()
  return g
}

/**
 * Counts quads that fold, on the edges a strip would actually be built from:
 * an edge running backwards against the centreline, or a quad whose winding
 * differs from the first one's. Used by the checks behind the claims above.
 */
export function countFolds(samples: RibbonSample[], edges: RibbonEdges): number {
  const { left, right } = edges
  let folds = 0
  let reference = 0
  for (let i = 0; i < samples.length - 1; i++) {
    const tx = samples[i + 1].x - samples[i].x
    const tz = samples[i + 1].z - samples[i].z
    const ldx = left[i * 2 + 2] - left[i * 2]
    const ldz = left[i * 2 + 3] - left[i * 2 + 1]
    const rdx = right[i * 2 + 2] - right[i * 2]
    const rdz = right[i * 2 + 3] - right[i * 2 + 1]
    // A pinched edge does not move at all: degenerate, not folded.
    const backwards = ldx * tx + ldz * tz < 0 || rdx * tx + rdz * tz < 0
    // Winding of the quad's diagonal triangle, right-from-left against the
    // advance of whichever edge moved.
    const ax = right[i * 2] - left[i * 2]
    const az = right[i * 2 + 1] - left[i * 2 + 1]
    const mx = ldx !== 0 || ldz !== 0 ? ldx : rdx
    const mz = ldx !== 0 || ldz !== 0 ? ldz : rdz
    const cross = Math.sign(ax * mz - az * mx)
    if (i === 0) reference = cross
    if (backwards || (cross !== 0 && cross !== reference)) folds++
  }
  return folds
}
