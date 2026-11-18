import * as THREE from 'three'
import { buildStopsLut, type Lut } from '../palette'
import type { StudyTerrain } from '../study/terrain'
import { PART_KINDS, type Part, type PartKind } from './building'
import { centroid, type Polygon } from './geometry'
import type { Ground } from './ground'
import type { RoadNetwork } from './roads'
import type { Tree, TreeKind } from './site'
import type { Category } from './zoning'

/**
 * Everything in Topic 10 that knows about three.js, apart from the viewport.
 *
 * Each layer is built from the pure data the algorithms return, so a layer is
 * rebuilt only when its own data changes: a new road network rebuilds the road
 * mesh and nothing else, and a show/hide toggle touches `.visible` and builds
 * nothing at all.
 */

/** Hex in sRGB, as written in a design; THREE.Color converts to linear. */
export const CATEGORY_COLOURS: Record<Category, number> = {
  building: 0x9aa5b1,
  park: 0x6e9460,
  garden: 0xaab47c,
  open: 0xc9c1ac,
}

/** Slate to sage to pale: muted, ordered in lightness, readable on the dark ground. */
export const HEAT_STOPS = ['#24313f', '#3f5d78', '#6f9389', '#a9bf8f', '#e8e4c6']
export const HEAT_LUT: Lut = buildStopsLut(HEAT_STOPS, 0)

const tmp = new THREE.Color()
const tmp2 = new THREE.Color()

/** The resting ground: sand at the shore, meadow on the flats, drier and stonier as it rises and steepens. */
export function groundColour(elevation: number, slope: number, out: THREE.Color): THREE.Color {
  out.setHex(0xa59d86).lerp(tmp.setHex(0x748a62), THREE.MathUtils.smoothstep(elevation, 0, 0.04))
  out.lerp(tmp.setHex(0x86906f), THREE.MathUtils.smoothstep(elevation, 0.35, 0.75))
  out.lerp(tmp.setHex(0x8a8574), THREE.MathUtils.smoothstep(slope, 10, 18))
  return out
}

export function paintGround(geometry: THREE.BufferGeometry, terrain: StudyTerrain, sample: ((x: number, z: number) => number) | null) {
  const colour = geometry.getAttribute('color') as THREE.BufferAttribute
  const { res, size, height, slope, waterLevel, maxHeight } = terrain
  const step = size / (res - 1)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i
      const e = (height[k] - waterLevel) / (maxHeight - waterLevel)
      if (sample) {
        const v = Math.min(1, Math.max(0, sample(-size / 2 + i * step, -size / 2 + j * step)))
        const o = Math.round(v * 255) * 3
        tmp2.setRGB(HEAT_LUT.linear[o], HEAT_LUT.linear[o + 1], HEAT_LUT.linear[o + 2])
        // Under water the map means nothing; keep it dark so the shore reads.
        if (e < 0) tmp2.multiplyScalar(0.35)
        colour.setXYZ(k, tmp2.r, tmp2.g, tmp2.b)
      } else {
        groundColour(e, slope[k], tmp2)
        colour.setXYZ(k, tmp2.r, tmp2.g, tmp2.b)
      }
    }
  }
  colour.needsUpdate = true
}

/** How far road and plot surfaces float over the ground, to stay out of it between samples. */
const ROAD_LIFT = 0.35
const PLOT_LIFT = 0.22

/**
 * Roads as flat strips, one per edge, with a disc at every junction to fill the
 * joint. Each strip is cut every 4 units and each cut set on the ground, so a
 * long road follows the terrain instead of bridging it.
 */
export function roadGeometry(net: RoadNetwork, ground: Ground): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const primary = new THREE.Color(0x565c63)
  const secondary = new THREE.Color(0x6a7076)
  const push = (x: number, z: number, c: THREE.Color, lift = ROAD_LIFT) => {
    pos.push(x, ground.height(x, z) + lift, z)
    col.push(c.r, c.g, c.b)
    return pos.length / 3 - 1
  }
  const radius = new Float32Array(net.nodes.length)
  const kindAt: boolean[] = new Array(net.nodes.length).fill(false)
  for (const e of net.edges) {
    const a = net.nodes[e.a]
    const b = net.nodes[e.b]
    const c = e.kind === 'primary' ? primary : secondary
    radius[e.a] = Math.max(radius[e.a], e.width / 2)
    radius[e.b] = Math.max(radius[e.b], e.width / 2)
    if (e.kind === 'primary') kindAt[e.a] = kindAt[e.b] = true
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (len < 1e-6) continue
    const nx = (-(b.z - a.z) / len) * (e.width / 2)
    const nz = ((b.x - a.x) / len) * (e.width / 2)
    const steps = Math.max(1, Math.ceil(len / 4))
    let prevL = -1
    let prevR = -1
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const x = a.x + (b.x - a.x) * t
      const z = a.z + (b.z - a.z) * t
      // Primaries sit a hair above secondaries, so where they overlap at a
      // junction one wins cleanly instead of flickering.
      const lift = ROAD_LIFT + (e.kind === 'primary' ? 0.03 : 0)
      const l = push(x + nx, z + nz, c, lift)
      const r = push(x - nx, z - nz, c, lift)
      if (prevL >= 0) idx.push(prevL, l, prevR, prevR, l, r)
      prevL = l
      prevR = r
    }
  }
  for (let n = 0; n < net.nodes.length; n++) {
    if (radius[n] <= 0) continue
    const { x, z } = net.nodes[n]
    const c = kindAt[n] ? primary : secondary
    const lift = ROAD_LIFT + (kindAt[n] ? 0.03 : 0)
    const centre = push(x, z, c, lift)
    const sides = 14
    const first = pos.length / 3
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2
      push(x + Math.cos(a) * radius[n], z + Math.sin(a) * radius[n], c, lift)
    }
    for (let k = 0; k < sides; k++) idx.push(centre, first + ((k + 1) % sides), first + k)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * Plot fills, triangulated and draped. `shrink` scales each polygon toward its
 * centre: 1 fills the plot; less leaves a tile in the middle with the ground —
 * or the zoning map — showing round it, which is how Experiment C shows the
 * decision and the field it was read from at once.
 */
