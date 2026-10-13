import * as THREE from 'three'
import type { LeafSite, Segment } from './skeleton'

/**
 * Skeleton to triangles.
 *
 * Every branch segment becomes an open tapered tube — two rings of `radial`
 * vertices and `2 × radial` triangles, no caps, because a cap is only ever
 * seen at a twig's tip, where it is a pixel wide. Every leaf becomes a copy
 * of one small template polyhedron. Both are written straight into typed
 * arrays: a tree is thousands of pieces, and building a `CylinderGeometry`
 * per piece and merging them would allocate thousands of objects to throw
 * away.
 *
 * The output is one `BufferGeometry` for the wood and one for the leaves,
 * in the tree's own frame with its base at the origin. Placing it in a
 * forest is the renderer's job, by instancing.
 */

export type LeafShape = 'cluster' | 'needles' | 'bulb'

export type Palette = {
  bark: string
  /** Leaves are coloured between these, per leaf, so a canopy is not one flat green. */
  leafLow: string
  leafHigh: string
}

/**
 * One colour per generation, for the colour-by-generation view.
 *
 * A categorical set rather than a ramp: the question being asked is "which
 * generation is this", not "how deep", and neighbouring generations meet at
 * every joint, so adjacent entries must differ in hue, not just in lightness.
 * Generation 5 and deeper share the last colour.
 */
export const GENERATION_COLOURS = ['#c9a27a', '#e4787a', '#6ea8fe', '#7fcf8a', '#c79bf2', '#f0d264']

export const generationColour = (generation: number) =>
  GENERATION_COLOURS[Math.min(generation, GENERATION_COLOURS.length - 1)]

export type BranchStyle = {
  radial: number
  /** Draw every segment as a thin rod of this radius — the skeleton view. */
  skeletonRadius: number | null
  colourByGeneration: boolean
  bark: string
}

const UP = new THREE.Vector3(0, 1, 0)
const SIDE = new THREE.Vector3(1, 0, 0)

