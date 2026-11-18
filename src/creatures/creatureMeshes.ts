import * as THREE from 'three'
import type { Body } from './animate'
import type { Creature, JointKind } from './skeleton'

/**
 * Drawing a creature. Built once per phenotype; a frame only writes bone
 * transforms and instance matrices, never geometry.
 *
 *   body      one SkinnedMesh: rings of skin round the spine, every vertex
 *             bound to its two nearest spine bones by distance, so the spine
 *             bends the skin smoothly — the rigging the lecture describes.
 *   head      an ellipsoid on the head joint's frame, with eyes.
 *   limbs     every leg, digit, antenna, wing finger and frond bone as one
 *             instanced tapered cylinder, with a ball at each joint so the
 *             segments join as soft knuckles rather than open tubes.
 *   wings     a membrane between the fingers, its vertices rewritten each
 *             frame from the finger joints.
 *   debug     the skeleton as lines, the joints and attachment points as
 *             markers, all drawn over the body.
 */
const PALETTE = [0x7d9466, 0x93a687, 0x6f8494, 0x8d8f9b, 0xb2a587].map((h) => new THREE.Color(h))
const BELLY = new THREE.Color(0xd9d3c3)

export function creatureColour(hue: number): THREE.Color {
  const t = Math.min(0.999, Math.max(0, hue)) * (PALETTE.length - 1)
  const i = Math.floor(t)
  return PALETTE[i].clone().lerp(PALETTE[i + 1], t - i)
}

export const JOINT_COLOURS: Record<JointKind, number> = {
  root: 0xffffff,
  spine: 0xf0e6b0,
  tail: 0xf0e6b0,
  head: 0xf0e6b0,
  hip: 0x9cc7e8,
  coxa: 0x9cc7e8,
  knee: 0x9cc7e8,
  ankle: 0x9cc7e8,
  toe: 0x9cc7e8,
  digit: 0x9cc7e8,
  eye: 0xb8e0a8,
  antenna: 0xb8e0a8,
  wing: 0xd0b8e8,
  frond: 0xd0b8e8,
}
export const ATTACH_COLOUR = 0xd98a9a
export const SKELETON_COLOUR = 0xf4f1e8
export const SELECT_COLOUR = 0xffffff

const UP = new THREE.Vector3(0, 1, 0)