export function plotFillGeometry(polys: Polygon[], colours: number[], ground: Ground, shrink = 1): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  polys.forEach((poly, p) => {
    const c = centroid(poly)
    const pts = poly.map((v) => new THREE.Vector2(c.x + (v.x - c.x) * shrink, c.z + (v.z - c.z) * shrink))
    const tris = THREE.ShapeUtils.triangulateShape(pts, [])
    const base = pos.length / 3
    tmp.setHex(colours[p])
    for (const v of pts) {
      pos.push(v.x, ground.height(v.x, v.y) + PLOT_LIFT, v.y)
      col.push(tmp.r, tmp.g, tmp.b)
    }
    for (const t of tris) idx.push(base + t[0], base + t[2], base + t[1])
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Plot outlines, cut every 3 units so they lie on the ground. */
export function outlineGeometry(polys: Polygon[], colours: number[] | number, ground: Ground, lift = PLOT_LIFT + 0.08): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  polys.forEach((poly, p) => {
    tmp.setHex(typeof colours === 'number' ? colours : colours[p])
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3))
      for (let s = 0; s < n; s++) {
        const x0 = a.x + ((b.x - a.x) * s) / n
        const z0 = a.z + ((b.z - a.z) * s) / n
        const x1 = a.x + ((b.x - a.x) * (s + 1)) / n
        const z1 = a.z + ((b.z - a.z) * (s + 1)) / n
        pos.push(x0, ground.height(x0, z0) + lift, z0, x1, ground.height(x1, z1) + lift, z1)
        col.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b)
      }
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

/** A triangular prism, ridge along x, base on y = 0, spanning the unit square. */
function gableGeometry(): THREE.BufferGeometry {
  const v = [
    // Two sloped faces and two gable ends, unindexed for flat shading.
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
  ]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  g.computeVertexNormals()
  return g
}

export type BuildingInstance = { x: number; y: number; z: number; rot: number; parts: Part[] }

/**
 * Every part of every building, one InstancedMesh per kind: a site of five
 * hundred buildings is ten draw calls. One unit box serves every kind but the
 * roof, and it is shared, as are the materials.
 */
export class BuildingInstances {
  readonly group = new THREE.Group()
  private readonly box = new THREE.BoxGeometry(1, 1, 1)
  private readonly gable = gableGeometry()
  private readonly materials: Record<PartKind, THREE.MeshStandardMaterial>
  private meshes = new Map<PartKind, THREE.InstancedMesh>()
  instances = 0

  constructor() {
    const mat = (roughness = 0.92) => new THREE.MeshStandardMaterial({ roughness, metalness: 0, flatShading: true })
    this.materials = Object.fromEntries(PART_KINDS.map((k) => [k, mat(k === 'window' ? 0.35 : 0.92)])) as Record<PartKind, THREE.MeshStandardMaterial>
  }

  set(buildings: BuildingInstance[]) {
    const byKind = new Map<PartKind, { b: BuildingInstance; p: Part }[]>()
    for (const b of buildings) for (const p of b.parts) {
      const list = byKind.get(p.kind)
      if (list) list.push({ b, p })
      else byKind.set(p.kind, [{ b, p }])
    }
    const mb = new THREE.Matrix4()
    const mp = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const v = new THREE.Vector3()
    const s = new THREE.Vector3()
    const colour = new THREE.Color()
    this.instances = 0
    for (const kind of PART_KINDS) {
      const list = byKind.get(kind) ?? []
      let mesh = this.meshes.get(kind)
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) {
          this.group.remove(mesh)
          mesh.dispose()
        }
        const capacity = Math.max(16, Math.ceil(list.length * 1.25))
        mesh = new THREE.InstancedMesh(kind === 'gable' ? this.gable : this.box, this.materials[kind], capacity)
        mesh.castShadow = true
        mesh.receiveShadow = true
        this.meshes.set(kind, mesh)
        this.group.add(mesh)
      }
      list.forEach(({ b, p }, i) => {
        mb.compose(v.set(b.x, b.y, b.z), q.setFromAxisAngle(up, b.rot), s.set(1, 1, 1))
        mp.compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.rot), s.set(p.sx, p.sy, p.sz))
        mesh!.setMatrixAt(i, mb.multiply(mp))
        mesh!.setColorAt(i, colour.setHex(p.colour))
      })
      mesh.count = list.length
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
      this.instances += list.length
    }
  }

  dispose() {
    for (const m of this.meshes.values()) m.dispose()
    this.box.dispose()
    this.gable.dispose()
    for (const m of Object.values(this.materials)) m.dispose()
  }
}

