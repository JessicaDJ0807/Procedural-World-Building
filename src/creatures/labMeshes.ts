import * as THREE from 'three'
import type { Body } from './animate'
import type { Brain, Habitat } from './behavior'
import type { Creature } from './skeleton'

/**
 * The world around the creature, and the overlays that explain it. Like the
 * rig, built once and only re-posed per frame.
 *
 *   HabitatMeshes   ground, rocks, food, the three points of interest
 *   Overlay         sensors (sight wedge, smell and touch rings, a ring on
 *                   every food item currently perceived), the movement target
 *                   and the line to it, and the locomotion path — the body's
 *                   trail and a footprint at every touchdown
 */
export const GROUND = 0x7f857a
export const FOOD = 0xb38690
export const ROCK = 0x7a8088
export const SENSE = 0x9cc7e8
export const TARGET = 0xf2efe6
export const PRINT_L = 0x8fa7bf
export const PRINT_R = 0xa9c09a

const disposeTree = (o: THREE.Object3D) =>
  o.traverse((x) => {
    const m = x as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((y) => y.dispose())
    else mat?.dispose()
    if (x instanceof THREE.InstancedMesh) x.dispose()
  })

export class HabitatMeshes {
  readonly group = new THREE.Group()
  readonly habitat: Habitat
  private readonly food: THREE.InstancedMesh
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()
  private readonly s = new THREE.Vector3()

  constructor(h: Habitat) {
    this.habitat = h
    const ground = new THREE.Mesh(new THREE.CircleGeometry(h.radius + 8, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1 }))
    ground.receiveShadow = true
    const edge = new THREE.Mesh(new THREE.RingGeometry(h.radius - 0.08, h.radius + 0.08, 128).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9aa093, transparent: true, opacity: 0.5 }))
    edge.position.y = 0.01
    this.group.add(ground, edge)

    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: ROCK, roughness: 0.95, flatShading: true }), Math.max(1, h.obstacles.length))
    rocks.count = h.obstacles.length
    rocks.castShadow = true
    rocks.receiveShadow = true
    h.obstacles.forEach((o, i) => {
      this.m.compose(this.v.set(o.x, o.r * 0.35, o.z), this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7), this.s.set(o.r, o.r * 0.75, o.r * 0.92))
      rocks.setMatrixAt(i, this.m)
    })
    this.group.add(rocks)

    // Food: a low cluster of berries on a leafy cushion.
    this.food = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: FOOD, roughness: 0.6 }), Math.max(1, h.food.length))
    this.food.count = h.food.length
    this.food.castShadow = true
    const leaves = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 7).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f8a5c, roughness: 1, side: THREE.DoubleSide }), Math.max(1, h.food.length))
    leaves.count = h.food.length
    h.food.forEach((f, i) => {
      this.m.compose(this.v.set(f.x, 0.02, f.z), this.q.identity(), this.s.setScalar(0.42))
      leaves.setMatrixAt(i, this.m)
    })
    this.group.add(this.food, leaves)

    // Points of interest: a burrow, a pool, a lookout stone.
    for (const p of h.pois) {
      let o: THREE.Object3D
      if (p.name === 'Pool') {
        o = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5c7d92, roughness: 0.25 }))
        o.position.y = 0.015
      } else if (p.name === 'Burrow') {
        o = new THREE.Group()
        const hole = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3b3a36, roughness: 1 }))
        hole.position.y = 0.02
        const mound = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.32, 10, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a7f6c, roughness: 1 }))
        mound.position.y = 0.05
        mound.scale.y = 0.6
        o.add(hole, mound)
      } else {
        o = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 2.2, 7).translate(0, 1.1, 0), new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.9, flatShading: true }))
        o.castShadow = true
      }
      o.position.x = p.x
      o.position.z = p.z
      this.group.add(o)
    }
  }

  update() {
    this.habitat.food.forEach((f, i) => {
      // Eaten food grows back over its last ten seconds.
      const k = f.regrow <= 0 ? 1 : Math.max(0, 1 - f.regrow / 10)
      this.m.compose(this.v.set(f.x, 0.16 * k, f.z), this.q.identity(), this.s.setScalar(0.2 * k + 1e-4))
      this.food.setMatrixAt(i, this.m)
    })
    this.food.instanceMatrix.needsUpdate = true
  }

  dispose() {
    disposeTree(this.group)
  }
}

export type OverlayShow = { sensors: boolean; target: boolean; path: boolean }

export class Overlay {
  readonly group = new THREE.Group()
  private wedge: THREE.Mesh
  private smell: THREE.Mesh
  private touch: THREE.Mesh
  private readonly seen: THREE.InstancedMesh
  private readonly marker: THREE.Group
  private readonly line: THREE.Line
  private readonly circle: THREE.LineLoop
  private readonly trail: THREE.Line
  private readonly prints: THREE.InstancedMesh
  private creature: Creature | null = null
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly c = new THREE.Color()

