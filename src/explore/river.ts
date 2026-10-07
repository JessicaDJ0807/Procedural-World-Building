import { heightField, macroField, routeField, valueNoise, type TerrainSpec } from './terrain'
import { smoothCentreline } from '../ribbon'

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
  // against the ground the river will actually lie in (valleyGround, below),
  // because the water has to stay under the terrain that actually exists.
  const route = routeField(terrain)
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

  /* ---- Into the valley: a lightweight relaxation ----------------------- */
  // The greedy route is held to its bearing hard (drift 2.6), so it crossed
  // the valley rather than following it: the lowest ground across the river
  // was inside the channel at 41 of 214 nodes, a median 180 units away, and
  // the water — forced to keep falling — sat 26 units below the land 30 units
  // from its edge. That is the trench. This slides each node sideways toward
  // lower ground, a little at a time, while a smoothing pass keeps the line a
  // line; source and mouth stay where they are.
  relaxIntoValley(path, valleyGround(terrain, spec))

  /* ---- One centreline: the route, smoothed once ------------------------ */
  // The route turns by up to 1.11 rad at a node. Everything downstream — the
  // carve, the banks, the water — is built on this smoothed line and nothing
  // else, so they cannot disagree about where the river is. The water used to
  // follow its own smoothing of the route while the channel followed the raw
  // corners, which is how banks and water stopped matching.
  const dense = smoothCentreline(path, 4, ROUTE_SMOOTHING).samples
  const course: { x: number; z: number }[] = []
  for (let k = 0, target = 0; k < dense.length; k++) {
    if (dense[k].s >= target || k === dense.length - 1) {
      course.push({ x: dense[k].x, z: dense[k].z })
      target += spec.step
    }
  }

  /* ---- Profile: monotonic by construction ------------------------------ */
  const nodes: RiverNode[] = []
  let s = 0
  // The profile reads the ground the river will actually lie in — mountains
  // damped by valleyFloor — not the raw height, so the water is set against
  // the same terrain the relaxation steered toward and the carve cuts into.
  const ground0 = valleyGround(terrain, spec)
  let water = ground0(course[0].x, course[0].z) - spec.depth * 0.6
  const along: number[] = []
  for (let i = 0; i < course.length; i++) {
    if (i > 0) s += Math.hypot(course[i].x - course[i - 1].x, course[i].z - course[i - 1].z)
    along.push(s)
  }
  const widths = channelWidths(course, along, spec, seed, dense)
  for (let i = 0; i < course.length; i++) {
    const { x, z } = course[i]
    const ground = ground0(x, z)
    if (i > 0) {
      // The lower of: a guaranteed drop below the previous node, and a fixed
      // depth below the local ground. The first makes the profile monotonic
      // whatever the terrain does; the second stops the water surface climbing
      // out of the ground when the route crosses a rise it could not avoid.
      water = Math.min(water - spec.gradient * spec.step, ground - spec.depth * 0.6)
    }
    const vary = valueNoise(along[i] * 0.0045, 0, seed + 8181)
    const depth = spec.depth * (0.8 + vary * 0.45)

    const prev = course[Math.max(0, i - 1)]
    const next = course[Math.min(course.length - 1, i + 1)]
    const tLen = Math.hypot(next.x - prev.x, next.z - prev.z) || 1

    nodes.push({
      x,
      z,
      s: along[i],
      tx: (next.x - prev.x) / tLen,
      tz: (next.z - prev.z) / tLen,
      water,
      bed: water - depth,
      width: widths[i],
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

  /*
   * The nearest point on the course, not the nearest node.
   *
   * Measuring to the nearest node made the channel a chain of discs 20 units
   * apart: between two nodes a point at the channel's edge is further from
   * both than from the line between them, so the bank bulged in and out every
   * 20 units — the scalloped shoreline. Projecting onto each segment and
   * interpolating the node values along it gives one continuous channel.
   */
  const at = (x: number, z: number, radius = spec.influence): RiverSample | null => {
    const list = buckets.get(key(Math.floor(x / BUCKET), Math.floor(z / BUCKET)))
    if (!list) return null
    let best = -1
    let bestT = 0
    let bestDist = Infinity
    for (const i of list) {
      if (i >= nodes.length - 1) continue
      const a = nodes[i]
      const b = nodes[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len2 = dx * dx + dz * dz || 1e-9
      const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2))
      const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t))
      if (d < bestDist) {
        bestDist = d
        best = i
        bestT = t
      }
    }
    if (best < 0 || bestDist > radius) return null
    const a = nodes[best]
    const b = nodes[best + 1]
    const mix = (p: number, q: number) => p + (q - p) * bestT
    return {
      node: {
        x: mix(a.x, b.x),
        z: mix(a.z, b.z),
        s: mix(a.s, b.s),
        tx: a.tx,
        tz: a.tz,
        water: mix(a.water, b.water),
        bed: mix(a.bed, b.bed),
        width: mix(a.width, b.width),
      },
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
      const w = node.width
      /*
       * The cross-section, built around the water rather than the bed:
       *
       *      land ─────╮
       *                 ╲  release: eased back to the land
       *    wet bank ─────╲___
       *   ~~~~~~~~~~~~~~~~~~~╲~~~~  water, exactly `width` from the centreline
       *     shelf ╲________________ bed
       *
       * Under the water (lateral ≤ width) the ground is always below the water
       * level: flat bed across the middle, shelving up to just under the
       * surface at the edge, which is what reads as shallows. Then a short wet
       * bank climbs out of the water, and only then does the ground ease back
       * to the land. The first version eased straight from the bed to the land
       * over the whole 78-unit influence, so the ground stayed underwater for a
       * median 18 units past the channel edge — the navy strip that read as a
       * second river, and that the water was then widened to hide.
       *
       * The bank may raise low ground a little, to `water + BANK_HEIGHT`. That
       * is what holds the river in; without it, a river crossing ground lower
       * than its own surface would have nothing for a shoreline.
       */
      const shelf = node.water - SHELF_DEPTH
      if (lateral <= w) {
        // The bed is flat only across the middle 40%; from there it shelves up
        // the whole way to the edge, so the water shallows gradually.
        const t = smooth01((lateral - w * 0.4) / (w * 0.6))
        return node.bed + (shelf - node.bed) * t
      }
      const bankTop = node.water + BANK_HEIGHT
      if (lateral <= w + BANK_WIDTH) {
        return shelf + (bankTop - shelf) * smooth01((lateral - w) / BANK_WIDTH)
      }
      // The release is as long as it needs to be for its slope to stay near
      // RELEASE_SLOPE: high land is approached over a longer run than low land,
      // rather than every bank climbing out over the same fixed distance. With
      // a fixed run, a bank 25 units below the land climbed out at 22° median
      // through ground that had been 5° before it was carved.
      const rise = Math.max(baseH - bankTop, 0)
      const room = Math.max(1e-6, spec.influence - w - BANK_WIDTH)
      const run = Math.min(room, Math.max(RELEASE_MIN, rise / Math.tan(RELEASE_SLOPE)))
      const t = smooth01((lateral - w - BANK_WIDTH) / run)
      // Where the land is lower than the river, easing straight from the bank
      // to the land dips below the water on the way and leaves underwater
      // ground outside the water. A floor just above the surface holds over
      // the first 70% of the release and then fades into the land itself, so
      // the result is a long low levee rather than a step.
      const floor = node.water + 0.3 + (baseH - node.water - 0.3) * smooth01((t - 0.7) / 0.3)
      return Math.max(bankTop + (baseH - bankTop) * t, floor)
    },
  }
}

