import { gaitPattern, type Gait, type GaitPattern } from './gait'
import { solveTwoBone } from './ik'
import type { Creature } from './skeleton'
import { add, addScaled, dirInFrame, dist, inFrame, lerp, norm, scale, sub, uprightFrame, v3, yaw, type Frame, type V3 } from './vec'

/**
 * Procedural animation: the creature posed every fixed step from its
 * movement, never from a clip.
 *
 * Four layers, each feeding the next:
 *
 *  1. **Root motion.** The head moves forward at the current speed and turns
 *     toward the wanted heading, no tighter than half a body length. Its
 *     track is recorded as a path.
 *  2. **Spine.** Every spine joint sits on that path, as far behind the head
 *     as it is in the rest pose — follow-the-leader — so the body bends
 *     round every turn the head made. On top: a sway locked to the gait
 *     cycle for legged bodies, or, for legless ones, a sine wave fixed to
 *     the *ground*: each point of the body is displaced by sin(2π s / λ) at
 *     its own distance s along the path, so as the body advances every point
 *     slides along the same S-shaped track. That is lateral undulation, and
 *     the reason a snake leaves one trail rather than a smear.
 *  3. **Feet.** Each leg runs the gait cycle (gait.ts). In stance its toe is
 *     pinned to the ground where it landed and does not move at all; in
 *     swing it travels on a half-sine arc to where its rest position *will
 *     be* half a stance from now, so it lands ahead and the body walks over
 *     it. Stance never slides because nothing writes to a planted toe.
 *  4. **Legs.** The hip comes from the posed spine; two-bone IK (ik.ts)
 *     finds the knee that joins hip to ankle. A third bone stands the foot
 *     up on its toes; a fourth, the coxa, holds the leg out first.
 *
 * And secondary motion: antennae are chains of point masses integrated with
 * Verlet and held at their length, so they lag and spring back; fronds bend
 * back with speed and sway with a delay that grows toward their tips.
 *
 * Nothing here touches three.js. The output is a position for every joint
 * and a frame for every spine joint; the renderer reads them.
 */
export const STEP = 1 / 60

type PathPoint = { x: number; z: number; s: number }

export type LegState = {
  planted: boolean
  toe: V3
  liftoff: V3
  swing: number
  error: number
  /** Seconds left in an early step; 0 when stepping on schedule. */
  early: number
  /** Planted after an early step, waiting for the schedule to call a stance. */
  hold: boolean
}

export type Command = {
  /** Wanted speed, world units per second. */
  speed: number
  /** Wanted heading in radians, or null to hold the current one. */
  heading: number | null
  /** A point the head turns to look at, or null to look around. */
  look: { x: number; z: number } | null
}

export type Footprint = { x: number; z: number; heading: number; side: number }

const TAU = Math.PI * 2
const wrap = (a: number) => a - TAU * Math.round(a / TAU)
const frac = (a: number) => ((a % 1) + 1) % 1
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Shortest step from a to b on a circle of circumference 1. */
const wrap1 = (d: number) => d - Math.round(d)

/** Cadence limits: no gait cycle quicker than this, or slower than this. */
export const MIN_CYCLE = 0.28
export const MAX_CYCLE = 2.4

export class Body {
  readonly c: Creature
  /** Head position on the ground, heading, speed and the distance travelled. */
  x: number
  z: number
  heading: number
  speed = 0
  odometer = 0
  time = 0
  /** The gait clock, in cycles. */
  phase = 0
  gait: Gait = 'idle'
  pattern: GaitPattern
  runBlend = 0
  offsets: number[]
  duty: number
  stride = 0
  cycle = 0
  /** What the legs allow: the speed at which the cadence would hit MIN_CYCLE. */
  maxSpeed: number
  settling = false
  lookYaw = 0
  readonly legs: LegState[]
  /** World position of every joint, 3 per joint. */
  readonly pos: Float64Array
  readonly spineFrames: Frame[]
  headFrame: Frame
  /** Largest distance between a planted toe and where its leg could put it, decaying. */
  contactError = 0
  /** Toe-downs, newest last; the debug overlay draws them. */
  readonly footprints: Footprint[] = []
  footprintCount = 0
  /** Steps taken early because the body was about to outrun a planted foot. */
  earlySteps = 0
  readonly trail: { x: number; z: number }[] = []
  /** Wave length of the slither, in world units. */
  readonly wavelength: number
  private path: PathPoint[] = []
  private readonly antenna: { p: V3[]; q: V3[] }[]
  private readonly walkStride: number
  private readonly footTravel: number

