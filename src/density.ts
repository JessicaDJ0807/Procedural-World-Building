/**
 * Density fields and constructive solid geometry.
 *
 * Topic 2 built a field by sampling a grid and compositing grids together.
 * This topic inverts that: a shape is a *function* of position, evaluated
 * wherever you ask, and the grid is only where you choose to look at it.
 *
 * The function returns a signed distance — negative inside the shape, zero on
 * its surface, positive outside — which is what makes the boolean operations
 * below one-liners. Union is `min`, intersection is `max`, and the difference
 * is `max(a, -b)`. No polygon clipping, no intersection curves, no special
 * cases for shapes that touch at a single point.
 */

import { mulberry32 } from './noise'

/** Negative inside, 0 on the surface, positive outside. */
export type Sdf = (x: number, y: number, z: number) => number

/** Half-extent of the sampled cube. Shapes are authored to fit inside it. */
export const DOMAIN = 1.3

/* ---------------------------------------------------------------------------
 * Continuous value noise
 *
 * Topic 2's noise is a grid that gets interpolated when drawn. A density
 * function cannot use that directly: it is asked for one point at a time, at
 * coordinates that are not grid indices. So the lattice is kept and sampled
 * continuously, reusing the same PRNG so a seed means the same thing in both
 * topics.
 * ------------------------------------------------------------------------- */

function hermite(t: number): number {
  return t * t * (3 - 2 * t)
}

function buildLattice(size: number, seed: number): Float32Array {
  const rand = mulberry32(seed)
  const lattice = new Float32Array(size * size)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
  return lattice
}

/** Wrapping bilinear sample with a Hermite fade, in lattice units. */
function sampleLattice(lattice: Float32Array, size: number, x: number, z: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const tx = hermite(x - x0)
  const tz = hermite(z - z0)
  const xa = ((x0 % size) + size) % size
  const za = ((z0 % size) + size) % size
  const xb = (xa + 1) % size
  const zb = (za + 1) % size
  const n00 = lattice[za * size + xa]
  const n10 = lattice[za * size + xb]
  const n01 = lattice[zb * size + xa]
  const n11 = lattice[zb * size + xb]
  const near = n00 + (n10 - n00) * tx
  const far = n01 + (n11 - n01) * tx
  return near + (far - near) * tz
}

const TERRAIN_LATTICE = 16

/**
 * fBm height in [0, 1], as a closure over its lattices.
 *
 * The lattices are built once when the shape is built, never per sample: a
 * 64³ grid asks for 262,144 heights, and regenerating a PRNG stream for each
 * one would dominate everything else on the page.
 */
function terrainHeight(octaves: number, seed: number): (x: number, z: number) => number {
  const count = Math.max(1, Math.round(octaves))
  const lattices: Float32Array[] = []
  for (let o = 0; o < count; o++) lattices.push(buildLattice(TERRAIN_LATTICE, seed + o * 1013))

  return (x: number, z: number) => {
    let sum = 0
    let amplitude = 1
    let total = 0
    let frequency = 1
    for (let o = 0; o < count; o++) {
      sum += sampleLattice(lattices[o], TERRAIN_LATTICE, x * frequency, z * frequency) * amplitude
      total += amplitude
      amplitude *= 0.5
      frequency *= 2
    }
    return sum / total
  }
}

/* ---------------------------------------------------------------------------
 * Primitives
 * ------------------------------------------------------------------------- */

export type ShapeParam = {
  key: string
  label: string
  info: string
  min: number
  max: number
  step: number
  defaultValue: number
  format?: (value: number) => string
}

export type ShapeName =
  | 'sphere'
  | 'box'
  | 'torus'
  | 'cylinder'
  | 'cone'
  | 'plane'
  | 'gyroid'
  | 'terrain'

export type Shape = {
  value: ShapeName
  label: string
  hint: string
  /**
   * Whether the function returns a true Euclidean distance.
   *
   * It matters for blending, not for the surface: an inexact field still has
   * the right sign everywhere, so the shape it carves is correct, but smooth
   * blends assume a unit gradient and widen or narrow where that fails.
   */
  exact: boolean
  params: ShapeParam[]
  build: (params: Record<string, number>, seed: number) => Sdf
}

const value = (params: Record<string, number>, key: string, fallback: number) =>
  Number.isFinite(params[key]) ? params[key] : fallback

