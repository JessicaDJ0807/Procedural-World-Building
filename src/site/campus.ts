import type { Building } from '../green/building'
import { buildFromFootprints } from '../green/fromFootprints'
import type { Site } from './siteData'

/**
 * Cell size for the campus. Measured in Node: at 1 m the six buildings are
 * 50,052 cells, built in 0.25 s with a June day of sun in 0.19 s; at 0.5 m
 * they are 202,639 cells, 0.93 s and 0.71 s. Both run in a worker, so the
 * cost is waiting, not freezing. 1 m was enough to read which walls get sun;
 * growth wants 0.5 m, where a vine is a strand rather than a stripe.
 */
export const CAMPUS_CELL = 0.5

export type Campus = {
  building: Building
  /** For each cell, the index into `site.buildings` of the building it is on. */
  owner: Int16Array
  /** The campus buildings, as indices into `site.buildings`. */
  indices: number[]
  ms: number
}

/**
 * The Cornell Tech buildings as cells, with every other building on the
 * island as a shadow caster that is not grown on.
 */
export function buildCampus(site: Site): Campus {
  const start = performance.now()
  const indices = site.buildings.flatMap((b, i) => (b.campus ? [i] : []))
  const context = site.buildings
    .filter((b) => !b.campus)
    .map((b) => ({ polygon: b.outline[0], y0: 0, y1: b.height }))
  const { building, owner } = buildFromFootprints(
    indices.map((i) => ({ outline: site.buildings[i].outline, height: site.buildings[i].height })),
    CAMPUS_CELL,
    context,
  )
  const siteOwner = owner.map((o) => (o >= 0 ? indices[o] : -1))
  return { building, owner: siteOwner, indices, ms: performance.now() - start }
}