/**
 * The terrain a finished river lies in: the raw height with the mountain mass
 * removed as valleyFloor will remove it at the channel (its full strength).
 */
function valleyGround(terrain: TerrainSpec, spec: RiverSpec): (x: number, z: number) => number {
  const raw = heightField(terrain)
  if (!spec.valleyFloor) return raw
  const macro = macroField(terrain)
  const strength = spec.valleyFloor.strength
  return (x, z) => raw(x, z) - macro(x, z) * strength
}

/** How far a node may move from where the greedy route put it. */
const VALLEY_REACH = 90
const VALLEY_ITERATIONS = 10

/**
 * Slides the route into its valley, in place.
 *
 * Each pass looks across every interior node, ±VALLEY_REACH at 10-unit steps,
 * for the lowest ground — penalised by distance, so a slightly lower point far
 * away does not win over a nearly-as-low one close by — and moves the node a
 * quarter of the way there. Then each node is pulled halfway toward the
 * midpoint of its neighbours, which keeps the line smooth and stops it
 * collapsing onto one hollow. No node strays more than VALLEY_REACH from where
 * the route put it, and the two ends never move. Not hydrology: a cheap
 * active contour on the height field, ten passes.
 */
function relaxIntoValley(path: { x: number; z: number }[], ground: (x: number, z: number) => number) {
  const n = path.length
  if (n < 5) return
  const origin = path.map((p) => ({ ...p }))
  for (let pass = 0; pass < VALLEY_ITERATIONS; pass++) {
    const next = path.map((p) => ({ ...p }))
    for (let i = 1; i < n - 1; i++) {
      const a = path[i - 1]
      const b = path[i + 1]
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
      const nx = -(b.z - a.z) / len
      const nz = (b.x - a.x) / len
      let best = 0
      let bestScore = Infinity
      for (let d = -VALLEY_REACH; d <= VALLEY_REACH; d += 10) {
        const score = ground(path[i].x + nx * d, path[i].z + nz * d) + Math.abs(d) * 0.08
        if (score < bestScore) {
          bestScore = score
          best = d
        }
      }
      next[i].x = path[i].x + nx * best * 0.25
      next[i].z = path[i].z + nz * best * 0.25
    }
    for (let i = 1; i < n - 1; i++) {
      const mx = (next[i - 1].x + next[i + 1].x) / 2
      const mz = (next[i - 1].z + next[i + 1].z) / 2
      let x = next[i].x + (mx - next[i].x) * 0.5
      let z = next[i].z + (mz - next[i].z) * 0.5
      const dx = x - origin[i].x
      const dz = z - origin[i].z
      const shift = Math.hypot(dx, dz)
      if (shift > VALLEY_REACH) {
        x = origin[i].x + (dx / shift) * VALLEY_REACH
        z = origin[i].z + (dz / shift) * VALLEY_REACH
      }
      path[i].x = x
      path[i].z = z
    }
  }
}

