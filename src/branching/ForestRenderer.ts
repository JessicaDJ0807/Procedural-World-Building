import * as THREE from 'three'
import { LODS, chooseLod, disposeVariant, type TreeVariant } from './lod'

/**
 * Trees into the scene, by instancing, with a level chosen per tree.
 *
 * ## Buckets
 *
 * One `InstancedMesh` per tree type per LOD per part — wood and leaves — so a
 * forest of three tree types is 3 × 4 × 2 = 24 meshes however many trees it
 * holds. A tree changing level is not a mesh changing geometry: it is the
 * tree's matrix moving from one bucket's instance buffer to another's. Every
 * bucket shares one of two materials (or one of eight debug ones), so nothing
 * is compiled per tree either.
 *
 * ## What happens per frame
 *
 * Nothing, unless the camera moved or a setting changed. When one did, every
 * tree is tested against the view frustum, given a level by its distance,
 * and its precomputed matrix copied into the right bucket: sixteen floats per
 * visible tree, with no geometry built and nothing allocated. Generation —
 * grammar, turtle, meshes, scatter — runs only when its own inputs change,
 * never because the camera did.
 *
 * Culling here is per tree. Left to itself, three.js culls an
 * `InstancedMesh` as a whole against the bounds of its *geometry*, which is
 * one tree at the origin; with that on, a forest vanishes whenever the origin
 * leaves the frame. So the meshes opt out and the culling is done here,
 * where it also stops off-screen trees from counting toward a level.
 */
export type Placement = {
  x: number
  z: number
  yaw: number
  scale: number
  variant: number
  /** Lightness multiplier, so no two trees of a type are quite the same green. */
  tint: number
  /** Pin this tree to a level, whatever the policy says — the lineup view. */
  lod?: number
}

export type LodPolicy = {
  auto: boolean
  manual: number
  thresholds: number[]
  hysteresis: number
}

export type FrameStats = {
  total: number
  visible: number
  perLod: number[]
  triangles: number
  /** What the same visible trees would cost all at LOD 0. */
  fullTriangles: number
  drawCalls: number
  updateMs: number
}

type Bucket = { wood: THREE.InstancedMesh; leaves: THREE.InstancedMesh | null; count: number }

export class ForestRenderer {
  readonly group = new THREE.Group()
  private variants: TreeVariant[] = []
  private placements: Placement[] = []
  private matrices = new Float32Array(0)
  private levels = new Int8Array(0)
  private buckets: Bucket[][] = []
  private shadows: THREE.InstancedMesh | null = null
  private dirty = true
  private policy: LodPolicy = { auto: true, manual: 0, thresholds: [20, 40, 70], hysteresis: 0.08 }
  private showLeaves = true
  private lodColours = false
  private progress = 1

