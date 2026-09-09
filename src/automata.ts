/**
 * A cellular automaton over the composited field.
 *
 * Unlike the shaping operations, which are per-cell `f(x)`, this is
 * `f(x, neighbours)` applied repeatedly: the field is first thresholded to a
 * live/dead mask, then each generation sets a cell live when enough of its
 * neighbours are live. A few passes pull speckled noise into connected blobs —
 * the standard way caves and coastlines get generated.
 */

/**
 * Cells considered per step: the whole 3^d block, the centre included.
 *
 * Counting only the 8 surrounding cells and excluding the centre looks like the
 * same rule but is not — with no vote of its own a cell cannot hold its state,
 * so the field erodes away instead of settling. Including the centre makes it a
 * genuine majority, which is what converges to blobs.
 */
export const BLOCK_SIZE: Record<2 | 3, number> = { 2: 9, 3: 27 }

/** A bare majority of the block, where the rule is stable. */
export const DEFAULT_SURVIVE: Record<2 | 3, number> = { 2: 5, 3: 14 }

/**
 * Safety net only — the run normally stops at its own fixed point. 2D settles
 * in under a dozen passes; 3D needs far more (about 80 on the default stack at
 * 32³) because a 27-cell block has more ways to stay balanced, so the cap has
 * to clear that or the run stops short of the result it is meant to show.
 */
export const MAX_GENERATIONS = 96

export type AutomataResult = {
  field: Float32Array
  /** Passes that actually changed the mask. Stops at the fixed point. */
  generations: number
  /** True once a further pass would change nothing. */
  settled: boolean
  /** Cells whose value differs from the input field. 0 means the rule is inert. */
  changed: number
  /** Cells left with a non-zero value. 0 means the rule wiped the field out. */
  live: number
  /** Cells that flipped on the last pass — non-zero only when the cap cut the run short. */
  flips: number
}

/**
 * Indices wrap, matching the noise lattices. Clamping instead would make the
 * borders permanently short of neighbours, so the field would erode inward from
 * its edges no matter what rule was set.
 *
 * Returns the number of cells that flipped, which is what lets the caller stop
 * at the fixed point rather than grinding out passes that change nothing.
 */
function step2D(alive: Uint8Array, out: Uint8Array, r: number, survive: number): number {
  let flips = 0
  for (let y = 0; y < r; y++) {
    const yUp = (y + r - 1) % r
    const yDown = (y + 1) % r
    for (let x = 0; x < r; x++) {
      const xLeft = (x + r - 1) % r
      const xRight = (x + 1) % r
      const count =
        alive[yUp * r + xLeft] + alive[yUp * r + x] + alive[yUp * r + xRight] +
        alive[y * r + xLeft] + alive[y * r + x] + alive[y * r + xRight] +
        alive[yDown * r + xLeft] + alive[yDown * r + x] + alive[yDown * r + xRight]
      const next = count >= survive ? 1 : 0
      const i = y * r + x
      if (next !== alive[i]) flips++
      out[i] = next
    }
  }
  return flips
}

function step3D(alive: Uint8Array, out: Uint8Array, r: number, survive: number): number {
  let flips = 0
  for (let z = 0; z < r; z++) {
    for (let y = 0; y < r; y++) {
      for (let x = 0; x < r; x++) {
        let count = 0
        for (let dz = -1; dz <= 1; dz++) {
          const nz = (z + dz + r) % r
          for (let dy = -1; dy <= 1; dy++) {
            const ny = (y + dy + r) % r
            for (let dx = -1; dx <= 1; dx++) {
              count += alive[(nz * r + ny) * r + ((x + dx + r) % r)]
            }
          }
        }
        const next = count >= survive ? 1 : 0
        const i = (z * r + y) * r + x
        if (next !== alive[i]) flips++
        out[i] = next
      }
    }
  }
  return flips
}

function countNonZero(field: Float32Array): number {
  let n = 0
  for (let i = 0; i < field.length; i++) if (field[i] !== 0) n++
  return n
}

/**
 * Generation 0 returns the field untouched, so the automaton is genuinely off
 * until it is stepped rather than silently thresholding everything.
 *
 * The result keeps each live cell's original value and zeroes the dead ones, so
 * land holds its noise detail while the rest goes flat — islands with terrain,
 * rather than a binary plateau.
 */
export function runAutomata(
  field: Float32Array,
  resolution: number,
  dimensions: 2 | 3,
  options: { threshold: number; survive: number; generations: number },
): AutomataResult {
  const { threshold, survive, generations } = options
  if (generations <= 0) {
    return { field, generations: 0, settled: false, changed: 0, live: countNonZero(field), flips: 0 }
  }

  let alive = new Uint8Array(field.length)
  for (let i = 0; i < field.length; i++) alive[i] = field[i] >= threshold ? 1 : 0

  let scratch = new Uint8Array(field.length)
  const step = dimensions === 2 ? step2D : step3D
  let ran = 0
  let settled = false
  let flips = 0
  for (let g = 0; g < generations; g++) {
    flips = step(alive, scratch, resolution, survive)
    // Swapped rather than copied: a generation must read a consistent previous
    // state, so writing in place would let earlier cells influence later ones.
    const previous = alive
    alive = scratch
    scratch = previous
    // A pass that flips nothing is a fixed point: every later pass is identical,
    // so the run is over. Without this the counter keeps ticking against a
    // frozen picture, which reads as the controls being broken.
    if (flips === 0) {
      settled = true
      break
    }
    ran = g + 1
  }

  const out = new Float32Array(field.length)
  let changed = 0
  let live = 0
  for (let i = 0; i < field.length; i++) {
    if (alive[i]) {
      out[i] = field[i]
      if (field[i] !== 0) live++
    } else if (field[i] !== 0) {
      changed++
    }
  }
  return { field: out, generations: ran, settled, changed, live, flips }
}
