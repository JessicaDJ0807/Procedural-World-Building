import * as THREE from 'three'
import type { Building } from '../green/building'
import type { Growth } from '../green/growth'
import { NO_SPECIES } from '../green/growth'
import { leafGeometry } from '../green/vegetation'
import { SPECIES_IDS, SPECIES_LOOK } from '../green/species'

/**
 * Real leaves on the campus, near the camera only.
 *
 * Explore draws two or three leaves on every grown cell and reserves room for
 * all of them up front; on the campus that would be 2.0 million instances,
 * about 160 MB, for leaves a fraction of a pixel across from the default view.
 * So the campus is drawn in two layers. Every grown cell is coloured on the
 * building's surface, which reads correctly from any distance. Within
 * `RADIUS` of the point the camera looks at, and only when the camera is
 * close enough for a leaf to be more than a speck, leaves are laid over the
 * colour — rebuilt when the camera has moved or the growth has changed.
 *
 * The leaves are the same shapes as Explore's, sized for the coarser cells,
 * and coloured by the same rule. They carry no age: leaves appear whole.
 */

/** Leaves are drawn when the camera is within this many metres of what it is looking at… */
export const LEAF_RANGE = 160
/** …for grown cells within this many metres of that point. */
const RADIUS = 70
/**
 * Per species. Measured at year 4, September: within the radius of the
 * campus's centre, 85,980 ivy leaves, 6,891 moss clumps and 71,614 vine
 * leaves — under the cap. Beyond it, cells are thinned evenly.
 */
const CAPACITY = 90_000

type Spec = { perCell: number; size: [number, number]; tilt: [number, number]; offset: number }

/** Explore's leaf shapes and tilts, at about twice the size: these cells are twice as wide. */
const SPECS: Spec[] = [
  { perCell: 2, size: [0.42, 0.26], tilt: [0.35, 0.6], offset: 0.08 },
  { perCell: 1, size: [0.62, 0.3], tilt: [0, 0.12], offset: 0.02 },
  { perCell: 2, size: [0.38, 0.2], tilt: [0.3, 0.5], offset: 0.08 },
]

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export class SiteLeaves {
  readonly meshes: THREE.InstancedMesh[]
  private readonly b: Building
  /** Where and what the leaves were last built for. */
  private builtAt = new THREE.Vector3(Infinity, 0, 0)
  private builtGrown = -1
  private builtFields = -1
  count = 0

  constructor(b: Building) {
    this.b = b
    this.meshes = SPECIES_IDS.map((id) => {
      const geometry = leafGeometry(id)
      const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, flatShading: id === 'moss' })
      const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3)
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.renderOrder = 22
      return mesh
    })
  }

  set visible(v: boolean) {
    for (const m of this.meshes) m.visible = v
  }

  /** Whether the leaves for this view are stale: the camera moved a fair way, or the growth or fields changed. */
  stale(centre: THREE.Vector3, growth: Growth, fieldsVersion: number): boolean {
    return centre.distanceTo(this.builtAt) > RADIUS * 0.25 || growth.grown !== this.builtGrown || fieldsVersion !== this.builtFields
  }

  rebuild(centre: THREE.Vector3, growth: Growth, moisture: Float32Array, fieldsVersion: number) {
    const b = this.b
    const r2 = RADIUS * RADIUS
    // First pass: which grown cells are near, per species, to choose a stride
    // that keeps every species under its cap.
    const near: number[][] = SPECIES_IDS.map(() => [])
    for (let k = 0; k < growth.grown; k++) {
      const cell = growth.order[k]
      const dx = b.px[cell] - centre.x
      const dy = b.py[cell] - centre.y
      const dz = b.pz[cell] - centre.z
      if (dx * dx + dy * dy + dz * dz > r2) continue
      const sp = growth.species[cell]
      if (sp !== NO_SPECIES) near[sp].push(cell)
    }

    const m = new THREE.Matrix4()
    const n = new THREE.Vector3()
    const t = new THREE.Vector3()
    const face = new THREE.Vector3()
    const along = new THREE.Vector3()
    const xAxis = new THREE.Vector3()
    const zAxis = new THREE.Vector3()
    const colour = new THREE.Color()
    this.count = 0
    near.forEach((cells, sp) => {
      const id = SPECIES_IDS[sp]
      const spec = SPECS[sp]
      const mesh = this.meshes[sp]
      const lush = new THREE.Color(SPECIES_LOOK[id].lush)
      const dry = new THREE.Color(SPECIES_LOOK[id].dry)
      const stride = Math.max(1, (cells.length * spec.perCell) / CAPACITY)
      let i = 0
      for (let f = 0; f < cells.length && i < CAPACITY; f += stride) {
        const cell = cells[Math.floor(f)]
        n.set(b.nx[cell], b.ny[cell], b.nz[cell])
        t.set(b.ax[cell], b.ay[cell], b.az[cell])
        face.set(b.ux[cell], b.uy[cell], b.uz[cell])
        const wet = Math.min(1, moisture[cell] * 1.4)
        for (let j = 0; j < spec.perCell && i < CAPACITY; j++) {
          const h = cell * 7 + j * 131
          const spin = (hash(h) - 0.5) * Math.PI * 1.6
          const tilt = spec.tilt[0] + hash(h + 1) * spec.tilt[1]
          along.copy(face).multiplyScalar(Math.cos(spin)).addScaledVector(t, Math.sin(spin))
          const yAxis = along.multiplyScalar(Math.cos(tilt)).addScaledVector(n, Math.sin(tilt)).normalize()
          zAxis.copy(n).addScaledVector(yAxis, -n.dot(yAxis)).normalize()
          xAxis.crossVectors(yAxis, zAxis)
          const size = spec.size[0] + hash(h + 2) * spec.size[1]
          const width = 0.8 + hash(h + 6) * 0.4
          m.makeBasis(xAxis.multiplyScalar(size * width), yAxis.clone().multiplyScalar(size), zAxis.clone().multiplyScalar(size))
          const ja = (hash(h + 3) - 0.5) * b.cell * 0.8
          const ju = (hash(h + 4) - 0.5) * b.cell * 0.8
          m.setPosition(
            b.px[cell] + n.x * spec.offset + t.x * ja + face.x * ju,
            b.py[cell] + n.y * spec.offset + t.y * ja + face.y * ju,
            b.pz[cell] + n.z * spec.offset + t.z * ja + face.z * ju,
          )
          mesh.setMatrixAt(i, m)
          colour.copy(dry).lerp(lush, wet)
          colour.offsetHSL((hash(h + 7) - 0.5) * 0.05, (hash(h + 8) - 0.5) * 0.2, (hash(h + 9) - 0.5) * 0.14)
          mesh.setColorAt(i, colour)
          i++
        }
      }
      mesh.count = i
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this.count += i
    })
    this.builtAt.copy(centre)
    this.builtGrown = growth.grown
    this.builtFields = fieldsVersion
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      mesh.dispose()
    }
  }
}
