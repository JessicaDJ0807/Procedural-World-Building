import type { Ground } from '../ground'
import type { SiteLayout } from '../site'
import type { Zone } from '../zoning'
import { nearestNode, type Graph } from './graph'

/**
 * What the simulation knows about the city: places with a door, a junction
 * and a capacity. Built once from Experiment E's layout — the same buildings,
 * the same parks — so the simulation runs on the city the earlier experiments
 * generated rather than on one of its own.
 *
 *   house       homes only: about one resident per 45 u² of floor
 *   apartment   homes above, shops and services on the ground floor
 *   tower       offices: about one job per 30 u² of floor
 *   park        a destination with no residents and no jobs
 *
 * The door is a point a unit in front of the building's street face; the
 * junction is the road node nearest to it, which is where every trip to or
 * from the place joins the road graph.
 */
export type PlaceKind = 'house' | 'apartment' | 'tower' | 'park'

export type Place = {
  id: number
  kind: PlaceKind
  /** Index into layout.buildings, or -1 for a park. */
  building: number
  doorX: number
  doorZ: number
  node: number
  residents: number
  jobs: number
  /** Where a marker sits: above the roof, or at the park's centre. */
  markerY: number
  x: number
  z: number
  floors: number
}

export function buildPlaces(layout: SiteLayout, zones: Zone[], graph: Graph, ground: Ground): Place[] {
  const places: Place[] = []
  layout.buildings.forEach((b, i) => {
    const floorArea = b.params.width * b.params.depth
    const floors = b.params.floors
    const fx = Math.sin(b.rot)
    const fz = Math.cos(b.rot)
    const doorX = b.x + fx * (b.params.depth / 2 + 1)
    const doorZ = b.z + fz * (b.params.depth / 2 + 1)
    const kind: PlaceKind = b.type
    const residents =
      kind === 'house' ? Math.max(2, Math.round((floors * floorArea) / 45)) : kind === 'apartment' ? Math.round(((floors - 1) * floorArea) / 45) : 0
    const jobs = kind === 'tower' ? Math.round((floors * floorArea) / 30) : kind === 'apartment' ? Math.round(floorArea / 30) : 0
    places.push({
      id: places.length,
      kind,
      building: i,
      doorX,
      doorZ,
      node: nearestNode(graph, doorX, doorZ),
      residents,
      jobs,
      markerY: b.y + b.result.height + 2.5,
      x: b.x,
      z: b.z,
      floors,
    })
  })
  for (const z of zones) {
    if (z.category !== 'park') continue
    const c = z.plot.centre
    places.push({ id: places.length, kind: 'park', building: -1, doorX: c.x, doorZ: c.z, node: nearestNode(graph, c.x, c.z), residents: 0, jobs: 0, markerY: ground.height(c.x, c.z) + 4, x: c.x, z: c.z, floors: 0 })
  }
  return places
}
