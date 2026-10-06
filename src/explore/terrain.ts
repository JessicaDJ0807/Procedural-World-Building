/**
 * The height function the explorable worlds are built from.
 *
 * ## Why this noise is not Topic 2's
 *
 * `compositeLayers` fills a fixed grid, and `density.ts`'s continuous version
 * samples a 16×16 lattice that wraps — fine for a shape inside a 1.3-unit cube,
 * visibly tiled the moment you walk a hundred units across it. A chunked world
 * needs `height(x, z)` defined everywhere, identical from either side of a
 * chunk boundary, and never repeating.
 *
 * So the lattice is hashed rather than stored: an integer coordinate pair goes
 * through an integer mix and comes back as a value in [0, 1). Same Hermite fade
 * and same bilinear interpolation as the rest of the project's value noise —
 * only the way a lattice point is looked up differs. Nothing is allocated, so a
 * chunk can be built on demand without a table being sized for the world first.
 *
 * ## What is missing, deliberately
 *
 * No hydraulic erosion. Droplets run over a whole grid and accumulate across
 * it, so there is no way to erode one chunk without its neighbours disagreeing
 * about the result at the seam. The valleys here come from ridged shaping and
 * domain warp, which are pointwise and therefore chunkable. That is a real loss
 * — Topic 2's channels are the better landform — and the honest version of this
 * demo says so rather than pretending the terrain is eroded.
 */

/* ---------------------------------------------------------------------------
 * Hashed value noise
 * ------------------------------------------------------------------------- */

/** Integer mix. The constants are the usual odd 32-bit primes; nothing subtle. */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix | 0) * 374761393 + (iz | 0) * 668265263 + (seed | 0) * 1442695040
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  // >>> 0 first: the multiplies above overflow into the sign bit, and a
  // negative numerator here would put half the lattice outside [0, 1).
  return (h >>> 0) / 4294967296
}

const fade = (t: number) => t * t * (3 - 2 * t)

const ramp01 = (v: number, a: number, b: number) => fade(Math.min(1, Math.max(0, (v - a) / (b - a || 1e-6))))

/** One octave of value noise at a continuous coordinate. */
export function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const tx = fade(x - x0)
  const tz = fade(z - z0)
  const n00 = hash2(x0, z0, seed)
  const n10 = hash2(x0 + 1, z0, seed)
  const n01 = hash2(x0, z0 + 1, seed)
  const n11 = hash2(x0 + 1, z0 + 1, seed)
  const near = n00 + (n10 - n00) * tx
  const far = n01 + (n11 - n01) * tx
  return near + (far - near) * tz
}

export type Shaping = 'none' | 'ridge' | 'billow' | 'terrace'

function shape(v: number, kind: Shaping): number {
  switch (kind) {
    // Folded at the midpoint and inverted: the fold becomes a crease, and a
    // stack of creased octaves reads as ridgelines rather than as dunes.
    case 'ridge':
      return 1 - Math.abs(v * 2 - 1)
    case 'billow':
      return Math.abs(v * 2 - 1)
    // A tread and a riser, not a smoothed ramp. Fading across the whole step
    // reconstructs something almost linear — the steps only read as steps if
    // most of each one is flat, so the rise is compressed into the last third.
    case 'terrace': {
      const n = 7
      const scaled = v * n
      const frac = scaled - Math.floor(scaled)
      const riser = frac < 0.66 ? 0 : fade((frac - 0.66) / 0.34)
      return (Math.floor(scaled) + riser) / n
    }
    default:
      return v
  }
}

/* ---------------------------------------------------------------------------
 * Landmarks
 *
 * A landmark is a term in the height function, not a mesh placed in the scene.
 * That keeps it procedural, keeps it seamless across chunk boundaries for free,
 * and — because it sits at a known coordinate — gives the spawn point something
 * definite to face.
 * ------------------------------------------------------------------------- */

export type Landmark =
  | { kind: 'volcano'; x: number; z: number; radius: number; height: number }
  | { kind: 'massif'; x: number; z: number; radius: number; height: number }
  | { kind: 'valley'; x: number; z: number; radius: number; height: number }
  | { kind: 'none' }

function landmarkAt(mark: Landmark, x: number, z: number, seed: number): number {
  if (mark.kind === 'none') return 0
  const dx = x - mark.x
  const dz = z - mark.z
  const r = Math.hypot(dx, dz) / mark.radius

  if (mark.kind === 'volcano') {
    if (r > 1) return 0
    // A smooth shoulder rather than a straight cone: the straight one meets the
    // surrounding ground at a hard angle that reads as a placed object.
    const cone = (1 - r) ** 1.5
    // The crater is a dip inside the summit, not a hole cut through it.
    const crater = r < 0.22 ? -(((1 - r / 0.22) ** 2) * 0.42) : 0
    return (cone + crater) * mark.height
  }

  if (mark.kind === 'massif') {
    if (r > 1) return 0
    // Several shoulders at different radii, so it reads as a range rather than
    // as one dome. The noise term breaks the circular silhouette.
    const base = (1 - r) ** 2
    const broken = valueNoise(x * 0.015, z * 0.015, seed + 991) * 0.55 + 0.45
    return base * broken * mark.height
  }

  // A valley: a trough carved along z, wandering so it does not read as a canal.
  const wander = (valueNoise(0, z * 0.004, seed + 77) - 0.5) * mark.radius * 2.2
  const across = Math.abs(dx - wander) / mark.radius
  if (across > 1) return 0
  return -(((1 - across) ** 1.6) * mark.height)
}

