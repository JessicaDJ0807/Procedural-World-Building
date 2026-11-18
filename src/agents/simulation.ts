import { mulberry32 } from '../noise'
import {
  WALL_MID,
  WORLD_H,
  WORLD_W,
  buildEnvironment,
  cellOf,
  gapAt,
  isBlocked,
  type Circle,
  type Environment,
} from './environment'
import { TrailField } from './trail'

/**
 * Agents, their state machine, and the loop that steps them.
 *
 * Every agent runs the same four-state machine and the same steering rule.
 * What differs between them is a few personal factors drawn from the seed —
 * walking speed, how much they trust trails, how curious they are — each
 * within ±20% of the slider's value, so the population is not a single agent
 * copied three hundred times but nobody is a different kind of thing.
 *
 * ## The steering rule
 *
 * Every 0.15 s a travelling agent looks along nine headings fanned ±110°
 * around the way it faces, and scores each:
 *
 *     score = cos(heading − direction to goal)            the compass
 *           + influence · T / (T + K)                     the trail 5 units out
 *           + 0.3 · cos(heading − current heading)        momentum
 *
 * Headings that run into an obstacle within 3 units are struck out. It then
 * picks one at random with probability ∝ exp(score / τ), where τ is the
 * exploration setting. Small τ means almost always the best-scoring heading;
 * large τ means a heading that scored a little worse is chosen often — which is
 * what "trying a less-travelled route" is, mechanically.
 *
 * This is the active-walker model of trail formation (Helbing, Keltsch and
 * Molnár, 1997) — the one used to explain desire paths across a lawn — with the
 * gradient replaced by sampled headings so walls can be struck out. Walkers
 * want to go straight to their goal; trails bend them; trails are made by
 * walkers. Nobody plans a route.
 *
 * The compass is the agents' only global knowledge: they know which way their
 * goal is, as a person crossing a campus does, but not how to get there. An
 * agent that meets the wall slides along it — the candidates pointing at the
 * goal are struck out, and momentum keeps it sliding the way it started — until
 * a gap opens toward the goal.
 *
 * T / (T + K) saturates on purpose. With raw T, a well-worn path would pull
 * from across the map with a force that grows without bound, and the first
 * route to get busy would win every time regardless of length.
 */

export type AgentState = 'idle' | 'explore' | 'navigate' | 'rest'
export const AGENT_STATES: AgentState[] = ['idle', 'explore', 'navigate', 'rest']

export type AgentParams = {
  agents: number
  /** Weight of the trail term relative to the compass, 0 = ignore trails. */
  influence: number
  /** Trail decay rate per second. Half-life is ln 2 / this. */
  evaporation: number
  /** 0–1: softmax temperature and detour rate. */
  exploration: number
  /** Walking speed, world units per second. */
  speed: number
}

export type DecisionKind =
  | 'spawn'
  | 'choose'
  | 'rest'
  | 'sight'
  | 'trail'
  | 'compass'
  | 'wall'
  | 'detour'
  | 'unstuck'
  | 'lost'
  | 'boxed'

/** Why the agent is doing what it is doing — written by the rule that decided it. */
export type Decision = {
  kind: DecisionKind
  /** Chosen heading relative to the one it had, radians. Positive is clockwise on screen. */
  turn: number
  /** Saturated trail strength T / (T + K) along the chosen heading, 0–1. */
  trail: number
  /** Seconds left, for timed behaviour: resting, idling, detouring. */
  remaining: number
}

export type Agent = {
  id: number
  x: number
  y: number
  heading: number
  /** The heading the last decision chose; the agent turns toward it at a limited rate. */
  desired: number
  state: AgentState
  stateTime: number
  /** Index into the destinations. −1 before the first choice. */
  origin: number
  target: number
  speedFactor: number
  influenceFactor: number
  curiosityFactor: number
  /** Speed actually moved last step, units per second. */
  velocity: number
  timer: number
  decisionClock: number
  detour: number
  detourHeading: number
  /**
   * Which way this trip slides along walls: +1 or −1 once it has met one, 0
   * before. Kept for the whole trip and flipped when the agent gets stuck —
   * the Bug algorithm's rule. Without it, an agent that slid into a corner was
   * sent away by the stuck check, and the compass walked it straight back into
   * the same corner: trips of 60–140 s where the rest took 10–15.
   */
  side: number
  lostTime: number
  checkClock: number
  checkX: number
  checkY: number
  tripTime: number
  tripDistance: number
  /** Shortest walkable distance to the target from where the trip began. */
  tripShortest: number
  trips: number
  lastX: number
  decision: Decision
}

