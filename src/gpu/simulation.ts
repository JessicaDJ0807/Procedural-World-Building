import type * as THREE from 'three'

/** One tunable exposed to the sidebar. */
export type ParamSpec = {
  key: string
  label: string
  info: string
  min: number
  max: number
  step: number
  value: number
  /** How the value reads next to its label. Defaults to two decimals. */
  format?: (value: number) => string
  /** Present when the value is a choice rather than a range. */
  options?: { value: number; label: string }[]
  /**
   * Belongs in the viewport's View popover rather than the sidebar: it changes
   * how the result is looked at, not what the simulation computes. Rare on
   * purpose — on this topic the shader parameters ARE the subject, so appearance
   * alone is not the test.
   */
  view?: boolean
}

/** A named point in a simulation's parameter space. */
export type Preset = {
  value: string
  label: string
  hint: string
  params: Record<string, number>
}

/**
 * Where the pointer is, in both spaces a simulation might want.
 *
 * `x`/`y` are the field's own texture coordinates, for the three simulations
 * that are a grid; `ndcX`/`ndcY` are clip space, for the one that is a camera
 * looking at a 3D scene.
 */
export type Pointer = {
  x: number
  y: number
  ndcX: number
  ndcY: number
  active: boolean
}

export type Stat = { label: string; value: string }

/**
 * One GPU simulation.
 *
 * A factory must allocate nothing until `init` runs, so the page can build one
 * purely to read its parameters and presets without touching the GPU.
 *
 * Deliberately not a React component: these own WebGL resources and a stepping
 * loop, and rebuilding them on a re-render would drop the state they exist to
 * accumulate. The page owns one at a time and disposes it on the way out.
 */
export type Simulation = {
  id: string
  label: string
  /** One line for the selector's explanation. */
  blurb: string
  params: ParamSpec[]
  presets: Preset[]
  /**
   * Whether running this study changes anything from one frame to the next.
   *
   * The four simulations accumulate state, so a running one always needs the
   * next frame. The shading study does not: its surface is fixed, and stepping
   * it only pushes uniforms and advances the turntable — both of which
   * `animating` already reports. Left undefined it means true, so only the
   * study that holds still has to say so.
   */
  accumulates?: boolean

  init(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement): void
  reset(params: Record<string, number>): void
  /**
   * Advances the state by one animation frame.
   *
   * How many sub-steps that is belongs to the simulation, not the page: a wave
   * needs one to stay stable, Gray-Scott needs a dozen to be watchable at all.
   */
  step(params: Record<string, number>, pointer: Pointer): void
  /** Draws the current state. Display-only parameters are applied here. */
  draw(renderer: THREE.WebGLRenderer, params: Record<string, number>): void
  /**
   * True while the view keeps changing with no further input — a turntable
   * turning, a camera still settling under damping.
   *
   * Only the two simulations that own a camera need this. Without it the page
   * would go idle mid-orbit and freeze halfway through the deceleration.
   */
  animating?(params: Record<string, number>): boolean
  resize(width: number, height: number): void
  /** Whatever this simulation can honestly report about itself. */
  stats(): Stat[]
  dispose(): void
}

/** Reads a parameter, falling back to its declared default. */
export function param(
  params: Record<string, number>,
  specs: ParamSpec[],
  key: string,
): number {
  const value = params[key]
  if (value !== undefined) return value
  return specs.find((spec) => spec.key === key)?.value ?? 0
}

/** Every parameter at its default, for seeding page state and Reset. */
export function defaults(specs: ParamSpec[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const spec of specs) out[spec.key] = spec.value
  return out
}
