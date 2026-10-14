import { SEASONS, computeDaySun } from '../green/sunPath'
import { buildCampus, type Campus } from './campus'
import type { SunSet } from './campusSim'
import { buildRoadside, computeRoadsideSun, type Roadside } from './roadside'
import type { Site } from './siteData'

/**
 * The campus build and the sun, off the main thread.
 *
 * Cutting six buildings into 202,639 cells and tracing a day of sun through
 * every building on the island is about a second for the build and 0.4–0.7 s
 * a day in Node, but took several times that in headless Chrome, whose JIT
 * warms up slowly (the invented building's build ran 3.4 s, 1.8, 1.0, then
 * 0.39 on repeats). Here the page keeps drawing and orbiting while it runs.
 *
 * All three days are traced at once: a year's light is interpolated between
 * them, so a run that cycles the seasons needs every one, and switching the
 * day becomes instant.
 */
export type WorkerRequest = { type: 'build'; site: Site }

export type WorkerReply =
  | { type: 'campus'; campus: Campus }
  | { type: 'suns'; suns: SunSet }
  | { type: 'roadside'; roadside: Roadside; suns: SunSet }

const ctx = self as unknown as Worker

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { site } = event.data
  const campus = buildCampus(site)
  ctx.postMessage({ type: 'campus', campus } satisfies WorkerReply)
  const suns = Object.fromEntries(
    SEASONS.map((s) => [s.id, computeDaySun(campus.building, site.origin.lat, s.declination)]),
  ) as SunSet
  ctx.postMessage({ type: 'suns', suns } satisfies WorkerReply)
  // Then the ground, for the roadside study: 468,875 cells built in about a
  // tenth of a second, and shadows drawn rather than ray-cast, 0.6–0.7 s a day.
  const roadside = buildRoadside(site)
  const roadSuns = Object.fromEntries(
    SEASONS.map((s) => [s.id, computeRoadsideSun(roadside, site.origin.lat, s.declination)]),
  ) as SunSet
  ctx.postMessage({ type: 'roadside', roadside, suns: roadSuns } satisfies WorkerReply)
})
