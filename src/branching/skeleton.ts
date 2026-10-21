import * as THREE from 'three'
import { mulberry32 } from '../noise'

/**
 * The turtle: a string in, a branch graph out.
 *
 * A turtle walks the string one symbol at a time, carrying a position and an
 * orientation. `F` moves it forward and leaves a segment behind; `+` and `-`
 * turn it; `[` saves where it is and `]` jumps back there, which is the whole
 * of branching — a bracket is a side trip that returns to the junction it
 * started from.
 *
 * | Symbol | Meaning |
 * | --- | --- |
 * | `F` | Move forward one segment, drawing it |
 * | `f` | Move forward without drawing |
 * | `+` `-` | Turn about the turtle's up axis — the textbook's left and right |
 * | `&` `^` | Pitch down and up |
 * | `/` `\` | Roll about the heading |
 * | `\|` | Turn around |
 * | `[` `]` | Push and pop the turtle's state |
 * | anything else | Nothing; a placeholder the grammar rewrites, like `X` |
 *
 * ## Generation is bracket depth
 *
 * A segment's generation is how many `[` are open when it is drawn: the trunk
 * is drawn at depth 0, a branch off it at depth 1, a branch off that at 2. That
 * is the one structural fact the colour-by-generation view shows, the length
 * and thickness decays act on, and the LOD levels cut along.
 *
 * ## Why a 2D grammar still makes a 3D tree
 *
 * The textbook grammars only use `+` and `-`, which turn in one plane: drawn
 * literally, every one of them is a pressed flower. Each new branch is
 * therefore rolled about its heading as it starts — by the *branch roll*,
 * times how many branches came before it. At 137.5°, the golden angle, no two
 * branches line up for a long time, which is how real plants arrange leaves
 * around a stem. Set the roll to 0 and the page draws the flat figure from the
 * book, which is the clearest way to show what the roll is doing.
 */
export type TurtleParams = {
  /** Degrees per `+` or `-`. */
  angle: number
  /** Length of a generation-0 `F`, in world units. */
  segmentLength: number
  /** Each generation's segments are this fraction of the previous one's. */
  lengthDecay: number
  /** Radius of the trunk at the ground. */
  trunkRadius: number
  /** Each generation's radius is this fraction of the previous one's. */
  thicknessDecay: number
  /** Degrees of uniform random added to every turn. */
  angleJitter: number
  /** Fraction of random added to every segment's length. */
  lengthJitter: number
  /** Degrees each new branch is rolled by, times the branch's index. */
  branchRoll: number
  /** Positive bends growth toward the sky, negative lets it droop. */
  tropism: number
  seed: number
}

export type Segment = {
  a: THREE.Vector3
  b: THREE.Vector3
  generation: number
  /** The unbroken run of segments this one belongs to — one limb. */
  chain: number
  r0: number
  r1: number
}

export type LeafSite = {
  position: THREE.Vector3
  /** Index of the segment it hangs from, so a partial draw can hide it. */
  segment: number
  generation: number
  /** Random rotation and size, drawn once so every LOD agrees. */
  yaw: number
  tilt: number
  size: number
}

export type Skeleton = {
  segments: Segment[]
  maxGeneration: number
  /** Each generation's starting radius as a fraction of the trunk's. */
  relativeRadius: (generation: number) => number
  height: number
  /** Horizontal reach from the trunk, for culling and the LOD rings. */
  radius: number
  /** Centre of the drawn segments' bounding box. */
  centre: THREE.Vector3
  ms: number
  truncated: boolean
}

/**
 * Hard ceiling on segments. A grammar under MAX_SYMBOLS can still be almost
 * entirely `F`; past this a single tree's mesh would be millions of
 * triangles, which is no longer a playground setting.
 */
export const MAX_SEGMENTS = 40_000

const DEG = Math.PI / 180
const X = new THREE.Vector3(1, 0, 0)
const Y = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)

type Turtle = {
  position: THREE.Vector3
  orientation: THREE.Quaternion
  generation: number
  chain: number
  /** Distance travelled along the current chain, for the taper. */
  along: number
}

