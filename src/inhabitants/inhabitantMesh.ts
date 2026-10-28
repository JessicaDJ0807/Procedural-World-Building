import * as THREE from 'three'
import { ivyLeaf } from '../green/vegetation'
import { COATS, type Behavior, type Inhabitant } from './agent'

/**
 * An inhabitant, drawn — the one model and set of animations every page
 * shows: Play, the Lab and the Inhabitants studio.
 *
 * A small round creature, about a third of a storey tall (1.1 growth
 * units; a storey is 3) — at first half that, and in the game it was a
 * speck lost among the ivy leaves, which stand further off a wall than it
 * did. A soft egg of a body in its coat colour with a
 * paler belly, two dark eyes with a glint, rosy cheeks, two stubby feet, and
 * a leaf sprouting from its head — the game's own ivy leaf — so it reads as
 * something that belongs to the plants. Built from a handful of spheres, it
 * stays legible at the game's distance, where detail would be lost.
 *
 * Local axes: +y is up (the surface normal it stands on), +z forward.
 *
 * Animations, chosen by behavior: a breathing idle with blinks and glances;
 * a bobbing walk with stepping feet and a swinging leaf; a quicker, perkier
 * walk when discovering; and a puzzled head-tilt with a drooping leaf when
 * it has no route or is stranded.
 */

export type Pose = 'idle' | 'walk' | 'discover' | 'puzzled'

export const POSES: Pose[] = ['idle', 'walk', 'discover', 'puzzled']
export const POSE_NAMES: Record<Pose, string> = { idle: 'Idle', walk: 'Walk', discover: 'Discover', puzzled: 'Puzzled' }

/** The pose a behavior shows: moving behaviors walk, the stuck ones puzzle. */
export function poseOf(behavior: Behavior, moving: boolean): Pose {
  if (behavior === 'no-route' || behavior === 'stranded') return 'puzzled'
  if (!moving) return 'idle'
  return behavior === 'discovering' ? 'discover' : 'walk'
}

/** Drawn at this scale: modelled at 0.55 units, shown at 1.1. */
export const SIZE = 2
export const HEIGHT = 0.55 * SIZE
/** How far off the surface it stands: clear of the leaves growing there. */
const LIFT = 0.3

/** Geometry shared by every inhabitant; materials are per coat. */
const shared = (() => {
  const leaf = ivyLeaf()
  leaf.scale(0.26, 0.26, 0.26)
  return {
    body: new THREE.SphereGeometry(0.2, 22, 16),
    belly: new THREE.SphereGeometry(0.15, 18, 12),
    eye: new THREE.SphereGeometry(0.045, 12, 8),
    glint: new THREE.SphereGeometry(0.014, 8, 6),
    cheek: new THREE.CircleGeometry(0.03, 12),
    foot: new THREE.SphereGeometry(0.055, 12, 8),
    stem: new THREE.CylinderGeometry(0.012, 0.016, 0.1, 6),
    leaf,
  }
})()

const dark = new THREE.MeshStandardMaterial({ color: '#2b2a26', roughness: 0.4 })
const white = new THREE.MeshBasicMaterial({ color: '#ffffff' })
const cheekMat = new THREE.MeshBasicMaterial({ color: '#f0a3a0', transparent: true, opacity: 0.75 })
const leafMat = new THREE.MeshStandardMaterial({ color: '#6f9e4a', roughness: 0.7, side: THREE.DoubleSide })
const stemMat = new THREE.MeshStandardMaterial({ color: '#5d7a3a', roughness: 0.8 })
const coatMats = COATS.map((c) => ({
  body: new THREE.MeshStandardMaterial({ color: c.body, roughness: 0.75 }),
  belly: new THREE.MeshStandardMaterial({ color: c.belly, roughness: 0.85 }),
  foot: new THREE.MeshStandardMaterial({ color: new THREE.Color(c.body).multiplyScalar(0.6), roughness: 0.8 }),
}))

export type InhabitantModel = {
  group: THREE.Group
  /** Everything above the feet: what bobs, tilts and breathes. */
  torso: THREE.Group
  /** Advances its animation: a pose, real seconds, and how fast it walks (for the step rate). */
  animate: (pose: Pose, time: number) => void
  setCoat: (coat: number) => void
}