export const SHAPES: Shape[] = [
  {
    value: 'sphere',
    label: 'Sphere',
    hint: 'The simplest exact distance function: the distance from the centre, less the radius.',
    exact: true,
    params: [
      { key: 'radius', label: 'Radius', info: 'Distance from the centre to the surface.', min: 0.05, max: 1.2, step: 0.01, defaultValue: 0.6 },
    ],
    build: (p) => {
      const r = value(p, 'radius', 0.6)
      return (x, y, z) => Math.sqrt(x * x + y * y + z * z) - r
    },
  },
  {
    value: 'box',
    label: 'Box',
    hint: 'A rounded box. The rounding is free — subtracting a constant from any distance field offsets its surface outward.',
    exact: true,
    params: [
      { key: 'size', label: 'Size', info: 'Half-extent along each axis before rounding.', min: 0.05, max: 1.1, step: 0.01, defaultValue: 0.5 },
      { key: 'round', label: 'Rounding', info: 'Subtracted from the distance, which moves the surface outward by that much and rounds every edge to this radius. Offsetting a mesh this way would be a hard geometry problem; here it is one subtraction.', min: 0, max: 0.4, step: 0.005, defaultValue: 0.05 },
    ],
    build: (p) => {
      const s = value(p, 'size', 0.5)
      const round = value(p, 'round', 0.05)
      return (x, y, z) => {
        const qx = Math.abs(x) - s
        const qy = Math.abs(y) - s
        const qz = Math.abs(z) - s
        const ox = Math.max(qx, 0)
        const oy = Math.max(qy, 0)
        const oz = Math.max(qz, 0)
        const outside = Math.sqrt(ox * ox + oy * oy + oz * oz)
        const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0)
        return outside + inside - round
      }
    },
  },
  {
    value: 'torus',
    label: 'Torus',
    hint: 'Distance to a circle, less the tube radius. A genus-1 surface with no special-casing anywhere.',
    exact: true,
    params: [
      { key: 'major', label: 'Ring radius', info: 'Radius of the circle the tube is swept around.', min: 0.1, max: 1, step: 0.01, defaultValue: 0.6 },
      { key: 'minor', label: 'Tube radius', info: 'Thickness of the tube. Above the ring radius the hole closes.', min: 0.02, max: 0.6, step: 0.01, defaultValue: 0.22 },
    ],
    build: (p) => {
      const R = value(p, 'major', 0.6)
      const r = value(p, 'minor', 0.22)
      return (x, y, z) => {
        const q = Math.sqrt(x * x + z * z) - R
        return Math.sqrt(q * q + y * y) - r
      }
    },
  },
  {
    value: 'cylinder',
    label: 'Cylinder',
    hint: 'A capped cylinder, built by intersecting an infinite tube with a slab — the same max() the Intersect operation uses.',
    exact: true,
    params: [
      { key: 'radius', label: 'Radius', info: 'Radius of the tube.', min: 0.05, max: 1, step: 0.01, defaultValue: 0.35 },
      { key: 'height', label: 'Half-height', info: 'Distance from the centre to each flat cap.', min: 0.05, max: 1.2, step: 0.01, defaultValue: 0.7 },
    ],
    build: (p) => {
      const r = value(p, 'radius', 0.35)
      const h = value(p, 'height', 0.7)
      return (x, y, z) => {
        const dx = Math.sqrt(x * x + z * z) - r
        const dy = Math.abs(y) - h
        const ox = Math.max(dx, 0)
        const oy = Math.max(dy, 0)
        return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ox * ox + oy * oy)
      }
    },
  },
  {
    value: 'cone',
    label: 'Cone',
    hint: 'A cone truncated at both ends, so the top radius is a control rather than always zero. Set it above the base radius and the cone opens upward instead — which is what makes a crater out of a subtraction.',
    exact: true,
    params: [
      { key: 'radius', label: 'Base radius', info: 'Radius at the bottom cap.', min: 0.02, max: 1.2, step: 0.01, defaultValue: 0.7 },
      { key: 'top', label: 'Top radius', info: 'Radius at the top cap. At 0 the cone comes to a point; above the base radius it widens upward, which is the orientation a crater wants.', min: 0, max: 1.2, step: 0.01, defaultValue: 0.15 },
      { key: 'height', label: 'Half-height', info: 'Distance from the centre to each flat cap.', min: 0.05, max: 1.2, step: 0.01, defaultValue: 0.55 },
    ],
    /**
     * Exact, and not by the obvious route.
     *
     * The tempting construction is an infinite cone intersected with a slab,
     * the way `cylinder` is built. That gets the surface right and the distance
     * wrong: `max()` of two exact fields is only exact outside both, and near
     * the rim where the slanted side meets the cap it reports the larger of two
     * perpendicular distances rather than the distance to the edge itself.
     *
     * So this measures to the two features directly. `ca` is the distance to
     * the cap discs, `cb` the distance to the slanted side as a segment with
     * the parameter clamped to its ends, and the result is the nearer of the
     * two — which is the shortest distance to the boundary by construction,
     * including at the rims. Verified at 1.000 mean gradient magnitude; see
     * the table in docs/topics/topic-3-voxels.md.
     */
    build: (p) => {
      const r1 = value(p, 'radius', 0.7)
      const r2 = value(p, 'top', 0.15)
      const h = value(p, 'height', 0.55)
      const k1x = r2
      const k1y = h
      const k2x = r2 - r1
      const k2y = 2 * h
      const k2dot = k2x * k2x + k2y * k2y || 1
      return (x, y, z) => {
        const qx = Math.sqrt(x * x + z * z)
        const qy = y
        const cax = qx - Math.min(qx, qy < 0 ? r1 : r2)
        const cay = Math.abs(qy) - h
        const t = Math.min(1, Math.max(0, ((k1x - qx) * k2x + (k1y - qy) * k2y) / k2dot))
        const cbx = qx - k1x + k2x * t
        const cby = qy - k1y + k2y * t
        const inside = cbx < 0 && cay < 0 ? -1 : 1
        return inside * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby))
      }
    },
  },
  {
    value: 'plane',
    label: 'Half-space',
    hint: 'Everything below a height. Useless alone, but intersecting with it is how you get a flat cut, and subtracting it is how you get a floor.',
    exact: true,
    params: [
      { key: 'height', label: 'Height', info: 'The cut plane. Material lies below it.', min: -1.2, max: 1.2, step: 0.01, defaultValue: 0 },
    ],
    build: (p) => {
      const h = value(p, 'height', 0)
      return (_x, y) => y - h
    },
  },
  {
    value: 'gyroid',
    label: 'Gyroid',
    hint: 'A triply periodic minimal surface — one trigonometric expression that divides space into two interlocking halves. Popular in 3D printing as an infill that is strong in every direction.',
    exact: false,
    params: [
      { key: 'scale', label: 'Scale', info: 'Spatial frequency. Higher packs more cells into the same volume.', min: 1, max: 14, step: 0.1, defaultValue: 5, format: (v) => v.toFixed(1) },
      { key: 'thickness', label: 'Thickness', info: 'Wall thickness. At 0 the surface has no volume at all and nothing is drawn.', min: 0.02, max: 1.2, step: 0.01, defaultValue: 0.35 },
    ],
    build: (p) => {
      const s = value(p, 'scale', 5)
      const t = value(p, 'thickness', 0.35)
      // Dividing by the frequency is the standard crude Lipschitz correction:
      // it keeps the gradient near 1 so blends behave, without making this a
      // real distance field. See `exact: false`.
      return (x, y, z) => {
        const g =
          Math.sin(x * s) * Math.cos(y * s) +
          Math.sin(y * s) * Math.cos(z * s) +
          Math.sin(z * s) * Math.cos(x * s)
        return (Math.abs(g) - t) / s
      }
    },
  },
  {
    value: 'terrain',
    label: 'Terrain',
    hint: 'An fBm height field turned into a solid: density is your height above the ground, so everything below the surface is inside. This is what makes terrain something CSG can cut into.',
    exact: false,
    params: [
      { key: 'amplitude', label: 'Relief', info: 'How far the ground rises and falls.', min: 0.05, max: 1.2, step: 0.01, defaultValue: 0.55 },
      { key: 'level', label: 'Ground level', info: 'Vertical offset of the whole surface.', min: -1, max: 1, step: 0.01, defaultValue: -0.15 },
      { key: 'frequency', label: 'Frequency', info: 'Lattice cells across the domain. Higher is rougher ground at the same relief.', min: 0.5, max: 8, step: 0.1, defaultValue: 2.4, format: (v) => v.toFixed(1) },
      { key: 'octaves', label: 'Octaves', info: 'How many doublings of frequency are summed, each at half the amplitude — the fBm stack from Topic 2, evaluated continuously instead of on a grid.', min: 1, max: 6, step: 1, defaultValue: 4, format: (v) => `${v}` },
    ],
    build: (p, seed) => {
      const amplitude = value(p, 'amplitude', 0.55)
      const level = value(p, 'level', -0.15)
      const frequency = value(p, 'frequency', 2.4)
      const height = terrainHeight(value(p, 'octaves', 4), seed)
      return (x, y, z) => y - (level + (height(x * frequency, z * frequency) - 0.5) * amplitude * 2)
    },
  },
]

