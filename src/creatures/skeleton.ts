import { mulberry32 } from '../noise'
import { legRatios, legSplay, repair, type Genome } from './genome'
import { solveTwoBone } from './ik'
import { add, norm, scale, v3, yaw, type V3 } from './vec'

/**
 * Genotype to phenotype: the creature's whole structure, built from a genome.
 *
 * Everything is in the **body frame** at rest: x forward, y up, z to the
 * creature's right, the ground at y = 0. Animation never rebuilds any of
 * this; it poses it (animate.ts).
 *
 * The structure is a hierarchy, rooted at the middle of the torso:
 *
 *   Root
 *   ├── Spine forward → chest → Head → eyes, antennae
 *   ├── Spine backward → tail base → … → tail tip
 *   └── on spine joints: hips → (coxa) → knee → (ankle) → toe → (digits)
 *                         wing roots → finger tips
 *                         frond roots → branches
 *
 * Appendages are not decoration placed near the body: each hangs from an
 * **anchor** — a position along the spine plus an offset in the spine's local
 * frame — so when the spine bends, sways or follows a path, everything on it
 * goes with it.
 */
export type JointKind =
  | 'root'
  | 'spine'
  | 'tail'
  | 'head'
  | 'hip'
  | 'coxa'
  | 'knee'
  | 'ankle'
  | 'toe'
  | 'digit'
  | 'eye'
  | 'antenna'
  | 'wing'
  | 'frond'

export type Joint = { id: number; name: string; kind: JointKind; parent: number; bind: V3 }

/** A point on the spine plus an offset in the spine's frame: (forward, up, right). */
export type Anchor = { x: number; off: V3 }

export type Limb = {
  index: number
  name: string
  /** −1 left, +1 right; radial legs take the side they stand on. */
  side: number
  /** 0 is the front pair (bilateral) or the leg nearest straight ahead (radial). */
  pair: number
  /** Around the body, for radial creatures; ±π/2 for bilateral ones. */
  angle: number
  anchor: Anchor
  /** Joint ids from the hip to the toe. */
  joints: number[]
  /** Bone lengths, hip to toe; one fewer than the joints. */
  lengths: number[]
  /** Indices into `joints` of the IK root and the IK end. */
  ikRoot: number
  ikEnd: number
  /** Thigh and shin: the two bones the IK solves. */
  a: number
  b: number
  /** The horizontal direction the foot splays toward, in the body frame. */
  outward: V3
  /** Where the toe rests, body frame, on the ground. */
  restToe: V3
  /** Toe to ankle, in (forward, up, outward) coefficients; zero for two-bone legs. */
  ankleOffset: V3
  /** The way the knee bends, in (forward, up, outward) coefficients. */
  pole: V3
  digits: number[]
  /**
   * How far a planted foot may travel front to back past its hip before the
   * leg is straight (at 95% of reach, leaving room for sway). A leg whose
   * resting foot already sits forward of its hip has less room ahead.
   */
  travel: number
}

export type Eye = { joint: number; radius: number; /** head frame (forward, up, right) */ pos: V3; dir: V3 }
export type Antenna = { joints: number[]; base: V3; dir: V3; segment: number; stiffness: number; r0: number }
export type Wing = { side: number; anchor: Anchor; joints: number[]; spread: V3[]; folded: V3[]; lengths: number[] }
export type Frond = { anchor: Anchor; joints: number[]; parents: number[]; rest: V3[]; depth: number[]; radius: number }
export type Bone = { a: number; b: number; r0: number; r1: number; part: 'leg' | 'digit' | 'antenna' | 'wing' | 'frond' }

/** A ring of skin around the spine: its position along the body and its two half-girths. */
export type Ring = { x: number; hw: number; hh: number; stripe: number }

