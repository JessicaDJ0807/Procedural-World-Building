/**
 * Turning a sampled density field into triangles.
 *
 * Two meshers, because "voxel" means two different things and the difference
 * is the point of the topic. The blocks mesher treats each sample as a solid
 * cube and shows you the grid itself. Surface nets treats the samples as
 * measurements of a smooth surface passing between them, and reconstructs
 * that surface. Same field, same resolution, two honest readings of it.
 *
 * Neither mesher imports three.js. They return plain typed arrays, which
 * keeps them runnable in a plain Node script — which is how the numbers in
 * the write-up were produced.
 */

import { DOMAIN } from './density'

export type Mesh = {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  /** Triangles actually emitted. */
  triangles: number
  vertices: number
  ms: number
}

const EMPTY: Mesh = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  indices: new Uint32Array(0),
  triangles: 0,
  vertices: 0,
  ms: 0,
}

/* ---------------------------------------------------------------------------
 * Blocks
 * ------------------------------------------------------------------------- */

/** Unit face, as 4 corners in CCW order seen from outside, per axis direction. */
const FACES: { dir: [number, number, number]; corners: [number, number, number][] }[] = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], corners: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]] },
]

export type BlockStats = {
  /** Samples that landed inside the solid. */
  filled: number
  /** Faces actually emitted. */
  faces: number
  /** Faces a mesher that ignored neighbours would have emitted. */
  naiveFaces: number
}

/**
 * One cube per sample below the isolevel, with interior faces dropped.
 *
 * A face is emitted only where the neighbouring voxel is empty. That check is
 * the whole optimisation and it is worth a great deal: a solid is mostly
 * interior, and every interior face is hidden by definition. The saving is
 * reported in `BlockStats` rather than asserted here, because it depends
 * entirely on the shape — a thin shell saves far less than a filled sphere.
 *
 * Voxels on the boundary of the grid emit their outward face. The alternative
 * is a solid that looks hollow wherever it is clipped by the domain.
 */
export function meshBlocks(
  field: Float32Array,
  resolution: number,
  iso: number,
): Mesh & { stats: BlockStats } {
  const started = performance.now()
  const r = resolution
  const step = (DOMAIN * 2) / Math.max(r - 1, 1)
  const origin = -DOMAIN - step / 2 // cube corner, so the sample sits at its centre

  const at = (x: number, y: number, z: number) => field[(z * r + y) * r + x]
  const solid = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < r && y < r && z < r && at(x, y, z) < iso

  let filled = 0
  let faces = 0
  for (let z = 0; z < r; z++) {
    for (let y = 0; y < r; y++) {
      for (let x = 0; x < r; x++) {
        if (!solid(x, y, z)) continue
        filled++
        for (const face of FACES) {
          if (!solid(x + face.dir[0], y + face.dir[1], z + face.dir[2])) faces++
        }
      }
    }
  }

  if (faces === 0) {
    return { ...EMPTY, ms: performance.now() - started, stats: { filled, faces, naiveFaces: filled * 6 } }
  }

  const positions = new Float32Array(faces * 4 * 3)
  const normals = new Float32Array(faces * 4 * 3)
  const indices = new Uint32Array(faces * 6)
  let v = 0
  let i = 0
  let quad = 0

  for (let z = 0; z < r; z++) {
    for (let y = 0; y < r; y++) {
      for (let x = 0; x < r; x++) {
        if (!solid(x, y, z)) continue
        for (const face of FACES) {
          if (solid(x + face.dir[0], y + face.dir[1], z + face.dir[2])) continue
          for (const corner of face.corners) {
            positions[v] = origin + (x + corner[0]) * step
            positions[v + 1] = origin + (y + corner[1]) * step
            positions[v + 2] = origin + (z + corner[2]) * step
            normals[v] = face.dir[0]
            normals[v + 1] = face.dir[1]
            normals[v + 2] = face.dir[2]
            v += 3
          }
          const base = quad * 4
          indices[i] = base
          indices[i + 1] = base + 1
          indices[i + 2] = base + 2
          indices[i + 3] = base
          indices[i + 4] = base + 2
          indices[i + 5] = base + 3
          i += 6
          quad++
        }
      }
    }
  }

  return {
    positions,
    normals,
    indices,
    triangles: faces * 2,
    vertices: faces * 4,
    ms: performance.now() - started,
    stats: { filled, faces, naiveFaces: filled * 6 },
  }
}

