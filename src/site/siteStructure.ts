import * as THREE from 'three'
import type { Building } from '../green/building'
import { NO_SPECIES, type Growth } from '../green/growth'
import { leafGeometry } from '../green/vegetation'
import { FRESH_STEPS, SITE_SPECIES, growthColour } from './siteLook'

/**
 * The middle level of detail: the growth's structure, between the far masses
 * and the close-up leaves.
 *
 * - **Branching paths.** Every flowering-vine cell is joined to the cell it
 *   grew from, as a thin stem: the vine stays the visibly structural species,
 *   its paths readable over the masses.
 * - **The growth front.** Climber cells younger than twice FRESH_STEPS are
 *   joined to their parents in a brighter, fresher green, so where growth is
 *   happening — and which way it is heading — shows from across the campus.
 * - **Leaf clusters.** A sparse scatter of three-leaf clusters over the ivy
 *   (one cell in eight) and the vine (one in fourteen), for relief: a mass of
 *   foliage rather than a painted surface. None on moss, which stays flat.
 *
 * One line mesh and one instanced mesh, rebuilt from the growth when it
 * changes — at most once a second while it plays — and drawn only at medium
 * range: from far away the lines would be pixel-wide scribbles, and close up
 * the full leaves take over.
 */

/** Drawn when the camera is between these distances from what it looks at, in metres. */
export const STRUCTURE_RANGE: [number, number] = [60, 650]
const IVY_CLUSTERS = 1 / 8
const VINE_CLUSTERS = 1 / 14
const FRONT_AGE = FRESH_STEPS * 2
const CLUSTER_CAP = 60_000

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export class SiteStructure {
  readonly group = new THREE.Group()
  private readonly lines: THREE.LineSegments
  private readonly clusters: THREE.InstancedMesh
  private readonly positions: Float32Array
  private readonly colours: Float32Array
  private readonly b: Building
  private builtGrown = -1
  private builtStep = -1
  private builtFields = -1
  /** Segments and clusters drawn after the last rebuild. */
  segments = 0
  clusterCount = 0

  constructor(b: Building) {
    this.b = b
    this.positions = new Float32Array(b.count * 6)
    this.colours = new Float32Array(b.count * 6)
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    lineGeo.setAttribute('color', new THREE.BufferAttribute(this.colours, 3).setUsage(THREE.DynamicDrawUsage))
    lineGeo.setDrawRange(0, 0)
    this.lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }))
    this.lines.frustumCulled = false
    this.lines.renderOrder = 22

    // A cluster: three ivy leaves fanned round a point, merged into one geometry.
    const parts: number[] = []
    const normals: number[] = []
    const leaf = leafGeometry('ivy')
    const pos = leaf.attributes.position
    const nor = leaf.attributes.normal
    const m = new THREE.Matrix4()
    const v = new THREE.Vector3()
    const nrm = new THREE.Vector3()
    for (let k = 0; k < 3; k++) {
      m.makeRotationZ((k * Math.PI * 2) / 3 + 0.4).multiply(new THREE.Matrix4().makeRotationX(0.5))
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m)
        nrm.fromBufferAttribute(nor, i).transformDirection(m)
        parts.push(v.x, v.y, v.z)
        normals.push(nrm.x, nrm.y, nrm.z)
      }
    }
    leaf.dispose()
    const clusterGeo = new THREE.BufferGeometry()
    clusterGeo.setAttribute('position', new THREE.Float32BufferAttribute(parts, 3))
    clusterGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    this.clusters = new THREE.InstancedMesh(clusterGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), CLUSTER_CAP)
    this.clusters.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CLUSTER_CAP * 3), 3)
    this.clusters.count = 0
    this.clusters.frustumCulled = false
    this.clusters.receiveShadow = true
    this.clusters.renderOrder = 22
    this.group.add(this.lines, this.clusters)
  }

  set visible(v: boolean) {
    this.group.visible = v
  }

  stale(growth: Growth, fieldsVersion: number): boolean {
    return growth.grown !== this.builtGrown || growth.step !== this.builtStep || fieldsVersion !== this.builtFields
  }

  rebuild(growth: Growth, env: Float32Array[], fieldsVersion: number, relief: Float32Array | null = null) {
    const { b } = this
    const P = this.positions
    const C = this.colours
    const stem = new THREE.Color('#57743f')
    const old = new THREE.Color('#4a5a3a')
    const front = SITE_SPECIES.map((s) => s.fresh.clone().multiplyScalar(1.15))
    const c = new THREE.Color()
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const n = new THREE.Vector3()
    const z = new THREE.Vector3(0, 0, 1)
    const spin = new THREE.Quaternion()
    let s = 0
    let k = 0
    const lift = 0.1
    for (let i = 0; i < growth.grown; i++) {
      const cell = growth.order[i]
      const sp = growth.species[cell]
      if (sp === NO_SPECIES) continue
      const age = growth.step - growth.birth[cell]
      const parent = growth.parent[cell]
      const isFront = sp !== 1 && age < FRONT_AGE
      if (parent >= 0 && (sp === 2 || isFront)) {
        // Stems ride just off the surface, along each cell's own normal.
        const o = s * 6
        const lp = lift + (relief ? relief[parent] : 0)
        const lc = lift + (relief ? relief[cell] : 0)
        P[o] = b.px[parent] + b.nx[parent] * lp
        P[o + 1] = b.py[parent] + b.ny[parent] * lp
        P[o + 2] = b.pz[parent] + b.nz[parent] * lp
        P[o + 3] = b.px[cell] + b.nx[cell] * lc
        P[o + 4] = b.py[cell] + b.ny[cell] * lc
        P[o + 5] = b.pz[cell] + b.nz[cell] * lc
        if (isFront) c.copy(front[sp])
        else c.copy(stem).lerp(old, Math.min(1, age / 600))
        c.toArray(C, o)
        c.toArray(C, o + 3)
        s++
      }
      const density = sp === 0 ? IVY_CLUSTERS : sp === 2 ? VINE_CLUSTERS : 0
      if (k < CLUSTER_CAP && density > 0 && age > FRESH_STEPS && hash(cell) < density) {
        n.set(b.nx[cell], b.ny[cell], b.nz[cell])
        q.setFromUnitVectors(z, n)
        spin.setFromAxisAngle(z, hash(cell + 3) * Math.PI * 2)
        q.multiply(spin)
        const size = 0.7 + hash(cell + 5) * 0.4
        const up = 0.12 + (relief ? relief[cell] : 0)
        m.compose(
          new THREE.Vector3(b.px[cell] + n.x * up, b.py[cell] + n.y * up, b.pz[cell] + n.z * up),
          q,
          new THREE.Vector3(size, size, size),
        )
        this.clusters.setMatrixAt(k, m)
        growthColour(sp, age, env[sp][cell], cell, c, false)
        this.clusters.setColorAt(k, c)
        k++
      }
    }
    const geo = this.lines.geometry
    geo.setDrawRange(0, s * 2)
    const posAttr = geo.attributes.position as THREE.BufferAttribute
    const colAttr = geo.attributes.color as THREE.BufferAttribute
    posAttr.clearUpdateRanges()
    colAttr.clearUpdateRanges()
    posAttr.addUpdateRange(0, s * 6)
    colAttr.addUpdateRange(0, s * 6)
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    this.clusters.count = k
    this.clusters.instanceMatrix.needsUpdate = true
    if (this.clusters.instanceColor) this.clusters.instanceColor.needsUpdate = true
    this.segments = s
    this.clusterCount = k
    this.builtGrown = growth.grown
    this.builtStep = growth.step
    this.builtFields = fieldsVersion
  }

  dispose() {
    this.lines.geometry.dispose()
    ;(this.lines.material as THREE.Material).dispose()
    this.clusters.geometry.dispose()
    ;(this.clusters.material as THREE.Material).dispose()
    this.clusters.dispose()
  }
}
