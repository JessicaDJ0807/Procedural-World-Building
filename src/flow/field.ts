import { valueNoise } from '../explore/terrain'
import { mulberry32 } from '../noise'

/**
 * A 2D velocity field: one function, asked by every particle.
 *
 *     v(p, t) = current + Σ vortices + curl noise + Σ stirs
 *
 * Every term is **divergence-free** — fluid neither appears nor disappears
 * anywhere in the frame. That is not decoration. A field with sources and
 * sinks herds particles into the sinks and empties the sources within a few
 * seconds, and what is left looks like dust settling, not water moving. An
 * incompressible field can only move particles *around* each other, which is
 * why the streaks keep their spacing and fold into each other the way the
 * reference image does.
 *
 *  - The **current** is uniform: trivially divergence-free.
 *  - A **vortex** is purely tangential, with a speed that depends only on the
 *    distance from its centre; such a field always has zero divergence.
 *  - **Curl noise** is the rotated gradient of a smooth scalar ψ —
 *    v = (∂ψ/∂y, −∂ψ/∂x) — which is divergence-free by construction, however
 *    ψ is made.
 *  - A **stir** is the same trick with a ψ built to push along the drag.
 *
 * Coordinates: y runs −1…1 bottom to top, x runs −aspect…aspect, so a unit is
 * half the viewport's height at any window size.
 */

export type Vortex = {
  /** Position as a fraction of the domain, so a resize keeps the layout. */
  u: number
  v: number
  /** +1 counter-clockwise, −1 clockwise. */
  spin: number
  /** Per-vortex multipliers on the global strength and radius, from the seed. */
  strength: number
  radius: number
}

export type FieldParams = {
  /** Speed of the base current, units per second. */
  current: number
  /** Peak tangential speed of a vortex at its radius, units per second. */
  vortexStrength: number
  /** Radius of peak speed, units. */
  vortexRadius: number
  /** Peak speed contributed by the curl noise, units per second. */
  noise: number
}

export type Stir = { x: number; y: number; ux: number; uy: number; radius: number; life: number }

/** Where vortices may be placed, as a fraction of the domain. Away from the edges. */
const MARGIN = 0.12

export function generateVortices(seed: number, count: number): Vortex[] {
  const rand = mulberry32(seed * 2654435761)
  const out: Vortex[] = []
  for (let i = 0; i < count; i++) {
    // Rejection against the ones already placed, so two never sit on top of
    // each other and cancel. Thirty tries is plenty at these counts.
    let u = 0.5
    let v = 0.5
    for (let attempt = 0; attempt < 30; attempt++) {
      u = MARGIN + rand() * (1 - 2 * MARGIN)
      v = MARGIN + rand() * (1 - 2 * MARGIN)
      if (out.every((o) => Math.hypot(o.u - u, (o.v - v) * 0.6) > 0.16)) break
    }
    out.push({
      u,
      v,
      // Alternating sign, then shuffled by the seed: an all-one-way set adds
      // up to a single giant gyre, which hides the individual vortices.
      spin: (i % 2 === 0 ? 1 : -1) * (rand() < 0.2 ? -1 : 1),
      strength: 0.7 + rand() * 0.6,
      radius: 0.75 + rand() * 0.5,
    })
  }
  return out
}

/**
 * The evaluator, with everything it needs bound once per frame.
 *
 * Returns into a caller-owned pair rather than allocating: it runs twice per
 * particle per frame — forty thousand calls at the default count — and a
 * fresh object each time would be most of the garbage the page makes.
 */
export class FlowField {
  aspect = 1
  time = 0
  params: FieldParams = { current: 0.3, vortexStrength: 0.9, vortexRadius: 0.2, noise: 0.08 }
  vortices: Vortex[] = []
  stirs: Stir[] = []
  noiseSeed = 1

  // Resolved per frame: vortex centres in world units, radius, peak speed.
  private vx = new Float32Array(32)
  private vy = new Float32Array(32)
  private vr = new Float32Array(32)
  private vs = new Float32Array(32)
  private count = 0

  /** Converts the stored vortices to world space. Call once per frame, before sampling. */
  prepare() {
    this.count = Math.min(this.vortices.length, 32)
    for (let i = 0; i < this.count; i++) {
      const v = this.vortices[i]
      this.vx[i] = (v.u * 2 - 1) * this.aspect
      this.vy[i] = v.v * 2 - 1
      this.vr[i] = this.params.vortexRadius * v.radius
      this.vs[i] = this.params.vortexStrength * v.strength * v.spin
    }
  }

