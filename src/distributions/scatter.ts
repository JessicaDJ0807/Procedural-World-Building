import * as THREE from 'three'
import { mulberry32 } from '../noise'
import { normalAt, type StudyTerrain } from '../study/terrain'
import { ASSETS, KINDS, allFactors, groundAt, type AssetKind, type Rules } from './rules'

/**
 * Turning probability fields into instances.
 *
 * ## Candidates: a jittered grid
 *
 * Each asset lays a grid at its own spacing and jitters every point within its
 * cell. Pure uniform random points clump and leave holes by chance — Poisson
 * clumping — and those clumps would be read as the *rule* clustering, which is
 * exactly the thing this page is trying to show honestly. The grid bounds the
 * density from above; the probability decides what fraction of it survives.
 *
 * ## Acceptance
 *
 * A candidate is kept when a uniform draw falls under its probability, and
 * then only if nothing already placed is within the two keep-out radii. Trees
 * go first, then bushes, then rocks, so the order is also a priority: a bush
 * cannot land in a trunk.
 *
 * ## One seeded stream per asset
 *
 * Each asset draws from its own generator. Shared, a change to the tree rule
 * would shift every random number the bushes and rocks drew afterwards, and
 * moving one slider would reshuffle all three layers — which looks like noise,
 * not like a rule changing.
 */
export type Placement = {
  kind: AssetKind
  x: number
  y: number
  z: number
  /** Probability it was accepted at, kept for the size variation. */
  p: number
  scale: number
  yaw: number
  /** Variant index within the kind (broadleaf vs conifer, two rock shapes). */
  variant: number
  colour: THREE.Color
  /** Rocks only: tilt to sit on the slope. */
  tilt: THREE.Quaternion | null
}

export type ScatterResult = {
  placements: Record<AssetKind, Placement[]>
  candidates: Record<AssetKind, number>
  ms: number
}

const KIND_STREAM: Record<AssetKind, number> = { tree: 1, bush: 2, rock: 3 }

/** A uniform hash grid for the keep-out test. */
class Occupancy {
  private cells = new Map<number, { x: number; z: number; r: number }[]>()
  private readonly size = 0.25
  private key(i: number, j: number) {
    return (i + 4096) * 8192 + (j + 4096)
  }
  blocked(x: number, z: number, r: number): boolean {
    const i = Math.floor(x / this.size)
    const j = Math.floor(z / this.size)
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const list = this.cells.get(this.key(i + di, j + dj))
        if (!list) continue
        for (const o of list) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return true
      }
    }
    return false
  }
  add(x: number, z: number, r: number) {
    const k = this.key(Math.floor(x / this.size), Math.floor(z / this.size))
    const list = this.cells.get(k)
    if (list) list.push({ x, z, r })
    else this.cells.set(k, [{ x, z, r }])
  }
}

const UP = new THREE.Vector3(0, 1, 0)

export function scatter(terrain: StudyTerrain, rules: Rules, seed: number): ScatterResult {
  const started = performance.now()
  const occupancy = new Occupancy()
  const placements: Record<AssetKind, Placement[]> = { tree: [], bush: [], rock: [] }
  const candidates: Record<AssetKind, number> = { tree: 0, bush: 0, rock: 0 }
  const half = terrain.size / 2
  const normal = new THREE.Vector3()

  for (const kind of KINDS) {
    const info = ASSETS[kind]
    const rand = mulberry32(seed * 7919 + KIND_STREAM[kind] * 104729)
    const n = Math.floor(terrain.size / info.spacing)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        // Every candidate consumes the same four draws whether or not it is
        // kept, so a rule change never shifts the stream for the points after it.
        const jx = rand()
        const jz = rand()
        const roll = rand()
        const vary = rand()
        candidates[kind]++
        const x = -half + (i + jx) * info.spacing
        const z = -half + (j + jz) * info.spacing
        if (Math.abs(x) > half - 0.05 || Math.abs(z) > half - 0.05) continue

        const ground = groundAt(terrain, x, z)
        const p = allFactors(rules, ground, x, z, seed)[kind].p
        if (roll >= p) continue
        if (occupancy.blocked(x, z, info.radius)) continue
        occupancy.add(x, z, info.radius)
        placements[kind].push(describeInstance(kind, terrain, ground, x, z, p, vary, normal))
      }
    }
  }

  return { placements, candidates, ms: performance.now() - started }
}

const tmp = new THREE.Color()

/**
 * Per-instance variation, driven by the ground as well as by chance.
 *
 * A random scale alone makes a uniform forest of random trees. Tying it to the
 * terrain makes the variation *say* something: trees shrink toward the treeline,
 * bushes are lusher at the shore, rocks are bigger where the ground is steeper,
 * and colour drifts drier with distance from water. Chance is then layered on
 * top so no two neighbours are identical.
 */
function describeInstance(
  kind: AssetKind,
  t: StudyTerrain,
  g: ReturnType<typeof groundAt>,
  x: number,
  z: number,
  p: number,
  r: number,
  normal: THREE.Vector3,
): Placement {
  // Four more numbers from one draw: a hash rather than further stream draws,
  // so the stream stays four per candidate (see above).
  const h1 = fract(Math.sin(r * 12.9898 + 78.233) * 43758.5453)
  const h2 = fract(Math.sin(r * 39.3468 + 11.135) * 24634.6345)
  const h3 = fract(Math.sin(r * 73.156 + 52.235) * 12737.1231)
  const near = Math.exp(-g.waterDist / 1.2)
  const colour = new THREE.Color()
  const yaw = h1 * Math.PI * 2
  let scale: number
  let variant = 0
  let tilt: THREE.Quaternion | null = null

  if (kind === 'tree') {
    // Broadleaf in the wet lowlands, conifers above — a second rule inside the
    // first, decided by the same ground data.
    variant = near > 0.45 && g.elevation < 0.35 ? 1 : 0
    scale = (variant === 1 ? 0.36 : 0.44) * (0.7 + 0.6 * h2) * (1 - 0.45 * Math.min(g.elevation, 1)) * (0.8 + 0.3 * p)
    colour.setHex(variant === 1 ? 0x6f8f55 : 0x58775a)
    colour.lerp(tmp.setHex(0x8c8a55), (1 - near) * 0.35) // drier away from water
    colour.lerp(tmp.setHex(0x3f5a55), Math.min(g.elevation, 1) * 0.4) // darker, bluer with height
  } else if (kind === 'bush') {
    scale = 0.17 * (0.7 + 0.6 * h2) * (1 + 0.5 * near)
    colour.setHex(0x7d9150).lerp(tmp.setHex(0x9a8c58), (1 - near) * 0.5)
  } else {
    variant = h3 < 0.5 ? 0 : 1
    const steep = Math.min(g.slope / 45, 1)
    scale = 0.11 * (0.55 + 1.2 * h2 * h2) * (1 + steep * 0.9)
    colour.setHex(0x8b867f).lerp(tmp.setHex(0xb2aca2), Math.min(g.elevation, 1) * 0.6)
    // Seated on the slope rather than balanced upright on it.
    normalAt(t, t.height, x, z, normal)
    tilt = new THREE.Quaternion().setFromUnitVectors(UP, normal)
  }

  const jitter = 0.9 + h3 * 0.2
  colour.multiplyScalar(jitter)
  // Sunk slightly, so a base never hovers over a slope it only touches at one corner.
  const sink = kind === 'rock' ? scale * 0.25 : scale * 0.04
  return { kind, x, y: g.height - sink, z, p, scale, yaw, variant, colour, tilt }
}

function fract(v: number) {
  return v - Math.floor(v)
}