/* ---------------------------------------------------------------------------
 * Greedy blocks
 * ------------------------------------------------------------------------- */

export type GreedyStats = BlockStats & {
  /** Merged rectangles emitted, against one per exposed face. */
  quads: number
}

/**
 * The same exposed faces, merged into the largest rectangles that tile them.
 *
 * Face culling already threw away everything hidden inside the solid. What is
 * left is still one quad per surface voxel, and a flat wall of a thousand
 * voxels is a thousand coplanar quads describing a rectangle. This walks each
 * axis-aligned slice, grows a run along one axis, then grows that run along
 * the other while every row still matches — the standard greedy sweep.
 *
 * The saving is a flatness measurement, so it is reported rather than claimed:
 * terrain and slabs merge well, a gyroid barely at all.
 */
export function meshGreedyBlocks(
  field: Float32Array,
  resolution: number,
  iso: number,
): Mesh & { stats: GreedyStats } {
  const started = performance.now()
  const r = resolution
  const step = (DOMAIN * 2) / Math.max(r - 1, 1)
  const origin = -DOMAIN - step / 2

  const solid = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < r && y < r && z < r && field[(z * r + y) * r + x] < iso

  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  let filled = 0
  let faces = 0
  let quads = 0

  for (let z = 0; z < r; z++)
    for (let y = 0; y < r; y++)
      for (let x = 0; x < r; x++) if (solid(x, y, z)) filled++

  // (axis, sign) pairs. u and v are the two axes spanning the slice.
  const SWEEPS: { axis: number; sign: number; u: number; v: number }[] = [
    { axis: 0, sign: 1, u: 1, v: 2 },
    { axis: 0, sign: -1, u: 1, v: 2 },
    { axis: 1, sign: 1, u: 0, v: 2 },
    { axis: 1, sign: -1, u: 0, v: 2 },
    { axis: 2, sign: 1, u: 0, v: 1 },
    { axis: 2, sign: -1, u: 0, v: 1 },
  ]

  const mask = new Uint8Array(r * r)
  const cell = [0, 0, 0]
  const corner = [0, 0, 0]

  for (const sweep of SWEEPS) {
    const { axis, sign, u, v } = sweep
    const normal = [0, 0, 0]
    normal[axis] = sign

    for (let slice = 0; slice < r; slice++) {
      mask.fill(0)
      for (let a = 0; a < r; a++) {
        for (let b = 0; b < r; b++) {
          cell[axis] = slice
          cell[u] = a
          cell[v] = b
          if (!solid(cell[0], cell[1], cell[2])) continue
          const nx = cell[0] + normal[0]
          const ny = cell[1] + normal[1]
          const nz = cell[2] + normal[2]
          if (solid(nx, ny, nz)) continue
          mask[a * r + b] = 1
          faces++
        }
      }

      for (let a = 0; a < r; a++) {
        for (let b = 0; b < r; b++) {
          if (!mask[a * r + b]) continue

          // Grow along v, then along u while every row of that width matches.
          let width = 1
          while (b + width < r && mask[a * r + b + width]) width++
          let height = 1
          grow: while (a + height < r) {
            for (let k = 0; k < width; k++) {
              if (!mask[(a + height) * r + b + k]) break grow
            }
            height++
          }
          for (let i = 0; i < height; i++)
            for (let k = 0; k < width; k++) mask[(a + i) * r + b + k] = 0

          // The face plane sits on the far side of the voxel for a positive
          // sweep and the near side for a negative one.
          const plane = origin + (slice + (sign > 0 ? 1 : 0)) * step
          const base = positions.length / 3
          const spans: [number, number][] = [
            [a, b],
            [a + height, b],
            [a + height, b + width],
            [a, b + width],
          ]
          for (const [ai, bi] of spans) {
            corner[axis] = plane
            corner[u] = origin + ai * step
            corner[v] = origin + bi * step
            positions.push(corner[0], corner[1], corner[2])
            normals.push(normal[0], normal[1], normal[2])
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
          quads++
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    triangles: indices.length / 3,
    vertices: positions.length / 3,
    ms: performance.now() - started,
    stats: { filled, faces, naiveFaces: filled * 6, quads },
  }
}

/* ---------------------------------------------------------------------------
 * Dual methods: surface nets and dual contouring
 *
 * These two are the same algorithm. Both put one vertex in every cell the
 * surface passes through, and both join four such vertices into a quad around
 * every grid edge that changes sign. The ONLY difference is where inside the
 * cell that vertex goes, which is why they share everything here.
 * ------------------------------------------------------------------------- */

// Corner c of a cell is offset by (c & 1, (c >> 1) & 1, (c >> 2) & 1).
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
]

/** Where the cell's vertex goes. */
export type Placement =
  /** Average of the edge crossings. Surface nets. */
  | 'centroid'
  /** Least-squares point agreeing with every crossing's tangent plane. Dual contouring. */
  | 'qef'

/** Gradient of the sampled field at a grid point, by central difference. */
function gridGradient(field: Float32Array, r: number, x: number, y: number, z: number) {
  const at = (a: number, b: number, c: number) => field[(c * r + b) * r + a]
  const lo = (v: number) => Math.max(v - 1, 0)
  const hi = (v: number) => Math.min(v + 1, r - 1)
  return [
    at(hi(x), y, z) - at(lo(x), y, z),
    at(x, hi(y), z) - at(x, lo(y), z),
    at(x, y, hi(z)) - at(x, y, lo(z)),
  ] as [number, number, number]
}

/**
 * Solves the 3×3 normal equations for the QEF, regularised toward the mass
 * point.
 *
 * The quadratic error function is Σ (nᵢ·(x − pᵢ))², minimised where every
 * crossing's tangent plane agrees. On a flat wall every normal is the same and
 * the system is rank 1 — the minimum is a whole plane of points, and without
 * help the solve picks an arbitrary one and the surface tears. `lambda` pulls
 * the answer toward the centroid exactly where the planes fail to pin it down,
 * which is what makes a sharp-feature method safe to use on smooth geometry.
 */
function solveQef(
  ata: Float64Array,
  atb: Float64Array,
  centre: [number, number, number],
  lambda: number,
): [number, number, number] {
  const [a00, a01, a02, a11, a12, a22] = ata
  const m00 = a00 + lambda
  const m11 = a11 + lambda
  const m22 = a22 + lambda
  const c0 = m11 * m22 - a12 * a12
  const c1 = a02 * a12 - a01 * m22
  const c2 = a01 * a12 - a02 * m11
  const det = m00 * c0 + a01 * c1 + a02 * c2
  if (Math.abs(det) < 1e-12) return centre

  // No lambda term on the right: the system is solved for the offset FROM the
  // centroid, so the pull toward it contributes zero here and only appears on
  // the diagonal above.
  const b0 = atb[0]
  const b1 = atb[1]
  const b2 = atb[2]
  const i00 = c0 / det
  const i01 = c1 / det
  const i02 = c2 / det
  const i11 = (m00 * m22 - a02 * a02) / det
  const i12 = (a01 * a02 - m00 * a12) / det
  const i22 = (m00 * m11 - a01 * a01) / det
  return [
    centre[0] + i00 * b0 + i01 * b1 + i02 * b2,
    centre[1] + i01 * b0 + i11 * b1 + i12 * b2,
    centre[2] + i02 * b0 + i12 * b1 + i22 * b2,
  ]
}

/**
 * The shared dual mesher.
 *
 * `sdf`, when given, is the analytic field. Dual contouring uses it to take an
 * exact gradient at the exact crossing point, which is the whole reason this
 * page can reconstruct a sharp corner: most implementations have only the
 * sampled grid and must interpolate a normal, and an interpolated normal near
 * an edge is the average of two faces rather than either of them.
 */
function meshDual(
  field: Float32Array,
  resolution: number,
  iso: number,
  placement: Placement,
  sdf?: (x: number, y: number, z: number) => number,
): Mesh {
  const started = performance.now()
  const r = resolution
  if (r < 2) return EMPTY

  const cells = r - 1
  const step = (DOMAIN * 2) / Math.max(r - 1, 1)
  const at = (x: number, y: number, z: number) => field[(z * r + y) * r + x]

  const vertexAt = new Int32Array(cells * cells * cells).fill(-1)
  const positions: number[] = []
  const normals: number[] = []
  const corner = new Float64Array(8)
  const ata = new Float64Array(6)
  const atb = new Float64Array(3)
  const h = step * 0.35 // gradient step, when sampling the analytic field

  for (let z = 0; z < cells; z++) {
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        let mask = 0
        for (let c = 0; c < 8; c++) {
          const value = at(x + (c & 1), y + ((c >> 1) & 1), z + ((c >> 2) & 1))
          corner[c] = value
          if (value < iso) mask |= 1 << c
        }
        if (mask === 0 || mask === 255) continue

        ata.fill(0)
        atb.fill(0)
        let sx = 0
        let sy = 0
        let sz = 0
        let crossings = 0
        // Crossings in world space, so the QEF is solved in the same units the
        // gradients are measured in.
        const px: number[] = []
        const py: number[] = []
        const pz: number[] = []
        const nx: number[] = []
        const ny: number[] = []
        const nz: number[] = []

        for (const [a, b] of EDGES) {
          const va = corner[a]
          const vb = corner[b]
          if ((va < iso) === (vb < iso)) continue
          const t = (iso - va) / (vb - va)
          const ax = a & 1
          const ay = (a >> 1) & 1
          const az = (a >> 2) & 1
          const ox = ax + ((b & 1) - ax) * t
          const oy = ay + (((b >> 1) & 1) - ay) * t
          const oz = az + (((b >> 2) & 1) - az) * t
          sx += ox
          sy += oy
          sz += oz
          crossings++

          if (placement === 'qef') {
            const wx = -DOMAIN + (x + ox) * step
            const wy = -DOMAIN + (y + oy) * step
            const wz = -DOMAIN + (z + oz) * step
            let gx: number
            let gy: number
            let gz: number
            if (sdf) {
              gx = sdf(wx + h, wy, wz) - sdf(wx - h, wy, wz)
              gy = sdf(wx, wy + h, wz) - sdf(wx, wy - h, wz)
              gz = sdf(wx, wy, wz + h) - sdf(wx, wy, wz - h)
            } else {
              // No analytic field: interpolate the grid gradient along the edge.
              const ga = gridGradient(field, r, x + ax, y + ay, z + az)
              const gb = gridGradient(field, r, x + (b & 1), y + ((b >> 1) & 1), z + ((b >> 2) & 1))
              gx = ga[0] + (gb[0] - ga[0]) * t
              gy = ga[1] + (gb[1] - ga[1]) * t
              gz = ga[2] + (gb[2] - ga[2]) * t
            }
            const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1
            px.push(wx)
            py.push(wy)
            pz.push(wz)
            nx.push(gx / len)
            ny.push(gy / len)
            nz.push(gz / len)
          }
        }

        let vx = -DOMAIN + (x + sx / crossings) * step
        let vy = -DOMAIN + (y + sy / crossings) * step
        let vz = -DOMAIN + (z + sz / crossings) * step

        if (placement === 'qef' && px.length > 0) {
          for (let i = 0; i < px.length; i++) {
            const a0 = nx[i]
            const a1 = ny[i]
            const a2 = nz[i]
            ata[0] += a0 * a0
            ata[1] += a0 * a1
            ata[2] += a0 * a2
            ata[3] += a1 * a1
            ata[4] += a1 * a2
            ata[5] += a2 * a2
            // Residual measured from the centroid, so the solve returns an
            // offset from it rather than an absolute position.
            const d = a0 * (px[i] - vx) + a1 * (py[i] - vy) + a2 * (pz[i] - vz)
            atb[0] += a0 * d
            atb[1] += a1 * d
            atb[2] += a2 * d
          }
          const solved = solveQef(ata, atb, [vx, vy, vz], 0.08)
          // Clamping to the cell is what keeps a near-degenerate solve from
          // throwing a vertex across the model. A sharp corner sits inside its
          // own cell, so nothing that should be sharp is lost to this.
          const lo = [-DOMAIN + x * step, -DOMAIN + y * step, -DOMAIN + z * step]
          vx = Math.min(Math.max(solved[0], lo[0]), lo[0] + step)
          vy = Math.min(Math.max(solved[1], lo[1]), lo[1] + step)
          vz = Math.min(Math.max(solved[2], lo[2]), lo[2] + step)
        }

        vertexAt[(z * cells + y) * cells + x] = positions.length / 3
        positions.push(vx, vy, vz)

        const gx =
          corner[1] - corner[0] + corner[3] - corner[2] + corner[5] - corner[4] + corner[7] - corner[6]
        const gy =
          corner[2] - corner[0] + corner[3] - corner[1] + corner[6] - corner[4] + corner[7] - corner[5]
        const gz =
          corner[4] - corner[0] + corner[5] - corner[1] + corner[6] - corner[2] + corner[7] - corner[3]
        const length = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1
        normals.push(gx / length, gy / length, gz / length)
      }
    }
  }

  if (positions.length === 0) return { ...EMPTY, ms: performance.now() - started }

  const indices: number[] = []
  const cellVertex = (x: number, y: number, z: number) => vertexAt[(z * cells + y) * cells + x]
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) indices.push(a, c, b, a, d, c)
    else indices.push(a, b, c, a, c, d)
  }

  for (let z = 0; z < cells; z++) {
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const v0 = at(x, y, z) < iso
        if (x + 1 < r && y > 0 && z > 0 && v0 !== (at(x + 1, y, z) < iso)) {
          quad(cellVertex(x, y - 1, z - 1), cellVertex(x, y, z - 1), cellVertex(x, y, z), cellVertex(x, y - 1, z), v0)
        }
        if (y + 1 < r && x > 0 && z > 0 && v0 !== (at(x, y + 1, z) < iso)) {
          quad(cellVertex(x - 1, y, z - 1), cellVertex(x - 1, y, z), cellVertex(x, y, z), cellVertex(x, y, z - 1), v0)
        }
        if (z + 1 < r && x > 0 && y > 0 && v0 !== (at(x, y, z + 1) < iso)) {
          quad(cellVertex(x - 1, y - 1, z), cellVertex(x, y - 1, z), cellVertex(x, y, z), cellVertex(x - 1, y, z), v0)
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    triangles: indices.length / 3,
    vertices: positions.length / 3,
    ms: performance.now() - started,
  }
}

