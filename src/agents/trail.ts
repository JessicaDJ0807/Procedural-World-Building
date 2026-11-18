import { WORLD_H, WORLD_W } from './environment'

/**
 * The shared trail: one number per cell, written by every agent and read by
 * every agent. It is the only channel through which agents influence each
 * other — no agent knows where any other agent is going or has been.
 *
 * Three operations, all local:
 * - **deposit**: a walking agent adds trail where it stands, in proportion to
 *   the distance it walked, so a fast agent and a slow one mark a route equally
 *   per metre rather than the slow one marking it more.
 * - **evaporation**: every cell decays by exp(−rate·dt). Without it every
 *   route ever walked would stay attractive forever and the colony could never
 *   change its mind; it is what makes the trail a memory with a half-life.
 * - **diffusion**: a small blur, so a trail one agent wide is sensed from a
 *   cell or two away. Blocked cells take no part, so trail does not soak
 *   through walls.
 */
export class TrailField {
  readonly data = new Float32Array(WORLD_W * WORLD_H)
  private readonly scratch = new Float32Array(WORLD_W * WORLD_H)
  private readonly sorted = new Float32Array(WORLD_W * WORLD_H)
  blocked: Uint8Array

  constructor(blocked: Uint8Array) {
    this.blocked = blocked
  }

  clear() {
    this.data.fill(0)
  }

  /** Bilinear splat, so a path drawn at an angle is as smooth as one along an axis. */
  deposit(x: number, y: number, amount: number) {
    const fx = x - 0.5
    const fy = y - 0.5
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const tx = fx - i
    const ty = fy - j
    this.add(i, j, amount * (1 - tx) * (1 - ty))
    this.add(i + 1, j, amount * tx * (1 - ty))
    this.add(i, j + 1, amount * (1 - tx) * ty)
    this.add(i + 1, j + 1, amount * tx * ty)
  }

  private add(i: number, j: number, v: number) {
    if (i < 0 || j < 0 || i >= WORLD_W || j >= WORLD_H) return
    const c = j * WORLD_W + i
    if (!this.blocked[c]) this.data[c] += v
  }

  sample(x: number, y: number): number {
    const fx = x - 0.5
    const fy = y - 0.5
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const tx = fx - i
    const ty = fy - j
    return (
      this.at(i, j) * (1 - tx) * (1 - ty) +
      this.at(i + 1, j) * tx * (1 - ty) +
      this.at(i, j + 1) * (1 - tx) * ty +
      this.at(i + 1, j + 1) * tx * ty
    )
  }

  private at(i: number, j: number): number {
    if (i < 0 || j < 0 || i >= WORLD_W || j >= WORLD_H) return 0
    return this.data[j * WORLD_W + i]
  }

  /**
   * One explicit step of evaporation and diffusion.
   *
   * `diffusion` is in cells² per second. The explicit scheme is stable while
   * diffusion·dt stays under 0.25 per cell; at the fixed 1/30 s step and the
   * rate the simulation uses, it is 0.02 — an order of magnitude inside.
   */
  step(dt: number, evaporation: number, diffusion: number) {
    const keep = Math.exp(-evaporation * dt)
    const k = Math.min(0.2, diffusion * dt)
    const { data, scratch, blocked } = this
    for (let j = 0; j < WORLD_H; j++) {
      for (let i = 0; i < WORLD_W; i++) {
        const c = j * WORLD_W + i
        if (blocked[c]) {
          scratch[c] = 0
          continue
        }
        const v = data[c]
        // A blocked or off-grid neighbour reflects: it contributes this cell's
        // own value, so nothing flows into the wall and mass is conserved.
        const l = i > 0 && !blocked[c - 1] ? data[c - 1] : v
        const r = i < WORLD_W - 1 && !blocked[c + 1] ? data[c + 1] : v
        const u = j > 0 && !blocked[c - WORLD_W] ? data[c - WORLD_W] : v
        const d = j < WORLD_H - 1 && !blocked[c + WORLD_W] ? data[c + WORLD_W] : v
        scratch[c] = (v + k * (l + r + u + d - 4 * v)) * keep
      }
    }
    data.set(scratch)
  }

  total(): number {
    let sum = 0
    for (let c = 0; c < this.data.length; c++) sum += this.data[c]
    return sum
  }

  /**
   * The share of all trail held by the busiest `fraction` of walkable cells.
   *
   * If trail were spread evenly over the ground this would equal `fraction`;
   * if it were all on one narrow path it would approach 1. It is the single
   * number for "have the agents agreed on routes", and is independent of how
   * much trail there is in total — which evaporation and agent count change.
   */
  concentration(fraction = 0.05): number {
    let n = 0
    let total = 0
    for (let c = 0; c < this.data.length; c++) {
      if (this.blocked[c]) continue
      this.sorted[n++] = this.data[c]
      total += this.data[c]
    }
    if (total <= 1e-9 || n === 0) return 0
    const view = this.sorted.subarray(0, n)
    view.sort()
    const top = Math.max(1, Math.round(n * fraction))
    let sum = 0
    for (let c = n - top; c < n; c++) sum += view[c]
    return sum / total
  }
}
