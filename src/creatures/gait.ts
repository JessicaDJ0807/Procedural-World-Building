import type { Creature } from './skeleton'

/**
 * Gaits as data: a duty factor and one phase offset per leg.
 *
 * Every leg runs the same cycle, 0 → 1. A leg is on the ground (stance) for
 * the first `duty` of its cycle and in the air (swing) for the rest; its
 * cycle starts `offset` later than the clock. That is the whole of a gait —
 * walk, trot, tripod and wave differ only in these numbers — which is why a
 * creature with a different leg count needs a different table, not different
 * code. The patterns are the ones animals use:
 *
 *   2 legs   alternating: left 0, right ½. Running drops the duty below ½,
 *            so both feet are off the ground at once — the flight phase.
 *   4 legs   walk: lateral sequence, left hind → left fore → right hind →
 *            right fore, a quarter cycle apart, three feet down at a time.
 *            Run: trot, diagonal pairs together.
 *   6 legs   alternating tripod: front and back on one side with the middle
 *            on the other, three legs always down — a stable triangle.
 *   8 legs   walk: a wave gait, each leg lifting just after the one behind
 *            it, sides half a cycle apart. Run: alternating tetrapods.
 *   radial   walk: a wave around the ring; run: alternate legs.
 *
 * A legless body has no feet to phase; it slithers (animate.ts).
 */
export type Gait = 'idle' | 'walk' | 'run'

export type GaitPattern = { name: string; duty: number; offsets: number[]; groups: string }

export function gaitPattern(c: Creature, mode: 'walk' | 'run'): GaitPattern {
  const n = c.limbs.length
  if (n === 0) return { name: 'Lateral undulation', duty: 1, offsets: [], groups: 'A travelling wave down the spine pushes against the ground.' }
  const radial = c.genome.symmetry === 'radial' && n >= 4
  if (radial) {
    return mode === 'walk'
      ? { name: 'Radial wave', duty: 0.75, offsets: c.limbs.map((_, k) => k / n), groups: 'Each leg lifts after its neighbour, round the ring.' }
      : { name: 'Alternating radial', duty: 0.5, offsets: c.limbs.map((_, k) => (k % 2) * 0.5), groups: 'Every other leg together, alternating.' }
  }
  // Bilateral: limbs come in pairs, front first, left before right.
  const pairs = n / 2
  // A leg touches down when the clock reaches 1 − offset, so a sequence of
  // footfalls is written with negated offsets.
  const off = (fn: (pair: number, right: number) => number) => c.limbs.map((l) => (((fn(l.pair, l.side > 0 ? 1 : 0) % 1) + 1) % 1))
  if (n === 2) {
    return mode === 'walk'
      ? { name: 'Alternating biped walk', duty: 0.62, offsets: [0, 0.5], groups: 'Left, then right, half a cycle apart; both feet down at the changeover.' }
      : { name: 'Biped run', duty: 0.36, offsets: [0, 0.5], groups: 'Left, then right; each foot down for under half the cycle, so the body flies between.' }
  }
  if (n === 4) {
    return mode === 'walk'
      ? {
          name: 'Lateral-sequence walk',
          duty: 0.7,
          // Footfalls LH, LF, RH, RF at clock 0, ¼, ½, ¾.
          offsets: off((pair, right) => -((pair === 0 ? 0.25 : 0) + right * 0.5)),
          groups: 'Left hind, left fore, right hind, right fore — a quarter cycle apart, never fewer than two feet down.',
        }
      : { name: 'Trot', duty: 0.45, offsets: off((pair, right) => ((pair + right) % 2) * 0.5), groups: 'Diagonal pairs together: left fore with right hind, right fore with left hind.' }
  }
  if (n === 6) {
    return {
      name: 'Alternating tripod',
      duty: mode === 'walk' ? 0.6 : 0.5,
      offsets: off((pair, right) => ((pair + right) % 2) * 0.5),
      groups: 'L1, R2, L3 together, then R1, L2, R3: always a triangle of three feet down.',
    }
  }
  return mode === 'walk'
    ? {
        name: 'Wave gait',
        duty: 0.75,
        // Back to front on each side, the sides half a cycle apart.
        offsets: off((pair, right) => -(pairs - 1 - pair) / pairs + right * 0.5),
        groups: 'Each leg lifts just after the one behind it, a wave running forward; the two sides half a cycle apart.',
      }
    : { name: 'Alternating tetrapod', duty: 0.5, offsets: off((pair, right) => ((pair + right) % 2) * 0.5), groups: 'L1, R2, L3, R4 together, then the other four.' }
}

/** Which legs are on the ground at a phase: for tests and the gait diagram. */
export function stanceAt(p: GaitPattern, phase: number): boolean[] {
  return p.offsets.map((o) => (((phase + o) % 1) + 1) % 1 < p.duty)
}