const smooth01 = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** How far the smoothed course is spread, in world units (Gaussian sigma). */
const ROUTE_SMOOTHING = 12
/** How far under the surface the shelf meets the edge of the water. */
export const SHELF_DEPTH = 0.35
/**
 * The wet bank: how far it runs past the water's edge, and how high it climbs.
 * 10 units to 0.9 above the water is about a 5° slope — muddy margin, not a
 * step. The first version climbed 1.75 over 6 units, about 16°, everywhere.
 */
export const BANK_WIDTH = 10
export const BANK_HEIGHT = 0.9
/** The slope the release aims for (radians, ~10°), and its shortest run. */
const RELEASE_SLOPE = (10 * Math.PI) / 180
const RELEASE_MIN = 20
/** Widest change in half-width allowed between neighbouring nodes. */
const MAX_WIDTH_STEP = 0.8
/**
 * Water half-width never exceeds this share of the local bend radius. At 0.55
 * the outer edge of a bend travels at most (1 + 0.55) / (1 − 0.55) ≈ 3.4 times
 * as far as the inner one; at 0.75, the first setting, it was 7, and the inner
 * edge all but pivoted.
 */
const BEND_SHARE = 0.55
/**
 * How far the water surface runs past the channel's edge, under the wet bank.
 *
 * The bank climbs from 0.35 under the water at the channel edge to 0.9 above it
 * over 10 units on a smoothstep, so the ground crosses the surface about 3.5
 * units out. Running the water to 5 puts its own edge under ground about 0.28
 * above it, where the depth test hides it: the shoreline seen is the bank
 * meeting the water, not the end of a mesh. (With the earlier, steeper bank, 2.5 left 21 edge
 * vertices just under the water on the inside of bends, where the water's
 * lightly smoothed centreline sits a unit off the carve's segments; 3.5 left
 * one.) Exported because the bend limit has to leave room for it: a limit on
 * the channel alone let the water fold at the tightest bends.
 */
export const BANK_OVERLAP = 5

/**
 * The river's half-width along its course, decided by the course and nothing
 * else.
 *
 *     base(s)  — growing from 80% at the source to 125% at the mouth
 *   × (1 ± 12%) — a slow wander, about 500 units a cycle, so it is not a canal
 *   × (1 + up to 12%) on bends gentler than a 150-unit radius
 *   → Gaussian-smoothed over about five nodes
 *   → no more than MAX_WIDTH_STEP change between neighbours
 *   → no more than BEND_SHARE of the local bend radius
 *
 * The terrain has no say. The previous water found its width by walking out
 * until the ground rose above it, which handed the width to whatever low
 * ground was nearby: half-widths up to 123 units, jumps of 11 units between
 * cross-sections 4 units apart, and pools wherever the bank happened to be low.
 * Here the ground is carved to fit the river instead, and the water and the
 * channel read the same number.
 */