/** What the selected agent saw at its last decision, for drawing its senses. */
export type Probe = {
  x: number
  y: number
  heading: number
  goal: number
  angles: number[]
  scores: number[]
  trail: number[]
  probability: number[]
  blocked: boolean[]
  chosen: number
}

export type Trip = { time: number; distance: number; shortest: number }

export const DT = 1 / 30
export const MAX_AGENTS = 400
export const DECISION_INTERVAL = 0.15
/** How far ahead the trail is sensed, and the radius drawn round a selected agent. */
export const SENSE_DISTANCE = 5
const PROBE = [1.5, 3]
const OFFSETS = [-110, -75, -45, -22.5, 0, 22.5, 45, 75, 110].map((d) => (d * Math.PI) / 180)
const TURN_RATE = 6
const MOMENTUM = 0.3
const TRAIL_K = 4
/** Hysteresis: a trail must reach 0.35 to be followed, and fall below 0.15 to be let go. */
const ENTER = 0.35
const EXIT = 0.15
const LOST_AFTER = 1
const SIGHT = 22
const DETOUR_RATE = 0.25
const DEPOSIT = 1
const DIFFUSION = 0.6
const CLEARANCE = 0.6
const SEPARATION = 1.6
const SEPARATION_PUSH = 3
const STUCK_WINDOW = 3
const STUCK_DISTANCE = 2.5
const TRIP_WINDOW = 40
const CROSSING_WINDOW = 60
const HISTORY_LENGTH = 180
const PATH_LENGTH = 150

const wrap = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

/** Half-life in seconds for an evaporation rate. */
export const halfLife = (rate: number) => Math.LN2 / Math.max(rate, 1e-9)

export class Simulation {
  env: Environment
  readonly trail: TrailField
  agents: Agent[] = []
  params: AgentParams
  time = 0
  tripsCompleted = 0
  /** Trips by every agent, most recent last, capped at TRIP_WINDOW. */
  recentTrips: Trip[] = []
  /** Gap index of each recent crossing of the wall, most recent last. */
  recentCrossings: number[] = []
  /** Trail concentration, sampled once a simulated second. */
  history: number[] = []
  selected = -1
  probe: Probe | null = null
  /** The selected agent's recent positions. */
  path: { x: number; y: number }[] = []

  private rand: () => number
  private nextId = 0
  private sampleClock = 0
  private pathClock = 0
  private readonly head = new Int32Array((WORLD_W / 2) * (WORLD_H / 2))
  private next = new Int32Array(MAX_AGENTS)

  constructor(seed: number, params: AgentParams, placed: Circle[] = []) {
    this.env = buildEnvironment(seed, placed)
    this.trail = new TrailField(this.env.blocked)
    this.params = { ...params }
    this.rand = mulberry32(seed * 2654435761)
    this.setAgentCount(params.agents)
  }

  /** Swap the ground under the agents — a block placed or removed — keeping everything else. */
  setEnvironment(env: Environment) {
    this.env = env
    this.trail.blocked = env.blocked
    for (let c = 0; c < env.blocked.length; c++) if (env.blocked[c]) this.trail.data[c] = 0
    // Anyone standing where a block now is steps out to the nearest free cell.
    for (const a of this.agents) {
      if (!this.blockedAt(a.x, a.y)) continue
      const spot = this.nearestFree(a.x, a.y)
      a.x = spot.x
      a.y = spot.y
      a.decisionClock = 0
    }
  }

  setParams(params: AgentParams) {
    this.params = { ...params }
    this.setAgentCount(params.agents)
  }

  clearTrails() {
    this.trail.clear()
  }

  select(id: number) {
    this.selected = id
    this.probe = null
    this.path = []
  }

  private setAgentCount(count: number) {
    const n = Math.max(0, Math.min(MAX_AGENTS, Math.round(count)))
    while (this.agents.length > n) {
      const gone = this.agents.pop() as Agent
      if (gone.id === this.selected) this.select(-1)
    }
    while (this.agents.length < n) this.agents.push(this.spawn())
  }