export type Creature = {
  genome: Genome
  joints: Joint[]
  root: number
  /** Spine joint ids, tail tip to head. */
  spine: number[]
  spineX: number[]
  head: number
  headRadii: V3
  /** Joint ids of the tail, tip first; empty without one. */
  tail: number[]
  limbs: Limb[]
  eyes: Eye[]
  antennae: Antenna[]
  wings: Wing[]
  fronds: Frond[]
  bones: Bone[]
  rings: Ring[]
  /** Height of the spine above the ground at rest. */
  bodyY: number
  /**
   * How far the spine may sway sideways and bob down while a foot is planted.
   * Both move the hip away from a foot that cannot move, so both are taken
   * out of each leg's travel budget — and sway is capped at a share of the
   * shortest leg's reach so a wide, short-legged body cannot sway its feet
   * off the ground.
   */
  swayAmp: number
  bobAmp: number
  /** Torso length, and nose to tail tip. */
  length: number
  totalLength: number
  width: number
  height: number
  /** Body segments as drawn: one for a continuous body. */
  segments: number
  /** Named points where appendages are fixed, for the debug overlay. */
  attachments: { label: string; joint: number }[]
  senses: Senses
  traits: Traits
}

export type Senses = {
  /** Field of view, degrees; 0 without eyes. */
  fov: number
  /** Sight range, world units. */
  sight: number
  /** All-round sense from antennae; 0 without. */
  smell: number
  /** Touch: anything this close is felt, whatever the eyes see. */
  touch: number
}

/**
 * Traits read off the body, not set: the same genome numbers that shape the
 * mesh decide how heavy it is and what it costs to move. This is the
 * lecture's "traits" layer — speed, strength, energy — as consequences.
 */
export type Traits = {
  /** Body volume, as mass at density 1. */
  mass: number
  /** How far a planted foot can travel past its hip: the longest stance the legs allow. */
  footTravel: number
  /** Energy per unit distance at walking pace: mass over a leg-length-scaled efficiency. */
  costPerUnit: number
  /** Supporting legs per unit mass, a stand-in for strength. */
  strength: number
}

const TAU = Math.PI * 2
const deg = Math.PI / 180

/** The half-girth profile along the torso, t ∈ [0, 1] rear to front, before width and height. */
function torsoProfile(g: Genome, sizes: number[]): (t: number) => number {
  const n = sizes.length
  const smooth = (t: number) => {
    // Catmull-Rom-free: cosine interpolation between per-segment sizes.
    const p = Math.min(n - 1, Math.max(0, t * n - 0.5))
    const i = Math.floor(p)
    const f = p - i
    const w = (1 - Math.cos(Math.PI * f)) / 2
    return sizes[i] * (1 - w) + sizes[Math.min(n - 1, i + 1)] * w
  }
  if (g.topology === 'segmented') {
    return (t) => {
      const k = Math.min(n - 1, Math.floor(t * n))
      const local = t * n - k
      // Each segment bulges and pinches toward its ends. The envelope keeps
      // the end segments a little smaller, so the body reads as one animal.
      const bulge = 0.5 + 0.5 * Math.pow(Math.sin(Math.PI * local), 0.6)
      return bulge * sizes[k] * (0.82 + 0.18 * Math.sin(Math.PI * t))
    }
  }
  if (g.topology === 'branching') return (t) => Math.pow(Math.sin(Math.PI * (0.05 + 0.9 * t)), 0.45) * smooth(t)
  return (t) => Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * t)), 0.5) * smooth(t)
}