/**
 * Naive surface nets: the cell's vertex is the average of its edge crossings.
 *
 * Reproduces a flat face exactly and a smooth surface to within about 1% of a
 * cell, but it cannot represent a sharp edge: averaging crossings that lie on
 * two different planes lands between them, and no resolution fixes that.
 */
export function meshSurfaceNets(field: Float32Array, resolution: number, iso: number): Mesh {
  return meshDual(field, resolution, iso, 'centroid')
}

/**
 * Dual contouring: the cell's vertex is the point that best agrees with the
 * tangent plane at every crossing.
 *
 * Where surface nets asks "where are the crossings?", this asks "where are the
 * surfaces through those crossings, and where do they meet?" — and the answer
 * to the second question is a corner. Pass the analytic field to get exact
 * normals; without it the gradients come from the grid and the corner is
 * softer.
 */
export function meshDualContouring(
  field: Float32Array,
  resolution: number,
  iso: number,
  sdf?: (x: number, y: number, z: number) => number,
): Mesh {
  return meshDual(field, resolution, iso, 'qef', sdf)
}

/* ---------------------------------------------------------------------------
 * Marching cubes
 *
 * Included for contrast rather than because it is better. It is the primal
 * method: vertices are pinned onto grid edges, so a feature between two edges
 * cannot be represented at all, and the famous 256-case table is a symptom of
 * having to enumerate every way a surface can cut a cube.
 *
 * The table here is DERIVED at module load rather than transcribed, which is
 * both more honest and more informative: the derivation is where the
 * algorithm's real subtlety lives.
 * ------------------------------------------------------------------------- */

