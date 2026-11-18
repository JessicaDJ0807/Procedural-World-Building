import * as THREE from 'three'
import type { Ground } from '../ground'
import { isTravelling, type Task } from './inhabitants'
import { RESOURCES, type ResourceId } from './resources'
import type { CitySim } from './urban'

/**
 * Drawing the simulation. Reads a CitySim and writes instance buffers; never
 * changes it. Everything is instanced and allocated once per simulation, so
 * a frame costs a buffer upload, not geometry.
 *
 *   inhabitants   a capsule per traveller, coloured by where they are going
 *   network       the selected resource's pipes, coloured by how full
 *   particles     beads moving along each pipe in the direction of flow,
 *                 more of them on fuller pipes
 *   plants        a column at each plant, in its resource's colour
 *   status pins   a bead over every building: supply of the selected resource
 *                 in G, activity in H; dark when closed
 */
export const TASK_COLOURS: Record<Task, number> = {
  home: 0xd8cfb8,
  toWork: 0x7fa2c9,
  work: 0x7fa2c9,
  toPark: 0x86b072,
  park: 0x86b072,
  toHome: 0xd9b98a,
}

export const RESOURCE_COLOURS: Record<ResourceId, number> = { water: 0x6fa3c8, energy: 0xd8c27a, waste: 0xa58f78 }
const FULL = new THREE.Color(0xc4736a)
const GOOD = new THREE.Color(0x8fbf7f)
const WARN = new THREE.Color(0xd8b56a)
const BAD = new THREE.Color(0xc4736a)
const CLOSED = new THREE.Color(0x3a3d40)

const LIFT = 1.2
const MAX_BEADS = 4

export class SimLayer {
  readonly group = new THREE.Group()
  private readonly ground: Ground
  private readonly people: THREE.InstancedMesh
  private readonly ring: THREE.Mesh
  private readonly beads: THREE.InstancedMesh
  private readonly pins: THREE.InstancedMesh
  private readonly plants: THREE.InstancedMesh
  /** One flat bar per pipe, instanced: a line would be a pixel wide at this distance. */
  private readonly pipes: THREE.InstancedMesh
  private readonly sim: CitySim
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly c = new THREE.Color()
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly xAxis = new THREE.Vector3(1, 0, 0)
  private phase = 0

