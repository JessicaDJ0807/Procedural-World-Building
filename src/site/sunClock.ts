import type { Season } from '../green/sunPath'

/**
 * Where the sun is over Roosevelt Island on any day, at any clock time — for
 * the scene's light, not the growth.
 *
 * The growth reads three traced days (sunPath.ts); the light you see can be
 * exact for any date and moment, because three.js draws shadows for any sun
 * almost for free. Same solar geometry as sunPath.ts, plus the two
 * corrections that turn solar time into what a New York clock says:
 *
 * - **Longitude and time zone.** Eastern Standard Time is set for 75° W; the
 *   island is at 73.96° W, so solar noon comes 4 minutes before noon.
 * - **Daylight saving**, roughly 10 March to 3 November here, adds an hour.
 *   The exact switch dates move year to year; this is close enough to read.
 * - **The equation of time**, the year's drift of solar noon by up to a
 *   quarter of an hour either way (the usual three-term approximation).
 *
 * Sunrise and sunset use the conventional −0.833° (the sun's radius and the
 * air's bending of light).
 */

const RAD = Math.PI / 180

/** Days are counted from 1 January = 0. */
export const SEASON_DAY: Record<Season, number> = { june: 171, equinox: 78, december: 354 }

/** The growth's year phase (0 = the December solstice) as a day of the year. */
export function dayOfPhase(phase: number): number {
  return (354 + phase * 365) % 365
}

export function declinationOfDay(day: number): number {
  return -23.44 * Math.cos((2 * Math.PI * (day + 10)) / 365)
}

/** The equation of time, in minutes. */
function equationOfTime(day: number): number {
  const B = (2 * Math.PI * (day - 81)) / 365
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B)
}

const daylightSaving = (day: number) => day >= 68 && day <= 306

/** Solar time minus clock time, in hours, on a day at a longitude. */
function clockOffset(day: number, longitude: number): number {
  return (4 * (longitude + 75) + equationOfTime(day)) / 60 - (daylightSaving(day) ? 1 : 0)
}

export type SunNow = {
  /** Unit vector toward the sun: +x east, +y up, +z south. */
  dir: [number, number, number]
  elevation: number
  /** Degrees from north, east positive. */
  azimuth: number
}

export function sunAtSolar(latitude: number, day: number, solarHour: number): SunNow {
  const phi = latitude * RAD
  const delta = declinationOfDay(day) * RAD
  const H = (solarHour - 12) * 15 * RAD
  const sinEl = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H)
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)))
  const azimuth = Math.atan2(-Math.sin(H), Math.tan(delta) * Math.cos(phi) - Math.sin(phi) * Math.cos(H))
  const c = Math.cos(elevation)
  return {
    dir: [c * Math.sin(azimuth), sinEl, -c * Math.cos(azimuth)],
    elevation: elevation / RAD,
    azimuth: ((azimuth / RAD) + 360) % 360,
  }
}

export function sunAtClock(latitude: number, longitude: number, day: number, clockHour: number): SunNow {
  return sunAtSolar(latitude, day, clockHour + clockOffset(day, longitude))
}

export type SunTimes = { sunrise: number; sunset: number; noon: number; length: number }

/** Sunrise, solar noon and sunset as clock hours, and the day's length. */
export function sunTimes(latitude: number, longitude: number, day: number): SunTimes {
  const phi = latitude * RAD
  const delta = declinationOfDay(day) * RAD
  const cosH0 = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(delta)) / (Math.cos(phi) * Math.cos(delta))
  const H0 = Math.acos(Math.max(-1, Math.min(1, cosH0))) / RAD / 15
  const noon = 12 - clockOffset(day, longitude)
  return { sunrise: noon - H0, sunset: noon + H0, noon, length: 2 * H0 }
}

export function formatClock(hour: number): string {
  const h = Math.floor(((hour % 24) + 24) % 24)
  const m = Math.round((hour - Math.floor(hour)) * 60) % 60
  const suffix = h < 12 ? 'am' : 'pm'
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`
}

export function formatDay(day: number): string {
  const d = new Date(Date.UTC(2025, 0, 1 + Math.round(day)))
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/**
 * Where the sun sits while the growth plays: late afternoon, 85% of the way
 * from sunrise to sunset, on whichever day is showing. A fixed clock time was
 * the first plan, but 3 pm puts the equinox sun 40° up — midday light, not
 * the page's golden hour — and 5 pm is after sunset in December. A fixed share
 * of the day keeps the low light every season: 12° up in December at 3:08 pm,
 * 19° at the equinox at 5:16 pm, 23° in June at 6:14 pm, swinging from
 * south-west (225°) to west-north-west (282°).
 */
export const LATE_AFTERNOON = 0.85

export function lateAfternoon(latitude: number, longitude: number, day: number): number {
  const t = sunTimes(latitude, longitude, day)
  return t.sunrise + LATE_AFTERNOON * t.length
}