export function getShape(name: ShapeName): Shape {
  return SHAPES.find((s) => s.value === name) ?? SHAPES[0]
}

export function defaultParamsFor(shape: Shape): Record<string, number> {
  const params: Record<string, number> = {}
  for (const param of shape.params) params[param.key] = param.defaultValue
  return params
}

/* ---------------------------------------------------------------------------
 * Boolean operations
 * ------------------------------------------------------------------------- */

export type CsgOpName = 'union' | 'intersect' | 'subtract'

export const CSG_OPS: { value: CsgOpName; label: string; hint: string }[] = [
  { value: 'union', label: 'Union', hint: 'Keep whichever surface is nearer: min(a, b). The only one of the three that stays an exact distance field.' },
  { value: 'intersect', label: 'Intersect', hint: 'Keep only what is inside both: max(a, b). Exact outside the result, an underestimate inside it.' },
  { value: 'subtract', label: 'Subtract', hint: 'Cut the second shape out of the first: max(a, -b). This is how you carve a cave into terrain.' },
]

/**
 * Polynomial smooth minimum.
 *
 * `min` produces a crease where two surfaces meet, because it switches between
 * them discontinuously in the derivative. This interpolates across a band of
 * width k instead, which is what turns a boolean into a weld or a fillet.
 *
 * It assumes both fields measure distance in the same units — that a value of
 * 0.1 means the same thing in each. An inexact field breaks that assumption,
 * which is why blending a gyroid or terrain does not widen the way a sphere
 * does at the same k.
 */