/** Faces of the cube as cyclic corner rings. */
const CUBE_FACES: number[][] = [
  [0, 2, 6, 4], // x = 0
  [1, 5, 7, 3], // x = 1
  [0, 4, 5, 1], // y = 0
  [2, 3, 7, 6], // y = 1
  [0, 1, 3, 2], // z = 0
  [4, 6, 7, 5], // z = 1
]

const EDGE_OF_PAIR = new Map<string, number>()
EDGES.forEach(([a, b], index) => {
  EDGE_OF_PAIR.set(`${Math.min(a, b)}_${Math.max(a, b)}`, index)
})
const edgeBetween = (a: number, b: number) =>
  EDGE_OF_PAIR.get(`${Math.min(a, b)}_${Math.max(a, b)}`) as number

/** Each face as its four edge indices, in the same cyclic order. */
const FACE_EDGES: number[][] = CUBE_FACES.map((ring) =>
  ring.map((corner, i) => edgeBetween(corner, ring[(i + 1) % 4])),
)

export type MarchingTable = {
  /** Flat edge-index triples per case. */
  triangles: number[][]
  /** Cases containing at least one face with four crossings. */
  ambiguousCases: number
}

/**
 * Builds the case table by construction.
 *
 * On every face of the cube the surface enters and leaves, so the crossings on
 * a face pair up into segments. Those segments chain into closed loops around
 * the cube, and each loop is a polygon of the surface — fan-triangulated here.
 *
 * The subtlety is a face with FOUR crossings, where the corners alternate
 * inside and outside. Its two segments can be drawn two ways, and the choice
 * decides whether the two inside corners are joined or separated. Both are
 * geometrically valid; the field alone does not say which is right. What
 * matters is only that two cells sharing that face make the SAME choice —
 * classic marching cubes used one fixed table for all cells and produced
 * holes at exactly these faces, which is what `separateAmbiguous` toggles.
 */