  constructor(c: Creature, at: { x: number; z: number; heading: number; phase?: number; time?: number }) {
    this.c = c
    this.x = at.x
    this.z = at.z
    this.heading = at.heading
    this.phase = at.phase ?? 0
    this.time = at.time ?? 0
    const g = c.genome
    this.pattern = gaitPattern(c, 'walk')
    this.offsets = this.pattern.offsets.slice()
    this.duty = this.pattern.duty
    this.walkStride = g.stride * g.legLength * g.scale
    // How far a planted toe can travel past its hip before the leg is straight.
    this.footTravel = c.limbs.length ? Math.min(...c.limbs.map((l) => l.travel)) : 0
    this.maxSpeed = c.limbs.length ? Math.min(this.footTravel / gaitPattern(c, 'run').duty, this.walkStride * 1.35) / MIN_CYCLE : c.totalLength * 1.4
    this.wavelength = Math.max(c.totalLength / 1.25, c.width * 3)
    this.pos = new Float64Array(c.joints.length * 3)
    this.spineFrames = c.spine.map(() => uprightFrame(v3(), v3(1, 0, 0)))
    this.headFrame = uprightFrame(v3(), v3(1, 0, 0))
    // A straight path behind the head, as long as the body and a margin.
    const f = this.forward()
    const span = c.totalLength + 2
    for (let d = span; d >= 0; d -= 0.05) this.path.push({ x: this.x - f.x * d, z: this.z - f.z * d, s: span - d })
    this.odometer = span
    this.legs = c.limbs.map(() => ({ planted: true, toe: v3(), liftoff: v3(), swing: 0, error: 0, early: 0, hold: false }))
    this.antenna = c.antennae.map((a) => ({ p: a.joints.map(() => v3()), q: a.joints.map(() => v3()) }))
    // Pose once at rest to put the feet and antennae where they belong.
    this.poseSpine()
    this.legs.forEach((leg, k) => {
      leg.toe = this.restToeWorld(k)
    })
    this.poseHead()
    this.antenna.forEach((st, k) => {
      const a = c.antennae[k]
      const socket = inFrame(this.headFrame, a.base)
      const d = dirInFrame(this.headFrame, a.dir)
      st.p = a.joints.map((_, i) => addScaled(socket, d, a.segment * i))
      st.q = st.p.map((p) => ({ ...p }))
    })
    this.poseLimbs(0, v3())
    this.poseAppendages(0)
  }

  forward(): V3 {
    return v3(Math.cos(this.heading), 0, Math.sin(this.heading))
  }

  /** Where the creature is: the root joint. */
  centre(): V3 {
    const r = this.c.root * 3
    return v3(this.pos[r], this.pos[r + 1], this.pos[r + 2])
  }

  joint(id: number): V3 {
    return v3(this.pos[id * 3], this.pos[id * 3 + 1], this.pos[id * 3 + 2])
  }

  private setJoint(id: number, p: V3) {
    this.pos[id * 3] = p.x
    this.pos[id * 3 + 1] = p.y
    this.pos[id * 3 + 2] = p.z
  }