/* ---------------------------------------------------------------------------
 * The world
 * ------------------------------------------------------------------------- */

export type TerrainSpec = {
  seed: number
  /** Cycles per world unit at the first octave. Lower is bigger landforms. */
  frequency: number
  octaves: number
  persistence: number
  /** Vertical scale, in world units. */
  amplitude: number
  shaping: Shaping
  /**
   * Applied to the summed stack rather than to each octave.
   *
   * The distinction matters for terracing. Terracing an octave and then adding
   * four more on top smooths the steps straight back out — the shelves only
   * survive if the quantising happens last, once the height is final.
   */
  outputShaping: Shaping
  /** Domain warp, in world units. Bends ridges so they do not run straight. */
  warp: number
  /** Fine roughness, in world units, added after shaping. 0 leaves it smooth. */
  detail: number
  /**
   * A medium-frequency ridged layer, added on top of the octave stack.
   *
   * The stack alone gives one family of shapes at every scale, because each
   * octave is the same noise at twice the frequency. Hills and cliffs are a
   * different kind of feature from the landmasses under them, and this is where
   * they come from: ridged noise at a few hundred units, strong enough to break
   * a smooth flank and weak enough to leave the macro geography recognisable.
   */
  ridges: { amount: number; frequency: number } | null
  landmark: Landmark
  /**
   * Channels radiating from a point, cut into the terrain.
   *
   * The reason lava needs this. Flooding everything below a waterline gives
   * hundreds of unconnected red patches wherever the noise happens to dip —
   * a red camouflage pattern rather than a lava field. Cutting a few deep
   * channels out from the crater and then flooding gives flows: connected,
   * running downhill, and recognisable as having come from somewhere.
   */
  channels: {
    x: number
    z: number
    /** How many run out from the centre. A handful reads; twenty does not. */
    count: number
    /** How far down they cut, in world units. */
    depth: number
    /** How far out they reach before fading. */
    reach: number
    /** Angular width, as a fraction of the gap between channels. */
    width: number
  } | null
  /**
   * Mountain masses: very low frequency, and thresholded so only the top of the
   * noise rises at all.
   *
   * Thresholding is what makes these read as a few formations rather than as
   * bigger rolling hills. Plain low-frequency noise raises everything by
   * something, which is uniform by another name; taking only the part above a
   * cutoff leaves most of the world alone and a handful of places tall.
   */
  massifs: { frequency: number; amount: number; threshold: number } | null
  /**
   * A regional gradient, in units of fall per world unit.
   *
   * Added because a river needs a watershed and this terrain had none. Measured
   * before it existed: mean height across the whole play area ran from 16.7 to
   * 26.5 — ten units over three and a half thousand, which is flat. Greedy
   * descent on flat ground does not descend, it circles, and the first traced
   * course was 3,380 units long and ended 530 units from its own source.
   *
   * Small enough to be invisible standing on it, large enough to be the reason
   * water goes one way rather than another.
   */
  tilt: { x: number; z: number } | null
  /** World Y of the water plane. `null` for a dry world. */
  seaLevel: number | null
}

/**
 * Height at a world coordinate.
 *
 * Returned as a closure over the spec rather than taking it per call: a chunk
 * at 96×96 asks for 9,409 heights and the scatter pass asks for more, so the
 * per-call cost is what the frame budget is actually made of.
 */
/**
 * The mountain masses on their own.
 *
 * Separate because two things need it independently: the height function adds
 * it, and the valley floor subtracts part of it back near the river. Keeping
 * the biggest landforms away from the water is what stops the world becoming a
 * canyon, and it can only be done if the term is reachable by itself.
 */
export function macroField(spec: TerrainSpec): (x: number, z: number) => number {
  const { massifs, seed } = spec
  if (!massifs) return () => 0
  return (x: number, z: number) => {
    const n =
      valueNoise(x * massifs.frequency, z * massifs.frequency, seed + 1717) * 0.72 +
      valueNoise(x * massifs.frequency * 2.3, z * massifs.frequency * 2.3, seed + 2929) * 0.28
    if (n <= massifs.threshold) return 0
    const t = (n - massifs.threshold) / (1 - massifs.threshold)
    // Squared, so a mass rises slowly at its foot and steeply near its summit
    // rather than meeting the plain at an angle.
    return t * t * massifs.amount
  }
}