function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k))
  return b + (a - b) * h - k * h * (1 - h)
}

function smoothMax(a: number, b: number, k: number): number {
  return -smoothMin(-a, -b, k)
}

export function combine(accumulated: number, next: number, op: CsgOpName, blend: number): number {
  switch (op) {
    case 'intersect':
      return smoothMax(accumulated, next, blend)
    case 'subtract':
      return smoothMax(accumulated, -next, blend)
    case 'union':
    default:
      return smoothMin(accumulated, next, blend)
  }
}

/* ---------------------------------------------------------------------------
 * The stack
 * ------------------------------------------------------------------------- */

export type CsgNode = {
  id: string
  shape: ShapeName
  params: Record<string, number>
  op: CsgOpName
  /** Width of the smooth blend band, in world units. 0 is a hard boolean. */
  blend: number
  offset: { x: number; y: number; z: number }
  seed: number
  enabled: boolean
}

export type VolumeStats = {
  /** Wall-clock milliseconds spent sampling. */
  ms: number
  /** Share of samples that landed inside the solid. */
  inside: number
  min: number
  max: number
}

/**
 * Evaluates the stack onto a `resolution³` grid of signed distances.
 *
 * The stack is a left fold, not a tree: each node combines with everything
 * beneath it, the way an image editor's layers do. A general CSG tree can
 * express more — `(a ∪ b) ∩ (c ∪ d)` has no linear form — but a tree needs a
 * tree editor, and the linear stack covers the cases this page is for.
 *
 * The first enabled node is the base and its operation is ignored: there is
 * nothing beneath it to combine with, and subtracting from empty space is a
 * guaranteed empty result rather than a useful one.
 */
/**
 * Folds the whole stack into one function of position.
 *
 * Sampling uses this, and so does dual contouring — which needs the field
 * between the grid points, not just on them. Evaluating the analytic function
 * at the exact crossing gives an exact normal there, where a mesher working
 * from the grid alone can only interpolate one.
 *
 * Sealing is itself a CSG operation: intersect everything with a box inset
 * from the domain. Without it a solid that reaches the edge is left open
 * there — the mesher has no samples beyond the boundary to close it against,
 * so terrain renders as a floating sheet with no underside. The inset is two
 * cells because a face needs the four cells around its edge to exist, and the
 * outermost layer has neighbours on one side only.
 */