  /** At a destination, idle for up to three seconds so the first wave does not leave in step. */
  private spawn(): Agent {
    const r = this.rand
    const origin = this.agents.length % this.env.destinations.length
    const d = this.env.destinations[origin]
    const angle = r() * Math.PI * 2
    const radius = d.r * 0.7 * Math.sqrt(r())
    const heading = r() * Math.PI * 2
    const vary = () => 0.8 + 0.4 * r()
    const x = d.x + Math.cos(angle) * radius
    const y = d.y + Math.sin(angle) * radius
    return {
      id: this.nextId++,
      x,
      y,
      heading,
      desired: heading,
      state: 'idle',
      stateTime: 0,
      origin,
      target: origin,
      speedFactor: vary(),
      influenceFactor: vary(),
      curiosityFactor: vary(),
      velocity: 0,
      timer: r() * 3,
      decisionClock: 0,
      detour: 0,
      detourHeading: 0,
      side: 0,
      lostTime: 0,
      checkClock: 0,
      checkX: x,
      checkY: y,
      tripTime: 0,
      tripDistance: 0,
      tripShortest: 0,
      trips: 0,
      lastX: x,
      decision: { kind: 'spawn', turn: 0, trail: 0, remaining: 0 },
    }
  }

  /** The agent's body is a disc: blocked if its centre or any of four rim points is. */
  private blockedAt(x: number, y: number) {
    const env = this.env
    return (
      isBlocked(env, x, y) ||
      isBlocked(env, x + CLEARANCE, y) ||
      isBlocked(env, x - CLEARANCE, y) ||
      isBlocked(env, x, y + CLEARANCE) ||
      isBlocked(env, x, y - CLEARANCE)
    )
  }

  private nearestFree(x: number, y: number) {
    for (let radius = 1; radius < 40; radius++) {
      for (let k = 0; k < 8 * radius; k++) {
        const a = (k / (8 * radius)) * Math.PI * 2
        const px = x + Math.cos(a) * radius
        const py = y + Math.sin(a) * radius
        if (!this.blockedAt(px, py)) return { x: px, y: py }
      }
    }
    return { x, y }
  }

  private setState(a: Agent, state: AgentState) {
    if (a.state !== state) {
      a.state = state
      a.stateTime = 0
    }
  }

