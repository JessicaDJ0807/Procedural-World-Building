import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { hash, ivyLeaf, vineLeaf } from '../green/vegetation'
import { STAGES, type Deck, type Living, type V3 } from './living'

/**
 * Living architecture, drawn: a hybrid of building and plant, grown in stages.
 *
 * Rigid architecture on this page is clean boxes in warm stone. Living
 * architecture is meant to read as something else that is still usable:
 *
 * - **Decks** are swept along their centrelines with an irregular section —
 *   a flattish walking surface, a deeper rounded underside, an edge that
 *   swells and dips — and coloured as a hybrid: root-brown and fibrous below,
 *   stone with moss on top.
 * - **The frame** — rails, keels, ribs, helices — and **roots** are tubes in
 *   root colours, thicker for roots.
 * - **A knot** marks the node where the plants met, and is absorbed as the
 *   structure grows.
 *
 * `grow(age)` takes the steps since the node formed, so growth follows the
 * simulation — paused when it is — through STAGES:
 *
 *   node: the knot swells → frame: tubes draw out along their length →
 *   surface: decks fill in from their roots → mature: the fibrous tint gives
 *   way to stone → leaves: vegetation opens over the structure
 *
 * Drawn in the growth model's units, inside the Build page's scaled group.
 */

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const progress = (age: number, [a, b]: readonly [number, number]) => ease((age - a) / (b - a))

const STONE = new THREE.Color('#cbbda2')
const MOSS = new THREE.Color('#87915a')
const FIBRE = new THREE.Color('#8e7257')
const ROOT = new THREE.Color('#6f5a45')
const ROOT_GREEN = new THREE.Color('#66714a')
const KNOT = new THREE.Color('#c4cc7e')
/** Before it matures the surface is tinted toward this: raw growth, not yet stone. */
const RAW = new THREE.Color('#a78c6c')

const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2])

function colourise(geo: THREE.BufferGeometry, colour: (i: number, p: THREE.Vector3) => THREE.Color) {
  const pos = geo.attributes.position
  const c = new Float32Array(pos.count * 3)
  const p = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) colour(i, p.fromBufferAttribute(pos, i)).toArray(c, i * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return geo
}

/**
 * A deck swept along its centreline. Each section is a ring of points round
 * the centre: a gently domed top, a deeper underside, the half-width swelling
 * and dipping by a hash of the section. Indexed ring by ring, so drawing the
 * first fraction of the index fills the deck in from its root.
 */
function deckGeometry(d: Deck, seed: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(d.centre.map(v))
  const N = Math.max(6, d.centre.length * 3)
  const K = 12
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  const lerpAt = (arr: number[], t: number) => {
    const x = t * (arr.length - 1)
    const i = Math.min(arr.length - 2, Math.floor(x))
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i)
  }
  for (let s = 0; s <= N; s++) {
    const t = s / N
    const P = curve.getPointAt(t)
    const T = curve.getTangentAt(t)
    let side = new THREE.Vector3().crossVectors(up, T)
    if (side.lengthSq() < 1e-4) side = new THREE.Vector3(1, 0, 0)
    side.normalize()
    const w = lerpAt(d.width, t) / 2
    const h = lerpAt(d.thickness, t)
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      // The edge swells and dips; the top is flatter than the bottom.
      const swell = 1 + (hash(seed + s * 17 + k) - 0.5) * 0.18 + (Math.abs(ca) > 0.7 ? (hash(seed + s * 5) - 0.5) * 0.12 : 0)
      const u = Math.sign(ca) * Math.pow(Math.abs(ca), 0.7) * w * swell
      const vv = sa > 0 ? sa * h * 0.22 : sa * h
      pos.push(P.x + side.x * u, P.y + vv, P.z + side.z * u)
      const n = hash(seed * 3 + s * 29 + k * 7)
      if (sa > 0.35) c.copy(STONE).lerp(MOSS, n < 0.3 ? 0.55 + n : n * 0.4)
      else if (sa > -0.3) c.copy(STONE).lerp(FIBRE, 0.45 + n * 0.3)
      else c.copy(FIBRE).lerp(ROOT, n * 0.6)
      col.push(c.r, c.g, c.b)
    }
  }
  for (let s = 0; s < N; s++) {
    for (let k = 0; k < K; k++) {
      const a = s * K + k
      const b = s * K + ((k + 1) % K)
      const a2 = a + K
      const b2 = b + K
      idx.push(a, a2, b, b, a2, b2)
    }
  }
  // Caps, as fans from each end's centre.
  for (const [s, flip] of [
    [0, true],
    [N, false],
  ] as [number, boolean][]) {
    const centre = pos.length / 3
    const P = curve.getPointAt(s / N)
    pos.push(P.x, P.y, P.z)
    col.push(FIBRE.r, FIBRE.g, FIBRE.b)
    for (let k = 0; k < K; k++) {
      const a = s * K + k
      const b = s * K + ((k + 1) % K)
      if (flip) idx.push(centre, b, a)
      else idx.push(centre, a, b)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

function tube(points: V3[], radius: number, colour: THREE.Color, tip: THREE.Color): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(v))
  const segments = Math.max(8, Math.round(curve.getLength() * 5))
  const geo = new THREE.TubeGeometry(curve, segments, radius, 6, false)
  // Darker at the root, greener toward the growing end.
  const n = geo.attributes.position.count
  const per = 7
  return colourise(geo, (i) => {
    const t = Math.floor(i / per) / Math.max(1, n / per - 1)
    return new THREE.Color().copy(colour).lerp(tip, t * 0.6)
  })
}

