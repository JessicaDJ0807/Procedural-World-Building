import { heightField, macroField, routeField, valueNoise, type TerrainSpec } from './terrain'

/**
 * A river that runs downhill.
 *
 * ## What this replaces, and why
 *
 * The first river was a trough carved along the z axis and flooded by one flat
 * plane. It looked right and was not a river: the water sat at the same
 * elevation from end to end, the channel did not descend, the surrounding
 * gradient had no say in where it went, and nothing stopped the terrain rising
 * through the waterline and breaking it into ponds. It happened not to, for
 * that seed and those numbers — which is luck, not a guarantee.
 *
 * ## The pipeline
 *
 *     terrain → downhill route → longitudinal profile → channel → banks → water
 *
 * Each stage reads the one before it and nothing else.
 *
 * **Route.** Greedy descent from a high point, in a forward cone so it cannot
 * doubleback, biased toward lower ground and nudged by a low-frequency noise so
 * it meanders instead of running straight down the fall line.
 *
 * **Profile.** Water elevation as a function of distance downstream, built to be
 * monotonic by construction rather than checked afterwards: each node takes the
 * lower of "a fixed drop below the previous node" and "a fixed depth below the
 * local ground". The first term guarantees it always falls; the second keeps it
 * from flying above the terrain when the route crosses a rise.
 *
 * **Channel.** The bed is the profile less the local depth, and the terrain is
 * blended toward it by lateral distance — flat across the bed, then banks, then
 * released into whatever the ground was doing anyway.
 *
 * **Banks and water** both read lateral distance from the same centreline, so
 * the tan margin is the river's own edge rather than a contour of elevation
 * that happens to sit near it.
 */

export type RiverSpec = {
  /** Where to look for a source: the highest ground in this box is the head. */
  source: { x: number; z: number; radius: number }
  /** World units between nodes. Smaller is smoother and slower to build. */
  step: number
  /** How many nodes to trace before stopping. */
  nodes: number
  /** Minimum fall per world unit downstream. Guarantees the profile descends. */
  gradient: number
  /** Water depth below the surface, and how much it varies along the course. */
  depth: number
  /** Half-width of the water, before variation. */
  width: number
  /** How far from the centreline the carve reaches before releasing. */
  influence: number
  /** How hard the route turns toward lower ground, against going straight. */
  descentBias: number
  /**
   * How hard the route is held to its overall bearing.
   *
   * Without it the course coils: the forward cone stops it reversing but
   * permits a slow spiral, and greedy descent on gently rolling ground is
   * happy to circle a basin. Measured before this existed — 3,380 units of
   * river that ended 530 units from its own source.
   */
  drift: number
  /** Low-frequency wander, in radians of heading. */
  meander: number
  /**
   * How much of the mountain mass is taken back out near the water, and over
   * what distance it returns.
   *
   * The reason this exists is composition. Mountains placed by noise alone land
   * wherever the noise is high, which sooner or later is right beside the river
   * — and a river with mountains on both banks everywhere is a canyon, not a
   * valley. Removing most of the macro term near the course and letting it
   * return over a few hundred units gives gentle ground at the water, rolling
   * hills beyond it, and the big formations held back to the distance.
   *
   * It is applied *after* the route is traced, so it cannot change where the
   * river decided to go.
   */
  valleyFloor: { reach: number; strength: number } | null
}

export type RiverNode = {
  x: number
  z: number
  /** Distance downstream from the source. */
  s: number
  /** Unit tangent, pointing downstream. */
  tx: number
  tz: number
  /** Water surface elevation. Never increases with s. */
  water: number
  /** Channel floor. Always below `water`. */
  bed: number
  /** Half-width of the water here. */
  width: number
}

export type RiverSample = {
  node: RiverNode
  /** Lateral distance from the centreline. */
  lateral: number
  /** 0 at the centreline, 1 at the edge of the carve's influence. */
  falloff: number
}

export type River = {
  nodes: RiverNode[]
  /** Total course length. */
  length: number
  /** Nearest point on the course, or null beyond `radius` (default: the carve's). */
  at(x: number, z: number, radius?: number): RiverSample | null
  /** The terrain height with the channel cut into it. */
  carve(x: number, z: number, base: number): number
  spec: RiverSpec
}

/** Cells of this size bucket the nodes, so `at` does not walk the whole course. */
/*
 * Bucket size, and it has to exceed the widest radius anyone asks `at` for.
 * Nodes are registered into their own cell and the eight around it, so a lookup
 * reads one cell — which only finds everything within one cell's width.
 */
const BUCKET = 420