  constructor(sim: CitySim, ground: Ground) {
    this.sim = sim
    this.ground = ground
    const max = 1000
    this.people = new THREE.InstancedMesh(
      // Stylised, and large: about 8 units tall on a 400-unit site, so a
      // commuter reads from the overview camera. A true-scale person would be
      // two pixels.
      new THREE.CapsuleGeometry(1.8, 3.6, 3, 10).translate(0, 3.6, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0x222222 }),
      max,
    )
    this.people.castShadow = true
    this.people.count = 0
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.6, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    this.ring.visible = false
    const n = sim.graph.x.length
    this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshBasicMaterial(), n * MAX_BEADS)
    this.beads.count = 0
    this.pins = new THREE.InstancedMesh(new THREE.SphereGeometry(2, 10, 8), new THREE.MeshBasicMaterial(), sim.places.length)
    this.pins.count = 0
    this.plants = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.4, 3, 1, 10).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.6 }), 3)
    this.plants.castShadow = true
    this.pipes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85 }), n)
    this.pipes.count = 0
    this.pipes.frustumCulled = false
    this.group.add(this.people, this.ring, this.beads, this.pins, this.plants, this.pipes)

    // Plants are fixed: draw them once.
    RESOURCES.forEach((r, i) => {
      const node = sim.plants[r]
      const x = sim.graph.x[node]
      const z = sim.graph.z[node]
      // Offset so two plants on one junction would not hide each other.
      const ox = (i - 1) * 6
      this.m.compose(this.v.set(x + ox, ground.height(x + ox, z), z), this.q.identity(), this.s.set(1, 14, 1))
      this.plants.setMatrixAt(i, this.m)
      this.plants.setColorAt(i, this.c.setHex(RESOURCE_COLOURS[r]))
    })
    this.plants.instanceMatrix.needsUpdate = true
    if (this.plants.instanceColor) this.plants.instanceColor.needsUpdate = true
  }

  /** `dt` in real seconds, for the beads; `flowRate` scales how fast they run. */
  update(resource: ResourceId, selected: number, showPeople: boolean, showNetwork: boolean, dt: number, flowRate: number) {
    const sim = this.sim
    this.phase = (this.phase + dt * flowRate) % 1

    // Inhabitants on the road. People indoors are not drawn.
    let k = 0
    this.ring.visible = false
    if (showPeople && sim.mode !== 'resources') {
      for (const a of sim.population.agents) {
        if (!isTravelling(a.task)) continue
        const y = this.ground.height(a.x, a.z)
        this.m.compose(this.v.set(a.x, y, a.z), this.q.setFromAxisAngle(this.up, a.heading), this.s.set(1, 1, 1))
        this.people.setMatrixAt(k, this.m)
        this.people.setColorAt(k, this.c.setHex(a.id === selected ? 0xffffff : TASK_COLOURS[a.task]))
        k++
        if (k >= this.people.instanceMatrix.count) break
      }
      const sel = selected >= 0 ? sim.population.agents[selected] : undefined
      if (sel) {
        const at = isTravelling(sel.task) ? sel : null
        const place = at ? null : sim.places[sim.population.placeOf(sel)]
        const x = at ? at.x : place ? place.doorX : sel.x
        const z = at ? at.z : place ? place.doorZ : sel.z
        this.ring.position.set(x, this.ground.height(x, z) + 0.4, z)
        this.ring.visible = true
      }
    }
    this.people.count = k
    this.people.instanceMatrix.needsUpdate = true
    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true

    // Network and beads.
    const alloc = sim.allocations?.[resource]
    const net = sim.networks[resource]
    let segs = 0
    let beads = 0
    const base = new THREE.Color(RESOURCE_COLOURS[resource])
    const reverse = resource === 'waste'
    if (alloc && showNetwork) {
      const { parent } = net.tree
      for (let node = 0; node < parent.length; node++) {
        const p = parent[node]
        if (p < 0 || alloc.flow[node] <= 1e-9) continue
        const ax = sim.graph.x[p]
        const az = sim.graph.z[p]
        const bx = sim.graph.x[node]
        const bz = sim.graph.z[node]
        const ay = this.ground.height(ax, az) + LIFT
        const by = this.ground.height(bx, bz) + LIFT
        const use = Math.min(1, alloc.flow[node] / Math.max(alloc.capacity[node], 1e-9))
        this.c.copy(base).lerp(FULL, Math.max(0, (use - 0.7) / 0.3))
        // Thicker for more flow, so the trunk mains read as mains.
        const len0 = Math.hypot(bx - ax, by - ay, bz - az)
        this.q.setFromUnitVectors(this.xAxis, this.v.set(bx - ax, by - ay, bz - az).normalize())
        this.m.compose(this.v.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), this.q, this.s.set(len0, 0.5, 0.8 + 1.6 * use))
        this.pipes.setMatrixAt(segs, this.m)
        this.pipes.setColorAt(segs, this.c)
        segs++
        // Beads: one to four, by how full; running from the plant outward,
        // or toward the depot for waste.
        const count = Math.max(1, Math.ceil(use * MAX_BEADS))
        const len = Math.hypot(bx - ax, bz - az)
        for (let i = 0; i < count; i++) {
          let t = (this.phase * (40 / Math.max(len, 1)) + i / count) % 1
          if (reverse) t = 1 - t
          this.m.compose(this.v.set(ax + (bx - ax) * t, ay + (by - ay) * t + 0.6, az + (bz - az) * t), this.q.identity(), this.s.set(1, 1, 1))
          this.beads.setMatrixAt(beads, this.m)
          this.beads.setColorAt(beads, this.c)
          beads++
        }
      }
    }
    this.pipes.count = segs
    this.pipes.instanceMatrix.needsUpdate = true
    if (this.pipes.instanceColor) this.pipes.instanceColor.needsUpdate = true
    this.beads.count = beads
    this.beads.instanceMatrix.needsUpdate = true
    if (this.beads.instanceColor) this.beads.instanceColor.needsUpdate = true

    // Status pins: G shows supply of the selected resource; H shows activity.
    let pins = 0
    if (sim.mode !== 'agents') {
      for (const p of sim.places) {
        if (p.kind === 'park') continue
        const value = sim.mode === 'dynamics' ? sim.activity[p.id] : sim.satisfaction(resource, p.id)
        if (sim.mode === 'dynamics' && !sim.open[p.id]) this.c.copy(CLOSED)
        else if (value >= 0.99) this.c.copy(GOOD)
        else this.c.copy(WARN).lerp(BAD, 1 - Math.max(0, Math.min(1, value)))
        this.m.compose(this.v.set(p.x, p.markerY, p.z), this.q.identity(), this.s.set(1, 1, 1))
        this.pins.setMatrixAt(pins, this.m)
        this.pins.setColorAt(pins, this.c)
        pins++
      }
    }
    this.pins.count = pins
    this.pins.instanceMatrix.needsUpdate = true
    if (this.pins.instanceColor) this.pins.instanceColor.needsUpdate = true
    this.plants.visible = sim.mode !== 'agents'
  }

  dispose() {
    for (const mesh of [this.people, this.beads, this.pins, this.plants, this.pipes]) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      mesh.dispose()
    }
    this.ring.geometry.dispose()
    ;(this.ring.material as THREE.Material).dispose()
  }
}
