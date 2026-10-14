/**
 * The site snapshot: Roosevelt Island as NYC Open Data describes it.
 *
 * Written by `scripts/fetch-roosevelt-island.mjs` and read from
 * `public/site/roosevelt-island.json` — never fetched from the API at runtime,
 * so the app and its figures describe one fixed state of the data. See that
 * script for where each layer comes from and how it is projected.
 */

/** [x, z] in metres. +x is east, +z is south: north is −z. */
export type Point = [number, number]
/** An outer ring followed by any holes. Rings are open: the last point is not repeated. */
export type Polygon = Point[][]

export type SiteBuilding = {
  /** Building Identification Number. Not unique: one building can be several footprints. */
  bin: number
  name?: string
  address?: string
  /** One of the Cornell Tech buildings. */
  campus?: boolean
  /** Roof height above the ground at the building's base, in metres. */
  height: number
  /** True when the city has no height on record and `height` is a placeholder. */
  heightMissing?: boolean
  /** Ground elevation at the base, metres above NAVD88. Not used yet: the island is drawn flat. */
  ground: number
  year: number | null
  /** The city's feature code: 2100 building, 5110 garage, 1000 parking, … */
  feature: number
  outline: Polygon
}

export const SURFACE_KINDS = ['recreation', 'park', 'openSpace', 'vacant', 'parking', 'roadbed', 'sidewalk', 'median'] as const
export type SurfaceKind = (typeof SURFACE_KINDS)[number]

export type Site = {
  name: string
  /** The date the snapshot was fetched, YYYY-MM-DD. */
  fetched: string
  origin: { lon: number; lat: number }
  units: string
  sources: Record<string, string>
  island: Point[]
  buildings: SiteBuilding[]
  surfaces: Partial<Record<SurfaceKind, Polygon[]>>
}

export async function loadSite(): Promise<Site> {
  const res = await fetch('/site/roosevelt-island.json')
  if (!res.ok) throw new Error(`Site data: HTTP ${res.status}`)
  return res.json()
}

/** Area of an open ring, by the shoelace formula. */
export function ringArea(ring: Point[]): number {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return Math.abs(s) / 2
}

/** Area of a polygon with its holes taken out. */
export function polygonArea(polygon: Polygon): number {
  return polygon.reduce((sum, ring, i) => sum + (i === 0 ? 1 : -1) * ringArea(ring), 0)
}

export function centroid(ring: Point[]): Point {
  let x = 0
  let z = 0
  for (const p of ring) {
    x += p[0]
    z += p[1]
  }
  return [x / ring.length, z / ring.length]
}