  constructor() {
    const flat = (opacity: number, color = SENSE) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })
    this.wedge = new THREE.Mesh(new THREE.BufferGeometry(), flat(0.16))
    this.smell = new THREE.Mesh(new THREE.BufferGeometry(), flat(0.55, 0xb8e0a8))
    this.touch = new THREE.Mesh(new THREE.BufferGeometry(), flat(0.6, 0xd0b8e8))
    for (const o of [this.wedge, this.smell, this.touch]) o.renderOrder = 2
    this.seen = new THREE.InstancedMesh(new THREE.RingGeometry(0.42, 0.52, 32).rotateX(-Math.PI / 2), flat(0.95), 64)
    this.seen.count = 0
    this.seen.renderOrder = 3
    this.seen.frustumCulled = false

    this.marker = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 32).rotateX(-Math.PI / 2), flat(0.95, TARGET))
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6).translate(0, 0.7, 0), new THREE.MeshBasicMaterial({ color: TARGET }))
    this.marker.add(ring, post)
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    this.line = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: TARGET, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.85 }))
    this.line.frustumCulled = false
    this.circle = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: TARGET, dashSize: 0.3, gapSize: 0.25, transparent: true, opacity: 0.6 }))

    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 3), 3))
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xe6dfcf, transparent: true, opacity: 0.7 }))
    this.trail.frustumCulled = false
    this.prints = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }), 160)
    this.prints.count = 0
    this.prints.frustumCulled = false
    this.prints.renderOrder = 2
    this.group.add(this.wedge, this.smell, this.touch, this.seen, this.marker, this.line, this.circle, this.trail, this.prints)
  }

  /** Rebuild the sensor shapes when the creature, and so its senses, change. */
  private setCreature(c: Creature) {
    this.creature = c
    const { fov, sight, smell, touch } = c.senses
    const ring = (r0: number, r1: number) => new THREE.RingGeometry(r0, r1, 96).rotateX(-Math.PI / 2)
    this.wedge.geometry.dispose()
    const rad = (fov * Math.PI) / 180
    this.wedge.geometry = sight > 0 && fov > 0 ? new THREE.RingGeometry(0, sight, 64, 1, -rad / 2, rad).rotateX(-Math.PI / 2) : new THREE.BufferGeometry()
    this.smell.geometry.dispose()
    this.smell.geometry = smell > 0 ? ring(smell - 0.05, smell + 0.05) : new THREE.BufferGeometry()
    this.touch.geometry.dispose()
    this.touch.geometry = ring(touch - 0.04, touch + 0.04)
  }

  update(
    c: Creature,
    body: Body,
    brain: Brain | null,
    habitat: Habitat | null,
    show: OverlayShow,
    studioCircle: number | null,
  ) {
    if (c !== this.creature) this.setCreature(c)
    // ---- sensors, on the ground under the head
    for (const o of [this.wedge, this.smell, this.touch]) {
      o.visible = show.sensors
      o.position.set(body.x, 0.03, body.z)
      // Ring geometry's angle 0 is +x and runs toward −z once laid flat; perception
      // uses the body's heading, not where the head is glancing.
      o.rotation.y = -body.heading
    }
    let n = 0
    if (show.sensors && brain && habitat) {
      for (const p of brain.perceived) {
        const f = habitat.food[p.index]
        this.m.compose(this.v.set(f.x, 0.04, f.z), this.q.identity(), this.s.setScalar(1))
        this.seen.setMatrixAt(n, this.m)
        this.seen.setColorAt(n, this.c.setHex(p.by === 'sight' ? SENSE : p.by === 'smell' ? 0xb8e0a8 : 0xd0b8e8))
        if (++n >= 64) break
      }
      this.seen.instanceMatrix.needsUpdate = true
      if (this.seen.instanceColor) this.seen.instanceColor.needsUpdate = true
    }
    this.seen.count = n

    // ---- target
    const target = brain?.target ?? brain?.goal ?? null
    this.marker.visible = show.target && !!target
    this.line.visible = show.target && !!target
    if (target && show.target) {
      this.marker.position.set(target.x, 0.03, target.z)
      const attr = this.line.geometry.getAttribute('position') as THREE.BufferAttribute
      attr.setXYZ(0, body.x, 0.06, body.z)
      attr.setXYZ(1, target.x, 0.06, target.z)
      attr.needsUpdate = true
      this.line.computeLineDistances()
    }
    this.circle.visible = show.target && studioCircle !== null
    if (this.circle.visible && studioCircle !== null) {
      const r = studioCircle
      if ((this.circle.userData.r as number | undefined) !== r) {
        const pts: THREE.Vector3[] = []
        for (let i = 0; i < 128; i++) pts.push(new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * r, 0.04, Math.sin((i / 128) * Math.PI * 2) * r))
        this.circle.geometry.dispose()
        this.circle.geometry = new THREE.BufferGeometry().setFromPoints(pts)
        this.circle.computeLineDistances()
        this.circle.userData.r = r
      }
    }

    // ---- locomotion path: the body's trail and every footprint
    this.trail.visible = show.path
    this.prints.visible = show.path
    if (show.path) {
      const attr = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute
      body.trail.forEach((p, i) => attr.setXYZ(i, p.x, 0.05, p.z))
      attr.needsUpdate = true
      this.trail.geometry.setDrawRange(0, body.trail.length)
      const size = 0.06 + 0.05 * c.genome.scale * c.genome.legLength
      body.footprints.forEach((f, i) => {
        this.m.compose(this.v.set(f.x, 0.035, f.z), this.q.identity(), this.s.set(size, 1, size))
        this.prints.setMatrixAt(i, this.m)
        this.prints.setColorAt(i, this.c.setHex(f.side < 0 ? PRINT_L : PRINT_R))
      })
      this.prints.count = body.footprints.length
      this.prints.instanceMatrix.needsUpdate = true
      if (this.prints.instanceColor) this.prints.instanceColor.needsUpdate = true
    }
  }

  dispose() {
    disposeTree(this.group)
  }
}