export function inhabitantModel(coat: number): InhabitantModel {
  const group = new THREE.Group()
  const figure = new THREE.Group()
  figure.scale.setScalar(SIZE)
  group.add(figure)
  const torso = new THREE.Group()
  figure.add(torso)
  const mats = coatMats[coat % coatMats.length]

  const body = new THREE.Mesh(shared.body, mats.body)
  body.scale.set(1, 1.18, 0.95)
  body.position.y = 0.27
  const belly = new THREE.Mesh(shared.belly, mats.belly)
  // Tucked into the body, so only its front shows: further out, the two spheres' intersection showed as a ragged edge.
  belly.scale.set(0.95, 1.05, 0.62)
  belly.position.set(0, 0.235, 0.083)
  torso.add(body, belly)

  const eyes: THREE.Mesh[] = []
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(shared.eye, dark)
    eye.position.set(s * 0.075, 0.34, 0.165)
    eye.scale.set(1, 1.15, 0.7)
    const glint = new THREE.Mesh(shared.glint, white)
    glint.position.set(0.015, 0.018, 0.03)
    eye.add(glint)
    const cheek = new THREE.Mesh(shared.cheek, cheekMat)
    cheek.position.set(s * 0.12, 0.285, 0.165)
    cheek.rotation.y = s * 0.55
    torso.add(eye, cheek)
    eyes.push(eye)
  }

  // The sprout: a short stem and the game's ivy leaf, from the top of the head.
  const sprout = new THREE.Group()
  sprout.position.set(0, 0.5, 0)
  const stem = new THREE.Mesh(shared.stem, stemMat)
  stem.position.y = 0.04
  const leaf = new THREE.Mesh(shared.leaf, leafMat)
  leaf.position.y = 0.08
  leaf.rotation.set(-0.5, 0, 0.25)
  sprout.add(stem, leaf)
  torso.add(sprout)

  const feet: THREE.Mesh[] = []
  for (const s of [-1, 1]) {
    const foot = new THREE.Mesh(shared.foot, mats.foot)
    foot.scale.set(1, 0.6, 1.3)
    foot.position.set(s * 0.085, 0.03, 0.02)
    figure.add(foot)
    feet.push(foot)
  }
  for (const o of [...torso.children, ...feet]) {
    o.castShadow = true
    o.traverse((x) => (x.castShadow = true))
  }

  const animate = (pose: Pose, t: number) => {
    const walking = pose === 'walk' || pose === 'discover'
    const rate = pose === 'discover' ? 13 : 9
    const ph = t * rate
    // Bob and waddle when walking; breathe when not.
    torso.position.y = walking ? Math.abs(Math.sin(ph)) * (pose === 'discover' ? 0.06 : 0.035) : 0
    torso.rotation.z = walking ? Math.sin(ph) * 0.09 : pose === 'puzzled' ? 0.28 + Math.sin(t * 5) * 0.04 : 0
    const breathe = walking ? 1 : 1 + Math.sin(t * 2.2) * 0.025
    body.scale.set(1 / Math.sqrt(breathe), 1.18 * breathe, 0.95 / Math.sqrt(breathe))
    // Glance about when idle; shake the head, puzzled.
    torso.rotation.y = pose === 'idle' ? Math.sin(t * 0.6) * 0.35 * Math.max(0, Math.sin(t * 0.23)) : pose === 'puzzled' ? Math.sin(t * 7) * 0.18 : 0
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? 1 : -1
      feet[k].position.z = 0.02 + (walking ? Math.sin(ph) * 0.07 * s : 0)
      feet[k].position.y = 0.03 + (walking ? Math.max(0, Math.sin(ph) * s) * 0.04 : 0)
    }
    // Blink every few seconds.
    const blink = (t % 3.7) < 0.12 ? 0.15 : 1.15
    for (const e of eyes) e.scale.y = blink
    // The leaf swings with the step, perks up discovering, droops puzzled.
    sprout.rotation.x = pose === 'puzzled' ? 0.9 : pose === 'discover' ? -0.25 + Math.sin(ph) * 0.15 : walking ? Math.sin(ph * 0.5) * 0.25 : Math.sin(t * 1.3) * 0.08
    sprout.rotation.z = walking ? Math.cos(ph * 0.5) * 0.2 : 0
  }
  animate('idle', 0)

  return {
    group,
    torso,
    animate,
    setCoat: (c: number) => {
      const m = coatMats[c % coatMats.length]
      body.material = m.body
      belly.material = m.belly
      for (const f of feet) f.material = m.foot
    },
  }
}

const basis = new THREE.Matrix4()
const vUp = new THREE.Vector3()
const vFwd = new THREE.Vector3()
const vRight = new THREE.Vector3()

/**
 * The inhabitants of a scene, drawn: one model each, placed on its surface
 * and animated by its behavior. `sync` is called each frame; models come and
 * go with the agents. Hiding hides the models only — the agents carry on.
 */
export class InhabitantsView {
  readonly group = new THREE.Group()
  private models = new Map<number, InhabitantModel>()
  private time = 0

  set visible(v: boolean) {
    this.group.visible = v
  }
  get visible() {
    return this.group.visible
  }

  sync(agents: Inhabitant[], dt: number) {
    this.time += dt
    const seen = new Set<number>()
    for (const a of agents) {
      seen.add(a.id)
      let m = this.models.get(a.id)
      if (!m) {
        m = inhabitantModel(a.coat)
        this.models.set(a.id, m)
        this.group.add(m.group)
      }
      m.group.visible = a.cell >= 0 || a.behavior === 'stranded'
      vUp.set(a.up[0], a.up[1], a.up[2]).normalize()
      vFwd.set(a.heading[0], a.heading[1], a.heading[2])
      vFwd.addScaledVector(vUp, -vFwd.dot(vUp))
      if (vFwd.lengthSq() < 1e-6) vFwd.set(0, 0, 1).addScaledVector(vUp, -vUp.z)
      vFwd.normalize()
      vRight.crossVectors(vUp, vFwd).normalize()
      basis.makeBasis(vRight, vUp, vFwd)
      m.group.quaternion.setFromRotationMatrix(basis)
      // Stand off the surface, clear of the leaves.
      m.group.position.set(a.pos[0] + vUp.x * LIFT, a.pos[1] + vUp.y * LIFT, a.pos[2] + vUp.z * LIFT)
      m.animate(poseOf(a.behavior, a.next >= 0), this.time + a.id * 1.7)
    }
    for (const [id, m] of this.models) {
      if (seen.has(id)) continue
      this.group.remove(m.group)
      this.models.delete(id)
    }
  }

  /** The model of one agent, for the studio's labels and camera. */
  modelOf(id: number): InhabitantModel | undefined {
    return this.models.get(id)
  }

  dispose() {
    // Geometry and materials are shared across every view, for the page's lifetime.
    this.group.clear()
    this.models.clear()
  }
}