  step(dt: number, cmd: Command) {
    const c = this.c
    const g = c.genome
    this.time += dt
    // ---- 1. root motion
    // The gait is chosen from the speed asked for; the speed actually reached
    // is capped by what the legs allow at the current duty factor, since a
    // foot down longer has to travel further past its hip.
    const asked = Math.max(0, cmd.speed)
    const capNow = c.limbs.length ? this.footTravel / Math.max(this.duty, 0.3) / MIN_CYCLE : this.maxSpeed
    const want = Math.min(asked, this.maxSpeed, capNow)
    const accel = 2.5 * Math.max(0.6, g.speed)
    this.speed += clamp(want - this.speed, -accel * dt * 1.6, accel * dt)
    if (cmd.heading !== null) {
      // No tighter than a radius of half a body length, plus a little turning
      // on the spot so a standing creature can face a new way.
      const rate = Math.min(3, this.speed / (0.45 * c.length) + 0.25)
      this.heading += clamp(wrap(cmd.heading - this.heading), -rate * dt, rate * dt)
    }
    const f = this.forward()
    this.x += f.x * this.speed * dt
    this.z += f.z * this.speed * dt
    this.odometer += this.speed * dt
    const last = this.path[this.path.length - 1]
    if (Math.hypot(this.x - last.x, this.z - last.z) >= 0.03) this.path.push({ x: this.x, z: this.z, s: this.odometer })
    const keep = this.odometer - (c.totalLength + 2)
    while (this.path.length > 2 && this.path[1].s < keep) this.path.shift()

    // ---- gait: chosen by speed, never by a menu
    const walkV = g.speed
    const moving = this.speed > 0.02 * g.scale
    this.runBlend += (clamp((Math.min(asked, this.maxSpeed) - 1.3 * walkV) / (0.9 * walkV), 0, 1) - this.runBlend) * Math.min(1, dt * 4)
    this.gait = !moving ? 'idle' : this.runBlend > 0.5 ? 'run' : 'walk'
    const pattern = gaitPattern(c, this.runBlend > 0.5 ? 'run' : 'walk')
    this.pattern = pattern
    // Blend into a new pattern rather than jumping, so a gait change does not
    // teleport a leg that was mid-stance into mid-swing.
    const k = Math.min(1, dt * 5)
    this.offsets = this.offsets.map((o, i) => frac(o + wrap1(pattern.offsets[i] - o) * k))
    this.duty += (pattern.duty - this.duty) * k
    if (c.limbs.length) {
      const stride = clamp(this.walkStride * (1 + 0.35 * this.runBlend), 0.05, this.footTravel / Math.max(this.duty, 0.3))
      this.cycle = moving ? clamp(stride / this.speed, MIN_CYCLE, MAX_CYCLE) : 0.6
      this.stride = moving ? this.speed * this.cycle : 0
    } else {
      this.cycle = moving ? this.wavelength / this.speed : 0
      this.stride = moving ? this.wavelength : 0
    }

    // Standing still: keep stepping until every foot is back under its hip.
    let err = 0
    this.legs.forEach((leg, i) => {
      err = Math.max(err, leg.planted ? dist(leg.toe, this.restToeWorld(i)) : Infinity)
    })
    const settleLimit = 0.1 * (c.limbs[0]?.a ?? 1)
    this.settling = !moving && c.limbs.length > 0 && err > settleLimit
    if (moving) this.phase += dt / this.cycle
    else if (this.settling) this.phase += dt / 0.55

    // ---- 2–4
    this.poseSpine()
    this.poseHead(cmd.look)
    const velocity = moving ? scale(this.forward(), this.speed) : v3()
    this.poseLimbs(dt, velocity)
    this.poseAppendages(dt)

    const r = this.centre()
    const tl = this.trail[this.trail.length - 1]
    if (!tl || Math.hypot(r.x - tl.x, r.z - tl.z) > 0.12) {
      this.trail.push({ x: r.x, z: r.z })
      if (this.trail.length > 400) this.trail.shift()
    }
  }

