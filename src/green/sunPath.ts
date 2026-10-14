import type { Building, Volume } from './building'
import { rayHits } from './fields'

/**
 * Sunlight over a whole day, for a real place: the sun's actual path across
 * the sky at a latitude and date, with every building's shadow at every step.
 *
 * The invented building's sunlight field is one sun at a fixed 38° and a
 * chosen bearing — enough to ask "what does light from this side do". A real
 * site asks something else: over the day, how much sun does this wall get?
 * A north wall in Manhattan sees direct sun only early and late in summer and
 * never in winter; a roof sees it all day; a low building beside a tower sees
 * whatever the tower lets through. None of that is one direction.
 *
 * ## The sun's position
 *
 * Standard solar geometry, in local solar time (the sun is due south at noon):
 *
 *     sin(elevation) = sin φ sin δ + cos φ cos δ cos H
 *     azimuth        = atan2(−sin H, tan δ cos φ − sin φ cos H)   (from north, east positive)
 *
 * φ is the latitude, δ the declination (+23.44° at the June solstice, 0 at
 * the equinoxes, −23.44° in December) and H the hour angle, 15° per hour from
 * noon. Solar time is not clock time: at Roosevelt Island's longitude (73.96° W)
 * solar noon is 56 minutes after noon on summer clocks and 4 minutes before it
 * in winter, and the equation of time moves it by up to a quarter of an hour
 * either way over the year.
 * Neither changes how much sun a wall gets in a day, only when.
 *
 * ## How much light
 *
 * Direct sunlight on a surface is the beam's intensity times the cosine of the
 * angle it arrives at. The beam is weaker when the sun is low, because it
 * crosses more air; Meinel's clear-sky approximation gives
 *
 *     I = 1.353 × 0.7^(AM^0.678) kW/m²,   AM = 1 / sin(elevation)
 *
 * — 0.95 kW/m² with the sun overhead, 0.42 at 10°. Clouds are not modelled:
 * this is a clear day, which is the right baseline for comparing walls with
 * each other, and wrong for absolute totals.
 */

export type Season = 'june' | 'equinox' | 'december'

export const SEASONS: { id: Season; label: string; date: string; declination: number }[] = [
  { id: 'june', label: 'June', date: '21 June', declination: 23.44 },
  { id: 'equinox', label: 'Equinox', date: '20 March / 22 September', declination: 0 },
  { id: 'december', label: 'December', date: '21 December', declination: -23.44 },
]

export type SunSample = {
  /** Unit vector toward the sun, +x east, +y up, +z south. */
  dir: [number, number, number]
  elevation: number
  /** Direct beam intensity, kW/m². */
  intensity: number
  /** Hours this sample stands for. */
  hours: number
  /** Solar time at the sample's middle, in hours (12 = solar noon). */
  time: number
}

const RAD = Math.PI / 180
/** Below this the beam is weak and the air-mass formula unreliable; the sun counts as down. */
const MIN_ELEVATION = 2 * RAD
const STEP_HOURS = 0.5

export function beamIntensity(elevation: number): number {
  const airMass = 1 / Math.sin(elevation)
  return 1.353 * Math.pow(0.7, Math.pow(airMass, 0.678))
}

/** The sun's positions over one day, one per half hour of daylight, taken at the middle of each half hour. */
export function sunSamples(latitudeDeg: number, declinationDeg: number): SunSample[] {
  const phi = latitudeDeg * RAD
  const delta = declinationDeg * RAD
  const samples: SunSample[] = []
  for (let t = STEP_HOURS / 2; t < 24; t += STEP_HOURS) {
    const H = (t - 12) * 15 * RAD
    const sinEl = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H)
    const elevation = Math.asin(sinEl)
    if (elevation < MIN_ELEVATION) continue
    const azimuth = Math.atan2(-Math.sin(H), Math.tan(delta) * Math.cos(phi) - Math.sin(phi) * Math.cos(H))
    const c = Math.cos(elevation)
    samples.push({
      // North is −z: an azimuth of 0 points to −z, 90° (east) to +x.
      dir: [c * Math.sin(azimuth), sinEl, -c * Math.cos(azimuth)],
      elevation,
      intensity: beamIntensity(elevation),
      hours: STEP_HOURS,
      time: t,
    })
  }
  return samples
}

/** Direct sunlight on open flat ground over a day, kWh/m². The yardstick every cell is measured against. */
export function horizontalTotal(samples: SunSample[]): number {
  return samples.reduce((sum, s) => sum + s.intensity * s.dir[1] * s.hours, 0)
}