export function buildCreature(raw: Genome): Creature {
  // Every genome is repaired on the way in: a phenotype is only ever built
  // from one that holds together.
  const g = repair(raw)
  const rand = mulberry32(g.bodySeed * 2654435761 + 11)
  const S = g.scale
  const L = g.bodyLength * S
  const W = g.bodyWidth * S
  const H = g.bodyHeight * S
  const segCount = g.topology === 'segmented' ? g.segments : Math.max(2, g.segments)
  const sizes = Array.from({ length: segCount }, () => 1 + 0.45 * g.segmentVariation * (2 * rand() - 1))
  const torso = torsoProfile(g, sizes)
  const halfW = (x: number) => (W / 2) * torso(Math.min(1, Math.max(0, x / L + 0.5)))
  const halfH = (x: number) => (H / 2) * torso(Math.min(1, Math.max(0, x / L + 0.5)))
  let hhMax = 0
  for (let i = 0; i <= 64; i++) hhMax = Math.max(hhMax, halfH(-L / 2 + (L * i) / 64))

  const headW = g.headSize * W
  const headRadii = v3(headW * 0.55, Math.min(headW * 0.42, H * 0.6 + headW * 0.15), headW * 0.5)
  const headX = L / 2 + headRadii.x * 0.7
  const T = g.tail ? g.tailLength * L : 0

  const joints: Joint[] = []
  const addJoint = (name: string, kind: JointKind, parent: number, bind: V3) => {
    joints.push({ id: joints.length, name, kind, parent, bind })
    return joints.length - 1
  }

  // ---------------------------------------------------------------- legs first, for the ride height
  const asym = g.symmetry === 'asymmetric'
  const radial = g.symmetry === 'radial' && g.legs >= 4
  const sprawl = legSplay(g) > 0.3
  const ratios = legRatios(g.legSegments)
  type LegPlan = {
    side: number
    pair: number
    angle: number
    x: number
    off: V3
    outward: V3
    lengths: number[]
    pole: V3
    ankleOffset: V3
  }
  const plans: LegPlan[] = []
  const pairs = g.legs / 2
  if (radial) {
    for (let k = 0; k < g.legs; k++) {
      const a = (TAU * (k + 0.5)) / g.legs
      const x = Math.cos(a) * (L / 2) * 0.55
      const side = Math.sin(a) >= 0 ? 1 : -1
      const factor = 1
      plans.push({
        side,
        pair: k,
        angle: a,
        x,
        off: v3(0, -0.3 * halfH(x), Math.sin(a) * halfW(x) * 0.85),
        outward: norm(v3(Math.cos(a), 0, Math.sin(a))),
        lengths: ratios.map((r) => r * g.legLength * S * factor),
        pole: v3(0, 1, 0.6),
        ankleOffset: g.legSegments === 3 ? v3(-0.3, 0.95, 0) : g.legSegments === 4 ? v3(0, 0.6, -0.8) : v3(),
      })
    }
  } else if (pairs > 0) {
    // Pair centres along the torso, front first, then snapped to segments.
    const centre = (g.legPlacement - 0.5) * L * 0.8
    const spread = pairs > 1 ? g.legSpread * L * 0.85 : 0
    let xs = Array.from({ length: pairs }, (_, i) => centre + spread * (0.5 - (pairs > 1 ? i / (pairs - 1) : 0.5)))
    xs = xs.map((x) => Math.min(L * 0.44, Math.max(-L * 0.44, x)))
    if (g.topology === 'segmented') {
      // One pair per segment, in order: the nearest free segment to each.
      const centres = Array.from({ length: segCount }, (_, k) => -L / 2 + ((k + 0.5) * L) / segCount)
      const toIndex = (x: number) => Math.round((x + L / 2) / (L / segCount) - 0.5)
      let prev = segCount
      xs = xs.map((x, i) => {
        const left = pairs - 1 - i
        const k = Math.max(left, Math.min(prev - 1, toIndex(x)))
        prev = k
        return centres[k]
      })
    }
    for (let i = 0; i < pairs; i++) {
      for (const side of [-1, 1]) {
        // Asymmetric bodies roll each leg's length and attachment separately.
        const factor = asym ? 0.82 + 0.36 * rand() : 1
        const x = xs[i] + (asym ? (rand() - 0.5) * 0.12 * L : 0)
        // Sprawling legs fan out: the front pair reaches forward, the back pair back.
        const fan = sprawl && pairs > 1 ? 0.7 * (0.5 - i / (pairs - 1)) * 2 : 0
        const front = pairs > 1 && i < pairs / 2
        plans.push({
          side,
          pair: i,
          angle: side * (Math.PI / 2),
          x,
          off: v3(0, -0.35 * halfH(x), side * halfW(x) * 0.8),
          outward: norm(v3(fan, 0, side)),
          lengths: ratios.map((r) => r * g.legLength * S * factor),
          // Mammal-like: hind knees forward, front elbows back. Sprawling: knees up and out.
          pole: sprawl ? v3(0, 1, 0.5) : front ? v3(-1, 0.1, 0.15) : v3(1, 0.1, 0.15),
          ankleOffset: g.legSegments === 3 ? (sprawl ? v3(0, 0.95, -0.3) : v3(-0.53, 0.85, 0)) : g.legSegments === 4 ? v3(0, 0.6, -0.8) : v3(),
        })
      }
    }
  }

  // The ride height: the body sits where every foot stands at 80% of its
  // reach, splayed out by `legSplay`. The lowest such height wins, so every
  // leg can reach; the others bend a little less.
  const coxaLift = 20 * deg
  const ikRootOffset = (p: LegPlan): V3 =>
    g.legSegments >= 4 ? add(p.off, v3(p.outward.x * p.lengths[0] * Math.cos(coxaLift), p.lengths[0] * Math.sin(coxaLift), p.outward.z * p.lengths[0] * Math.cos(coxaLift))) : p.off
  const legAB = (p: LegPlan) => (g.legSegments >= 4 ? [p.lengths[1], p.lengths[2]] : [p.lengths[0], p.lengths[1]])
  const footLen = (p: LegPlan) => (g.legSegments >= 3 ? p.lengths[p.lengths.length - 1] : 0)
  let bodyY = hhMax * 0.92
  if (plans.length) {
    bodyY = Infinity
    const splay = legSplay(g)
    for (const p of plans) {
      const [a, b] = legAB(p)
      const R = a + b
      const v = Math.sqrt(Math.max(0, 0.64 * R * R - (splay * R) ** 2))
      const ankleY = p.ankleOffset.y * footLen(p)
      bodyY = Math.min(bodyY, v + ankleY - ikRootOffset(p).y)
    }
    bodyY = Math.max(bodyY, hhMax * 0.9)
  }

  const minReach = plans.length ? Math.min(...plans.map((p) => legAB(p)[0] + legAB(p)[1])) : 0
  const swayAmp = plans.length ? Math.min(0.2 * W * g.sway, 0.12 * minReach) : 0.85 * W * g.sway
  const bobAmp = plans.length ? g.stepHeight * g.legLength * S * 0.22 : 0

  // ---------------------------------------------------------------- spine
  const spineX: number[] = []
  const tailCount = g.tail ? g.tailSegments : 0
  for (let k = tailCount; k >= 1; k--) spineX.push(-L / 2 - (T * k) / tailCount)
  const torsoJoints = g.topology === 'segmented' ? 2 * segCount + 1 : g.topology === 'branching' ? Math.max(4, segCount + 1) : Math.max(5, segCount + 3)
  for (let k = 0; k < torsoJoints; k++) spineX.push(-L / 2 + (L * k) / (torsoJoints - 1))
  spineX.push(headX)

  const root = addJoint('Root', 'root', -1, v3(0, bodyY, 0))
  // The spine as a hierarchy outward from the root: the nearest joint to the
  // middle hangs from it, and each joint hangs from its neighbour toward it.
  const mid = spineX.reduce((best, x, i) => (Math.abs(x) < Math.abs(spineX[best]) ? i : best), 0)
  const spine: number[] = new Array(spineX.length)
  const torsoStart = tailCount
  const nameOf = (i: number) => (i === spineX.length - 1 ? 'Head' : i < torsoStart ? `Tail ${torsoStart - i}` : `Spine ${i - torsoStart + 1}`)
  const kindOf = (i: number): JointKind => (i === spineX.length - 1 ? 'head' : i < torsoStart ? 'tail' : 'spine')
  spine[mid] = addJoint(nameOf(mid), kindOf(mid), root, v3(spineX[mid], bodyY, 0))
  for (let i = mid + 1; i < spineX.length; i++) spine[i] = addJoint(nameOf(i), kindOf(i), spine[i - 1], v3(spineX[i], bodyY, 0))
  for (let i = mid - 1; i >= 0; i--) spine[i] = addJoint(nameOf(i), kindOf(i), spine[i + 1], v3(spineX[i], bodyY, 0))
  const head = spine[spine.length - 1]
  const tail = spine.slice(0, tailCount)
  const nearestSpine = (x: number) => spine[spineX.reduce((best, sx, i) => (Math.abs(sx - x) < Math.abs(spineX[best] - x) ? i : best), torsoStart)]
  const atAnchor = (a: Anchor): V3 => v3(a.x + a.off.x, bodyY + a.off.y, a.off.z)

  // ---------------------------------------------------------------- limbs
  const bones: Bone[] = []
  const attachments: { label: string; joint: number }[] = []
  const limbs: Limb[] = []
  const legRadius = Math.max(0.035 * S, 0.075 * g.legLength * S * (0.6 + 0.4 * g.bodyWidth))
  plans.forEach((p, index) => {
    const label = radial ? `Leg ${index + 1}` : `Leg ${p.side < 0 ? 'L' : 'R'}${p.pair + 1}`
    const anchor: Anchor = { x: p.x, off: p.off }
    const hipPos = atAnchor(anchor)
    const ids: number[] = []
    const hip = addJoint(`${label} hip`, 'hip', nearestSpine(p.x), hipPos)
    ids.push(hip)
    attachments.push({ label: `${label} hip`, joint: hip })
    const rootOff = ikRootOffset(p)
    const ikRootPos = v3(p.x + rootOff.x, bodyY + rootOff.y, rootOff.z)
    if (g.legSegments >= 4) ids.push(addJoint(`${label} coxa`, 'coxa', hip, ikRootPos))
    const [a, b] = legAB(p)
    const lf = footLen(p)
    const ankleUp = p.ankleOffset.y * lf
    const v = ikRootPos.y - ankleUp
    const R = a + b
    const h = Math.sqrt(Math.max((0.1 * R) ** 2, (0.8 * R) ** 2 - v * v))
    const ankle = v3(ikRootPos.x + p.outward.x * h, ankleUp, ikRootPos.z + p.outward.z * h)
    // The foot offset is in (forward, up, outward) coefficients.
    const fo = p.ankleOffset
    const toAnkle = v3(fo.x * lf + p.outward.x * fo.z * lf, fo.y * lf, p.outward.z * fo.z * lf)
    const toe = v3(ankle.x - toAnkle.x, 0, ankle.z - toAnkle.z)
    const poleBody = norm(v3(p.pole.x + p.outward.x * p.pole.z, p.pole.y, p.outward.z * p.pole.z))
    const solved = solveTwoBone(ikRootPos, lf > 0 ? ankle : toe, a, b, poleBody)
    const ikRoot = ids.length - 1
    ids.push(addJoint(`${label} knee`, 'knee', ids[ids.length - 1], solved.mid))
    if (lf > 0) {
      ids.push(addJoint(`${label} ankle`, 'ankle', ids[ids.length - 1], ankle))
      ids.push(addJoint(`${label} toe`, 'toe', ids[ids.length - 1], toe))
    } else ids.push(addJoint(`${label} toe`, 'toe', ids[ids.length - 1], toe))
    const ikEnd = lf > 0 ? ids.length - 2 : ids.length - 1
    const lengths = p.lengths.slice()
    const ikTarget = lf > 0 ? ankle : toe
    const dx = ikTarget.x - ikRootPos.x
    // The worst the hip gets from a planted foot: rest offset, plus the full
    // sway sideways and the full bob downward.
    const rest2 = (Math.abs(ikTarget.y - ikRootPos.y) + bobAmp) ** 2 + (Math.abs(ikTarget.z - ikRootPos.z) + swayAmp) ** 2
    // 0.9: a margin for turning, where the outside legs of a bending body
    // travel further than the centre does.
    const travel = 0.9 * 2 * Math.max(0.05 * R, Math.sqrt(Math.max(0, (0.95 * R) ** 2 - rest2)) - Math.abs(dx))
    for (let k = 0; k < ids.length - 1; k++) {
      const t = k / Math.max(1, ids.length - 2)
      bones.push({ a: ids[k], b: ids[k + 1], r0: legRadius * (1 - 0.45 * t), r1: legRadius * (1 - 0.45 * (k + 1) / Math.max(1, ids.length - 1)), part: 'leg' })
    }
    // Branching creatures fork at the toe: three short digits, a branching
    // structure carried on the ends of the limbs.
    const digits: number[] = []
    if (g.topology === 'branching') {
      const dl = 0.16 * g.legLength * S
      for (const turn of [-35, 0, 35]) {
        const d = yaw(p.outward, turn * deg)
        const id = addJoint(`${label} digit`, 'digit', ids[ids.length - 1], v3(toe.x + d.x * dl, 0.02, toe.z + d.z * dl))
        digits.push(id)
        bones.push({ a: ids[ids.length - 1], b: id, r0: legRadius * 0.45, r1: legRadius * 0.2, part: 'digit' })
      }
    }
    limbs.push({
      index,
      name: label,
      side: p.side,
      pair: p.pair,
      angle: p.angle,
      anchor,
      joints: ids,
      lengths,
      ikRoot,
      ikEnd,
      a,
      b,
      outward: p.outward,
      restToe: toe,
      ankleOffset: p.ankleOffset,
      pole: p.pole,
      digits,
      travel,
    })
  })

  // ---------------------------------------------------------------- head: eyes and antennae
  const onHead = (az: number, el: number): { pos: V3; dir: V3 } => {
    const d = v3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az))
    const k = 1 / Math.sqrt((d.x / headRadii.x) ** 2 + (d.y / headRadii.y) ** 2 + (d.z / headRadii.z) ** 2)
    return { pos: scale(d, k), dir: d }
  }
  const eyes: Eye[] = []
  const headBind = joints[head].bind
  const eyeSpots: { az: number; el: number; size: number }[] = []
  if (radial) {
    for (let k = 0; k < g.eyes; k++) eyeSpots.push({ az: (TAU * k) / g.eyes, el: 22 * deg, size: 1 })
  } else {
    const pairsE = Math.floor(g.eyes / 2)
    if (g.eyes % 2) eyeSpots.push({ az: 0, el: 38 * deg, size: 1.15 })
    for (let j = 0; j < pairsE; j++) {
      const az = (18 + 62 * g.eyePlacement + 9 * j) * deg
      const el = (26 - 17 * j) * deg
      for (const side of [-1, 1]) {
        const jitter = asym ? { az: (rand() - 0.5) * 30 * deg, el: (rand() - 0.5) * 20 * deg, size: 0.7 + 0.6 * rand() } : { az: 0, el: 0, size: 1 }
        eyeSpots.push({ az: side * (az + jitter.az), el: el + jitter.el, size: (1 - 0.12 * j) * jitter.size })
      }
    }
  }
  eyeSpots.forEach((e, k) => {
    const r = g.eyeSize * headW * 0.5 * e.size
    const s = onHead(e.az, e.el)
    // Set into the head by a third of its radius, so it sits in a socket.
    const pos = scale(s.pos, 1 - (0.35 * r) / Math.max(Math.hypot(s.pos.x, s.pos.y, s.pos.z), 1e-6))
    const joint = addJoint(`Eye ${k + 1}`, 'eye', head, add(headBind, pos))
    eyes.push({ joint, radius: r, pos, dir: s.dir })
  })

  const antennae: Antenna[] = []
  const A = g.antennaLength * L
  const antennaSpots: { az: number; side: number }[] = []
  if (g.antennae % 2) antennaSpots.push({ az: 0, side: 0 })
  for (let j = 0; j < Math.floor(g.antennae / 2); j++) for (const side of [-1, 1]) antennaSpots.push({ az: (22 + 26 * j) * deg, side })
  antennaSpots.forEach((spot, k) => {
    const base = onHead(spot.side * spot.az + (asym ? (rand() - 0.5) * 0.4 : 0), 52 * deg).pos
    const lean = 0.25 + 0.3 * (k / Math.max(1, antennaSpots.length))
    const dir = norm(v3(0.55, 0.8, spot.side * lean))
    const n = 4
    const segment = A / n
    const ids: number[] = []
    let prev = head
    for (let i = 0; i <= n; i++) {
      const p = add(add(headBind, base), scale(dir, segment * i))
      prev = addJoint(i === 0 ? `Antenna ${k + 1} socket` : `Antenna ${k + 1}.${i}`, 'antenna', prev, p)
      ids.push(prev)
    }
    attachments.push({ label: `Antenna ${k + 1} socket`, joint: ids[0] })
    const r0 = 0.05 * headW + 0.035 * A
    for (let i = 0; i < n; i++) bones.push({ a: ids[i], b: ids[i + 1], r0: r0 * (1 - 0.7 * (i / n)), r1: r0 * (1 - 0.7 * ((i + 1) / n)), part: 'antenna' })
    // Long, thin antennae are floppy; short ones are horns.
    antennae.push({ joints: ids, base, dir, segment, stiffness: Math.min(1.6, Math.max(0.25, 0.9 - A / L + 0.6 * (r0 / segment))), r0 })
  })

  // ---------------------------------------------------------------- wings
  const wings: Wing[] = []
  if (g.wings) {
    const wx = L * 0.22
    for (const side of [-1, 1]) {
      const f = asym && side > 0 ? 0.85 : 1
      const WL = g.wingSpan * L * f
      const anchor: Anchor = { x: wx, off: v3(0, halfH(wx) * 0.8, side * halfW(wx) * 0.45) }
      const rootPos = atAnchor(anchor)
      const wingRoot = addJoint(`Wing ${side < 0 ? 'L' : 'R'} root`, 'wing', nearestSpine(wx), rootPos)
      attachments.push({ label: `Wing ${side < 0 ? 'L' : 'R'} root`, joint: wingRoot })
      const spread = [norm(v3(0.25, 0.2, side)), norm(v3(-0.3, 0.08, side * 0.95)), norm(v3(-0.8, 0.02, side * 0.6))]
      const folded = [norm(v3(-1, 0.22, side * 0.12)), norm(v3(-1, 0.16, side * 0.2)), norm(v3(-1, 0.1, side * 0.28))]
      const lengths = [WL, WL * 0.88, WL * 0.7]
      const ids = [wingRoot]
      folded.forEach((d, i) => {
        const id = addJoint(`Wing ${side < 0 ? 'L' : 'R'} finger ${i + 1}`, 'wing', wingRoot, add(rootPos, scale(d, lengths[i])))
        ids.push(id)
        bones.push({ a: wingRoot, b: id, r0: 0.04 * S, r1: 0.015 * S, part: 'wing' })
      })
      wings.push({ side, anchor, joints: ids, spread, folded, lengths })
    }
  }

  // ---------------------------------------------------------------- fronds: branching structures on the back
  const fronds: Frond[] = []
  if (g.topology === 'branching') {
    const count = Math.max(2, Math.min(5, segCount))
    for (let k = 0; k < count; k++) {
      const fx = -L * 0.32 + (L * 0.64 * k) / Math.max(1, count - 1)
      const anchor: Anchor = { x: fx, off: v3(0, halfH(fx) * 0.85, 0) }
      const trunk = (0.35 + 0.25 * rand()) * W * (0.7 + 0.3 * sizes[Math.min(sizes.length - 1, k)])
      const rest: V3[] = [v3()]
      const parents: number[] = [-1]
      const depth: number[] = [0]
      // A binary tree two levels deep: the trunk forks sideways, then each
      // branch forks fore and aft. Seven bones, each shorter than its parent.
      const grow = (from: number, dir: V3, length: number, level: number) => {
        const tip = add(rest[from], scale(dir, length))
        rest.push(tip)
        parents.push(from)
        depth.push(level)
        const me = rest.length - 1
        if (level >= 3) return
        const spreadA = (level === 1 ? 34 : 28) * deg + (asym ? (rand() - 0.5) * 0.3 : 0)
        for (const s of [-1, 1]) {
          const d =
            level === 1
              ? norm(v3(dir.x, dir.y * Math.cos(spreadA), s * Math.sin(spreadA) + dir.z))
              : norm(v3(dir.x + s * Math.sin(spreadA), dir.y * Math.cos(spreadA), dir.z))
          grow(me, d, length * 0.68, level + 1)
        }
      }
      grow(0, norm(v3(-0.25, 1, 0)), trunk, 1)
      const base = atAnchor(anchor)
      const ids = rest.map((r, i) => addJoint(i === 0 ? `Frond ${k + 1} root` : `Frond ${k + 1}.${i}`, 'frond', i === 0 ? nearestSpine(fx) : -1, add(base, r)))
      ids.forEach((id, i) => {
        if (i > 0) joints[id].parent = ids[parents[i]]
      })
      attachments.push({ label: `Frond ${k + 1} root`, joint: ids[0] })
      const radius = 0.06 * W
      for (let i = 1; i < ids.length; i++) bones.push({ a: ids[parents[i]], b: ids[i], r0: radius * Math.pow(0.62, depth[i] - 1), r1: radius * Math.pow(0.62, depth[i]), part: 'frond' })
      fronds.push({ anchor, joints: ids, parents, rest, depth, radius })
    }
  }
  if (tail.length) attachments.push({ label: 'Tail base', joint: spine[torsoStart] })

  // ---------------------------------------------------------------- skin rings
  const rings: Ring[] = []
  const rearCap = g.tail ? 0 : Math.max(halfW(-L / 2), halfH(-L / 2)) * 0.9
  const x0 = -L / 2 - T - rearCap - (g.tail ? 0.06 * S : 0)
  const x1 = headX
  const total = x1 - x0
  const n = Math.round(Math.min(220, Math.max(60, total / (0.03 * S))))
  const neckR = headW * 0.36
  const tipR = 0.03 * S
  for (let i = 0; i <= n; i++) {
    const x = x0 + (total * i) / n
    let hw: number
    let hh: number
    let stripe = 0
    if (x >= -L / 2 && x <= L / 2) {
      hw = halfW(x)
      hh = halfH(x)
      const t = x / L + 0.5
      stripe = g.topology === 'segmented' ? Math.pow(Math.abs(Math.cos(Math.PI * t * segCount)), 8) : Math.pow(Math.max(0, Math.cos(TAU * t * 2.5)), 6)
    } else if (x > L / 2) {
      // Neck: blend from the chest girth to a collar inside the head.
      const s = (x - L / 2) / (headX - L / 2)
      const w = s * s * (3 - 2 * s)
      hw = halfW(L / 2) * (1 - w) + neckR * w
      hh = halfH(L / 2) * (1 - w) + neckR * 0.85 * w
      if (i === n) hw = hh = 0
    } else if (g.tail && x >= -L / 2 - T) {
      const s = (-L / 2 - x) / T
      const taper = 1 - 0.9 * Math.pow(s, 0.85)
      hw = Math.max(tipR, halfW(-L / 2) * taper)
      hh = Math.max(tipR, halfH(-L / 2) * taper)
      stripe = Math.pow(Math.abs(Math.cos(Math.PI * s * tailCount * 0.5)), 10) * 0.8
    } else {
      // Rounded cap: the tail tip, or the rump without one.
      const end = g.tail ? -L / 2 - T : -L / 2
      const capLen = end - x0
      const d = (end - x) / Math.max(capLen, 1e-6)
      const k = Math.sqrt(Math.max(0, 1 - d * d))
      hw = (g.tail ? tipR : halfW(-L / 2)) * k
      hh = (g.tail ? tipR : halfH(-L / 2)) * k
    }
    rings.push({ x, hw, hh, stripe })
  }

  // ---------------------------------------------------------------- senses and traits
  let volume = 0
  for (let i = 1; i < rings.length; i++) volume += Math.PI * rings[i].hw * rings[i].hh * (rings[i].x - rings[i - 1].x)
  volume += (4 / 3) * Math.PI * headRadii.x * headRadii.y * headRadii.z
  const fov = g.eyes === 0 ? 0 : radial ? 360 : Math.min(340, 120 + 180 * g.eyePlacement + 8 * Math.max(0, g.eyes - 2))
  const senses: Senses = {
    fov,
    sight: g.eyes === 0 ? 0 : g.detection * (0.75 + g.eyeSize) * Math.sqrt(S),
    smell: g.antennae === 0 ? 0 : 1.2 * A + 0.5 * L,
    touch: 0.6 * L + headRadii.x,
  }
  const reach = limbs.length ? Math.min(...limbs.map((l) => l.a + l.b)) : 0
  const traits: Traits = {
    mass: volume,
    footTravel: limbs.length ? Math.min(...limbs.map((l) => l.travel)) : 0,
    costPerUnit: volume / (limbs.length ? 0.6 + 0.4 * Math.min(1, reach / L) * Math.sqrt(limbs.length) : 0.8),
    strength: limbs.length ? (limbs.length * reach) / Math.max(volume, 1e-3) : 0,
  }

  return {
    genome: g,
    joints,
    root,
    spine,
    spineX,
    head,
    headRadii,
    tail,
    limbs,
    eyes,
    antennae,
    wings,
    fronds,
    bones,
    rings,
    bodyY,
    swayAmp,
    bobAmp,
    length: L,
    totalLength: headX + headRadii.x - x0,
    width: W,
    height: H,
    segments: g.topology === 'segmented' ? segCount : 1,
    attachments,
    senses,
    traits,
  }
}
