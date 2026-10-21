import * as THREE from 'three'
import { SEG, edgeAt, type Draper, type Strand } from './draper'
import type { V3 } from './living'

/**
 * Drapers, drawn: hanging vegetation, not lines.
 *
 * - **Stems** are thin tubes, three-sided, tapering from the edge to the tip,
 *   green-brown above and fresher green below — never black.
 * - **Leaves** hang off them: slim, pointed, drooping, set densely near the
 *   top and further apart lower down, smaller toward the tip, and the last
 *   few at the tip pale and still opening, so you can see which way it grows.
 *   Every so often a **cluster** of larger leaves bunches round the stem.
 * - **A lip** of leaves along the edge between the outermost strands, where
 *   the plant is anchored, so the curtain hangs from a mass of foliage rather
 *   than from a ruled line.
 * - **A rooted base**: a few leaves round where a strand reached the lawn
 *   (the patch round it is the ground cover's).
 *
 * Leaves sit at fixed distances along each strand, from a hash of the strand,
 * so as a strand grows leaves are added at its tip and none move. Teal-green,
 * so a Draper reads apart from Climber's dark green and Spreader's olive.
 * One merged geometry for the stems and one instanced mesh for the leaves,
 * redrawn as the strands grow; in the growth model's units.
 */

const MAX_LEAVES = 32000
const STEM_TOP = new THREE.Color('#566f3c')
const STEM_TIP = new THREE.Color('#86a85c')
const LEAF_DARK = new THREE.Color('#2d6450')
const LEAF_LIGHT = new THREE.Color('#5e9c74')
const LEAF_YOUNG = new THREE.Color('#b4d99c')

/** The colour for the plant list: Draper's teal-green. */
export const DRAPER_SWATCH = '#4f9479'

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** A slim pointed leaf along +y from its stalk at the origin, folded a little along its midrib. */
function leafGeometry(): THREE.BufferGeometry {
  const w = 0.17
  const f = 0.06
  // prettier-ignore
  const p = [
    0, 0, 0,  w, 0.35, f,  0, 0.4, 0,
    0, 0, 0,  0, 0.4, 0,  -w, 0.35, f,
    w, 0.35, f,  0, 1, 0,  0, 0.4, 0,
    0, 0.4, 0,  0, 1, 0,  -w, 0.35, f,
  ]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  g.computeVertexNormals()
  return g
}

/** The point and tangent at a distance along a strand's path. */
function along(st: Strand, a: number, out: THREE.Vector3, tangent: THREE.Vector3) {
  const x = Math.max(0, a / SEG)
  const i = Math.min(st.path.length - 2, Math.floor(x))
  if (i < 0) {
    out.set(...st.path[0])
    tangent.set(0, -1, 0)
    return
  }
  const t = Math.min(1, x - i)
  const p = st.path[i]
  const q = st.path[i + 1]
  out.set(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t)
  tangent.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize()
}

export class DraperView {
  readonly group = new THREE.Group()
  readonly stems: THREE.Mesh
  readonly leaves: THREE.InstancedMesh
  leafCount = 0

