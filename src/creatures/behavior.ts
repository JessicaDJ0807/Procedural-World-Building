import { mulberry32 } from '../noise'
import type { Command } from './animate'
import type { Senses } from './skeleton'

/**
 * Perception and behaviour: what the creature knows, and what it decides.
 *
 * **Perception** is computed from the body, not configured. Something is
 * perceived if it is within sight range *and* inside the field of view the
 * eyes give; or within the antennae's all-round smell range; or close
 * enough to touch. A creature with forward eyes misses food beside it that a
 * side-eyed one sees; one without eyes finds food only by bumping into it.
 *
 * **Decision** is a priority list, read top to bottom every step; the first
 * rule whose condition holds sets the state — the same structure as Topic
 * 10's zoning decision, and as legible: the panel highlights the rule that
 * fired.
 *
 *   1. resting, and energy under 0.85        → keep resting
 *   2. energy under 0.2                      → rest
 *   3. an obstacle or the edge ahead         → avoid: steer round it
 *   4. hungry (over 0.5) and food perceived  → seek the nearest food
 *   5. a wander goal not yet reached         → wander to it
 *   6. otherwise                             → idle; when the pause ends,
 *                                              pick a new goal
 *
 * The state then sets a wanted speed and heading, and the body (animate.ts)
 * does the rest: the gait, the stride, the cadence all follow from that
 * speed. Nothing chooses an animation.
 *
 * Energy and hunger are the coupling to the body: moving costs energy in
 * proportion to speed squared and to the creature's mass, so a heavy, fast
 * creature has to rest more often than a light, slow one.
 */
export type Food = { x: number; z: number; /** Seconds until it grows back; 0 when there. */ regrow: number }
export type Obstacle = { x: number; z: number; r: number }
export type Poi = { x: number; z: number; name: string }
export type Habitat = { radius: number; food: Food[]; obstacles: Obstacle[]; pois: Poi[] }

export type BehaviorState = 'idle' | 'wander' | 'seek' | 'avoid' | 'rest'
export type RuleId = 'resting' | 'tired' | 'blocked' | 'hungry' | 'goal' | 'pause'

export const RULES: { id: RuleId; when: string; then: BehaviorState }[] = [
  { id: 'resting', when: 'resting and energy < 0.85', then: 'rest' },
  { id: 'tired', when: 'energy < 0.2', then: 'rest' },
  { id: 'blocked', when: 'obstacle or edge ahead', then: 'avoid' },
  { id: 'hungry', when: 'hunger > 0.5 and food perceived', then: 'seek' },
  { id: 'goal', when: 'a wander goal not reached', then: 'wander' },
  { id: 'pause', when: 'otherwise', then: 'idle' },
]

export const TIRED = 0.2
export const RESTED = 0.85
export const HUNGRY = 0.5

export type Target = { x: number; z: number; kind: 'food' | 'poi' | 'point' | 'obstacle' | 'edge'; label: string; index: number }

export type Brain = {
  state: BehaviorState
  rule: RuleId
  energy: number
  hunger: number
  target: Target | null
  goal: Target | null
  pause: number
  /** Food items perceived this step, and by which sense. */
  perceived: { index: number; by: 'sight' | 'smell' | 'touch' }[]
  eaten: number
  decisions: number
  rng: () => number
}

export type BrainParams = {
  senses: Senses
  /** Walking speed; running is 2.2× this. */
  speed: number
  curiosity: number
  /** Energy cost of moving at walking pace, relative to a reference creature. */
  effort: number
  /** Body length, for how far ahead to feel and how close is "arrived". */
  length: number
  /** Half the body width: the clearance it keeps from obstacles. */
  halfWidth: number
}

export function makeHabitat(seed: number, radius = 24): Habitat {
  const r = mulberry32(seed * 9973 + 5)
  const obstacles: Obstacle[] = []
  const pois: Poi[] = []
  const food: Food[] = []
  const free = (x: number, z: number, clearance: number) =>
    Math.hypot(x, z) < radius - clearance &&
    Math.hypot(x, z) > 4 &&
    obstacles.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + clearance) &&
    pois.every((p) => Math.hypot(x - p.x, z - p.z) > clearance + 2)
  const place = (clearance: number) => {
    for (let tries = 0; tries < 200; tries++) {
      const a = r() * Math.PI * 2
      const d = Math.sqrt(r()) * radius
      const x = Math.cos(a) * d
      const z = Math.sin(a) * d
      if (free(x, z, clearance)) return { x, z }
    }
    return null
  }
  for (let i = 0; i < 9; i++) {
    const rad = 0.9 + r() * 1.6
    const p = place(rad + 2.2)
    if (p) obstacles.push({ ...p, r: rad })
  }
  for (const name of ['Burrow', 'Pool', 'Lookout']) {
    const p = place(3)
    if (p) pois.push({ ...p, name })
  }
  for (let i = 0; i < 16; i++) {
    const p = place(1.2)
    if (p) food.push({ ...p, regrow: 0 })
  }
  return { radius, food, obstacles, pois }
}