  /** Velocity at (x, y), written into out[0], out[1]. */
  sample(x: number, y: number, out: Float32Array) {
    let ux = this.params.current
    let uy = 0

    for (let i = 0; i < this.count; i++) {
      const dx = x - this.vx[i]
      const dy = y - this.vy[i]
      const r2 = dx * dx + dy * dy
      const R = this.vr[i]
      const q = r2 / (R * R)
      // Skipped only past 6.3R, where the envelope is e^-19.5 ≈ 3×10⁻⁹. The
      // first cutoff was 4R (e^-7.5): small, but a step in velocity, and the
      // divergence check read a stencil straddling it as max |∇·v| = 0.41 in
      // a field that is divergence-free on paper.
      if (q > 40) continue
      // Tangential speed s·(r/R)·e^{(1−r²/R²)/2}: solid-body rotation at the
      // core, a peak of exactly s at r = R, then a Gaussian fall to nothing.
      // A point vortex's 1/r would be infinite at the centre and would still
      // be pulling at the far edge of the frame; this one is neither.
      // Dividing by r for the unit tangent cancels the r in the profile, so
      // the speed term is just s/R·envelope.
      const k = (this.vs[i] / R) * Math.exp(0.5 * (1 - q))
      ux += -dy * k
      uy += dx * k
    }

    if (this.params.noise > 0) {
      // Curl of a two-octave value-noise potential, by central differences.
      // ψ drifts slowly with time, so the fine structure evolves without
      // anything having to be animated by hand.
      const e = 0.01
      const t = this.time * 0.15
      const psi = (px: number, py: number) =>
        valueNoise(px * 1.6 + t, py * 1.6 - t * 0.7, this.noiseSeed) +
        0.5 * valueNoise(px * 3.4 - t * 1.3, py * 3.4 + t, this.noiseSeed + 7)
      const dpdy = (psi(x, y + e) - psi(x, y - e)) / (2 * e)
      const dpdx = (psi(x + e, y) - psi(x - e, y)) / (2 * e)
      // The raw gradient of this ψ peaks around 3; scaled so `noise` reads as
      // a speed in the same units as the current.
      const n = this.params.noise / 3
      ux += dpdy * n
      uy += -dpdx * n
    }

    for (const s of this.stirs) {
      if (s.life < 0.01) continue
      const dx = x - s.x
      const dy = y - s.y
      const R2 = s.radius * s.radius
      const q = (dx * dx + dy * dy) / R2
      if (q > 25) continue // e^-25: no step for a stencil to find
      // ψ = (u × d)·g with g a Gaussian. Its curl is exactly u at the centre
      // and closes into two counter-rotating eddies either side — a dipole,
      // which is what a stirring finger leaves in real water. A plain
      // "push along the drag" blob would be a source in front and a sink
      // behind, and would sweep particles into a hole.
      const g = Math.exp(-q) * s.life
      const cross = s.ux * dy - s.uy * dx
      ux += (s.ux - (2 * dy * cross) / R2) * g
      uy += (s.uy + (2 * dx * cross) / R2) * g
    }

    out[0] = ux
    out[1] = uy
  }

  /** Stirs decay exponentially; spent ones are dropped. */
  decay(dt: number, halfLife = 0.8) {
    const k = Math.pow(0.5, dt / halfLife)
    for (const s of this.stirs) s.life *= k
    this.stirs = this.stirs.filter((s) => s.life > 0.01)
  }

  /** Max |∇·v| and mean |∇v| over a grid, for the readout's divergence check. */
  divergence(cols = 48, rows = 32): { maxDiv: number; meanGrad: number } {
    this.prepare()
    const a = new Float32Array(2)
    const b = new Float32Array(2)
    const h = 1e-3
    let maxDiv = 0
    let sumGrad = 0
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = ((i + 0.5) / cols) * 2 * this.aspect - this.aspect
        const y = ((j + 0.5) / rows) * 2 - 1
        this.sample(x + h, y, a)
        this.sample(x - h, y, b)
        const dudx = (a[0] - b[0]) / (2 * h)
        const dvdx = (a[1] - b[1]) / (2 * h)
        this.sample(x, y + h, a)
        this.sample(x, y - h, b)
        const dudy = (a[0] - b[0]) / (2 * h)
        const dvdy = (a[1] - b[1]) / (2 * h)
        maxDiv = Math.max(maxDiv, Math.abs(dudx + dvdy))
        sumGrad += Math.hypot(dudx, dudy, dvdx, dvdy)
      }
    }
    return { maxDiv, meanGrad: sumGrad / (cols * rows) }
  }
}