function channelWidths(
  course: { x: number; z: number }[],
  along: number[],
  spec: RiverSpec,
  seed: number,
  dense: { s: number; tx: number; tz: number }[],
): number[] {
  const n = course.length
  const total = along[n - 1] || 1
  // Curvature per node, for the bend term below: gentle bends widen a little,
  // which is where a river spreads; tight ones are then held back by the bend
  // limit regardless.
  const curvature = course.map((_, i) => {
    const a = course[Math.max(i - 1, 0)]
    const b = course[i]
    const c = course[Math.min(i + 1, n - 1)]
    const h0 = Math.atan2(b.z - a.z, b.x - a.x)
    const h1 = Math.atan2(c.z - b.z, c.x - b.x)
    return Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0))) / Math.max(spec.step, 1e-6)
  })
  const raw = along.map(
    (s, i) =>
      spec.width *
      (0.8 + 0.45 * (s / total)) *
      (1 + (valueNoise(s * 0.002, 0, seed + 8181) - 0.5) * 0.24) *
      (1 + 0.12 * smooth01(curvature[i] * 150)),
  )

  // The bend limit. Curvature is measured on the dense smoothed line, 4 units
  // apart, and each node takes the tightest radius anywhere within one step of
  // it. The first version measured the turn across two nodes either side — 80
  // units — which averaged the tightest part of a bend away, and the inner
  // edge of the water nearly stopped there while the outer edge swung 13 times
  // as far: a fan.
  const radius = dense.map((_, k) => {
    const a = dense[Math.max(k - 3, 0)]
    const b = dense[Math.min(k + 3, dense.length - 1)]
    const turn = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz))
    return turn < 1e-6 ? Infinity : Math.max(b.s - a.s, 1e-6) / turn
  })
  const limit = along.map((s0) => {
    let tightest = Infinity
    for (let k = 0; k < dense.length; k++) {
      if (Math.abs(dense[k].s - s0) <= spec.step) tightest = Math.min(tightest, radius[k])
    }
    return tightest === Infinity ? Infinity : Math.max(BEND_SHARE * tightest - BANK_OVERLAP, 4)
  })

  const smooth = (values: number[]) => {
    const radius = 7
    const sigma = 2.5
    return values.map((_, i) => {
      let sum = 0
      let weight = 0
      for (let k = -radius; k <= radius; k++) {
        const j = Math.min(Math.max(i + k, 0), n - 1)
        const g = Math.exp(-0.5 * (k / sigma) ** 2)
        sum += values[j] * g
        weight += g
      }
      return sum / weight
    })
  }
  // Limited forward and back, so a narrowing is spread both ways rather than
  // dropping at one node and recovering slowly after it.
  const rate = (values: number[]) => {
    const out = values.slice()
    for (let i = 1; i < n; i++) out[i] = Math.min(out[i], out[i - 1] + MAX_WIDTH_STEP)
    for (let i = n - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] + MAX_WIDTH_STEP)
    return out
  }
  // The limit is itself made smooth before anything is clamped to it: the
  // tightest value over three nodes either side, then smoothed. Clamping to
  // the raw per-node limit made the width follow every flicker of the
  // curvature — measured, the median change between nodes sat at the 0.8
  // ceiling, a sawtooth — and hid the downstream trend under it.
  const tightest = limit.map((_, i) => {
    let m = Infinity
    for (let k = Math.max(i - 3, 0); k <= Math.min(i + 3, n - 1); k++) m = Math.min(m, limit[k])
    return m
  })
  const finite = tightest.map((l) => (Number.isFinite(l) ? l : spec.width * 3))
  const steady = smooth(finite)
  // Clamp, smooth, then clamp and rate-limit again: the smoothing keeps the
  // bend narrowing gradual, and the last pass restores both guarantees.
  const first = smooth(raw.map((w, i) => Math.min(w, steady[i])))
  return rate(first.map((w, i) => Math.min(w, steady[i])))
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
