import * as THREE from 'three'
import { Batch, hash, ivyLeaf, leafMaterial, stemMaterial, vineLeaf } from '../green/vegetation'
import type { Building } from '../green/building'
import { MAX_LAYERS, ORPHAN, ROOT, type WildGrowth } from './growth'
import { CLIMBER, WILD_SPECIES } from './species'

/**
 * Draws the two species so they read apart by shape, not only by colour.
 *
 * - **Climber**: a visible stem from every cell to the one it grew from —
 *   thin lines that show which way it went — and sparse, small, pointed
 *   leaves standing off the wall: one on a little over half its cells.
 * - **Spreader**: no long stems to speak of, and three broad lobed leaves on
 *   every cell, lying close to the wall and turned sideways, so a stand reads
 *   as a dense horizontal mat.
 *
 * Age lives in the shader (vegetation.ts): instances carry their birth step
 * and open as the step uniform passes it, so a simulation step only appends.
 * When growth is removed — withering — everything is rebuilt.
 */

type Look = { lush: THREE.Color; dry: THREE.Color; stem: THREE.Color }

/** How far each layer stands off the one beneath it, in metres. */
const LAYER_GAP = 0.07
/** Seeds this close to the ground get a stem from it; anything higher starts where it was planted. */
const SEED_GROUND = 0.5

const LEAF = [
  // Climber: small, pointed, standing off the wall.
  { perCell: 1, share: 0.7, size: [0.17, 0.1], tilt: [0.45, 0.6], sideways: false, delays: [6] },
  // Spreader: broad, lobed, flat to the wall and turned sideways.
  { perCell: 3, share: 1, size: [0.27, 0.14], tilt: [0.05, 0.2], sideways: true, delays: [1, 10, 26] },
]

export class WildVegetation {
  readonly uStep = { value: 0 }
  private readonly stems: Batch
  private readonly leaves: Batch[]
  private readonly b: Building
  private readonly cellPos: Float32Array
  private drawn = 0
  private revision = -1
  private readonly looks: Look[]

