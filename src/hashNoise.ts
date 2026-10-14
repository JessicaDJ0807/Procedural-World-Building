/**
 * Value noise defined everywhere, with no table behind it.
 *
 * Topic 2's noise fills a fixed grid, and `density.ts`'s continuous version
 * samples a 16×16 lattice that wraps — fine inside one small shape, visibly
 * tiled across anything larger. This version hashes the lattice instead: an
 * integer coordinate pair goes through an integer mix and comes back as a value
 * in [0, 1). Same Hermite fade and same bilinear interpolation as the rest of
 * the project's value noise — only the way a lattice point is looked up
 * differs. Nothing is allocated, so it can be asked about any point at any time.
 *
 * It was written for the original Project's chunked terrain, where a chunk
 * built on demand had to agree with its neighbours at the seam. That terrain
 * was retired; Topics 5, 6 and 7 still use this for their clustering, road
 * wobble and curl noise, so it lives here rather than with any one of them.
 */

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