function bodyGeometry(c: Creature): THREE.BufferGeometry {
  const R = 22
  const rings = c.rings
  const base = creatureColour(c.genome.hue)
  const dark = base.clone().multiplyScalar(0.62)
  const pos: number[] = []
  const col: number[] = []
  const skinIndex: number[] = []
  const skinWeight: number[] = []
  const xs = c.spineX
  const tmp = new THREE.Color()
  for (const ring of rings) {
    // The two spine bones either side of this ring, weighted by distance.
    let i = 0
    while (i < xs.length - 2 && xs[i + 1] < ring.x) i++
    const w = Math.min(1, Math.max(0, (ring.x - xs[i]) / Math.max(xs[i + 1] - xs[i], 1e-9)))
    for (let k = 0; k <= R; k++) {
      const th = (k / R) * Math.PI * 2
      const s = Math.sin(th)
      // A flatter belly than back, as most animals have.
      const y = c.bodyY + ring.hh * s * (s < 0 ? 0.78 : 1)
      pos.push(ring.x, y, ring.hw * Math.cos(th))
      tmp.copy(base)
      if (s > 0) tmp.lerp(dark, 0.18 * s + 0.55 * c.genome.pattern * ring.stripe * Math.pow(s, 0.6))
      else tmp.lerp(BELLY, 0.5 * Math.pow(-s, 0.8))
      col.push(tmp.r, tmp.g, tmp.b)
      skinIndex.push(i, i + 1, 0, 0)
      skinWeight.push(1 - w, w, 0, 0)
    }
  }
  const index: number[] = []
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < R; k++) {
      const a = r * (R + 1) + k
      const b = a + R + 1
      // Counter-clockwise seen from outside: ring angle runs from the right side
      // (+z) up over the back, so (a, b, a + 1) faces outward. The other order
      // drew the far wall's inside, and the body read as a hollow shell.
      index.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

export class CreatureRig {
  readonly group = new THREE.Group()
  readonly creature: Creature
  private readonly boneRoot = new THREE.Group()
  private readonly bones: THREE.Bone[]
  readonly skin: THREE.SkinnedMesh
  readonly head: THREE.Mesh
  readonly limbs: THREE.InstancedMesh
  readonly knuckles: THREE.InstancedMesh
  private readonly knuckleJoints: number[]
  private readonly knuckleRadius: number[]
  private readonly sclera: THREE.InstancedMesh
  private readonly pupils: THREE.InstancedMesh
  private readonly wings: THREE.Mesh | null
  // Debug
  private readonly skeleton: THREE.LineSegments
  private readonly skeletonPairs: [number, number][]
  private readonly jointMarks: THREE.InstancedMesh
  private readonly attachMarks: THREE.InstancedMesh
  private readonly selection: THREE.Mesh
  private readonly limbColour: THREE.Color
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly basis = new THREE.Matrix4()
  private readonly materials: THREE.Material[] = []
  private readonly geometries: THREE.BufferGeometry[] = []

  constructor(c: Creature, { ghost = false }: { ghost?: boolean } = {}) {
    this.creature = c
    const base = creatureColour(c.genome.hue)
    const mat = <T extends THREE.Material>(m: T) => {
      if (ghost) {
        m.transparent = true
        m.opacity = 0.55
      }
      this.materials.push(m)
      return m
    }
    const geo = <T extends THREE.BufferGeometry>(g: T) => {
      this.geometries.push(g)
      return g
    }

    // ---- skinned body: one bone per spine joint, bound at the rest pose.
    this.bones = c.spine.map((id) => {
      const bone = new THREE.Bone()
      bone.position.set(c.joints[id].bind.x, c.joints[id].bind.y, c.joints[id].bind.z)
      this.boneRoot.add(bone)
      return bone
    })
    this.group.add(this.boneRoot)
    this.skin = new THREE.SkinnedMesh(geo(bodyGeometry(c)), mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 })))
    this.skin.castShadow = !ghost
    this.skin.receiveShadow = true
    this.skin.frustumCulled = false
    this.group.add(this.skin)
    this.group.updateMatrixWorld(true)
    this.skin.bind(new THREE.Skeleton(this.bones))

    // ---- head and eyes
    const r = c.headRadii
    this.head = new THREE.Mesh(geo(new THREE.SphereGeometry(1, 28, 18).scale(r.x, r.y, r.z)), mat(new THREE.MeshStandardMaterial({ color: base.clone().lerp(BELLY, 0.12), roughness: 0.75 })))
    this.head.castShadow = !ghost
    this.group.add(this.head)
    const eyeCount = Math.max(1, c.eyes.length)
    this.sclera = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(1, 16, 12)), mat(new THREE.MeshStandardMaterial({ color: 0xeeeae0, roughness: 0.35 })), eyeCount)
    this.pupils = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(1, 12, 10)), mat(new THREE.MeshStandardMaterial({ color: 0x1f2326, roughness: 0.2 })), eyeCount)
    this.sclera.count = this.pupils.count = c.eyes.length
    this.group.add(this.sclera, this.pupils)

    // ---- limbs: a slightly tapered unit cylinder from y = 0 to 1, per bone.
    this.limbColour = base.clone().multiplyScalar(0.82)
    this.limbs = new THREE.InstancedMesh(
      geo(new THREE.CylinderGeometry(0.78, 1, 1, 12, 1, true).translate(0, 0.5, 0)),
      mat(new THREE.MeshStandardMaterial({ roughness: 0.75 })),
      Math.max(1, c.bones.length),
    )
    this.limbs.count = c.bones.length
    this.limbs.castShadow = !ghost
    this.limbs.frustumCulled = false
    // A ball at every joint a bone touches, as big as the thickest bone there.
    const radius = new Map<number, number>()
    for (const bn of c.bones) {
      radius.set(bn.a, Math.max(radius.get(bn.a) ?? 0, bn.r0))
      radius.set(bn.b, Math.max(radius.get(bn.b) ?? 0, bn.r1))
    }
    this.knuckleJoints = [...radius.keys()]
    this.knuckleRadius = this.knuckleJoints.map((j) => radius.get(j)! * (c.joints[j].kind === 'toe' ? 1.5 : 1.08))
    this.knuckles = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(1, 12, 10)), mat(new THREE.MeshStandardMaterial({ roughness: 0.75 })), Math.max(1, this.knuckleJoints.length))
    this.knuckles.count = this.knuckleJoints.length
    this.knuckles.castShadow = !ghost
    this.knuckles.frustumCulled = false
    c.bones.forEach((bn, i) => {
      const tint = bn.part === 'wing' ? base.clone().lerp(BELLY, 0.3) : bn.part === 'frond' ? base.clone().lerp(new THREE.Color(0x9fb88a), 0.4) : this.limbColour
      this.limbs.setColorAt(i, tint)
    })
    this.knuckleJoints.forEach((j, i) => this.knuckles.setColorAt(i, c.joints[j].kind === 'frond' ? base.clone().lerp(new THREE.Color(0x9fb88a), 0.4) : this.limbColour))
    this.group.add(this.limbs, this.knuckles)

    // ---- wing membranes
    if (c.wings.length) {
      const g = geo(new THREE.BufferGeometry())
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(c.wings.length * 6 * 3), 3))
      this.wings = new THREE.Mesh(g, mat(new THREE.MeshStandardMaterial({ color: base.clone().lerp(BELLY, 0.45), roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: ghost ? 0.3 : 0.62 })))
      this.wings.frustumCulled = false
      this.group.add(this.wings)
    } else this.wings = null

    // ---- debug: skeleton lines, joint and attachment markers, selection
    this.skeletonPairs = c.joints.filter((j) => j.parent >= 0).map((j) => [j.parent, j.id])
    const lineGeo = geo(new THREE.BufferGeometry())
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.skeletonPairs.length * 6), 3))
    this.skeleton = new THREE.LineSegments(lineGeo, mat(new THREE.LineBasicMaterial({ color: SKELETON_COLOUR, depthTest: false, transparent: true, opacity: 0.9 })))
    this.skeleton.renderOrder = 10
    this.skeleton.frustumCulled = false
    const marker = (n: number, g: THREE.BufferGeometry) => {
      const im = new THREE.InstancedMesh(geo(g), mat(new THREE.MeshBasicMaterial({ depthTest: false, transparent: true })), Math.max(1, n))
      im.count = n
      im.renderOrder = 11
      im.frustumCulled = false
      return im
    }
    this.jointMarks = marker(c.joints.length, new THREE.SphereGeometry(1, 10, 8))
    c.joints.forEach((j, i) => this.jointMarks.setColorAt(i, new THREE.Color(JOINT_COLOURS[j.kind])))
    this.attachMarks = marker(c.attachments.length, new THREE.OctahedronGeometry(1))
    c.attachments.forEach((_, i) => this.attachMarks.setColorAt(i, new THREE.Color(ATTACH_COLOUR)))
    this.selection = new THREE.Mesh(geo(new THREE.TorusGeometry(1, 0.12, 8, 32)), mat(new THREE.MeshBasicMaterial({ color: SELECT_COLOUR, depthTest: false, transparent: true })))
    this.selection.renderOrder = 12
    this.selection.visible = false
    this.group.add(this.skeleton, this.jointMarks, this.attachMarks, this.selection)
  }

  /** Copy a pose into the scene graph. `selected` is a joint id, or −1. */
  update(body: Body, show: { skeleton: boolean; joints: boolean; attachments: boolean }, selected: number, camera: THREE.Camera) {
    const c = this.creature
    const p = body.pos
    const at = (id: number, out: THREE.Vector3) => out.set(p[id * 3], p[id * 3 + 1], p[id * 3 + 2])

    // Spine bones: position and the frame's basis.
    body.spineFrames.forEach((f, i) => {
      const bone = this.bones[i]
      bone.position.set(f.o.x, f.o.y, f.o.z)
      this.basis.makeBasis(this.a.set(f.t.x, f.t.y, f.t.z), this.b.set(f.u.x, f.u.y, f.u.z), this.v.set(f.l.x, f.l.y, f.l.z))
      bone.quaternion.setFromRotationMatrix(this.basis)
    })
    const hf = body.headFrame
    this.head.position.set(hf.o.x, hf.o.y, hf.o.z)
    this.basis.makeBasis(this.a.set(hf.t.x, hf.t.y, hf.t.z), this.b.set(hf.u.x, hf.u.y, hf.u.z), this.v.set(hf.l.x, hf.l.y, hf.l.z))
    this.head.quaternion.setFromRotationMatrix(this.basis)

    // Eyes: a white ball, and a pupil on its surface facing out.
    c.eyes.forEach((e, i) => {
      at(e.joint, this.a)
      this.m.compose(this.a, this.q.identity(), this.s.setScalar(e.radius))
      this.sclera.setMatrixAt(i, this.m)
      const d = this.b.set(hf.t.x * e.dir.x + hf.u.x * e.dir.y + hf.l.x * e.dir.z, hf.t.y * e.dir.x + hf.u.y * e.dir.y + hf.l.y * e.dir.z, hf.t.z * e.dir.x + hf.u.z * e.dir.y + hf.l.z * e.dir.z)
      this.a.addScaledVector(d, e.radius * 0.62)
      this.m.compose(this.a, this.q.identity(), this.s.setScalar(e.radius * 0.5))
      this.pupils.setMatrixAt(i, this.m)
    })
    this.sclera.instanceMatrix.needsUpdate = true
    this.pupils.instanceMatrix.needsUpdate = true

    // Limb bones.
    const sel = selected
    c.bones.forEach((bn, i) => {
      at(bn.a, this.a)
      at(bn.b, this.b)
      const l = this.a.distanceTo(this.b)
      this.v.subVectors(this.b, this.a).divideScalar(Math.max(l, 1e-9))
      this.q.setFromUnitVectors(UP, this.v)
      this.m.compose(this.a, this.q, this.s.set(bn.r0, l, bn.r0))
      this.limbs.setMatrixAt(i, this.m)
    })
    this.limbs.instanceMatrix.needsUpdate = true
    this.knuckleJoints.forEach((j, i) => {
      at(j, this.a)
      const r = this.knuckleRadius[i]
      // Toes flatten into a foot pad.
      this.m.compose(this.a, this.q.identity(), c.joints[j].kind === 'toe' ? this.s.set(r * 1.2, r * 0.7, r * 1.2) : this.s.setScalar(r))
      this.knuckles.setMatrixAt(i, this.m)
    })
    this.knuckles.instanceMatrix.needsUpdate = true

    if (this.wings) {
      const attr = this.wings.geometry.getAttribute('position') as THREE.BufferAttribute
      let k = 0
      for (const w of c.wings) {
        const [r0, f1, f2, f3] = w.joints
        for (const tri of [
          [r0, f1, f2],
          [r0, f2, f3],
        ]) {
          for (const id of tri) attr.setXYZ(k++, p[id * 3], p[id * 3 + 1], p[id * 3 + 2])
        }
      }
      attr.needsUpdate = true
      this.wings.geometry.computeVertexNormals()
    }

    // ---- debug
    this.skeleton.visible = show.skeleton
    if (show.skeleton) {
      const attr = this.skeleton.geometry.getAttribute('position') as THREE.BufferAttribute
      this.skeletonPairs.forEach(([pa, ch], i) => {
        attr.setXYZ(i * 2, p[pa * 3], p[pa * 3 + 1], p[pa * 3 + 2])
        attr.setXYZ(i * 2 + 1, p[ch * 3], p[ch * 3 + 1], p[ch * 3 + 2])
      })
      attr.needsUpdate = true
    }
    // Markers keep a constant size on screen: scaled by distance to the camera.
    const size = (v: THREE.Vector3, k: number) => Math.max(0.012, v.distanceTo(camera.position) * k)
    this.jointMarks.visible = show.joints
    if (show.joints) {
      c.joints.forEach((_, i) => {
        at(i, this.a)
        this.m.compose(this.a, this.q.identity(), this.s.setScalar(size(this.a, 0.006)))
        this.jointMarks.setMatrixAt(i, this.m)
      })
      this.jointMarks.instanceMatrix.needsUpdate = true
    }
    this.attachMarks.visible = show.attachments
    if (show.attachments) {
      c.attachments.forEach((att, i) => {
        at(att.joint, this.a)
        this.m.compose(this.a, this.q.identity(), this.s.setScalar(size(this.a, 0.011)))
        this.attachMarks.setMatrixAt(i, this.m)
      })
      this.attachMarks.instanceMatrix.needsUpdate = true
    }
    this.selection.visible = sel >= 0 && sel < c.joints.length
    if (this.selection.visible) {
      at(sel, this.a)
      this.selection.position.copy(this.a)
      this.selection.quaternion.copy(camera.quaternion)
      this.selection.scale.setScalar(size(this.a, 0.018))
    }
  }

  /**
   * The joint under a ray: a limb bone picks its far joint, a knuckle its own,
   * the body its nearest spine joint, the head the head. −1 for a miss.
   */
  pick(ray: THREE.Raycaster, body: Body): number {
    // Instanced and skinned meshes cache their bounding sphere at the first
    // raycast, and this creature's instances move every frame — walking in
    // place, it walks on in its own coordinates while the view slides it
    // back. A stale sphere misses every ray, so they are refreshed per click.
    for (const m of [this.limbs, this.knuckles, this.sclera]) m.computeBoundingSphere()
    this.skin.computeBoundingSphere()
    const hits = ray.intersectObjects([this.limbs, this.knuckles, this.head, this.sclera, this.skin], false)
    const hit = hits[0]
    if (!hit) return -1
    const c = this.creature
    if (hit.object === this.limbs && hit.instanceId !== undefined) return c.bones[hit.instanceId].b
    if (hit.object === this.knuckles && hit.instanceId !== undefined) return this.knuckleJoints[hit.instanceId]
    if (hit.object === this.sclera && hit.instanceId !== undefined) return c.eyes[hit.instanceId].joint
    if (hit.object === this.head) return c.head
    // The body: the spine joint nearest the hit, in world space.
    const local = this.group.worldToLocal(hit.point.clone())
    let best = c.spine[0]
    let bestD = Infinity
    for (const id of c.spine) {
      const d = Math.hypot(body.pos[id * 3] - local.x, body.pos[id * 3 + 1] - local.y, body.pos[id * 3 + 2] - local.z)
      if (d < bestD) {
        bestD = d
        best = id
      }
    }
    return best
  }

  dispose() {
    this.skin.skeleton.dispose()
    for (const g of this.geometries) g.dispose()
    for (const m of this.materials) m.dispose()
    for (const im of [this.limbs, this.knuckles, this.sclera, this.pupils, this.jointMarks, this.attachMarks]) im.dispose()
  }
}