export function branchGeometry(segments: Segment[], style: BranchStyle): THREE.BufferGeometry {
  const radial = Math.max(3, style.radial)
  const vertsPer = radial * 2
  const positions = new Float32Array(segments.length * vertsPer * 3)
  const normals = new Float32Array(segments.length * vertsPer * 3)
  const colours = new Float32Array(segments.length * vertsPer * 3)
  const indexCount = segments.length * radial * 6
  const index = segments.length * vertsPer > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount)

  const dir = new THREE.Vector3()
  const u = new THREE.Vector3()
  const v = new THREE.Vector3()
  const ring = new THREE.Vector3()
  const colour = new THREE.Color()
  const bark = new THREE.Color(style.bark)
  /**
   * Each limb's last ring orientation, carried down the limb.
   *
   * Picking a ring's "zero" direction fresh for every segment makes each
   * joint twist by however far the arbitrary choice moved, and with five or
   * six sides that twist is a visible kink at every step. Projecting the
   * previous segment's choice onto the new segment's plane — parallel
   * transport, done crudely — keeps the facets running straight down a limb.
   */
  const frame = new Map<number, THREE.Vector3>()

  let p = 0
  let n = 0
  let k = 0
  segments.forEach((s, i) => {
    dir.subVectors(s.b, s.a).normalize()
    const carried = frame.get(s.chain)
    if (carried) u.copy(carried).addScaledVector(dir, -carried.dot(dir))
    if (!carried || u.lengthSq() < 1e-6) u.crossVectors(dir, Math.abs(dir.y) < 0.99 ? UP : SIDE)
    u.normalize()
    v.crossVectors(dir, u)
    frame.set(s.chain, u.clone())

    if (style.colourByGeneration) colour.set(generationColour(s.generation))
    else colour.copy(bark)
    const r0 = style.skeletonRadius ?? s.r0
    const r1 = style.skeletonRadius ?? s.r1

    for (let end = 0; end < 2; end++) {
      const centre = end === 0 ? s.a : s.b
      const r = end === 0 ? r0 : r1
      for (let j = 0; j < radial; j++) {
        const theta = (j / radial) * Math.PI * 2
        ring.copy(u).multiplyScalar(Math.cos(theta)).addScaledVector(v, Math.sin(theta))
        positions[p++] = centre.x + ring.x * r
        positions[p++] = centre.y + ring.y * r
        positions[p++] = centre.z + ring.z * r
        normals[n] = ring.x
        normals[n + 1] = ring.y
        normals[n + 2] = ring.z
        colours[n] = colour.r
        colours[n + 1] = colour.g
        colours[n + 2] = colour.b
        n += 3
      }
    }
    const base = i * vertsPer
    for (let j = 0; j < radial; j++) {
      const a = base + j
      const b = base + ((j + 1) % radial)
      const c = a + radial
      const d = b + radial
      index[k++] = a
      index[k++] = b
      index[k++] = c
      index[k++] = b
      index[k++] = d
      index[k++] = c
    }
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  return geometry
}

/** Indices per segment, so a partial draw can stop at segment `k`. */
export const branchIndicesPerSegment = (radial: number) => Math.max(3, radial) * 6

/**
 * The template each leaf is a copy of, non-indexed so flat shading gives
 * every facet its own normal.
 *
 * Small solids rather than flat cards: a card is invisible edge-on and
 * double-sided lighting on a card reads as paper, while a 20-triangle blob
 * reads as a clump of foliage from every side — which is what one "leaf" at
 * this scale stands for anyway.
 */
function template(shape: LeafShape, detail: 'full' | 'low'): Float32Array {
  const source =
    shape === 'bulb'
      ? new THREE.IcosahedronGeometry(1, detail === 'full' ? 1 : 0)
      : detail === 'full'
        ? new THREE.IcosahedronGeometry(1, 0)
        : new THREE.OctahedronGeometry(1, 0)
  // Broadleaf clumps are flattened, the way a spray of leaves lies; needle
  // tufts are flatter and wider still. A bulb stays round.
  const squash = shape === 'cluster' ? 0.62 : shape === 'needles' ? 0.42 : 1
  const stretch = shape === 'needles' ? 1.25 : 1
  source.scale(stretch, squash, stretch)
  const geometry = source.index ? source.toNonIndexed() : source
  const out = (geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
  return out.slice()
}

export type LeafStyle = {
  shape: LeafShape
  detail: 'full' | 'low'
  size: number
  palette: Palette
}

/** Two cheap hashes, so a leaf's shade depends on the leaf and not on draw order. */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

export function leafGeometry(sites: LeafSite[], style: LeafStyle, sizeScale = 1): THREE.BufferGeometry {
  const shape = template(style.shape, style.detail)
  const per = shape.length / 3
  const positions = new Float32Array(sites.length * shape.length)
  const colours = new Float32Array(sites.length * shape.length)
  const low = new THREE.Color(style.palette.leafLow)
  const high = new THREE.Color(style.palette.leafHigh)
  const colour = new THREE.Color()
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const s = new THREE.Vector3()
  const v = new THREE.Vector3()

  let p = 0
  sites.forEach((site, i) => {
    e.set(site.tilt, site.yaw, site.tilt * 0.5)
    q.setFromEuler(e)
    const size = style.size * site.size * sizeScale
    s.set(size, size, size)
    m.compose(site.position, q, s)
    colour.copy(low).lerp(high, hash(i + site.segment * 0.37))
    for (let j = 0; j < per; j++) {
      v.set(shape[j * 3], shape[j * 3 + 1], shape[j * 3 + 2]).applyMatrix4(m)
      positions[p] = v.x
      positions[p + 1] = v.y
      positions[p + 2] = v.z
      colours[p] = colour.r
      colours[p + 1] = colour.g
      colours[p + 2] = colour.b
      p += 3
    }
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Vertices per leaf for a style, so a partial draw can stop at leaf `k`. */
export const leafVerticesPer = (shape: LeafShape, detail: 'full' | 'low') => template(shape, detail).length / 3

export const triangles = (geometry: THREE.BufferGeometry | null) =>
  !geometry
    ? 0
    : geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position') as THREE.BufferAttribute).count / 3