export function buildStack(nodes: CsgNode[], sealAt = Infinity): Sdf {
  const built = nodes
    .filter((node) => node.enabled)
    .map((node) => ({ node, sdf: getShape(node.shape).build(node.params, node.seed) }))

  return (x, y, z) => {
    let d = Infinity
    for (let n = 0; n < built.length; n++) {
      const { node, sdf } = built[n]
      const sample = sdf(x - node.offset.x, y - node.offset.y, z - node.offset.z)
      d = n === 0 ? sample : combine(d, sample, node.op, node.blend)
    }
    if (!Number.isFinite(d)) d = DOMAIN
    if (Number.isFinite(sealAt)) {
      const qx = Math.abs(x) - sealAt
      const qy = Math.abs(y) - sealAt
      const qz = Math.abs(z) - sealAt
      const ox = Math.max(qx, 0)
      const oy = Math.max(qy, 0)
      const oz = Math.max(qz, 0)
      const box =
        Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0)
      d = Math.max(d, box)
    }
    return d
  }
}

/** Half-extent of the seal box for a given resolution. */
export function sealExtent(resolution: number): number {
  return DOMAIN - ((DOMAIN * 2) / Math.max(resolution - 1, 1)) * 2
}

/**
 * Central-difference gradient, normalised.
 *
 * `h` is deliberately independent of the grid: this asks the analytic function
 * either side of the point, so it measures the real surface rather than the
 * sampled one.
 */
export function gradientOf(sdf: Sdf, x: number, y: number, z: number, h = 1e-4): [number, number, number] {
  const gx = sdf(x + h, y, z) - sdf(x - h, y, z)
  const gy = sdf(x, y + h, z) - sdf(x, y - h, z)
  const gz = sdf(x, y, z + h) - sdf(x, y, z - h)
  const length = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1
  return [gx / length, gy / length, gz / length]
}

export function sampleVolume(
  nodes: CsgNode[],
  resolution: number,
  seal = true,
): { field: Float32Array; stats: VolumeStats } {
  const started = performance.now()
  const stack = buildStack(nodes, seal ? sealExtent(resolution) : Infinity)

  const field = new Float32Array(resolution * resolution * resolution)
  const step = (DOMAIN * 2) / Math.max(resolution - 1, 1)
  let inside = 0
  let min = Infinity
  let max = -Infinity

  for (let zi = 0; zi < resolution; zi++) {
    const z = -DOMAIN + zi * step
    for (let yi = 0; yi < resolution; yi++) {
      const y = -DOMAIN + yi * step
      for (let xi = 0; xi < resolution; xi++) {
        const x = -DOMAIN + xi * step
        const d = stack(x, y, z)
        field[(zi * resolution + yi) * resolution + xi] = d
        if (d < 0) inside++
        if (d < min) min = d
        if (d > max) max = d
      }
    }
  }

  return {
    field,
    stats: {
      ms: performance.now() - started,
      inside: inside / field.length,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
    },
  }
}

/* ---------------------------------------------------------------------------
 * Starting scenes
 *
 * Each one exists to make a different property visible: an exact boolean, a
 * smooth one, an intersection, and what happens when the field underneath is
 * not a real distance function.
 * ------------------------------------------------------------------------- */

export type SceneNode = Omit<CsgNode, 'id'>

export type Scene = {
  value: string
  label: string
  hint: string
  nodes: SceneNode[]
}

const at = (x: number, y: number, z: number) => ({ x, y, z })

function shapeNode(
  shape: ShapeName,
  over: Partial<SceneNode> & { params?: Record<string, number> } = {},
): SceneNode {
  return {
    shape,
    params: { ...defaultParamsFor(getShape(shape)), ...over.params },
    op: over.op ?? 'union',
    blend: over.blend ?? 0,
    offset: over.offset ?? at(0, 0, 0),
    seed: over.seed ?? 1,
    enabled: over.enabled ?? true,
  }
}