  /** Point and tangent on the head's path, `s` units from where it started. */
  private sample(s: number): { x: number; z: number } {
    const P = this.path
    const last = P[P.length - 1]
    if (s >= last.s) {
      const span = this.odometer - last.s
      const t = span > 1e-9 ? Math.min(1, (s - last.s) / span) : 1
      return { x: last.x + (this.x - last.x) * t, z: last.z + (this.z - last.z) * t }
    }
    if (s <= P[0].s) {
      const a = P[0]
      const b = P[1]
      const l = Math.max(Math.hypot(b.x - a.x, b.z - a.z), 1e-9)
      const d = s - a.s
      return { x: a.x + ((b.x - a.x) / l) * d, z: a.z + ((b.z - a.z) / l) * d }
    }
    let lo = 0
    let hi = P.length - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (P[m].s <= s) lo = m
      else hi = m
    }
    const a = P[lo]
    const b = P[hi]
    const t = (s - a.s) / Math.max(b.s - a.s, 1e-9)
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
  }

  private poseSpine() {
    const c = this.c
    const g = c.genome
    const h = c.spine.length - 1
    const headX = c.spineX[h]
    const span = headX - c.spineX[0]
    const moving = clamp(this.speed / (0.3 * g.speed), 0, 1)
    const W = c.width
    const legless = c.limbs.length === 0
    const tailCount = c.tail.length
    const tailLen = tailCount ? -c.length / 2 - c.spineX[0] : 0
    const breath = Math.sin((TAU * this.time) / 3.2) * 0.012 * c.height
    const bob = -c.bobAmp * (0.45 + 0.55 * this.runBlend) * (0.5 - 0.5 * Math.cos(TAU * 2 * this.phase)) * moving
    const points: V3[] = []
    for (let i = 0; i <= h; i++) {
      const d = headX - c.spineX[i]
      const s = this.odometer - d
      const p = this.sample(s)
      const a = this.sample(s + 0.12)
      const b = this.sample(s - 0.12)
      const tx = a.x - b.x
      const tz = a.z - b.z
      const tl = Math.max(Math.hypot(tx, tz), 1e-9)
      // The path's normal, to the creature's right.
      const nx = -tz / tl
      const nz = tx / tl
      let lateral: number
      let y = c.bodyY + breath + bob
      const along = d / Math.max(span, 1e-9)
      if (legless) {
        // A wave fixed to the ground: the phase is the distance along the path.
        const env = 0.3 + 0.7 * Math.pow(along, 0.7)
        lateral = c.swayAmp * env * Math.sin((TAU * s) / this.wavelength)
        if (i === h) y += 0.35 * c.height
      } else {
        // A standing wave locked to the gait: chest and hips swing opposite ways.
        lateral = c.swayAmp * moving * Math.sin(TAU * this.phase + Math.PI * (c.spineX[i] / c.length))
      }
      if (i < tailCount) {
        // Tail: droops toward the ground and wags, more toward the tip.
        const q = (-c.length / 2 - c.spineX[i]) / Math.max(tailLen, 1e-9)
        const drop = Math.max(0, c.bodyY - 0.12 * g.scale) * 0.5 * (legless ? 0 : 1)
        y -= drop * q * q
        const wag = (0.08 + 0.3 * g.sway) * W * q * (moving * Math.sin(TAU * this.phase - q * 1.6) + (1 - moving) * 0.6 * Math.sin(this.time * 1.4 - q * 1.2))
        lateral += legless ? 0 : wag
      }
      points.push(v3(p.x + nx * lateral, y, p.z + nz * lateral))
    }
    for (let i = 0; i <= h; i++) {
      const prev = points[Math.max(0, i - 1)]
      const next = points[Math.min(h, i + 1)]
      const fr = uprightFrame(points[i], sub(next, prev))
      this.spineFrames[i] = fr
      this.setJoint(c.spine[i], points[i])
    }
    this.setJoint(c.root, this.frameAt(0).o)
  }

  /** The spine's frame at a rest-pose x, interpolated between joints. */
  frameAt(x: number): Frame {
    const xs = this.c.spineX
    let i = 0
    while (i < xs.length - 2 && xs[i + 1] < x) i++
    const t = clamp((x - xs[i]) / Math.max(xs[i + 1] - xs[i], 1e-9), 0, 1)
    const a = this.spineFrames[i]
    const b = this.spineFrames[i + 1]
    return uprightFrame(lerp(a.o, b.o, t), lerp(a.t, b.t, t))
  }

  private poseHead(look: { x: number; z: number } | null = null) {
    const c = this.c
    const base = this.spineFrames[c.spine.length - 1]
    let want: number
    if (look) {
      const toward = Math.atan2(look.z - base.o.z, look.x - base.o.x)
      want = clamp(wrap(toward - Math.atan2(base.t.z, base.t.x)), -0.9, 0.9)
    } else {
      // Idle: glance about. Moving: look where it is going.
      const idle = this.gait === 'idle' ? 1 : 0.2
      want = idle * (0.45 * Math.sin(this.time * 0.37) + 0.22 * Math.sin(this.time * 0.91 + 1))
    }
    this.lookYaw += (want - this.lookYaw) * 0.08
    const t = yaw(base.t, this.lookYaw)
    this.headFrame = uprightFrame(base.o, t)
    for (const e of c.eyes) this.setJoint(e.joint, inFrame(this.headFrame, e.pos))
  }

  /** Where a leg's toe stands at rest, in the world, on the ground. */
  restToeWorld(k: number): V3 {
    const l = this.c.limbs[k]
    const F = this.frameAt(l.anchor.x)
    const H = uprightFrame(F.o, v3(F.t.x, 0, F.t.z))
    const rx = l.restToe.x - l.anchor.x
    const rz = l.restToe.z
    return v3(H.o.x + H.t.x * rx + H.l.x * rz, 0, H.o.z + H.t.z * rx + H.l.z * rz)
  }

  private poseLimbs(dt: number, velocity: V3) {
    const c = this.c
    const g = c.genome
    const up = v3(0, 1, 0)
    const lift = g.stepHeight * g.legLength * g.scale * (1 + 0.3 * this.runBlend)
    const moving = this.gait !== 'idle'
    const cycling = moving || this.settling
    let worst = 0
    c.limbs.forEach((l, k) => {
      const st = this.legs[k]
      const F = this.frameAt(l.anchor.x)
      const H = uprightFrame(F.o, v3(F.t.x, 0, F.t.z))
      const hip = inFrame(F, l.anchor.off)
      this.setJoint(l.joints[0], hip)
      const out = dirInFrame(H, l.outward)
      let ikRoot = hip
      if (g.legSegments >= 4) {
        const cl = Math.cos((20 * Math.PI) / 180)
        const sl = Math.sin((20 * Math.PI) / 180)
        ikRoot = add(hip, scale(add(scale(out, cl), scale(up, sl)), l.lengths[0]))
        this.setJoint(l.joints[1], ikRoot)
      }
      const lf = g.legSegments >= 3 ? l.lengths[l.lengths.length - 1] : 0
      const ao = l.ankleOffset
      const ankleVec = add(add(scale(H.t, ao.x * lf), scale(out, ao.z * lf)), scale(up, ao.y * lf))
      // ---- the foot
      const rest = this.restToeWorld(k)
      const p = frac(this.phase + this.offsets[k])
      const swingDur = Math.max(0.12, (1 - this.duty) * (this.settling ? 0.55 : this.cycle))
      // A planted foot the body is about to outrun steps early. The phase
      // schedule keeps feet planted only while the speed and heading it
      // planned for hold; when the creature speeds up or turns hard mid-stance
      // the hip runs away from the foot, and a real animal steps.
      if (st.planted && cycling && st.early <= 0 && dist(ikRoot, add(st.toe, ankleVec)) > 0.96 * (l.a + l.b)) {
        st.early = swingDur
        st.planted = false
        st.liftoff = { ...st.toe }
        this.earlySteps++
      }
      const phaseStance = !cycling || p < this.duty
      if (st.early > 0) {
        st.early -= dt
        const s = clamp(1 - st.early / swingDur, 0, 1)
        this.swingFoot(st, rest, velocity, s, swingDur, lift)
        if (st.early <= 0) {
          this.plant(st, l.side)
          // Hold it down until the schedule next calls for a stance, then rejoin it.
          st.hold = !phaseStance
        }
      } else if (phaseStance || st.hold) {
        if (phaseStance) st.hold = false
        if (!st.planted) this.plant(st, l.side)
        st.swing = 0
      } else {
        if (st.planted) {
          st.planted = false
          st.liftoff = { ...st.toe }
        }
        const s = clamp((p - this.duty) / Math.max(1 - this.duty, 1e-6), 0, 1)
        this.swingFoot(st, rest, this.settling ? v3() : velocity, s, swingDur, lift)
      }
      // ---- the leg
      const target = lf > 0 ? add(st.toe, ankleVec) : st.toe
      const pole = norm(add(add(scale(H.t, l.pole.x), scale(up, l.pole.y)), scale(out, l.pole.z)))
      const sol = solveTwoBone(ikRoot, target, l.a, l.b, pole)
      this.setJoint(l.joints[l.ikRoot + 1], sol.mid)
      this.setJoint(l.joints[l.ikEnd], sol.end)
      const toe = lf > 0 ? sub(sol.end, ankleVec) : sol.end
      this.setJoint(l.joints[l.joints.length - 1], toe)
      st.error = st.planted ? dist(toe, st.toe) : 0
      worst = Math.max(worst, st.error)
      if (l.digits.length) {
        const dl = 0.16 * g.legLength * g.scale
        l.digits.forEach((d, i) => {
          const dir = yaw(out, ((i - 1) * 35 * Math.PI) / 180)
          this.setJoint(d, v3(toe.x + dir.x * dl, toe.y + 0.02 + (st.planted ? 0 : -0.3 * dl), toe.z + dir.z * dl))
        })
      }
    })
    this.contactError = Math.max(worst, this.contactError * Math.exp(-dt * 3))
  }

  private plant(st: LegState, side: number) {
    st.planted = true
    st.toe = v3(st.toe.x, 0, st.toe.z)
    this.footprints.push({ x: st.toe.x, z: st.toe.z, heading: this.heading, side })
    if (this.footprints.length > 160) this.footprints.shift()
    this.footprintCount++
  }

  /** A swing at progress s: a half-sine arc to where the rest position will be half a stance after landing. */
  private swingFoot(st: LegState, rest: V3, velocity: V3, s: number, swingDur: number, lift: number) {
    st.swing = s
    const ahead = (1 - s) * swingDur + (this.duty * this.cycle) / 2
    const target = addScaled(rest, velocity, ahead)
    const e = s * s * (3 - 2 * s)
    const flat = lerp(st.liftoff, target, e)
    st.toe = v3(flat.x, Math.sin(Math.PI * s) * lift, flat.z)
  }

  private poseAppendages(dt: number) {
    const c = this.c
    // Antennae: Verlet point masses pulled toward their rest pose, held at length.
    c.antennae.forEach((a, k) => {
      const st = this.antenna[k]
      const socket = inFrame(this.headFrame, a.base)
      const d = dirInFrame(this.headFrame, a.dir)
      st.p[0] = socket
      st.q[0] = socket
      if (dt > 0) {
        const pull = 60 * a.stiffness * dt * dt
        const sag = 3 * dt * dt * (1.2 - Math.min(1, a.stiffness))
        for (let i = 1; i < st.p.length; i++) {
          const rest = addScaled(socket, d, a.segment * i)
          const p = st.p[i]
          const v = scale(sub(p, st.q[i]), 0.9)
          st.q[i] = p
          st.p[i] = v3(p.x + v.x + (rest.x - p.x) * pull, p.y + v.y + (rest.y - p.y) * pull - sag, p.z + v.z + (rest.z - p.z) * pull)
        }
      }
      for (let i = 1; i < st.p.length; i++) {
        const dir = norm(sub(st.p[i], st.p[i - 1]))
        st.p[i] = addScaled(st.p[i - 1], dir, a.segment)
      }
      a.joints.forEach((j, i) => this.setJoint(j, st.p[i]))
    })
    // Wings: folded along the back, half open and beating at a run for balance.
    for (const w of c.wings) {
      const F = this.frameAt(w.anchor.x)
      const root = inFrame(F, w.anchor.off)
      this.setJoint(w.joints[0], root)
      const open = 0.08 + 0.7 * this.runBlend + 0.04 * Math.sin(this.time * 0.8)
      const beat = this.runBlend * 0.5 * Math.sin(TAU * this.time * 2.6)
      w.folded.forEach((fd, i) => {
        const sd = w.spread[i]
        const m = norm(lerp(fd, sd, open))
        const cs = Math.cos(beat)
        const sn = Math.sin(beat)
        const r = v3(m.x, m.y * cs + w.side * m.z * sn, m.z * cs - w.side * m.y * sn)
        this.setJoint(w.joints[i + 1], addScaled(root, dirInFrame(F, r), w.lengths[i]))
      })
    }
    // Fronds: swept back with speed, swaying with a lag that grows to the tips.
    const drag = this.speed / (this.speed + 1.5)
    c.fronds.forEach((fr, k) => {
      const F = this.frameAt(fr.anchor.x)
      const base = inFrame(F, fr.anchor.off)
      const at: V3[] = [base]
      this.setJoint(fr.joints[0], base)
      for (let i = 1; i < fr.rest.length; i++) {
        const dpt = fr.depth[i]
        const rel = sub(fr.rest[i], fr.rest[fr.parents[i]])
        const pitch = (0.35 * drag + 0.07 * Math.sin(this.time * 1.7 + k - 0.8 * dpt)) * dpt
        const roll = 0.1 * Math.sin(this.time * 1.3 + k * 0.7 - 0.7 * dpt) * dpt
        const cp = Math.cos(pitch)
        const sp = Math.sin(pitch)
        const r1 = v3(rel.x * cp - rel.y * sp, rel.x * sp + rel.y * cp, rel.z)
        const cr = Math.cos(roll)
        const sr = Math.sin(roll)
        const r2 = v3(r1.x, r1.y * cr - r1.z * sr, r1.y * sr + r1.z * cr)
        at[i] = add(at[fr.parents[i]], dirInFrame(F, r2))
        this.setJoint(fr.joints[i], at[i])
      }
    })
  }
}
