/**
 * The 2D polygon toolkit the city is built from.
 *
 * Everything in Topic 10 below the renderer happens on the ground plane, in
 * (x, z) world units, with no three.js in sight — so it can be lifted into
 * Wildform, or a worker, or a test, as it is.
 *
 * Orientation convention: a polygon with positive signed area (shoelace, x then
 * z) has its interior on the *left* of each edge. Faces traced from the road
 * graph come out that way, and `inset` relies on it.
 */

export type Vec = { x: number; z: number }
export type Polygon = Vec[]

export function signedArea(poly: Polygon): number {
  let s = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    s += a.x * b.z - b.x * a.z
  }
  return s / 2
}

export const area = (poly: Polygon) => Math.abs(signedArea(poly))

export function centroid(poly: Polygon): Vec {
  let cx = 0
  let cz = 0
  let a2 = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % n]
    const c = p.x * q.z - q.x * p.z
    a2 += c
    cx += (p.x + q.x) * c
    cz += (p.z + q.z) * c
  }
  if (Math.abs(a2) < 1e-12) {
    // Degenerate: fall back to the vertex mean rather than dividing by zero.
    let x = 0
    let z = 0
    for (const p of poly) {
      x += p.x
      z += p.z
    }
    return { x: x / poly.length, z: z / poly.length }
  }
  return { x: cx / (3 * a2), z: cz / (3 * a2) }
}

export function pointInPolygon(poly: Polygon, x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

export function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

/**
 * Where segment p→p+r meets segment q→q+s, as fractions along each, or null.
 * Parallel segments never meet here — a road laid exactly along another is
 * caught by the angle and separation rules instead.
 */
export function segmentHit(
  px: number, pz: number, rx: number, rz: number,
  qx: number, qz: number, sx: number, sz: number,
): { t: number; u: number } | null {
  const denom = rx * sz - rz * sx
  if (Math.abs(denom) < 1e-12) return null
  const wx = qx - px
  const wz = qz - pz
  const t = (wx * sz - wz * sx) / denom
  const u = (wx * rz - wz * rx) / denom
  return { t, u }
}

/** True if no two non-adjacent edges cross. O(n²), which is fine at plot sizes. */
export function isSimple(poly: Polygon): boolean {
  const n = poly.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      const c = poly[j]
      const d = poly[(j + 1) % n]
      const hit = segmentHit(a.x, a.z, b.x - a.x, b.z - a.z, c.x, c.z, d.x - c.x, d.z - c.z)
      if (hit && hit.t > 1e-9 && hit.t < 1 - 1e-9 && hit.u > 1e-9 && hit.u < 1 - 1e-9) return false
    }
  }
  return true
}

/** Drops vertices that sit on a straight line between their neighbours. */
export function simplify(poly: Polygon, tolerance = 0.05): Polygon {
  let out = poly
  for (let pass = 0; pass < 4; pass++) {
    const next: Polygon = []
    const n = out.length
    for (let i = 0; i < n; i++) {
      const prev = out[(i + n - 1) % n]
      const cur = out[i]
      const nxt = out[(i + 1) % n]
      const dist = distanceToSegment(cur.x, cur.z, prev.x, prev.z, nxt.x, nxt.z)
      const dup = Math.hypot(cur.x - prev.x, cur.z - prev.z) < 1e-6
      if (dist > tolerance && !dup) next.push(cur)
    }
    if (next.length === out.length || next.length < 3) return next.length < 3 ? out : next
    out = next
  }
  return out
}

/**
 * Cut a simple polygon — convex or not — by the infinite line through `p`
 * with normal `n`. Returns every piece, on both sides.
 *
 * A concave block cut by a line can fall into more than two pieces, which is
 * why this is not Sutherland–Hodgman: that clips to one half-plane and, on a
 * concave input, returns the pieces still joined by zero-width bridges along
 * the cut. Here the crossings are sorted along the line and paired — for a
 * simple polygon with no vertex on the line, consecutive crossings bound a
 * chord that lies inside it — and each piece is traced by walking the outline
 * and jumping across a chord whenever one is reached.
 *
 * A vertex exactly on the line is what breaks the pairing, so the line is
 * nudged off any vertex it touches first. The nudge is a thousandth of a
 * unit; nothing downstream can see it.
 */
export function splitPolygon(poly: Polygon, px: number, pz: number, nx: number, nz: number): Polygon[] {
  const n = poly.length
  let offset = 0
  let d: number[] = []
  for (let attempt = 0; attempt < 8; attempt++) {
    d = poly.map((v) => (v.x - px) * nx + (v.z - pz) * nz - offset)
    if (d.every((v) => Math.abs(v) > 1e-7)) break
    offset += 1e-3 * (attempt + 1)
  }
  if (d.every((v) => v > 0) || d.every((v) => v < 0)) return [poly]

  type Node = { x: number; z: number; cross: boolean; t: number; partner: number; seen: boolean }
  const nodes: Node[] = []
  const crossings: number[] = []
  // Direction along the line, for sorting the crossings.
  const lx = -nz
  const lz = nx
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    nodes.push({ x: a.x, z: a.z, cross: false, t: 0, partner: -1, seen: false })
    if (d[i] > 0 !== d[(i + 1) % n] > 0) {
      const f = d[i] / (d[i] - d[(i + 1) % n])
      const x = a.x + (b.x - a.x) * f
      const z = a.z + (b.z - a.z) * f
      crossings.push(nodes.length)
      nodes.push({ x, z, cross: true, t: x * lx + z * lz, partner: -1, seen: false })
    }
  }
  crossings.sort((i, j) => nodes[i].t - nodes[j].t)
  for (let k = 0; k + 1 < crossings.length; k += 2) {
    nodes[crossings[k]].partner = crossings[k + 1]
    nodes[crossings[k + 1]].partner = crossings[k]
  }

  const pieces: Polygon[] = []
  const m = nodes.length
  for (let start = 0; start < m; start++) {
    if (nodes[start].cross || nodes[start].seen) continue
    const piece: Polygon = []
    let i = start
    for (let guard = 0; guard < m * 2; guard++) {
      const node = nodes[i]
      piece.push({ x: node.x, z: node.z })
      if (!node.cross) node.seen = true
      if (node.cross && node.partner >= 0) {
        const partner = nodes[node.partner]
        piece.push({ x: partner.x, z: partner.z })
        i = (node.partner + 1) % m
      } else {
        i = (i + 1) % m
      }
      if (i === start) break
    }
    if (piece.length >= 3) pieces.push(piece)
  }
  return pieces
}