export function buildRiver(terrain: TerrainSpec, spec: RiverSpec): River {
  // Two surfaces, for two different questions. The route is chosen on the
  // regional shape, because that is what a river responds to and because
  // following every bump drops it into the nearest hollow. The profile is set
  // against the real ground, because the water has to stay under the terrain
  // that actually exists.
  const route = routeField(terrain)
  const base = heightField(terrain)
  const seed = terrain.seed

  /* ---- Source: the highest ground in the search box -------------------- */
  let sx = spec.source.x
  let sz = spec.source.z
  let best = -Infinity
  for (let dz = -spec.source.radius; dz <= spec.source.radius; dz += spec.source.radius / 12) {
    for (let dx = -spec.source.radius; dx <= spec.source.radius; dx += spec.source.radius / 12) {
      const x = spec.source.x + dx
      const z = spec.source.z + dz
      const v = route(x, z)
      if (v > best) {
        best = v
        sx = x
        sz = z
      }
    }
  }

  /* ---- Bearing: which way is downhill at the scale of the whole world --- */
  // The lowest direction averaged over a far ring, so the route has somewhere
  // to be going. Local descent decides each step; this decides the journey.
  let bearing = 0
  let bearingScore = Infinity
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2
    let sum = 0
    for (let d = 500; d <= 1600; d += 100) sum += route(sx + Math.cos(a) * d, sz + Math.sin(a) * d)
    if (sum < bearingScore) {
      bearingScore = sum
      bearing = a
    }
  }

  /* ---- Route: greedy descent in a forward cone ------------------------- */
  const path: { x: number; z: number }[] = [{ x: sx, z: sz }]
  // Initial heading: straight downhill from the source, so the first step is
  // not an arbitrary direction that the cone then locks in.
  let heading = Math.atan2(
    route(sx, sz + 40) - route(sx, sz - 40),
    route(sx + 40, sz) - route(sx - 40, sz),
  ) + Math.PI

  for (let i = 1; i < spec.nodes; i++) {
    const { x, z } = path[path.length - 1]
    // Candidates within ±70° of the current heading. The cone is what prevents
    // a loop: the route can turn, but it can never come back on itself, so
    // "downhill" can never mean "back the way we came".
    let bestAngle = heading
    let bestScore = Infinity
    for (let k = -5; k <= 5; k++) {
      const a = heading + (k / 5) * 1.22
      const nx = x + Math.cos(a) * spec.step
      const nz = z + Math.sin(a) * spec.step
      // Height is what we are descending; the turn penalty keeps the course
      // smooth, because the lowest neighbour is often a hard left and a river
      // made of hard lefts reads as a maze.
      // Shortest signed angle to the overall bearing, so the penalty does not
      // jump by 2*pi when the heading crosses the wrap.
      let off = a - bearing
      off = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)))
      const score =
        route(nx, nz) * spec.descentBias + Math.abs(k / 5) * 1.4 + off * spec.drift
      if (score < bestScore) {
        bestScore = score
        bestAngle = a
      }
    }
    // Meander: a slow wander added after the choice, so the river is not glued
    // to the fall line. Sampled on `s` so it is smooth along the course.
    // Wavelength matters as much as amplitude. At 0.0035 the heading completed a
    // cycle every ~290 units of course, which at a 20-unit step is a turn radius
    // of about 44 units — the river met itself and braided.
    const wander = (valueNoise(i * spec.step * 0.0011, 0, seed + 4242) - 0.5) * spec.meander
    heading = bestAngle + wander
    path.push({ x: x + Math.cos(heading) * spec.step, z: z + Math.sin(heading) * spec.step })
  }

  /* ---- Profile: monotonic by construction ------------------------------ */
  const nodes: RiverNode[] = []
  let s = 0
  let water = base(path[0].x, path[0].z) - spec.depth * 0.6
  for (let i = 0; i < path.length; i++) {
    const { x, z } = path[i]
    if (i > 0) s += Math.hypot(x - path[i - 1].x, z - path[i - 1].z)

    const ground = base(x, z)
    if (i > 0) {
      // The lower of: a guaranteed drop below the previous node, and a fixed
      // depth below the local ground. The first makes the profile monotonic
      // whatever the terrain does; the second stops the water surface climbing
      // out of the ground when the route crosses a rise it could not avoid.
      water = Math.min(water - spec.gradient * spec.step, ground - spec.depth * 0.6)
    }

    // Width and depth breathe along the course. Wider on bends, because that is
    // where a river undercuts, and it keeps straights from looking like a canal.
    const turn = i > 1 && i < path.length - 1
      ? Math.abs(
          Math.atan2(path[i + 1].z - path[i].z, path[i + 1].x - path[i].x) -
            Math.atan2(path[i].z - path[i - 1].z, path[i].x - path[i - 1].x),
        )
      : 0
    const vary = valueNoise(s * 0.0045, 0, seed + 8181)
    const width = spec.width * (0.72 + vary * 0.56 + Math.min(0.5, turn * 1.6))
    const depth = spec.depth * (0.8 + vary * 0.45)

    const prev = path[Math.max(0, i - 1)]
    const next = path[Math.min(path.length - 1, i + 1)]
    const tLen = Math.hypot(next.x - prev.x, next.z - prev.z) || 1

    nodes.push({
      x,
      z,
      s,
      tx: (next.x - prev.x) / tLen,
      tz: (next.z - prev.z) / tLen,
      water,
      bed: water - depth,
      width,
    })
  }

  /* ---- Lookup: bucket the nodes by cell -------------------------------- */
  const buckets = new Map<string, number[]>()
  const key = (cx: number, cz: number) => `${cx},${cz}`
  for (let i = 0; i < nodes.length; i++) {
    const cx = Math.floor(nodes[i].x / BUCKET)
    const cz = Math.floor(nodes[i].z / BUCKET)
    // Registered in the neighbourhood too, so a lookup only has to read its own
    // cell rather than its own and eight others.
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const k = key(cx + dx, cz + dz)
        const list = buckets.get(k)
        if (list) list.push(i)
        else buckets.set(k, [i])
      }
  }

  const at = (x: number, z: number, radius = spec.influence): RiverSample | null => {
    const list = buckets.get(key(Math.floor(x / BUCKET), Math.floor(z / BUCKET)))
    if (!list) return null
    let bestNode: RiverNode | null = null
    let bestDist = Infinity
    for (const i of list) {
      const n = nodes[i]
      const d = Math.hypot(n.x - x, n.z - z)
      if (d < bestDist) {
        bestDist = d
        bestNode = n
      }
    }
    if (!bestNode || bestDist > radius) return null
    return {
      node: bestNode,
      lateral: bestDist,
      falloff: Math.min(1, bestDist / spec.influence),
    }
  }

  return {
    nodes,
    length: nodes[nodes.length - 1].s,
    at,
    spec,
    carve(x, z, baseH) {
      const hit = at(x, z)
      if (!hit) return baseH
      const { node, lateral } = hit
      /*
       * The cross section. Flat across the bed, then a bank that climbs out,
       * then a release back into whatever the ground was doing.
       *
       * The release is the part that matters: cutting to a fixed profile and
       * stopping would leave a rim all the way along the course where the
       * carve meets untouched terrain. Easing the blend to zero at the
       * influence radius means the channel joins the landscape instead.
       */
      if (lateral <= node.width) return node.bed
      const t = (lateral - node.width) / Math.max(1e-6, spec.influence - node.width)
      const eased = t * t * (3 - 2 * t)
      // Rise from the bed toward the untouched height, but never above it: a
      // river should not build a levee out of ground that was not there.
      return Math.min(baseH, node.bed + (baseH - node.bed) * eased)
    },
  }
}