export function interpret(text: string, params: TurtleParams): Skeleton {
  const started = performance.now()
  const rand = mulberry32(params.seed * 7919 + 17)
  const turn = new THREE.Quaternion()
  const heading = new THREE.Vector3()
  const bent = new THREE.Vector3()
  const segments: Segment[] = []
  const chainLength: number[] = [0]
  const stack: Turtle[] = []
  let branchIndex = 0
  let truncated = false

  let turtle: Turtle = {
    position: new THREE.Vector3(),
    orientation: new THREE.Quaternion(),
    generation: 0,
    chain: 0,
    along: 0,
  }

  // Every turn and every step draws its random number whether jitter is on or
  // not. Drawn only when needed, moving a jitter slider off zero would change
  // which number every later symbol got, and the tree would jump to a
  // different shape instead of bending smoothly away from the regular one.
  const jitter = () => (rand() * 2 - 1) * params.angleJitter * DEG
  const rotate = (axis: THREE.Vector3, radians: number) =>
    turtle.orientation.multiply(turn.setFromAxisAngle(axis, radians))

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    switch (c) {
      case 'F':
      case 'f': {
        const scale = params.lengthDecay ** turtle.generation
        const length = params.segmentLength * scale * (1 + (rand() * 2 - 1) * params.lengthJitter)
        heading.copy(Y).applyQuaternion(turtle.orientation)
        const start = turtle.position.clone()
        turtle.position.addScaledVector(heading, length)
        if (c === 'F') {
          if (segments.length >= MAX_SEGMENTS) {
            truncated = true
            break
          }
          const along = turtle.along + length
          segments.push({ a: start, b: turtle.position.clone(), generation: turtle.generation, chain: turtle.chain, r0: turtle.along, r1: along })
          chainLength[turtle.chain] = along
          turtle.along = along
        }
        // Tropism bends the heading toward (or away from) the sky in
        // proportion to how far the turtle just moved, so a limb drawn as many
        // short steps bends exactly as much as one drawn as a few long ones.
        if (params.tropism !== 0) {
          bent.copy(heading).addScaledVector(Y, params.tropism * length).normalize()
          turtle.orientation.premultiply(turn.setFromUnitVectors(heading, bent))
        }
        break
      }
      case '+':
        rotate(Z, params.angle * DEG + jitter())
        break
      case '-':
        rotate(Z, -params.angle * DEG + jitter())
        break
      case '&':
        rotate(X, params.angle * DEG + jitter())
        break
      case '^':
        rotate(X, -params.angle * DEG + jitter())
        break
      case '/':
        rotate(Y, params.angle * DEG + jitter())
        break
      case '\\':
        rotate(Y, -params.angle * DEG + jitter())
        break
      case '|':
        rotate(Z, Math.PI)
        break
      case '[': {
        stack.push({ ...turtle, position: turtle.position.clone(), orientation: turtle.orientation.clone() })
        branchIndex++
        chainLength.push(0)
        turtle = { ...turtle, generation: turtle.generation + 1, chain: chainLength.length - 1, along: 0 }
        rotate(Y, params.branchRoll * branchIndex * DEG + jitter())
        break
      }
      case ']': {
        const saved = stack.pop()
        if (saved) turtle = saved
        break
      }
    }
    if (truncated) break
  }

  // The taper. A limb starts at its generation's radius and narrows to the
  // next generation's at its tip, so where a branch leaves a limb the two are
  // roughly the same thickness and the joint does not step. r0 and r1 held
  // the distance along the chain until here; they become radii now that each
  // chain's total length is known.
  const radiusAt = (generation: number) => params.trunkRadius * params.thicknessDecay ** generation
  let maxGeneration = 0
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  let radius = 0
  for (const s of segments) {
    const total = chainLength[s.chain] || 1
    const from = radiusAt(s.generation)
    const to = radiusAt(s.generation + 1)
    const t0 = s.r0 / total
    const t1 = s.r1 / total
    s.r0 = from + (to - from) * t0
    s.r1 = from + (to - from) * t1
    maxGeneration = Math.max(maxGeneration, s.generation)
    min.min(s.a).min(s.b)
    max.max(s.a).max(s.b)
    radius = Math.max(radius, Math.hypot(s.b.x, s.b.z))
  }
  if (!segments.length) {
    min.set(0, 0, 0)
    max.set(0, 0, 0)
  }

  return {
    segments,
    maxGeneration,
    relativeRadius: (generation) => params.thicknessDecay ** generation,
    height: Math.max(max.y, 0.01),
    radius: Math.max(radius, 0.01),
    centre: min.clone().add(max).multiplyScalar(0.5),
    ms: performance.now() - started,
    truncated,
  }
}

/**
 * Where leaves hang.
 *
 * `twigs`: on every segment of the last two generations, and on the tip of
 * every limb whatever its generation — a bare branch end reads as dead wood.
 * `tips`: on limb tips only, which is what a coral's polyps or a candelabra's
 * flowers want. `density` is the expected number of leaves per eligible
 * segment, so 1.5 means one leaf always and a second half the time. Seeded
 * separately from the turtle so that changing leaf density never moves a
 * branch.
 */
export type LeafPlacement = 'twigs' | 'tips'

export function placeLeaves(skeleton: Skeleton, density: number, seed: number, placement: LeafPlacement = 'twigs'): LeafSite[] {
  const rand = mulberry32(seed * 104729 + 3)
  const sites: LeafSite[] = []
  const { segments, maxGeneration } = skeleton
  const firstLeafy = Math.max(1, maxGeneration - 1)
  segments.forEach((s, index) => {
    const next = segments[index + 1]
    const tip = !next || next.chain !== s.chain || !next.a.equals(s.b)
    const eligible = tip || (placement === 'twigs' && s.generation >= firstLeafy)
    // Draw the same number of randoms per segment whatever happens, for the
    // same reason as the turtle: density must thin leaves, not reshuffle them.
    const roll = rand()
    const t = rand()
    const yaw = rand() * Math.PI * 2
    const tilt = (rand() - 0.5) * 0.9
    const size = 0.75 + rand() * 0.5
    const jx = rand() - 0.5
    const jy = rand() - 0.5
    const jz = rand() - 0.5
    if (!eligible) return
    const whole = Math.floor(density)
    const count = whole + (roll < density - whole ? 1 : 0)
    for (let k = 0; k < count; k++) {
      // The first leaf sits at the segment's end; any more spread back along
      // it, so a dense canopy fills the twig rather than stacking at its tip.
      const along = k === 0 || placement === 'tips' ? 1 : (t + k * 0.618) % 1
      const position = s.a.clone().lerp(s.b, along)
      const spread = s.r0 * 2 + 0.06
      position.x += jx * spread * (k + 1)
      position.y += jy * spread * (k + 1)
      position.z += jz * spread * (k + 1)
      sites.push({ position, segment: index, generation: s.generation, yaw: yaw + k * 2.4, tilt, size })
    }
  })
  return sites
}