/**
 * The landscape at the scale a river responds to.
 *
 * Tilt, mountain masses and the two broadest octaves — no ridges, no fine
 * octaves, no detail. A route traced on the full height follows every bump, and
 * once the mountains arrived that meant falling into whichever basin the noise
 * happened to make and circling in it: 5,131 self-overlapping pairs, a course
 * four thousand units long that ended one thousand from its source.
 *
 * Rivers do not respond to boulders. Routing on the regional shape is both the
 * robust choice and the more honest one.
 */
export function routeField(spec: TerrainSpec): (x: number, z: number) => number {
  const { seed, frequency, persistence, amplitude, tilt } = spec
  const macroAt = macroField(spec)
  return (x: number, z: number) => {
    let sum = 0
    let total = 0
    let amp = 1
    let freq = frequency
    for (let o = 0; o < 2; o++) {
      sum += valueNoise(x * freq, z * freq, seed + o * 1013) * amp
      total += amp
      amp *= persistence
      freq *= 2
    }
    let h = (sum / total) * amplitude + macroAt(x, z)
    if (tilt) h += x * tilt.x + z * tilt.z
    return h
  }
}

export function heightField(spec: TerrainSpec): (x: number, z: number) => number {
  const { seed, frequency, octaves, persistence, amplitude, shaping, outputShaping, warp, landmark, detail, channels, ridges, tilt } =
    spec
  const macroAt = macroField(spec)

  return (x: number, z: number) => {
    let wx = x
    let wz = z
    if (warp > 0) {
      // Two independent fields, so the displacement is a vector rather than a
      // scalar pushed along the diagonal.
      wx += (valueNoise(x * frequency * 0.5, z * frequency * 0.5, seed + 101) - 0.5) * 2 * warp
      wz += (valueNoise(x * frequency * 0.5, z * frequency * 0.5, seed + 202) - 0.5) * 2 * warp
    }

    let sum = 0
    let total = 0
    let amp = 1
    let freq = frequency
    for (let o = 0; o < octaves; o++) {
      sum += shape(valueNoise(wx * freq, wz * freq, seed + o * 1013), shaping) * amp
      total += amp
      amp *= persistence
      freq *= 2
    }

    let h = shape(sum / total, outputShaping) * amplitude + landmarkAt(landmark, x, z, seed)

    if (channels) {
      const dx = x - channels.x
      const dz = z - channels.z
      const r = Math.hypot(dx, dz)
      if (r > 1 && r < channels.reach) {
        // The angle, wandered by a noise field that varies with radius. Without
        // it the channels are straight spokes, which reads as a wheel rather
        // than as drainage.
        const wander = (valueNoise(r * 0.004, 0, seed + 606) - 0.5) * 1.5
        const a = Math.atan2(dz, dx) / (Math.PI * 2) + wander
        // JS `%` keeps the sign of its left operand, so atan2's negative half
        // came back negative here and never matched a channel — the flows
        // existed on one side of the crater only.
        const f = (((a * channels.count) % 1) + 1) % 1
        const t = Math.abs(f - 0.5) * 2
        const across = 1 - Math.min(1, t / channels.width)
        if (across > 0) {
          // Shallow at the rim, deepest mid-way, closing again at the reach —
          // so a flow has a head and a toe rather than ending at a wall.
          const along = Math.min(1, r / (channels.reach * 0.22)) * (1 - ramp01(r / channels.reach, 0.55, 1))
          h -= channels.depth * (across * across * (3 - 2 * across)) * along
        }
      }
    }

    // A fine octave added after the shaping rather than inside it. Inside, the
    // output op would quantise it away — terracing in particular flattens
    // anything finer than a tread. Outside, it survives as the roughness you
    // only see within a few dozen units, which is the scale the chunk grid can
    // actually resolve and the one that stops near ground reading as polished.
    if (tilt) h += x * tilt.x + z * tilt.z
    h += macroAt(x, z)

    if (ridges) {
      // Folded and squared: the fold makes a crease rather than a dune, and
      // squaring keeps the troughs flat so the result reads as ridges standing
      // on the existing ground rather than as a second layer of hills.
      const v = valueNoise(wx * ridges.frequency, wz * ridges.frequency, seed + 808)
      const fold = 1 - Math.abs(v * 2 - 1)
      h += fold * fold * ridges.amount
    }

    if (detail > 0) {
      h += (valueNoise(x * frequency * 9, z * frequency * 9, seed + 404) - 0.5) * 2 * detail
    }
    return h
  }
}

/**
 * Surface normal by central difference on the height function.
 *
 * `h` is a world distance rather than a grid step, so a chunk built at a
 * coarser resolution still gets the normal of the real surface rather than of
 * its own triangles — which is what keeps shading continuous across a seam.
 */
export function normalAt(
  height: (x: number, z: number) => number,
  x: number,
  z: number,
  h = 0.6,
): [number, number, number] {
  const dx = height(x + h, z) - height(x - h, z)
  const dz = height(x, z + h) - height(x, z - h)
  // The cross product of the two tangents, normalised.
  const nx = -dx
  const ny = 2 * h
  const nz = -dz
  const len = Math.hypot(nx, ny, nz) || 1
  return [nx / len, ny / len, nz / len]
}