/**
 * The terrain a world is actually rendered from, and its river.
 *
 * Built together because they are not independent: the route is chosen from the
 * bare terrain, and the terrain is then cut by the route. Everything that needs
 * a height — the chunks, the overview, the environment, the scatter, the spawn
 * solvers — takes it from here, so there is exactly one surface and no chance
 * of two of them disagreeing about where the ground is.
 */
export function createTerrain(terrain: TerrainSpec, river: RiverSpec | null) {
  const base = heightField(terrain)
  if (!river) return { height: base, river: null as River | null }

  /*
   * Two passes, because the two depend on each other.
   *
   * How tall the ground is near the river should depend on the river, and where
   * the river goes depends on how tall the ground is. Tracing the route on the
   * full macro terrain and only then flattening around the finished course
   * breaks the circle: the river picked its way through the real landscape, and
   * the landscape is adjusted afterwards without the route being reconsidered.
   */
  const built = buildRiver(terrain, river)
  const floor = river.valleyFloor
  if (!floor) {
    return { height: (x: number, z: number) => built.carve(x, z, base(x, z)), river: built }
  }

  const macro = macroField(terrain)
  return {
    river: built,
    height: (x: number, z: number) => {
      let h = base(x, z)
      const hit = built.at(x, z, floor.reach)
      if (hit) {
        // 1 at the channel, 0 at the reach. The mass is removed rather than
        // scaled, so the valley floor sits at the height it would have had if
        // the mountains had never been there.
        const t = Math.min(1, hit.lateral / floor.reach)
        const eased = 1 - t * t * (3 - 2 * t)
        h -= macro(x, z) * floor.strength * eased
      }
      return built.carve(x, z, h)
    },
  }
}