type Box = { vol: Volume; x0: number; x1: number; z0: number; z1: number; cx: number; cz: number; r: number }

function boxOf(vol: Volume): Box {
  const xs = vol.polygon.map((p) => p[0])
  const zs = vol.polygon.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const z0 = Math.min(...zs)
  const z1 = Math.max(...zs)
  return { vol, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2 }
}

/** Whether a ray could reach a box before climbing over it: a 2D slab test up to the travel at which it clears the top. */
function rayNearBox(box: Box, ox: number, y: number, oz: number, hx: number, hz: number, rise: number): boolean {
  const tMax = (box.vol.y1 - y) / rise
  if (tMax <= 0) return false
  let t0 = 0
  let t1 = tMax
  if (Math.abs(hx) < 1e-12) {
    if (ox < box.x0 || ox > box.x1) return false
  } else {
    let a = (box.x0 - ox) / hx
    let c = (box.x1 - ox) / hx
    if (a > c) [a, c] = [c, a]
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, c)
  }
  if (Math.abs(hz) < 1e-12) {
    if (oz < box.z0 || oz > box.z1) return false
  } else {
    let a = (box.z0 - oz) / hz
    let c = (box.z1 - oz) / hz
    if (a > c) [a, c] = [c, a]
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, c)
  }
  return t0 <= t1
}

export type DaySun = {
  /** Direct sunlight over the day, as a fraction of what open flat ground gets on the June solstice. */
  light: Float32Array
  /** Hours of direct sun: half hours in which the cell faces the sun and nothing stands in the way. */
  hours: Float32Array
  /** The yardstick, kWh/m² — open flat ground in June. */
  reference: number
  /** This day's total on open flat ground, kWh/m², for comparison with the reference. */
  openGround: number
  samples: SunSample[]
  ms: number
}

/**
 * Direct sunlight and sun hours for every cell over one day.
 *
 * Each half hour, each cell facing the sun casts one ray toward it through
 * every volume — its own building's, its neighbours', and any context. A
 * whole day at 0.5 m cells over the campus is about thirty passes over two
 * hundred thousand cells, so two filters keep it fast without changing the
 * answer: a volume is skipped for the whole pass if it lies too far from the
 * buildings, against the sun, to shade them at that sun height; and for each
 * cell, a volume whose bounding box the ray climbs over first is skipped
 * before its edges are tested.
 */
export function computeDaySun(b: Building, latitudeDeg: number, declinationDeg: number): DaySun {
  const start = performance.now()
  const samples = sunSamples(latitudeDeg, declinationDeg)
  const reference = horizontalTotal(sunSamples(latitudeDeg, 23.44))
  const light = new Float32Array(b.count)
  const hours = new Float32Array(b.count)
  const boxes = b.volumes.map(boxOf)

  // The cells' own extent, for the per-pass filter.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < b.count; i++) {
    minX = Math.min(minX, b.px[i])
    maxX = Math.max(maxX, b.px[i])
    minZ = Math.min(minZ, b.pz[i])
    maxZ = Math.max(maxZ, b.pz[i])
  }
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2

  for (const s of samples) {
    const [lx, ly, lz] = s.dir
    const horizontal = Math.hypot(lx, lz)
    const hx = lx / horizontal
    const hz = lz / horizontal
    const rise = ly / horizontal
    // A volume can only shade these cells if it lies within its own shadow's
    // length of them, toward the sun: near the segment from their centre out
    // to that length along the sun's bearing.
    const near = boxes.filter((box) => {
      const reach = box.vol.y1 / rise
      const t = Math.max(0, Math.min(reach, (box.cx - cx) * hx + (box.cz - cz) * hz))
      return Math.hypot(box.cx - (cx + hx * t), box.cz - (cz + hz * t)) < radius + box.r
    })
    const weight = s.intensity * s.hours

    for (let i = 0; i < b.count; i++) {
      const facing = b.nx[i] * lx + b.ny[i] * ly + b.nz[i] * lz
      if (facing <= 0) continue
      const ox = b.px[i] + b.nx[i] * 1e-3
      const oz = b.pz[i] + b.nz[i] * 1e-3
      const y = b.py[i]
      let blocked = false
      for (const box of near) {
        if (rayNearBox(box, ox, y, oz, hx, hz, rise) && rayHits(box.vol, ox, y, oz, hx, hz, rise)) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      light[i] += weight * facing
      hours[i] += s.hours
    }
  }

  for (let i = 0; i < b.count; i++) light[i] /= reference
  return { light, hours, reference, openGround: horizontalTotal(samples), samples, ms: performance.now() - start }
}