export function makeBrain(seed: number, energy = 0.9, hunger = 0.3): Brain {
  return { state: 'idle', rule: 'pause', energy, hunger, target: null, goal: null, pause: 1, perceived: [], eaten: 0, decisions: 0, rng: mulberry32(seed * 31337 + 1) }
}

const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2))

export function perceive(head: { x: number; z: number; heading: number }, habitat: Habitat, senses: Senses): Brain['perceived'] {
  const out: Brain['perceived'] = []
  habitat.food.forEach((f, index) => {
    if (f.regrow > 0) return
    const d = Math.hypot(f.x - head.x, f.z - head.z)
    const bearing = Math.abs(wrap(Math.atan2(f.z - head.z, f.x - head.x) - head.heading))
    if (d <= senses.touch) out.push({ index, by: 'touch' })
    else if (senses.fov > 0 && d <= senses.sight && bearing <= ((senses.fov / 2) * Math.PI) / 180) out.push({ index, by: 'sight' })
    else if (d <= senses.smell) out.push({ index, by: 'smell' })
  })
  return out
}

/**
 * The nearest thing in the way within `feeler` units straight ahead, or the
 * edge of the habitat. Returns the obstacle and which way to turn.
 */
export function feel(head: { x: number; z: number; heading: number }, habitat: Habitat, feeler: number, clearance: number): { target: Target; turn: number; distance: number } | null {
  const fx = Math.cos(head.heading)
  const fz = Math.sin(head.heading)
  let best: { target: Target; turn: number; distance: number } | null = null
  habitat.obstacles.forEach((o, index) => {
    const ox = o.x - head.x
    const oz = o.z - head.z
    const along = ox * fx + oz * fz
    if (along < -o.r || along > feeler + o.r) return
    const side = ox * -fz + oz * fx
    // In the way if the corridor the body sweeps passes within the rock.
    if (Math.abs(side) > o.r + clearance) return
    const distance = Math.max(0, Math.hypot(ox, oz) - o.r)
    if (!best || distance < best.distance) {
      best = { target: { x: o.x, z: o.z, kind: 'obstacle', label: 'Rock', index }, turn: side > 0 ? -1 : 1, distance }
    }
  })
  // The edge: feel it when the point ahead is outside the habitat.
  const ax = head.x + fx * feeler
  const az = head.z + fz * feeler
  if (!best && Math.hypot(ax, az) > habitat.radius - 1) {
    const toCentre = Math.atan2(-head.z, -head.x)
    best = { target: { x: ax, z: az, kind: 'edge', label: 'Edge', index: -1 }, turn: wrap(toCentre - head.heading) > 0 ? 1 : -1, distance: habitat.radius - Math.hypot(head.x, head.z) }
  }
  return best
}

/**
 * One decision step. Reads the brain, the head and the habitat; changes the
 * brain and the habitat (food eaten, food regrowing); returns what the body
 * should do.
 */
