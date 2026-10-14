import * as THREE from 'three'
import type { SurfaceKind } from './siteData'

/** Ground colours, shared by the viewport and the sidebar's swatches. */
export const SURFACE_COLOURS: Record<SurfaceKind, string> = {
  recreation: '#6d8a4c',
  park: '#5f8443',
  openSpace: '#7d915a',
  vacant: '#9a986c',
  median: '#768656',
  roadbed: '#4b4b4e',
  sidewalk: '#aaa498',
  parking: '#64625e',
}

export type Ramp = { at: number; colour: THREE.Color }[]

const ramp = (stops: [number, string][]): Ramp => stops.map(([at, c]) => ({ at, colour: new THREE.Color(c) }))

/**
 * Sunlight share, dark to warm white: Explore's three sunlight stops, so the
 * two pages read alike.
 */
export const SUN_RAMP = ramp([
  [0, '#1f2023'],
  [0.5, '#6e5c3a'],
  [1, '#f2e0ae'],
])

/**
 * Sun hours, with its stops on the gardeners' thresholds — 3 h (shade to part
 * sun) and 6 h (part to full sun) — rather than spread evenly to 15. Evenly,
 * a wall with six hours, full sun to anyone choosing a plant, came out a dark
 * brown barely lighter than one with none.
 */
export const HOURS_RAMP = ramp([
  [0, '#1f2023'],
  [3, '#5c4a2e'],
  [6, '#c9a463'],
  [15, '#f7eccb'],
])

/** Moisture, dry to wet: Explore's three moisture stops. */
export const MOISTURE_RAMP = ramp([
  [0, '#24282c'],
  [0.5, '#3a5870'],
  [1, '#a3c8e0'],
])

/** A CSS gradient for a ramp's legend, so the legend and the paint cannot drift apart. */
export function rampGradient(r: Ramp): string {
  const end = r[r.length - 1].at
  return `linear-gradient(90deg, ${r.map((s) => `#${s.colour.getHexString()} ${(100 * s.at) / end}%`).join(', ')})`
}

/** The ramp's colour at `value`, written into `out`. Clamped to the first and last stops. */
export function rampColour(r: Ramp, value: number, out: THREE.Color): THREE.Color {
  if (value <= r[0].at) return out.copy(r[0].colour)
  for (let k = 1; k < r.length; k++) {
    if (value <= r[k].at) return out.copy(r[k - 1].colour).lerp(r[k].colour, (value - r[k - 1].at) / (r[k].at - r[k - 1].at))
  }
  return out.copy(r[r.length - 1].colour)
}