  private readonly wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })
  private readonly foliage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true })
  private readonly debugWood = LODS.map((l) => new THREE.MeshStandardMaterial({ color: new THREE.Color(l.colour).multiplyScalar(0.8), roughness: 0.9, metalness: 0 }))
  private readonly debugLeaves = LODS.map((l) => new THREE.MeshStandardMaterial({ color: l.colour, roughness: 0.85, metalness: 0, flatShading: true }))
  private readonly shadowTexture = blobTexture()
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false, color: 0x000000 })
  private readonly frustum = new THREE.Frustum()
  private readonly projView = new THREE.Matrix4()
  private readonly sphere = new THREE.Sphere()
  private readonly tintColour = new THREE.Color()

  /** Takes ownership: the previous variants' geometry is disposed here. */
  setVariants(variants: TreeVariant[]) {
    for (const v of this.variants) disposeVariant(v)
    this.variants = variants
    this.rebuildBuckets()
  }

  setPlacements(placements: Placement[]) {
    this.placements = placements
    this.matrices = new Float32Array(placements.length * 16)
    // -1 means "no level yet", which tells chooseLod to skip the hysteresis
    // band: a tree appearing for the first time should get the right level,
    // not the one a tree that was never there would have had.
    this.levels = new Int8Array(placements.length).fill(-1)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    placements.forEach((t, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.yaw)
      m.compose(p.set(t.x, 0, t.z), q, s.set(t.scale, t.scale, t.scale))
      m.toArray(this.matrices, i * 16)
    })
    this.rebuildBuckets()
  }

  setPolicy(policy: LodPolicy) {
    this.policy = policy
    this.levels.fill(-1)
    this.dirty = true
  }

  setDisplay(showLeaves: boolean, lodColours: boolean) {
    this.showLeaves = showLeaves
    this.lodColours = lodColours
    this.applyMaterials()
    this.dirty = true
  }

  /**
   * The single-tree view's "turtle progress": draw only the first fraction of
   * segments, in the order the turtle drew them, and the leaves hanging from
   * those. LOD 0 keeps every segment in turtle order, so this is a draw range
   * and costs nothing to scrub.
   */
  setProgress(fraction: number) {
    this.progress = fraction
    const variant = this.variants[0]
    if (!variant) return
    const lod = variant.lods[0]
    const segments = variant.skeleton.segments.length
    const shown = Math.round(segments * fraction)
    const perSegment = segments ? (lod.branches.index?.count ?? 0) / segments : 0
    lod.branches.setDrawRange(0, fraction >= 1 ? Infinity : shown * perSegment)
    if (lod.leaves) {
      const perLeaf = variant.sites.length ? (lod.leaves.getAttribute('position').count / variant.sites.length) : 0
      let leaves = 0
      while (leaves < variant.sites.length && variant.sites[leaves].segment < shown) leaves++
      lod.leaves.setDrawRange(0, fraction >= 1 ? Infinity : leaves * perLeaf)
    }
    this.dirty = true
  }

  markDirty() {
    this.dirty = true
  }

  /** Returns stats when it did any work, null when nothing needed doing. */
  update(camera: THREE.PerspectiveCamera, cameraMoved: boolean): FrameStats | null {
    if (!this.dirty && !cameraMoved) return null
    this.dirty = false
    const started = performance.now()
    camera.updateMatrixWorld()
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.projView)

    for (const row of this.buckets) for (const b of row) b.count = 0
    const perLod = [0, 0, 0, 0]
    let visible = 0
    let triangles = 0
    let fullTriangles = 0
    const { auto, manual, thresholds, hysteresis } = this.policy
    const cam = camera.position

    this.placements.forEach((t, i) => {
      const variant = this.variants[t.variant]
      const row = this.buckets[t.variant]
      if (!variant || !row) return
      this.sphere.center.set(t.x, variant.centreY * t.scale, t.z)
      this.sphere.radius = variant.boundRadius * t.scale
      if (!this.frustum.intersectsSphere(this.sphere)) return
      const distance = this.sphere.center.distanceTo(cam)
      const level =
        t.lod ?? (auto ? chooseLod(distance, this.levels[i], thresholds, hysteresis) : manual)
      this.levels[i] = level
      const bucket = row[level]
      const n = bucket.count++
      bucket.wood.instanceMatrix.array.set(this.matrices.subarray(i * 16, i * 16 + 16), n * 16)
      bucket.leaves?.instanceMatrix.array.set(this.matrices.subarray(i * 16, i * 16 + 16), n * 16)
      this.tintColour.setScalar(t.tint)
      bucket.wood.setColorAt(n, this.tintColour)
      bucket.leaves?.setColorAt(n, this.tintColour)
      perLod[level]++
      visible++
      const lod = variant.lods[level]
      const full = variant.lods[0]
      triangles += lod.branchTris + (this.showLeaves ? lod.leafTris : 0)
      fullTriangles += full.branchTris + (this.showLeaves ? full.leafTris : 0)
    })

    let drawCalls = 0
    for (const row of this.buckets) {
      for (const b of row) {
        for (const mesh of [b.wood, b.leaves]) {
          if (!mesh) continue
          mesh.count = b.count
          mesh.instanceMatrix.needsUpdate = true
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        }
        b.wood.visible = b.count > 0
        if (b.leaves) b.leaves.visible = b.count > 0 && this.showLeaves
        drawCalls += (b.wood.visible ? 1 : 0) + (b.leaves?.visible ? 1 : 0)
      }
    }
    if (this.shadows) drawCalls++

    return {
      total: this.placements.length,
      visible,
      perLod,
      triangles,
      fullTriangles,
      drawCalls,
      updateMs: performance.now() - started,
    }
  }

  dispose() {
    this.clearBuckets()
    for (const v of this.variants) disposeVariant(v)
    this.variants = []
    for (const m of [this.wood, this.foliage, this.shadowMaterial, ...this.debugWood, ...this.debugLeaves]) m.dispose()
    this.shadowTexture.dispose()
  }

  private clearBuckets() {
    for (const row of this.buckets) {
      for (const b of row) {
        this.group.remove(b.wood)
        b.wood.dispose()
        if (b.leaves) {
          this.group.remove(b.leaves)
          b.leaves.dispose()
        }
      }
    }
    this.buckets = []
    if (this.shadows) {
      this.group.remove(this.shadows)
      this.shadows.geometry.dispose()
      this.shadows.dispose()
      this.shadows = null
    }
  }

  /**
   * Capacity per bucket is the number of trees of that type, since in the
   * worst case every one of them is at the same level. Meshes are rebuilt
   * only when the trees or the tree types change — not when the camera
   * moves, and not when the LOD settings do.
   */
  private rebuildBuckets() {
    this.clearBuckets()
    const perVariant = this.variants.map(() => 0)
    for (const t of this.placements) if (t.variant < perVariant.length) perVariant[t.variant]++
    this.buckets = this.variants.map((variant, v) =>
      variant.lods.map((lod) => {
        const capacity = Math.max(1, perVariant[v])
        const wood = new THREE.InstancedMesh(lod.branches, this.wood, capacity)
        const leaves = lod.leaves ? new THREE.InstancedMesh(lod.leaves, this.foliage, capacity) : null
        for (const mesh of [wood, leaves]) {
          if (!mesh) continue
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3)
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
          mesh.frustumCulled = false
          mesh.count = 0
          this.group.add(mesh)
        }
        return { wood, leaves, count: 0 }
      }),
    )

    // A soft dark disc under every tree. Without any contact shadow a forest
    // on flat ground reads as trees hovering over it; real shadow maps over a
    // thousand instances would cost more than the trees themselves.
    if (this.placements.length && this.variants.length) {
      const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
      this.shadows = new THREE.InstancedMesh(quad, this.shadowMaterial, this.placements.length)
      this.shadows.frustumCulled = false
      this.shadows.renderOrder = -1
      const m = new THREE.Matrix4()
      this.placements.forEach((t, i) => {
        const variant = this.variants[t.variant] ?? this.variants[0]
        const r = Math.max(variant.skeleton.radius, variant.height * 0.18) * 2.2 * t.scale
        m.makeScale(r, 1, r).setPosition(t.x, 0.01, t.z)
        this.shadows!.setMatrixAt(i, m)
      })
      this.group.add(this.shadows)
    }
    this.applyMaterials()
    this.levels.fill(-1)
    this.setProgress(this.progress)
    this.dirty = true
  }

  private applyMaterials() {
    this.buckets.forEach((row) =>
      row.forEach((b, level) => {
        b.wood.material = this.lodColours ? this.debugWood[level] : this.wood
        if (b.leaves) b.leaves.material = this.lodColours ? this.debugLeaves[level] : this.foliage
      }),
    )
  }
}

function blobTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.42)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.2)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