export function think(brain: Brain, head: { x: number; z: number; heading: number; speed: number }, habitat: Habitat, p: BrainParams, dt: number): Command {
  brain.decisions++
  // ---- the body's economy
  const pace = head.speed / Math.max(p.speed, 1e-6)
  brain.energy -= (0.003 + 0.01 * pace * pace * p.effort + (brain.hunger >= 1 ? 0.01 : 0)) * dt
  brain.hunger += (0.008 + 0.006 * pace) * dt
  for (const f of habitat.food) if (f.regrow > 0) f.regrow = Math.max(0, f.regrow - dt)

  // ---- perception
  brain.perceived = perceive(head, habitat, p.senses)
  const feeler = 0.8 * p.length + 0.9 * head.speed + 0.6
  const blocked = feel(head, habitat, feeler, p.halfWidth + 0.25)

  // ---- decision: the first rule that holds
  let cmd: Command
  if (brain.state === 'rest' && brain.energy < RESTED) {
    brain.rule = 'resting'
    cmd = rest(brain, dt)
  } else if (brain.energy < TIRED) {
    brain.rule = 'tired'
    brain.goal = null
    cmd = rest(brain, dt)
  } else if (blocked) {
    brain.rule = 'blocked'
    brain.state = 'avoid'
    brain.target = blocked.target
    // Turn away harder the closer it is.
    const urgency = 1 - Math.min(1, blocked.distance / feeler)
    cmd = { speed: p.speed * (0.55 + 0.3 * (1 - urgency)), heading: head.heading + blocked.turn * (0.6 + 1.4 * urgency), look: blocked.target }
  } else if (brain.hunger > HUNGRY && brain.perceived.length) {
    brain.rule = 'hungry'
    brain.state = 'seek'
    let best = brain.perceived[0].index
    let bestD = Infinity
    for (const { index } of brain.perceived) {
      const f = habitat.food[index]
      const d = Math.hypot(f.x - head.x, f.z - head.z)
      if (d < bestD) {
        bestD = d
        best = index
      }
    }
    const f = habitat.food[best]
    brain.target = { x: f.x, z: f.z, kind: 'food', label: `Food ${best + 1}`, index: best }
    if (bestD < 0.35 + 0.12 * p.length) {
      // Eat: the food is gone for half a minute, and the hunger with it.
      f.regrow = 30
      brain.hunger = Math.max(0, brain.hunger - 0.55)
      brain.eaten++
    }
    // The hungrier, the faster: from walking at 0.5 to running at 1.
    const urge = Math.min(1, (brain.hunger - HUNGRY) / (1 - HUNGRY))
    const slow = Math.min(1, bestD / (0.6 * p.length + 0.5))
    cmd = { speed: p.speed * (1 + 1.2 * urge) * (0.35 + 0.65 * slow), heading: Math.atan2(f.z - head.z, f.x - head.x), look: f }
  } else if (brain.goal && Math.hypot(brain.goal.x - head.x, brain.goal.z - head.z) > 0.6 + 0.3 * p.length) {
    brain.rule = 'goal'
    brain.state = 'wander'
    brain.target = brain.goal
    const g = brain.goal
    const d = Math.hypot(g.x - head.x, g.z - head.z)
    cmd = { speed: p.speed * Math.min(1, 0.4 + d / (1.5 * p.length)), heading: Math.atan2(g.z - head.z, g.x - head.x), look: g }
  } else {
    brain.rule = 'pause'
    brain.state = 'idle'
    brain.target = null
    if (brain.goal) {
      brain.goal = null
      // Curious creatures linger less.
      brain.pause = (1 + 5 * (1 - p.curiosity)) * (0.5 + brain.rng())
    }
    brain.pause -= dt
    if (brain.pause <= 0) brain.goal = pickGoal(brain, head, habitat, p)
    cmd = { speed: 0, heading: null, look: null }
  }
  brain.energy = Math.min(1, Math.max(0, brain.energy))
  brain.hunger = Math.min(1, Math.max(0, brain.hunger))
  return cmd
}

function rest(brain: Brain, dt: number): Command {
  brain.state = 'rest'
  brain.target = null
  brain.energy += 0.06 * dt
  return { speed: 0, heading: null, look: null }
}

/**
 * Somewhere to go: with probability 0.7 × curiosity a point of interest,
 * otherwise a point ahead-ish, further for a curious creature. Points inside
 * a rock or past the edge are re-rolled.
 */
function pickGoal(brain: Brain, head: { x: number; z: number; heading: number }, habitat: Habitat, p: BrainParams): Target {
  const r = brain.rng
  if (habitat.pois.length && r() < 0.7 * p.curiosity) {
    const i = Math.floor(r() * habitat.pois.length)
    const poi = habitat.pois[i]
    return { x: poi.x, z: poi.z, kind: 'poi', label: poi.name, index: i }
  }
  for (let tries = 0; tries < 30; tries++) {
    const a = head.heading + (r() - 0.5) * 3.4
    const d = (2.5 + 11 * p.curiosity) * (0.5 + r()) + p.length
    const x = head.x + Math.cos(a) * d
    const z = head.z + Math.sin(a) * d
    if (Math.hypot(x, z) > habitat.radius - 2) continue
    if (habitat.obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + p.halfWidth + 0.8)) continue
    return { x, z, kind: 'point', label: 'Wander goal', index: -1 }
  }
  return { x: 0, z: 0, kind: 'point', label: 'Wander goal', index: -1 }
}

/**
 * Keep the head out of rocks and inside the habitat. The steering above
 * should never need it; it is the guarantee the tests check.
 */
export function resolveCollisions(pos: { x: number; z: number }, habitat: Habitat, clearance: number) {
  for (const o of habitat.obstacles) {
    const dx = pos.x - o.x
    const dz = pos.z - o.z
    const d = Math.hypot(dx, dz)
    const min = o.r + clearance
    if (d < min) {
      const k = d > 1e-9 ? min / d : 0
      pos.x = o.x + (d > 1e-9 ? dx * k : min)
      pos.z = o.z + dz * k
    }
  }
  const d = Math.hypot(pos.x, pos.z)
  if (d > habitat.radius) {
    pos.x *= habitat.radius / d
    pos.z *= habitat.radius / d
  }
}