export type LivingObject = { group: THREE.Group; grow: (age: number) => void; dispose: () => void }

export function livingObject(l: Living): LivingObject {
  const group = new THREE.Group()
  const surfaceMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide })
  const frameMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })
  const leafMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide })

  // The knot where the plants met.
  const knotGeo = colourise(new THREE.TorusKnotGeometry(0.26, 0.08, 64, 8, 2, 3), (_, p) => new THREE.Color().copy(KNOT).lerp(ROOT_GREEN, (p.y + 0.3) * 0.8))
  const knot = new THREE.Mesh(knotGeo, frameMaterial)
  knot.position.copy(v(l.node)).addScaledVector(v(l.normal), 0.3)
  knot.castShadow = true
  group.add(knot)

  // Frame and roots: one mesh each, so each draws out along its own length.
  const tubes: THREE.Mesh[] = []
  for (const c of l.frame) tubes.push(new THREE.Mesh(tube(c, 0.075, ROOT, ROOT_GREEN), frameMaterial))
  for (const c of l.roots) tubes.push(new THREE.Mesh(tube(c, 0.1, ROOT, FIBRE), frameMaterial))
  for (const t of tubes) {
    t.castShadow = true
    t.receiveShadow = true
    group.add(t)
  }

  const decks = l.decks.map((d, k) => {
    const m = new THREE.Mesh(deckGeometry(d, l.seed + k * 101), surfaceMaterial)
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
    return m
  })

  // Vegetation over the mature structure: leaves on the decks' tops and
  // hanging from their edges, merged, in an order that spreads from the node.
  const leafParts: { geo: THREE.BufferGeometry; d: number }[] = []
  const shapes = [ivyLeaf(), vineLeaf()]
  const greens = ['#5f8a55', '#7d9046', '#6b7f4c', '#8a9a52'].map((c) => new THREE.Color(c))
  const m4 = new THREE.Matrix4()
  const node = v(l.node)
  l.decks.forEach((d, k) => {
    const curve = new THREE.CatmullRomCurve3(d.centre.map(v))
    const count = Math.round(curve.getLength() * 9)
    for (let j = 0; j < count; j++) {
      const h = l.seed * 13 + k * 977 + j * 31
      const t = hash(h)
      const P = curve.getPointAt(t)
      const T = curve.getTangentAt(t)
      const side = new THREE.Vector3(-T.z, 0, T.x).normalize()
      const w = d.width[Math.min(d.width.length - 1, Math.round(t * (d.width.length - 1)))] / 2
      const off = (hash(h + 1) - 0.5) * 2 * w * 0.95
      const hanging = Math.abs(off) > w * 0.75 && hash(h + 2) < 0.5
      const at = P.clone().addScaledVector(side, off).add(new THREE.Vector3(0, hanging ? -0.2 - hash(h + 3) * 0.35 : 0.05, 0))
      const size = 0.22 + hash(h + 4) * 0.14
      const geo = shapes[hash(h + 5) < 0.6 ? 0 : 1].clone()
      const yAxis = hanging ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(Math.cos(hash(h + 6) * 6.28), 0, Math.sin(hash(h + 6) * 6.28))
      const zAxis = hanging ? side.clone().multiplyScalar(Math.sign(off)) : new THREE.Vector3(0, 1, 0)
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize()
      m4.makeBasis(xAxis.multiplyScalar(size), yAxis.multiplyScalar(size), zAxis.multiplyScalar(size)).setPosition(at)
      geo.applyMatrix4(m4)
      const g = greens[Math.floor(hash(h + 7) * greens.length)]
      colourise(geo, () => g)
      leafParts.push({ geo, d: at.distanceTo(node) })
    }
  })
  for (const s of shapes) s.dispose()
  leafParts.sort((a, b) => a.d - b.d)
  const leafGeo = leafParts.length ? mergeGeometries(leafParts.map((p) => p.geo)) : new THREE.BufferGeometry()
  for (const p of leafParts) p.geo.dispose()
  const leaves = new THREE.Mesh(leafGeo, leafMaterial)
  leaves.receiveShadow = true
  group.add(leaves)
  const leafCount = leafGeo.attributes.position ? leafGeo.attributes.position.count : 0

  const drawFraction = (mesh: THREE.Mesh, f: number) => {
    const geo = mesh.geometry
    const total = geo.index ? geo.index.count : geo.attributes.position?.count ?? 0
    const n = Math.floor((total * f) / 3) * 3
    geo.setDrawRange(0, n)
    mesh.visible = n > 0
  }

  const grow = (age: number) => {
    const node = progress(age, STAGES.node)
    const surface = progress(age, STAGES.surface)
    // The knot swells, then is absorbed as the surface grows over it.
    knot.scale.setScalar(Math.max(0.001, node * (1 - 0.5 * surface)))
    knot.rotation.y = age * 0.01
    const frame = progress(age, STAGES.frame)
    for (const t of tubes) drawFraction(t, frame)
    for (const d of decks) drawFraction(d, surface)
    // Raw growth turns to stone as it matures.
    surfaceMaterial.color.copy(RAW).lerp(new THREE.Color(1, 1, 1), progress(age, STAGES.mature))
    const leafF = progress(age, STAGES.leaves)
    leaves.geometry.setDrawRange(0, Math.floor((leafCount * leafF) / 3) * 3)
    leaves.visible = leafF > 0
  }
  grow(0)

  return {
    group,
    grow,
    dispose: () => {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose()
      })
      for (const m of [surfaceMaterial, frameMaterial, leafMaterial]) m.dispose()
    },
  }
}