const TREE_GREENS = [0x5f7d52, 0x6b8a5a, 0x587455, 0x748f60, 0x657f5d]

/** Trees, conifers and shrubs: a trunk and a low-poly crown each, instanced. */
export class TreeInstances {
  readonly group = new THREE.Group()
  private trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 5).translate(0, 0.5, 0)
  private crownGeo = new THREE.IcosahedronGeometry(1, 0)
  private coneGeo = new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0)
  private trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b5d50, roughness: 1, flatShading: true })
  private leafMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true })
  private trunks: THREE.InstancedMesh | null = null
  private crowns: THREE.InstancedMesh | null = null
  private cones: THREE.InstancedMesh | null = null
  count = 0

  set(trees: Tree[]) {
    const ensure = (current: THREE.InstancedMesh | null, geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
      if (current && current.instanceMatrix.count >= n) return current
      if (current) {
        this.group.remove(current)
        current.dispose()
      }
      const m = new THREE.InstancedMesh(geo, mat, Math.max(16, Math.ceil(n * 1.25)))
      m.castShadow = true
      m.receiveShadow = true
      this.group.add(m)
      return m
    }
    const broad = trees.filter((t) => t.kind !== 'conifer')
    const conifers = trees.filter((t) => t.kind === 'conifer')
    this.trunks = ensure(this.trunks, this.trunkGeo, this.trunkMat, trees.length)
    this.crowns = ensure(this.crowns, this.crownGeo, this.leafMat, broad.length)
    this.cones = ensure(this.cones, this.coneGeo, this.leafMat, conifers.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const v = new THREE.Vector3()
    const s = new THREE.Vector3()
    const c = new THREE.Color()
    const dims: Record<TreeKind, { trunk: number; crown: number; lift: number }> = {
      tree: { trunk: 2.2, crown: 2.3, lift: 3.6 },
      conifer: { trunk: 1.2, crown: 2.0, lift: 1.0 },
      shrub: { trunk: 0, crown: 1.4, lift: 0.8 },
    }
    trees.forEach((t, i) => {
      const d = dims[t.kind]
      m.compose(v.set(t.x, t.y - 0.2, t.z), q.identity(), s.set(t.scale, d.trunk * t.scale + 1e-3, t.scale))
      this.trunks!.setMatrixAt(i, m)
    })
    this.trunks.count = trees.length
    broad.forEach((t, i) => {
      const d = dims[t.kind]
      q.setFromAxisAngle(v.set(0, 1, 0), t.tint * 6.28)
      m.compose(v.set(t.x, t.y + d.lift * t.scale, t.z), q, s.set(d.crown * t.scale, d.crown * t.scale * 0.85, d.crown * t.scale))
      this.crowns!.setMatrixAt(i, m)
      this.crowns!.setColorAt(i, c.setHex(TREE_GREENS[Math.floor(t.tint * TREE_GREENS.length) % TREE_GREENS.length]).multiplyScalar(t.kind === 'shrub' ? 1.08 : 1))
    })
    this.crowns.count = broad.length
    conifers.forEach((t, i) => {
      m.compose(v.set(t.x, t.y + 1.0 * t.scale, t.z), q.identity(), s.set(1.9 * t.scale, 6 * t.scale, 1.9 * t.scale))
      this.cones!.setMatrixAt(i, m)
      this.cones!.setColorAt(i, c.setHex(0x4f6a52).multiplyScalar(0.9 + t.tint * 0.2))
    })
    this.cones.count = conifers.length
    for (const mesh of [this.trunks, this.crowns, this.cones]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    this.count = trees.length
  }

  dispose() {
    for (const m of [this.trunks, this.crowns, this.cones]) m?.dispose()
    this.trunkGeo.dispose()
    this.crownGeo.dispose()
    this.coneGeo.dispose()
    this.trunkMat.dispose()
    this.leafMat.dispose()
  }
}