  private lineOfSight(x0: number, y0: number, x1: number, y1: number) {
    const len = Math.hypot(x1 - x0, y1 - y0)
    const steps = Math.ceil(len / 0.5)
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      if (isBlocked(this.env, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false
    }
    return true
  }

  /** Leaving a destination: pick another one, uniformly. */
  private choose(a: Agent) {
    const n = this.env.destinations.length
    let target = Math.floor(this.rand() * (n - 1))
    if (target >= a.origin) target += 1
    a.target = target
    a.tripTime = 0
    a.tripDistance = 0
    const c = cellOf(a.x, a.y)
    a.tripShortest = c >= 0 ? this.env.distance[target][c] : 0
    a.decisionClock = 0
    a.detour = 0
    a.side = 0
    a.lostTime = 0
    a.checkClock = 0
    a.checkX = a.x
    a.checkY = a.y
    a.decision = { kind: 'choose', turn: 0, trail: 0, remaining: 0 }
    this.setState(a, 'explore')
  }

  /**
   * One decision: look, score, pick. Writes the agent's desired heading, its
   * state, and the reason. The selected agent also keeps what it saw.
   */
  private decide(a: Agent) {
    const goal = this.env.destinations[a.target]
    const goalAngle = Math.atan2(goal.y - a.y, goal.x - a.x)
    const record = a.id === this.selected
    const { influence, exploration } = this.params
    const trust = influence * a.influenceFactor
    const curiosity = Math.min(1, exploration * a.curiosityFactor)

    // Close enough to see the goal with nothing in the way: no need for any rule but the compass.
    const dist = Math.hypot(goal.x - a.x, goal.y - a.y)
    if (dist < SIGHT && this.lineOfSight(a.x, a.y, goal.x, goal.y)) {
      a.desired = goalAngle
      a.detour = 0
      a.lostTime = 0
      a.decision = { kind: 'sight', turn: wrap(goalAngle - a.heading), trail: 0, remaining: 0 }
      this.setState(a, 'navigate')
      if (record) this.probe = null
      return
    }

    const n = OFFSETS.length
    const angles: number[] = new Array(n)
    const scores: number[] = new Array(n)
    const trails: number[] = new Array(n)
    const blocked: boolean[] = new Array(n)
    const detouring = a.detour > 0
    let best = -Infinity
    let maxTrail = 0
    let goalMost = 0
    for (let k = 0; k < n; k++) {
      const h = a.heading + OFFSETS[k]
      const dx = Math.cos(h)
      const dy = Math.sin(h)
      angles[k] = h
      blocked[k] = PROBE.some((p) => this.blockedAt(a.x + dx * p, a.y + dy * p))
      const t = this.trail.sample(a.x + dx * SENSE_DISTANCE, a.y + dy * SENSE_DISTANCE)
      trails[k] = blocked[k] ? 0 : t / (t + TRAIL_K)
      if (!blocked[k]) maxTrail = Math.max(maxTrail, trails[k])
      if (Math.cos(h - goalAngle) > Math.cos(angles[goalMost] - goalAngle)) goalMost = k
    }
    const walled = blocked[goalMost]
    for (let k = 0; k < n; k++) {
      // During a detour the agent walks a heading it picked at random and
      // ignores trails and goal alike.
      const toward = detouring ? a.detourHeading : goalAngle
      // At a wall, keep turning the way this trip already slides.
      const slide = walled && !detouring ? 0.6 * a.side * Math.sin(OFFSETS[k]) : 0
      scores[k] = blocked[k]
        ? -Infinity
        : Math.cos(angles[k] - toward) + (detouring ? 0 : trust * trails[k]) + MOMENTUM * Math.cos(OFFSETS[k]) + slide
      best = Math.max(best, scores[k])
    }

    // Boxed in on every side, which a corner can do: turn round.
    if (best === -Infinity) {
      a.desired = a.heading + Math.PI
      a.decision = { kind: 'boxed', turn: Math.PI, trail: 0, remaining: 0 }
      if (record) this.probe = null
      return
    }

    // --- transitions -------------------------------------------------------
    if (detouring) {
      this.setState(a, 'explore')
    } else if (a.state === 'explore') {
      if (trust > 0 && maxTrail >= ENTER) {
        this.setState(a, 'navigate')
        a.lostTime = 0
      }
    } else if (a.state === 'navigate') {
      if (trust <= 0 || maxTrail < EXIT) {
        a.lostTime += DECISION_INTERVAL
        if (a.lostTime >= LOST_AFTER) this.setState(a, 'explore')
      } else {
        a.lostTime = 0
      }
      // Now and then, a navigating agent leaves the trail on purpose.
      if (a.state === 'navigate' && this.rand() < curiosity * DETOUR_RATE * DECISION_INTERVAL) {
        a.detour = 1 + this.rand() * 1.5
        const side = this.rand() < 0.5 ? -1 : 1
        a.detourHeading = a.heading + side * (0.5 + this.rand() * 1.2)
        this.setState(a, 'explore')
      }
    }

    // --- choice ------------------------------------------------------------
    // A committed agent explores less: half the temperature while navigating.
    const tau = (0.03 + 0.35 * curiosity) * (a.state === 'navigate' ? 0.5 : 1)
    const probability: number[] = new Array(n)
    let sum = 0
    for (let k = 0; k < n; k++) {
      probability[k] = blocked[k] ? 0 : Math.exp((scores[k] - best) / tau)
      sum += probability[k]
    }
    let u = this.rand() * sum
    let chosen = 0
    for (let k = 0; k < n; k++) {
      if (probability[k] === 0) continue
      chosen = k
      u -= probability[k]
      if (u <= 0) break
    }
    for (let k = 0; k < n; k++) probability[k] /= sum
    a.desired = angles[chosen]
    if (walled && a.side === 0 && OFFSETS[chosen] !== 0) a.side = Math.sign(OFFSETS[chosen])

    let kind: DecisionKind
    if (a.detour > 0) kind = a.decision.kind === 'unstuck' ? 'unstuck' : 'detour'
    else if (a.state === 'navigate') kind = 'trail'
    else if (a.lostTime >= LOST_AFTER && a.decision.kind === 'trail') kind = 'lost'
    else if (walled) kind = 'wall'
    else kind = 'compass'
    a.decision = { kind, turn: OFFSETS[chosen], trail: trails[chosen], remaining: a.detour }

    if (record) {
      this.probe = {
        x: a.x,
        y: a.y,
        heading: a.heading,
        goal: goalAngle,
        angles,
        scores,
        trail: trails,
        probability,
        blocked,
        chosen,
      }
    }
  }

  /** Advance one fixed step. Same seed, same parameters, same sequence of calls — same run. */
  step() {
    const dt = DT
    const { speed } = this.params
    this.buildNeighbours()

    for (const a of this.agents) {
      a.stateTime += dt
      if (a.state === 'idle') {
        a.velocity = 0
        a.timer -= dt
        a.decision = { ...a.decision, remaining: Math.max(0, a.timer) }
        if (a.timer <= 0) this.choose(a)
        continue
      }
      if (a.state === 'rest') {
        a.velocity = 0
        a.timer -= dt
        a.decision = { kind: 'rest', turn: 0, trail: 0, remaining: Math.max(0, a.timer) }
        this.separate(a, dt)
        if (a.timer <= 0) {
          a.timer = 0.4 + this.rand() * 0.6
          a.decision = { kind: 'choose', turn: 0, trail: 0, remaining: a.timer }
          this.setState(a, 'idle')
        }
        continue
      }

      // --- travelling: explore or navigate ---------------------------------
      a.tripTime += dt
      if (a.detour > 0) a.detour = Math.max(0, a.detour - dt)

      // Stuck check: an agent that has not got anywhere in three seconds is
      // jammed against something its sensors keep choosing; send it away.
      a.checkClock += dt
      if (a.checkClock >= STUCK_WINDOW) {
        if (Math.hypot(a.x - a.checkX, a.y - a.checkY) < STUCK_DISTANCE) {
          // Back the way it came, and slide the other way from now on.
          a.detour = 2
          a.detourHeading = a.heading + Math.PI + (this.rand() - 0.5)
          a.side = a.side === 0 ? (this.rand() < 0.5 ? -1 : 1) : -a.side
          a.decision = { kind: 'unstuck', turn: 0, trail: 0, remaining: a.detour }
          a.decisionClock = 0
        }
        a.checkClock = 0
        a.checkX = a.x
        a.checkY = a.y
      }

      a.decisionClock -= dt
      if (a.decisionClock <= 0) {
        this.decide(a)
        a.decisionClock += DECISION_INTERVAL
      }

      // Turn toward the chosen heading at a limited rate. This, not the
      // decision interval, is what makes the motion smooth: a decision can flip
      // by 45°, but the body only ever turns by TURN_RATE · dt.
      const diff = wrap(a.desired - a.heading)
      const maxTurn = TURN_RATE * dt
      a.heading = wrap(a.heading + Math.max(-maxTurn, Math.min(maxTurn, diff)))

      const v = speed * a.speedFactor
      let dx = Math.cos(a.heading) * v * dt
      let dy = Math.sin(a.heading) * v * dt
      const push = this.push(a)
      dx += push.x * dt
      dy += push.y * dt

      const x0 = a.x
      const y0 = a.y
      if (!this.blockedAt(a.x + dx, a.y + dy)) {
        a.x += dx
        a.y += dy
      } else if (!this.blockedAt(a.x + dx, a.y)) {
        a.x += dx
      } else if (!this.blockedAt(a.x, a.y + dy)) {
        a.y += dy
      } else {
        // Head-on into something: decide again now rather than at the next tick.
        a.decisionClock = 0
      }
      const moved = Math.hypot(a.x - x0, a.y - y0)
      a.velocity = moved / dt
      a.tripDistance += moved
      this.trail.deposit(a.x, a.y, DEPOSIT * moved)

      // A route choice: the agent's centre crossed the wall's centre line.
      if (a.lastX < WALL_MID !== a.x < WALL_MID) {
        const gap = gapAt(this.env, a.y)
        if (gap >= 0) {
          this.recentCrossings.push(gap)
          if (this.recentCrossings.length > CROSSING_WINDOW) this.recentCrossings.shift()
        }
      }
      a.lastX = a.x

      const goal = this.env.destinations[a.target]
      if (Math.hypot(goal.x - a.x, goal.y - a.y) < goal.r - 0.5) {
        a.trips += 1
        this.tripsCompleted += 1
        this.recentTrips.push({ time: a.tripTime, distance: a.tripDistance, shortest: a.tripShortest })
        if (this.recentTrips.length > TRIP_WINDOW) this.recentTrips.shift()
        a.origin = a.target
        a.timer = 2 + this.rand() * 3
        a.detour = 0
        a.velocity = 0
        a.decision = { kind: 'rest', turn: 0, trail: 0, remaining: a.timer }
        this.setState(a, 'rest')
      }
    }

    this.trail.step(dt, this.params.evaporation, DIFFUSION)
    this.time += dt

    this.sampleClock += dt
    if (this.sampleClock >= 1) {
      this.sampleClock -= 1
      this.history.push(this.trail.concentration())
      if (this.history.length > HISTORY_LENGTH) this.history.shift()
    }

    const sel = this.agents.find((a) => a.id === this.selected)
    if (sel) {
      this.pathClock += dt
      if (this.pathClock >= 0.2) {
        this.pathClock = 0
        this.path.push({ x: sel.x, y: sel.y })
        if (this.path.length > PATH_LENGTH) this.path.shift()
      }
    }
  }

  // --- separation: a spatial hash of 2 × 2 cells, rebuilt every step --------

  private buildNeighbours() {
    if (this.next.length < this.agents.length) this.next = new Int32Array(this.agents.length)
    this.head.fill(-1)
    const cols = WORLD_W / 2
    for (let k = 0; k < this.agents.length; k++) {
      const a = this.agents[k]
      const b = Math.floor(a.y / 2) * cols + Math.floor(a.x / 2)
      if (b < 0 || b >= this.head.length) continue
      this.next[k] = this.head[b]
      this.head[b] = k
    }
  }

  /**
   * A soft push away from anyone closer than 1.6 units — enough that two
   * agents on one trail pass side by side rather than through each other, and
   * too weak to knock either off its course. Resting agents are pushed too, so
   * a destination does not stack them on one spot.
   */
  private push(a: Agent) {
    let px = 0
    let py = 0
    const cols = WORLD_W / 2
    const bi = Math.floor(a.x / 2)
    const bj = Math.floor(a.y / 2)
    for (let j = bj - 1; j <= bj + 1; j++) {
      for (let i = bi - 1; i <= bi + 1; i++) {
        if (i < 0 || j < 0 || i >= cols || j >= WORLD_H / 2) continue
        for (let k = this.head[j * cols + i]; k >= 0; k = this.next[k]) {
          const o = this.agents[k]
          if (o === a) continue
          const dx = a.x - o.x
          const dy = a.y - o.y
          const d = Math.hypot(dx, dy)
          if (d >= SEPARATION || d < 1e-6) continue
          const s = (SEPARATION - d) / SEPARATION
          px += (dx / d) * s * SEPARATION_PUSH
          py += (dy / d) * s * SEPARATION_PUSH
        }
      }
    }
    return { x: px, y: py }
  }

  private separate(a: Agent, dt: number) {
    const p = this.push(a)
    const nx = a.x + p.x * dt
    const ny = a.y + p.y * dt
    if (!this.blockedAt(nx, ny)) {
      a.x = nx
      a.y = ny
    }
  }

  // --- what the page reads ---------------------------------------------------

  stateCounts(): Record<AgentState, number> {
    const counts = { idle: 0, explore: 0, navigate: 0, rest: 0 }
    for (const a of this.agents) counts[a.state] += 1
    return counts
  }

  /** Share of recent wall crossings through each gap. Empty until something has crossed. */
  gapShares(): number[] {
    const counts = this.env.gaps.map(() => 0)
    for (const g of this.recentCrossings) counts[g] += 1
    const total = this.recentCrossings.length
    return total ? counts.map((c) => c / total) : counts
  }

  tripSummary() {
    const trips = this.recentTrips
    if (trips.length === 0) return null
    let time = 0
    let distance = 0
    let shortest = 0
    for (const t of trips) {
      time += t.time
      distance += t.distance
      shortest += t.shortest
    }
    return {
      count: trips.length,
      time: time / trips.length,
      distance: distance / trips.length,
      /** How much longer the walked routes were than the shortest walkable ones, as a fraction. */
      excess: shortest > 0 ? distance / shortest - 1 : 0,
    }
  }

  agentAt(x: number, y: number, radius: number): Agent | null {
    let best: Agent | null = null
    let bestD = radius
    for (const a of this.agents) {
      const d = Math.hypot(a.x - x, a.y - y)
      if (d < bestD) {
        best = a
        bestD = d
      }
    }
    return best
  }
}

/** A run from a fresh start, for tests and headless measurement. */
export function runFor(seed: number, params: AgentParams, seconds: number, placed: Circle[] = []): Simulation {
  const sim = new Simulation(seed, params, placed)
  const steps = Math.round(seconds / DT)
  for (let s = 0; s < steps; s++) sim.step()
  return sim
}