export function buildMarchingTable(separateAmbiguous: boolean): MarchingTable {
  const triangles: number[][] = []
  let ambiguousCases = 0

  for (let mask = 0; mask < 256; mask++) {
    const inside = (corner: number) => (mask & (1 << corner)) !== 0
    const links = new Map<number, number[]>()
    const link = (a: number, b: number) => {
      if (!links.has(a)) links.set(a, [])
      if (!links.has(b)) links.set(b, [])
      links.get(a)!.push(b)
      links.get(b)!.push(a)
    }
    let ambiguousHere = false

    CUBE_FACES.forEach((ring, faceIndex) => {
      const edges = FACE_EDGES[faceIndex]
      const crossing: number[] = []
      for (let i = 0; i < 4; i++) {
        if (inside(ring[i]) !== inside(ring[(i + 1) % 4])) crossing.push(i)
      }
      if (crossing.length === 2) {
        link(edges[crossing[0]], edges[crossing[1]])
      } else if (crossing.length === 4) {
        ambiguousHere = true
        // Corners alternate. The two edges flanking corner j isolate it.
        const j = [0, 1, 2, 3].find((i) => inside(ring[i])) ?? 0
        if (separateAmbiguous) {
          link(edges[(j + 3) % 4], edges[j])
          link(edges[(j + 1) % 4], edges[(j + 2) % 4])
        } else {
          link(edges[j], edges[(j + 1) % 4])
          link(edges[(j + 2) % 4], edges[(j + 3) % 4])
        }
      }
    })
    if (ambiguousHere) ambiguousCases++

    // Every crossing edge now has exactly two links, so the graph is a union
    // of disjoint cycles. Walk each one and fan it.
    const out: number[] = []
    const seen = new Set<number>()
    for (const start of links.keys()) {
      if (seen.has(start)) continue
      const loop: number[] = []
      let current = start
      let previous = -1
      while (current !== undefined && !seen.has(current)) {
        seen.add(current)
        loop.push(current)
        const next = (links.get(current) ?? []).find((n) => n !== previous && !seen.has(n))
        previous = current
        current = next as number
      }
      for (let i = 1; i + 1 < loop.length; i++) out.push(loop[0], loop[i], loop[i + 1])
    }
    triangles.push(out)
  }

  return { triangles, ambiguousCases }
}