export const SCENES: Scene[] = [
  {
    value: 'caves',
    label: 'Caves in terrain',
    hint: 'An fBm height field turned solid, with two spheres cut out of it. Subtraction is the whole trick: a height map has no way to express an overhang, and a cave is nothing but overhang.',
    nodes: [
      shapeNode('terrain', { params: { amplitude: 0.5, level: -0.1, frequency: 2.4, octaves: 4 } }),
      shapeNode('sphere', { op: 'subtract', params: { radius: 0.42 }, offset: at(-0.25, -0.3, 0.1) }),
      shapeNode('sphere', { op: 'subtract', params: { radius: 0.3 }, offset: at(0.45, -0.45, -0.3), blend: 0.12 }),
    ],
  },
  {
    value: 'volcano',
    label: 'Volcano',
    hint: "A truncated cone with a second cone subtracted from its top. The crater cone is inverted — its top radius is wider than its base — so subtracting it cuts a funnel rather than a pit with straight walls. The vent carries on down as a cylinder, and the skirt is terrain blended into the base so the cone does not sit on nothing.",
    nodes: [
      shapeNode('cone', { params: { radius: 0.92, top: 0.3, height: 0.5 }, offset: at(0, -0.22, 0) }),
      // Unioned with a wide blend rather than butted against it: a hard min()
      // would leave a visible crease all the way round the base, which is the
      // one place a volcano should read as continuous with the ground.
      shapeNode('terrain', {
        params: { amplitude: 0.26, level: -0.62, frequency: 3.4, octaves: 4 },
        blend: 0.22,
      }),
      shapeNode('cone', {
        op: 'subtract',
        params: { radius: 0.07, top: 0.34, height: 0.24 },
        offset: at(0, 0.3, 0),
        blend: 0.04,
      }),
      shapeNode('cylinder', {
        op: 'subtract',
        params: { radius: 0.08, height: 0.55 },
        offset: at(0, -0.1, 0),
      }),
    ],
  },
  {
    value: 'cavern',
    label: 'Cavern system',
    hint: 'A gyroid subtracted from solid ground, which is a different kind of cave from the two spheres in the first scene: the gyroid is connected everywhere, so the voids form one network rather than separate pockets. Where the ground is thin the tunnels break the surface on their own.',
    nodes: [
      shapeNode('terrain', { params: { amplitude: 0.45, level: 0.3, frequency: 2, octaves: 5 } }),
      // Thickness, not scale, is what decides how much rock survives: a thicker
      // gyroid wall is more material subtracted. At 0.58 the block came out at
      // 22% solid and read as a sponge rather than as ground with tunnels in
      // it. A low scale makes the few remaining voids large enough to walk
      // through rather than numerous and narrow.
      shapeNode('gyroid', { op: 'subtract', params: { scale: 4.5, thickness: 0.32 } }),
      // One chamber large enough to read as a space rather than a tunnel, cut
      // where it meets the network instead of somewhere isolated.
      shapeNode('sphere', {
        op: 'subtract',
        params: { radius: 0.4 },
        offset: at(-0.3, -0.3, 0.2),
        blend: 0.1,
      }),
    ],
  },
  {
    value: 'boolean',
    label: 'Box minus sphere',
    hint: 'The canonical CSG demonstration. Both fields are exact, so the cut is exact — and the intersection curve nobody had to compute is just where max(a, −b) changes sign.',
    nodes: [
      shapeNode('box', { params: { size: 0.55, round: 0.04 } }),
      shapeNode('sphere', { op: 'subtract', params: { radius: 0.72 } }),
      shapeNode('cylinder', { op: 'subtract', params: { radius: 0.22, height: 1.2 } }),
    ],
  },
  {
    value: 'blend',
    label: 'Blended blobs',
    hint: 'Three spheres unioned with a wide blend. min() alone would leave a visible crease where they meet; the smooth minimum interpolates across a band instead, which is why they read as one grown object rather than three stuck together.',
    nodes: [
      shapeNode('sphere', { params: { radius: 0.42 }, offset: at(-0.35, -0.2, 0) }),
      shapeNode('sphere', { params: { radius: 0.34 }, offset: at(0.32, 0.05, 0.15), blend: 0.3 }),
      shapeNode('sphere', { params: { radius: 0.26 }, offset: at(0.05, 0.5, -0.2), blend: 0.3 }),
    ],
  },
  {
    value: 'gyroid',
    label: 'Gyroid ball',
    hint: 'A gyroid clipped to a sphere by intersection. The gyroid is not a true distance field — it runs about 1.5× steep — so a blend set here bites noticeably less than the same number would on two spheres.',
    nodes: [
      shapeNode('gyroid', { params: { scale: 6, thickness: 0.4 } }),
      shapeNode('sphere', { op: 'intersect', params: { radius: 0.85 } }),
    ],
  },
  {
    value: 'slice',
    label: 'Sliced torus',
    hint: 'A torus cut flat by a half-space, then drilled. Intersecting with a half-space is how you get a flat face on anything, with no clipping code at all.',
    nodes: [
      shapeNode('torus', { params: { major: 0.65, minor: 0.3 } }),
      shapeNode('plane', { op: 'intersect', params: { height: 0.12 } }),
      shapeNode('cylinder', { op: 'subtract', params: { radius: 0.28, height: 1.2 }, blend: 0.06 }),
    ],
  },
]

export function getScene(value: string): Scene {
  return SCENES.find((s) => s.value === value) ?? SCENES[0]
}