  constructor(b: Building) {
    this.b = b
    const stemGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true)
    stemGeo.translate(0, 0.5, 0)
    // Up to three layers a cell, each with its own stem.
    this.stems = new Batch(stemGeo, stemMaterial(this.uStep), b.count * MAX_LAYERS, true)
    // A species can be in a cell twice (Climber over Spreader over Climber).
    this.leaves = WILD_SPECIES.map((sp, k) => new Batch(k === CLIMBER ? vineLeaf() : ivyLeaf(), leafMaterial(this.uStep, sp.look.young, 160, 30), b.count * LEAF[k].perCell * 2 + 64, true))
    for (const batch of this.leaves) batch.mesh.receiveShadow = true
    this.looks = WILD_SPECIES.map((sp) => ({ lush: new THREE.Color(sp.look.lush), dry: new THREE.Color(sp.look.dry), stem: new THREE.Color(sp.look.stem) }))
    // Off the surface far enough to clear a ledge, with a jitter across it so
    // the cell grid doesn't show.
    this.cellPos = new Float32Array(b.count * 3)
    for (let i = 0; i < b.count; i++) {
      const off = 0.08 + hash(i * 3 + 2) * 0.03
      const ja = (hash(i * 3) - 0.5) * b.cell * 0.7
      const ju = (hash(i * 3 + 1) - 0.5) * b.cell * 0.7
      this.cellPos[i * 3] = b.px[i] + b.nx[i] * off + b.ax[i] * ja + b.ux[i] * ju
      this.cellPos[i * 3 + 1] = b.py[i] + b.ny[i] * off + b.ay[i] * ja + b.uy[i] * ju
      this.cellPos[i * 3 + 2] = b.pz[i] + b.nz[i] * off + b.az[i] * ja + b.uz[i] * ju
    }
  }

  get meshes(): THREE.InstancedMesh[] {
    return [this.stems.mesh, ...this.leaves.map((l) => l.mesh)]
  }

  get foliage(): THREE.InstancedMesh[] {
    return this.leaves.map((l) => l.mesh)
  }

  get leafCount() {
    return this.leaves.reduce((sum, l) => sum + l.count, 0)
  }

  private clear() {
    this.drawn = 0
    for (const batch of [this.stems, ...this.leaves]) batch.clear()
  }

  /** Appends what grew since the last call; rebuilds if growth was removed (`revision` changed). */
  sync(growth: WildGrowth, moisture: Float32Array, revision: number) {
    if (revision !== this.revision || growth.grown < this.drawn) {
      this.clear()
      this.revision = revision
    }
    if (growth.grown === this.drawn) return
    const { b } = this
    const pos = this.cellPos
    const m = new THREE.Matrix4()
    const a = new THREE.Vector3()
    const c = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const q = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const colour = new THREE.Color()
    const n = new THREE.Vector3()
    const t = new THREE.Vector3()
    const face = new THREE.Vector3()
    for (let k = this.drawn; k < growth.grown; k++) {
      const e = growth.order[k]
      const sp = growth.entrySpecies[e]
      const cell = growth.entryCell[e]
      const parentEntry = growth.entryParent[e]
      const parent = parentEntry >= 0 ? growth.entryCell[parentEntry] : -1
      // An orphan — its parent withered — has no stem to draw.
      const orphan = parentEntry === ORPHAN
      const born = growth.entryBirth[e]
      // Each layer sits further off the wall than the one beneath it, so a
      // stack reads as depth: the plant on top is on top.
      const over = growth.levelOf(e) * LAYER_GAP
      const overParent = parentEntry >= 0 ? growth.levelOf(parentEntry) * LAYER_GAP : 0
      c.set(pos[cell * 3] + b.nx[cell] * over, pos[cell * 3 + 1] + b.ny[cell] * over, pos[cell * 3 + 2] + b.nz[cell] * over)
      // Stems: the climber's always; the spreader's only as short runners,
      // most hidden under its own leaves.
      // A seed's stem comes up out of the ground — but only a seed at the foot
      // of a wall has ground under it. One planted up a wall, on a roof or on
      // a living structure (the Build page allows all three) drew a straight
      // stem from the lawn to wherever it was planted.
      const rootless = parent < 0 && b.py[cell] > SEED_GROUND
      if (!orphan && !rootless && (sp === CLIMBER || hash(cell * 5 + 1) < 0.35)) {
        if (parent >= 0) a.set(pos[parent * 3] + b.nx[parent] * overParent, pos[parent * 3 + 1] + b.ny[parent] * overParent, pos[parent * 3 + 2] + b.nz[parent] * overParent)
        else a.set(c.x, 0, c.z)
        dir.subVectors(c, a)
        const length = Math.max(dir.length(), 1e-4)
        q.setFromUnitVectors(up, dir.divideScalar(length))
        // Thin: the shader thickens a stem with age to 0.04, which drew the
        // climber as brown sticks; at 0.55 of that it reads as a vine.
        m.compose(a, q, scale.set(0.55, length, 0.55))
        this.stems.push(m, born, this.looks[sp].stem)
      }
      const spec = LEAF[sp]
      // A seed is a small sprout, open from the start: a few of its species'
      // leaves at the foot of the wall, so step 0 shows where each plant begins.
      const seed = parentEntry === ROOT
      if (!seed && hash(cell * 11 + 7) >= spec.share) continue
      n.set(b.nx[cell], b.ny[cell], b.nz[cell])
      t.set(b.ax[cell], b.ay[cell], b.az[cell])
      face.set(b.ux[cell], b.uy[cell], b.uz[cell])
      const wet = Math.min(1, moisture[cell] * 1.4)
      const leavesHere = seed ? 5 : spec.perCell
      for (let j = 0; j < leavesHere; j++) {
        const h = cell * 7 + j * 131 + sp * 977
        // Sideways leaves point along the wall, left or right; the climber's anywhere upward.
        const spin = spec.sideways ? (hash(h) < 0.5 ? -1 : 1) * (Math.PI / 2 + (hash(h + 5) - 0.5) * 0.9) : (hash(h) - 0.5) * Math.PI * 1.4
        const tilt = spec.tilt[0] + hash(h + 1) * spec.tilt[1]
        const along = new THREE.Vector3().addScaledVector(face, Math.cos(spin)).addScaledVector(t, Math.sin(spin))
        const yAxis = along.multiplyScalar(Math.cos(tilt)).addScaledVector(n, Math.sin(tilt)).normalize()
        const zAxis = n.clone().addScaledVector(yAxis, -n.dot(yAxis)).normalize()
        const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis)
        const size = (spec.size[0] + hash(h + 2) * spec.size[1]) * (seed ? 1.5 : 1)
        const width = sp === CLIMBER ? 0.7 + hash(h + 6) * 0.3 : 1 + hash(h + 6) * 0.35
        m.makeBasis(xAxis.multiplyScalar(size * width), yAxis.multiplyScalar(size), zAxis.multiplyScalar(size))
        const ja = (hash(h + 3) - 0.5) * 0.14
        const ju = (hash(h + 4) - 0.5) * 0.14
        const lift = sp === CLIMBER ? 0.02 : 0.01 + j * 0.012
        m.setPosition(c.x + n.x * lift + t.x * ja + face.x * ju, c.y + n.y * lift + t.y * ja + face.y * ju, c.z + n.z * lift + t.z * ja + face.z * ju)
        colour.copy(this.looks[sp].dry).lerp(this.looks[sp].lush, wet)
        colour.offsetHSL((hash(h + 7) - 0.5) * 0.04, (hash(h + 8) - 0.5) * 0.16, (hash(h + 9) - 0.5) * 0.12)
        this.leaves[sp].push(m, seed ? born - 40 : born + spec.delays[j], colour)
      }
    }
    this.drawn = growth.grown
    for (const batch of [this.stems, ...this.leaves]) batch.flush()
  }

  dispose() {
    for (const batch of [this.stems, ...this.leaves]) batch.dispose()
  }
}