const MARCHING_TABLES = {
  separate: buildMarchingTable(true),
  join: buildMarchingTable(false),
}

export function marchingTableStats() {
  return {
    ambiguousCases: MARCHING_TABLES.separate.ambiguousCases,
    maxTrianglesPerCell: Math.max(
      ...MARCHING_TABLES.separate.triangles.map((t) => t.length / 3),
    ),
  }
}

/**
 * Marching cubes over the sampled field.
 *
 * Vertices are not shared between cells. Sharing them needs an edge-to-vertex
 * map spanning two slices of the grid, which is a real cost, and leaving it
 * out makes the contrast with the dual methods plain: they get one vertex per
 * cell for free because the vertex belongs to the cell rather than to an edge
 * two cells share.
 */
export function meshMarchingCubes(
  field: Float32Array,
  resolution: number,
  iso: number,
  separateAmbiguous = true,
): Mesh {
  const started = performance.now()
  const r = resolution
  if (r < 2) return EMPTY

  const table = (separateAmbiguous ? MARCHING_TABLES.separate : MARCHING_TABLES.join).triangles
  const cells = r - 1
  const step = (DOMAIN * 2) / Math.max(r - 1, 1)
  const at = (x: number, y: number, z: number) => field[(z * r + y) * r + x]

  const positions: number[] = []
  const normals: number[] = []
  const corner = new Float64Array(8)

  for (let z = 0; z < cells; z++) {
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        let mask = 0
        for (let c = 0; c < 8; c++) {
          const value = at(x + (c & 1), y + ((c >> 1) & 1), z + ((c >> 2) & 1))
          corner[c] = value
          if (value < iso) mask |= 1 << c
        }
        const tri = table[mask]
        if (tri.length === 0) continue

        for (const edge of tri) {
          const [a, b] = EDGES[edge]
          const va = corner[a]
          const vb = corner[b]
          const t = (iso - va) / (vb - va)
          const ax = a & 1
          const ay = (a >> 1) & 1
          const az = (a >> 2) & 1
          const bx = b & 1
          const by = (b >> 1) & 1
          const bz = (b >> 2) & 1
          positions.push(
            -DOMAIN + (x + ax + (bx - ax) * t) * step,
            -DOMAIN + (y + ay + (by - ay) * t) * step,
            -DOMAIN + (z + az + (bz - az) * t) * step,
          )
          // Gradients at the two endpoints, interpolated to the crossing.
          const ga = gridGradient(field, r, x + ax, y + ay, z + az)
          const gb = gridGradient(field, r, x + bx, y + by, z + bz)
          const nx = ga[0] + (gb[0] - ga[0]) * t
          const ny = ga[1] + (gb[1] - ga[1]) * t
          const nz = ga[2] + (gb[2] - ga[2]) * t
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
          normals.push(nx / len, ny / len, nz / len)
        }
      }
    }
  }

  const count = positions.length / 3
  const indices = new Uint32Array(count)
  for (let i = 0; i < count; i++) indices[i] = i

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices,
    triangles: count / 3,
    vertices: count,
    ms: performance.now() - started,
  }
}
