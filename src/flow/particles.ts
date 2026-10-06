import { mulberry32 } from '../noise'
import type { FlowField } from './field'

/**
 * Particles that carry no behaviour of their own.
 *
 * A particle here is a position, the position it had last frame, an age and a
 * lifetime — nothing else. It does not know about vortices or noise; it asks
 * the one shared field what the velocity is where it stands and moves by that.
 * Every pattern on screen is therefore the field's, made visible.
 *
 * Stored as flat typed arrays, not objects: at 30,000 particles an object per
 * particle is 30,000 allocations the collector has to walk, and the hot loop
 * reads memory in order.
 */
export const MAX_PARTICLES = 30000

/** Floats per segment in the line buffer: two endpoints × (x, y, z). */
const SEGMENT = 6

export class Particles {
  readonly x = new Float32Array(MAX_PARTICLES)
  readonly y = new Float32Array(MAX_PARTICLES)
  readonly px = new Float32Array(MAX_PARTICLES)
  readonly py = new Float32Array(MAX_PARTICLES)
  readonly age = new Float32Array(MAX_PARTICLES)
  readonly life = new Float32Array(MAX_PARTICLES)
  /** Speed at the last step, for colouring. */
  readonly speed = new Float32Array(MAX_PARTICLES)
  count = 0
  private rand: () => number
  private readonly v = new Float32Array(2)

  constructor(seed: number) {
    this.rand = mulberry32(seed)
  }

  reseed(seed: number) {
    this.rand = mulberry32(seed)
  }

  /**
   * A new particle somewhere in the frame.
   *
   * Uniform over the whole domain rather than only at the upstream edge. An
   * inflow edge gives the classic streakline look, but in the lee of a strong
   * vortex the field can be nearly closed, and nothing from upstream ever
   * reaches inside — the vortex core stays empty. Uniform respawn keeps every
   * region populated, so a closed eddy is visible as a closed eddy.
   */
  spawn(i: number, aspect: number) {
    this.x[i] = (this.rand() * 2 - 1) * aspect
    this.y[i] = this.rand() * 2 - 1
    this.px[i] = this.x[i]
    this.py[i] = this.y[i]
    this.age[i] = 0
    // Staggered lifetimes, so particles do not all respawn in the same frame
    // and pulse the image.
    this.life[i] = 2 + this.rand() * 4
  }

  resize(count: number, aspect: number) {
    const next = Math.min(Math.max(0, Math.round(count)), MAX_PARTICLES)
    for (let i = this.count; i < next; i++) {
      this.spawn(i, aspect)
      // Fresh particles start part-way through a life, so a count change does
      // not create a cohort that all expires together six seconds later.
      this.age[i] = this.rand() * this.life[i]
    }
    this.count = next
  }

  /**
   * One step of the midpoint method (RK2), then respawn what left or expired.
   *
   * Euler takes the velocity at the start of the step and goes in a straight
   * line, so around a vortex every step lands slightly outside the circle it
   * was on and particles spiral outward — an error that looks like physics.
   * The midpoint method samples again half-way along and uses that, which
   * cancels the first-order drift for one extra field evaluation. Measured in
   * the Topic 7 chapter.
   *
   * Returns the number of field evaluations, for the readout.
   */
  step(field: FlowField, dt: number, aspect: number): number {
    const v = this.v
    const margin = 0.05
    for (let i = 0; i < this.count; i++) {
      const x0 = this.x[i]
      const y0 = this.y[i]
      field.sample(x0, y0, v)
      const mx = x0 + v[0] * dt * 0.5
      const my = y0 + v[1] * dt * 0.5
      field.sample(mx, my, v)
      this.px[i] = x0
      this.py[i] = y0
      this.x[i] = x0 + v[0] * dt
      this.y[i] = y0 + v[1] * dt
      this.speed[i] = Math.hypot(v[0], v[1])
      this.age[i] += dt
      if (
        this.age[i] > this.life[i] ||
        this.x[i] < -aspect - margin ||
        this.x[i] > aspect + margin ||
        this.y[i] < -1 - margin ||
        this.y[i] > 1 + margin
      ) {
        // Respawned with prev = current, so no segment is drawn across the
        // frame from where it died to where it was reborn.
        this.spawn(i, aspect)
      }
    }
    return this.count * 2
  }

  /**
   * Writes one segment per particle, previous → current, with a colour from
   * its speed and a fade in and out over its life.
   */
  writeSegments(positions: Float32Array, colours: Float32Array, speedScale: number) {
    for (let i = 0; i < this.count; i++) {
      const o = i * SEGMENT
      positions[o] = this.px[i]
      positions[o + 1] = this.py[i]
      positions[o + 2] = 0
      positions[o + 3] = this.x[i]
      positions[o + 4] = this.y[i]
      positions[o + 5] = 0

      // Restrained ramp: deep slate-blue when slow, cyan through the fast
      // currents, near-white only at the very fastest. No hue rotation —
      // speed is one quantity, so it gets one hue family.
      const s = Math.min(this.speed[i] * speedScale, 1)
      const r = 0.16 + s * s * 0.78
      const g = 0.3 + s * 0.6
      const b = 0.5 + s * 0.45
      // Fade in over the first half-second and out over the last, so a
      // respawn does not pop.
      const a = Math.min(this.age[i] * 2, 1, (this.life[i] - this.age[i]) * 2)
      // Low per-segment energy: segments add, and inside a vortex the same
      // circle is redrawn by hundreds of particles. At 0.55 the cores
      // saturated to flat white and the structure inside them was lost.
      const k = Math.max(a, 0) * 0.2
      colours[o] = r * k
      colours[o + 1] = g * k
      colours[o + 2] = b * k
      colours[o + 3] = r * k
      colours[o + 4] = g * k
      colours[o + 5] = b * k
    }
  }
}
