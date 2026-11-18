import { Body, STEP, type Command } from './animate'
import { makeBrain, makeHabitat, resolveCollisions, think, type Brain, type BrainParams, type Habitat } from './behavior'
import { defaultGenome, repair, type Genome } from './genome'
import { buildCreature, type Creature } from './skeleton'

/**
 * The laboratory: a creature, a body that moves it, and — in the habitat —
 * a brain that drives it. Holds no three.js; the viewport reads it.
 *
 *   studio   the creature on a turntable pad. Idle, walk or run on command,
 *            in place (a treadmill: the ground slides, the creature stays)
 *            or round a circle. In Variation, the parent stands beside it.
 *   habitat  a patch of ground with food, rocks and places to go. The brain
 *            chooses; the speed it asks for chooses the gait.
 *
 * Everything advances in fixed steps of 1/60 s, so a run is the same at any
 * frame rate and at any animation speed.
 */
export type Scene = 'studio' | 'habitat'
export type Drive = 'idle' | 'walk' | 'run'

let referenceMass = 0
/** Effort relative to the default creature: the cube root of mass ratio, so doubling size does not starve it. */
export function effortOf(c: Creature): number {
  if (!referenceMass) referenceMass = buildCreature(defaultGenome()).traits.mass
  return Math.min(2.5, Math.max(0.4, Math.cbrt(c.traits.mass / referenceMass)))
}

export function brainParams(c: Creature): BrainParams {
  const g = c.genome
  return {
    senses: c.senses,
    speed: g.speed,
    curiosity: g.curiosity,
    effort: effortOf(c),
    length: c.length,
    halfWidth: c.width / 2,
  }
}

export class Lab {
  creature: Creature
  body: Body
  /** The parent, shown beside its offspring in Variation; null otherwise. */
  parent: { creature: Creature; body: Body } | null = null
  scene: Scene
  habitat: Habitat
  brain: Brain
  drive: Drive = 'walk'
  inPlace = true

  setDrive(d: Drive) {
    this.drive = d
  }

  setInPlace(v: boolean) {
    this.inPlace = v
  }

  /** The energy and hunger sliders write straight into the living state. */
  setNeeds(energy: number, hunger: number) {
    this.brain.energy = energy
    this.brain.hunger = hunger
  }
  steps = 0
  lastCommand: Command = { speed: 0, heading: null, look: null }
  private seed: number

  constructor(genome: Genome, scene: Scene, seed: number) {
    this.seed = seed
    this.scene = scene
    this.creature = buildCreature(genome)
    this.habitat = makeHabitat(seed)
    this.brain = makeBrain(seed)
    this.body = new Body(this.creature, this.spawn())
  }

  private spawn() {
    return this.scene === 'habitat' ? { x: 0, z: 0, heading: 0.3 } : { x: this.studioRadius(), z: 0, heading: Math.PI / 2 }
  }

  /** The circle the studio walk follows, sized to the creature. */
  studioRadius() {
    return Math.max(3.5, this.creature.totalLength * 1.4)
  }

  /**
   * A new phenotype for the same animal: rebuild the body from a new genome,
   * keeping where it stands, which way it faces and its gait clock, so a
   * slider drag reshapes the creature without teleporting it.
   */
  setGenome(genome: Genome) {
    if (JSON.stringify(genome) === JSON.stringify(this.creature.genome)) return
    this.creature = buildCreature(genome)
    const b = this.body
    this.body = new Body(this.creature, { x: b.x, z: b.z, heading: b.heading, phase: b.phase, time: b.time })
    this.body.speed = b.speed
  }

  setParent(genome: Genome | null) {
    if (!genome) {
      this.parent = null
      return
    }
    if (this.parent && JSON.stringify(this.parent.creature.genome) === JSON.stringify(repair(genome))) return
    const creature = buildCreature(genome)
    const b = this.body
    this.parent = { creature, body: new Body(creature, { x: b.x, z: b.z, heading: b.heading, phase: b.phase, time: b.time }) }
  }

  setScene(scene: Scene) {
    if (scene === this.scene) return
    this.scene = scene
    this.reset()
  }

  /** A new habitat and a new brain from another seed. */
  reseed(seed: number) {
    this.seed = seed
    this.reset()
  }

  /** Back to the start: the same habitat regrown, a fresh brain, the body at the spawn point. */
  reset(energy?: number, hunger?: number) {
    this.habitat = makeHabitat(this.seed)
    this.brain = makeBrain(this.seed, energy, hunger)
    this.body = new Body(this.creature, this.spawn())
    if (this.parent) this.setParent(this.parent.creature.genome)
    this.steps = 0
  }

  step() {
    this.steps++
    const b = this.body
    let cmd: Command
    if (this.scene === 'habitat') {
      cmd = think(this.brain, { x: b.x, z: b.z, heading: b.heading, speed: b.speed }, this.habitat, brainParams(this.creature), STEP)
    } else {
      const g = this.creature.genome
      const speed = this.drive === 'idle' ? 0 : this.drive === 'walk' ? g.speed : g.speed * 2.2
      if (this.inPlace) cmd = { speed, heading: null, look: null }
      else {
        // Aim a little way round the circle, counter-clockwise.
        const R = this.studioRadius()
        const a = Math.atan2(b.z, b.x) + Math.min(0.9, (0.6 * this.creature.length) / R + 0.25)
        cmd = { speed, heading: Math.atan2(R * Math.sin(a) - b.z, R * Math.cos(a) - b.x), look: null }
      }
    }
    this.lastCommand = cmd
    b.step(STEP, cmd)
    if (this.scene === 'habitat') {
      const p = { x: b.x, z: b.z }
      resolveCollisions(p, this.habitat, this.creature.width * 0.3)
      b.x = p.x
      b.z = p.z
    }
    if (this.parent) this.parent.body.step(STEP, cmd)
  }
}

/** What the panels show, read off the lab a few times a second. */
export type LabReport = {
  steps: number
  gait: string
  pattern: string
  duty: number
  speed: number
  cycle: number
  stride: number
  phase: number
  maxSpeed: number
  /** Legs on the ground now, and which. */
  stance: boolean[]
  /** Each leg's phase offset in the gait now (blending toward the pattern's). */
  offsets: number[]
  contactError: number
  footprints: number
  earlySteps: number
  state: Brain['state'] | null
  rule: Brain['rule'] | null
  energy: number
  hunger: number
  target: string | null
  perceived: { sight: number; smell: number; touch: number }
  eaten: number
}

export function report(lab: Lab): LabReport {
  const b = lab.body
  const brain = lab.scene === 'habitat' ? lab.brain : null
  const perceived = { sight: 0, smell: 0, touch: 0 }
  if (brain) for (const p of brain.perceived) perceived[p.by]++
  return {
    steps: lab.steps,
    gait: b.gait,
    pattern: b.gait === 'idle' ? 'Standing' : b.pattern.name,
    duty: b.duty,
    speed: b.speed,
    cycle: b.cycle,
    stride: b.stride,
    phase: b.phase,
    maxSpeed: b.maxSpeed,
    stance: b.legs.map((l) => l.planted),
    offsets: b.offsets.slice(),
    contactError: b.contactError,
    footprints: b.footprintCount,
    earlySteps: b.earlySteps,
    state: brain?.state ?? null,
    rule: brain?.rule ?? null,
    energy: lab.brain.energy,
    hunger: lab.brain.hunger,
    target: brain ? (brain.target ?? brain.goal)?.label ?? null : null,
    perceived,
    eaten: lab.brain.eaten,
  }
}