/** Andrew's monotone chain. Counter-clockwise (positive area), no collinear points. */
export function convexHull(points: Vec[]): Vec[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z)
  if (pts.length < 3) return pts
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)
  const lower: Vec[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Vec[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/**
 * Minimum-area oriented bounding box. `u` is the long axis, unit length;
 * `long` and `short` are full side lengths.
 *
 * The minimum-area box always has one side flush with an edge of the convex
 * hull, so trying each hull edge's direction is exact, not a search.
 */
export type Obb = { cx: number; cz: number; ux: number; uz: number; long: number; short: number }

export function orientedBox(poly: Polygon): Obb {
  const hull = convexHull(poly)
  let best: Obb | null = null
  let bestArea = Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (len < 1e-9) continue
    const ux = (b.x - a.x) / len
    const uz = (b.z - a.z) / len
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (const p of hull) {
      const u = p.x * ux + p.z * uz
      const v = -p.x * uz + p.z * ux
      if (u < u0) u0 = u
      if (u > u1) u1 = u
      if (v < v0) v0 = v
      if (v > v1) v1 = v
    }
    const boxArea = (u1 - u0) * (v1 - v0)
    if (boxArea < bestArea) {
      bestArea = boxArea
      const cu = (u0 + u1) / 2
      const cv = (v0 + v1) / 2
      const along = u1 - u0
      const across = v1 - v0
      const cx = cu * ux - cv * uz
      const cz = cu * uz + cv * ux
      best =
        along >= across
          ? { cx, cz, ux, uz, long: along, short: across }
          : { cx, cz, ux: -uz, uz: ux, long: across, short: along }
    }
  }
  if (!best) {
    const c = centroid(poly)
    return { cx: c.x, cz: c.z, ux: 1, uz: 0, long: 0, short: 0 }
  }
  return best
}

/**
 * Move every edge inward by its own distance, and return the polygon those
 * lines bound — or null when the polygon is too small to survive the offset.
 *
 * Per-edge distances because a block's sides are different roads: a primary
 * is wider than a lane, and the plot line sits half a road width back from
 * each centreline. Each new vertex is where two neighbouring offset lines
 * meet. An edge shorter than the offset turns round — its offset copy points
 * backwards — and that edge is removed and the corner re-solved, which is the
 * one event of a straight skeleton this needs. What survives is checked for
 * self-intersection and dropped if it fails, rather than trusted.
 */
export function inset(poly: Polygon, distances: number[]): Polygon | null {
  const n0 = poly.length
  if (n0 < 3) return null
  // Offset line of edge i: a point on it and its unit direction. Interior is
  // on the left of a positive polygon, so inward is (-dz, dx).
  let lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n0]
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1e-9
    const dx = (b.x - a.x) / len
    const dz = (b.z - a.z) / len
    return { x: a.x - dz * distances[i], z: a.z + dx * distances[i], dx, dz }
  })
  for (let pass = 0; pass < n0; pass++) {
    const n = lines.length
    if (n < 3) return null
    // Vertex i is where the offset lines of edges i-1 and i meet.
    const out: Polygon = []
    for (let i = 0; i < n; i++) {
      const prev = lines[(i + n - 1) % n]
      const cur = lines[i]
      const hit = segmentHit(prev.x, prev.z, prev.dx, prev.dz, cur.x, cur.z, cur.dx, cur.dz)
      if (!hit || Math.abs(prev.dx * cur.dz - prev.dz * cur.dx) < 1e-3) {
        // Nearly collinear neighbours: the start of this edge's offset line.
        out.push({ x: cur.x, z: cur.z })
      } else {
        out.push({ x: prev.x + prev.dx * hit.t, z: prev.z + prev.dz * hit.t })
      }
    }
    // An offset edge that now points against its original has collapsed:
    // drop its line and let its neighbours meet.
    let flipped = -1
    for (let i = 0; i < n; i++) {
      const a = out[i]
      const b = out[(i + 1) % n]
      if ((b.x - a.x) * lines[i].dx + (b.z - a.z) * lines[i].dz < 0) {
        flipped = i
        break
      }
    }
    if (flipped < 0) {
      if (signedArea(out) <= 0 || !isSimple(out)) return null
      return out
    }
    lines = lines.filter((_, i) => i !== flipped)
  }
  return null
}

/** Distance from a point to the polygon's outline. */
export function distanceToOutline(poly: Polygon, x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    best = Math.min(best, distanceToSegment(x, z, a.x, a.z, b.x, b.z))
  }
  return best
}