  constructor() {
    this.stems = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }))
    this.stems.castShadow = true
    this.stems.receiveShadow = true
    this.leaves = new THREE.InstancedMesh(leafGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide }), MAX_LEAVES)
    this.leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LEAVES * 3), 3)
    this.leaves.count = 0
    this.leaves.castShadow = true
    this.leaves.receiveShadow = true
    this.leaves.frustumCulled = false
    this.group.add(this.stems, this.leaves)
  }

  update(drapers: Draper[], step: number) {
    const pos: number[] = []
    const col: number[] = []
    const idx: number[] = []
    const m4 = new THREE.Matrix4()
    const basis = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const t = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const face = new THREE.Vector3()
    const side = new THREE.Vector3()
    const radial = new THREE.Vector3()
    const c = new THREE.Color()
    let n = 0

    /** One leaf: at `at`, hanging along `d`, its face toward `f`, of size `size`. */
    const leaf = (at: THREE.Vector3, d: THREE.Vector3, f: THREE.Vector3, size: number, colour: THREE.Color) => {
      if (n >= MAX_LEAVES || size <= 0.01) return
      dir.copy(d).normalize()
      side.crossVectors(dir, f)
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
      side.normalize()
      face.crossVectors(side, dir)
      basis.makeBasis(side, dir, face)
      m4.copy(basis).scale(new THREE.Vector3(size, size, size)).setPosition(at)
      this.leaves.setMatrixAt(n, m4)
      this.leaves.setColorAt(n, colour)
      n++
    }

    for (const d of drapers) {
      const age = step - d.born
      let lo = Infinity
      let hi = -Infinity
      for (const st of d.strands) {
        if (st.length <= 0.02 || st.path.length < 2) continue
        lo = Math.min(lo, st.offset)
        hi = Math.max(hi, st.offset)
        const reach = Math.max(1, st.path.length * SEG)
        // --- the stem: a tapering three-sided tube to the grown length ---
        const nodes = Math.min(st.path.length - 1, Math.ceil(st.length / SEG))
        const base = pos.length / 3
        for (let k = 0; k <= nodes; k++) {
          const a = Math.min(st.length, k * SEG)
          along(st, a, p, t)
          const u = a / reach
          const r = 0.034 * (1 - u) + 0.012 * u
          side.set(1, 0, 0).addScaledVector(t, -t.x).normalize()
          face.crossVectors(t, side).normalize()
          c.copy(STEM_TOP).lerp(STEM_TIP, Math.min(1, a / 3))
          for (let j = 0; j < 3; j++) {
            const ang = (j / 3) * Math.PI * 2
            pos.push(p.x + (side.x * Math.cos(ang) + face.x * Math.sin(ang)) * r, p.y + (side.y * Math.cos(ang) + face.y * Math.sin(ang)) * r, p.z + (side.z * Math.cos(ang) + face.z * Math.sin(ang)) * r)
            col.push(c.r, c.g, c.b)
          }
          if (k > 0) {
            const a0 = base + (k - 1) * 3
            const b0 = base + k * 3
            for (let j = 0; j < 3; j++) {
              const j1 = (j + 1) % 3
              idx.push(a0 + j, b0 + j, a0 + j1, a0 + j1, b0 + j, b0 + j1)
            }
          }
        }

        // --- leaves along it: dense near the top, sparser below, opening at the tip ---
        const out = edgeAt(d.edge, d.s0 + st.offset).out
        let a = 0.04 + hash(st.seed + 3) * 0.05
        for (let i = 0; a < st.length && n < MAX_LEAVES; i++) {
          along(st, a, p, t)
          const u = a / reach
          const hs = st.seed * 977 + i * 31
          const ang = hash(hs) * Math.PI * 2
          const rr = 0.025 + hash(hs + 1) * 0.06
          radial.set(Math.cos(ang), 0, Math.sin(ang))
          // Toward the outside of the curtain more than into the wall.
          radial.x += out[0] * 0.7
          radial.z += out[2] * 0.7
          radial.normalize()
          const fromTip = st.length - a
          const opening = Math.min(1, fromTip / 0.45)
          const size = (0.3 - 0.13 * u) * (0.75 + 0.5 * hash(hs + 2)) * (0.35 + 0.65 * opening)
          c.copy(LEAF_DARK).lerp(LEAF_LIGHT, hash(hs + 3) * 0.7 + u * 0.3)
          if (fromTip < 0.6) c.lerp(LEAF_YOUNG, 1 - fromTip / 0.6)
          p.addScaledVector(radial, rr)
          dir.copy(radial).multiplyScalar(0.55).add(t.clone().multiplyScalar(0.9))
          leaf(p, dir, radial, size, c)
          // A cluster: a bunch of larger leaves round the stem.
          if (hash(hs + 4) < 0.1 + 0.08 * (1 - u) && fromTip > 0.5) {
            for (let k = 0; k < 4; k++) {
              const a2 = ang + (k / 4) * Math.PI * 2 + hash(hs + 10 + k)
              radial.set(Math.cos(a2) + out[0] * 0.5, 0.15, Math.sin(a2) + out[2] * 0.5).normalize()
              along(st, a, p, t)
              p.addScaledVector(radial, 0.05)
              dir.copy(radial).multiplyScalar(0.8).add(t.clone().multiplyScalar(0.7))
              c.copy(LEAF_DARK).lerp(LEAF_LIGHT, 0.3 + hash(hs + 20 + k) * 0.5)
              leaf(p, dir, radial, size * 1.35, c)
            }
          }
          a += (0.055 + 0.11 * Math.min(1, a / 5)) * (0.7 + 0.6 * hash(hs + 5))
        }

        // --- a rooted base ---
        if (st.rootedAt >= 0) {
          const grown = Math.min(1, (step - st.rootedAt) / 120)
          const end = st.path[st.path.length - 1]
          for (let k = 0; k < 6; k++) {
            const hs = st.seed * 53 + k * 7
            const ang = hash(hs) * Math.PI * 2
            radial.set(Math.cos(ang), 0, Math.sin(ang))
            p.set(end[0] + radial.x * 0.12, end[1] + 0.02, end[2] + radial.z * 0.12)
            dir.set(radial.x, 0.25, radial.z)
            c.copy(LEAF_DARK).lerp(LEAF_LIGHT, hash(hs + 1))
            leaf(p, dir, new THREE.Vector3(0, 1, 0), 0.28 * grown * (0.7 + 0.6 * hash(hs + 2)), c)
          }
        }
      }

      // --- the lip: foliage along the edge, over the stretch the strands cover ---
      if (lo <= hi) {
        const lip = Math.min(1, age / 80)
        for (let s = lo - 0.3, i = 0; s <= hi + 0.3 && n < MAX_LEAVES; s += 0.075, i++) {
          const e = edgeAt(d.edge, d.s0 + s)
          const out: V3 = e.out
          for (let k = 0; k < 2; k++) {
            const hs = d.seed * 131 + i * 7 + k
            const drop = hash(hs) * 0.32
            p.set(e.p[0] + out[0] * (0.02 + hash(hs + 1) * 0.08), e.p[1] + 0.06 - drop, e.p[2] + out[2] * (0.02 + hash(hs + 1) * 0.08))
            radial.set(out[0] + (hash(hs + 2) - 0.5) * 0.8, 0, out[2] + (hash(hs + 3) - 0.5) * 0.8).normalize()
            dir.copy(radial).multiplyScalar(0.7).add(new THREE.Vector3(0, -0.8, 0))
            c.copy(LEAF_DARK).lerp(LEAF_LIGHT, hash(hs + 4) * 0.8)
            leaf(p, dir, radial, (0.26 + 0.1 * hash(hs + 5)) * lip, c)
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    this.stems.geometry.dispose()
    this.stems.geometry = geo
    this.leaves.count = n
    this.leafCount = n
    this.leaves.instanceMatrix.needsUpdate = true
    if (this.leaves.instanceColor) this.leaves.instanceColor.needsUpdate = true
  }

  dispose() {
    this.stems.geometry.dispose()
    ;(this.stems.material as THREE.Material).dispose()
    this.leaves.geometry.dispose()
    ;(this.leaves.material as THREE.Material).dispose()
    this.leaves.dispose()
  }
}
