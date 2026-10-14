#!/usr/bin/env node
/**
 * Fetch Roosevelt Island from NYC Open Data and write a site snapshot.
 *
 *   node scripts/fetch-roosevelt-island.mjs
 *
 * Writes public/site/roosevelt-island.json. The app reads only that file and
 * never calls the API itself, so a figure captured today and the numbers
 * beside it can be reproduced next year even though the city edits these
 * datasets daily. Re-running the script is the deliberate way to pick up
 * those edits, and the snapshot records when it was fetched.
 *
 * ## What comes from where
 *
 * - The **island outline** is Manhattan's clipped borough boundary, the one
 *   ring that contains the Cornell Tech campus.
 * - **Buildings** are the Building Footprints layer: an outline, a roof height
 *   above ground, and a ground elevation, all in feet.
 * - **Surfaces** (parks, recreation areas, vacant land, roadbed, sidewalk,
 *   parking, medians) are the city's planimetric layers, digitised from aerial
 *   photographs.
 *
 * NYC Parks' own Parks Properties layer is not used, because it has no
 * Roosevelt Island parks. The island's parks are run by the state, not by NYC
 * Parks. The planimetric "Open Space (Parks)" layer still outlines them; it
 * just leaves them unnamed.
 *
 * ## Coordinates
 *
 * Metres on a local tangent plane centred on the island: +x is east, +z is
 * south, so north is −z and the sun can later be placed by true compass
 * bearing. At 3 km across, a flat projection is off by well under a
 * centimetre, far finer than the footprints themselves.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'site', 'roosevelt-island.json')
const API = 'https://data.cityofnewyork.us/resource'
const FEET = 0.3048
/** A point on the Cornell Tech campus, used to pick the island out of Manhattan. */
const CAMPUS = [-73.9555, 40.7558]

/** Douglas–Peucker tolerance. Below the footprints' own accuracy, so nothing visible is lost. */
const SIMPLIFY = 0.2

const SURFACES = {
  park: { id: 'y6ja-fw4f', label: 'Open Space (Parks)' },
  openSpace: { id: 'b7j8-z8a7', label: 'Open Space (Other)' },
  roadbed: { id: 'i36f-5ih7', label: 'Roadbed' },
  sidewalk: { id: '52n9-sdep', label: 'Sidewalk' },
  parking: { id: '7cgt-uhhz', label: 'Parking Lot' },
  median: { id: 'ees7-4ufv', label: 'Median' },
}

/**
 * Cornell Tech, identified by address in the Department of Buildings job
 * filings (dataset ic3t-wcy2) for each BIN, not by eye. The Tata Innovation
 * Center opened as "The Bridge". 8 North Loop Road is a one-storey campus
 * building the filings do not name.
 */
const CAMPUS_BUILDINGS = {
  1090299: { name: 'Bloomberg Center', address: '2 West Loop Road' },
  1089785: { name: 'Tata Innovation Center', address: '11 East Loop Road' },
  1089538: { name: 'The House', address: '1 East Loop Road' },
  1090301: { name: 'Graduate Hotel', address: '22 North Loop Road' },
  1090298: { name: 'Verizon Executive Education Center', address: '34 North Loop Road' },
  1090300: { name: '8 North Loop Road', address: '8 North Loop Road' },
}

/** Placeholder and temporary structures are not buildings anyone would plant on. */
const SKIP_FEATURES = new Set(['1003', '1005'])
/** Construction year, not a roof: a fallback for footprints with no height. */
const MISSING_HEIGHT = 3

async function query(id, where, extra = {}) {
  const url = new URL(`${API}/${id}.json`)
  url.searchParams.set('$where', where)
  url.searchParams.set('$limit', '50000')
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

function geometryOf(row) {
  return Object.values(row).find((v) => v && typeof v === 'object' && 'coordinates' in v)
}

/** Every polygon in a feature as [outer, ...holes] rings of [lon, lat]. */
function polygonsOf(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function inside(ring, x, y) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/**
 * Most of a polygon's outer vertices on the island. A centroid test fails for
 * the long thin rings — a sidewalk wrapped around a block has its centroid in
 * the middle of the road — and a single vertex test lets in the Queens
 * waterfront where it touches the bounding box.
 */
function onIsland(island, polygon) {
  const outer = polygon[0]
  let n = 0
  for (const [x, y] of outer) if (inside(island, x, y)) n++
  return n / outer.length > 0.5
}

function projector(lon0, lat0) {
  const phi = (lat0 * Math.PI) / 180
  // Metres per degree on the WGS84 ellipsoid at this latitude.
  const mLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi)
  const mLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi)
  return ([lon, lat]) => [(lon - lon0) * mLon, -(lat - lat0) * mLat]
}

function simplify(points, tol) {
  if (points.length < 4) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, az] = points[a]
    const [bx, bz] = points[b]
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz) || 1
    let worst = -1
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i][0] - ax) * dz - (points[i][1] - az) * dx) / len
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (worst > tol) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

const round = (v) => Math.round(v * 100) / 100

/**
 * A closed ring, projected and simplified, without the repeated closing point.
 *
 * Douglas–Peucker measures distance from the chord between the two ends, and
 * a closed ring's ends are the same point — the chord has no direction and
 * every vertex looks redundant. So the ring is cut at the vertex farthest from
 * its start and the two halves are simplified separately.
 */
function ring(project, coords) {
  const pts = coords.map(project)
  if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop()
  if (pts.length < 3) return null
  let far = 0
  let best = -1
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1])
    if (d > best) {
      best = d
      far = i
    }
  }
  const a = simplify(pts.slice(0, far + 1), SIMPLIFY)
  const b = simplify([...pts.slice(far), pts[0]], SIMPLIFY)
  const out = [...a.slice(0, -1), ...b.slice(0, -1)]
  return out.length >= 3 && area(out) > 0.5 ? out.map(([x, z]) => [round(x), round(z)]) : null
}

function polygon(project, rings) {
  const out = rings.map((r) => ring(project, r))
  return out[0] ? out.filter(Boolean) : null
}

function area(r) {
  let s = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return Math.abs(s) / 2
}

async function main() {
  const [borough] = await query('gthc-hcne', "boroname='Manhattan'")
  const islandLonLat = polygonsOf(geometryOf(borough)).find((p) => inside(p[0], ...CAMPUS))[0]

  const lons = islandLonLat.map((p) => p[0])
  const lats = islandLonLat.map((p) => p[1])
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2
  const project = projector(lon0, lat0)
  const box = `${Math.max(...lats)},${Math.min(...lons)},${Math.min(...lats)},${Math.max(...lons)}`

  const island = ring(project, islandLonLat)

  const footprintRows = await query('5zhs-2jue', `within_box(the_geom,${box})`)
  const buildings = []
  for (const row of footprintRows) {
    if (SKIP_FEATURES.has(row.feature_code)) continue
    for (const rings of polygonsOf(geometryOf(row))) {
      if (!onIsland(islandLonLat, rings)) continue
      const outline = polygon(project, rings)
      if (!outline) continue
      const feet = Number(row.height_roof)
      const campus = CAMPUS_BUILDINGS[row.bin]
      buildings.push({
        bin: Number(row.bin),
        ...(campus ? { name: campus.name, address: campus.address, campus: true } : {}),
        height: feet > 0 ? round(feet * FEET) : MISSING_HEIGHT,
        ...(feet > 0 ? {} : { heightMissing: true }),
        ground: round(Number(row.ground_elevation || 0) * FEET),
        year: Number(row.construction_year) || null,
        feature: Number(row.feature_code),
        outline,
      })
    }
  }

  const surfaces = {}
  for (const [key, { id }] of Object.entries(SURFACES)) {
    const rows = await query(id, `within_box(the_geom,${box})`)
    surfaces[key] = []
    for (const row of rows) {
      for (const rings of polygonsOf(geometryOf(row))) {
        if (!onIsland(islandLonLat, rings)) continue
        const p = polygon(project, rings)
        if (!p) continue
        // Open Space (Other) mixes things a plant cares about very
        // differently: recreation areas (lawns, playgrounds), vacant lots,
        // and the rest (cemeteries and the like), by subtype code.
        if (key === 'openSpace') {
          const code = String(row.sub_featur ?? '')
          const kind = code.startsWith('251') ? 'recreation' : code.startsWith('252') ? 'vacant' : 'openSpace'
          surfaces[kind] ??= []
          surfaces[kind].push(p)
        } else {
          surfaces[key].push(p)
        }
      }
    }
    if (!surfaces[key].length) delete surfaces[key]
  }

  const snapshot = {
    name: 'Roosevelt Island',
    fetched: new Date().toISOString().slice(0, 10),
    origin: { lon: lon0, lat: lat0 },
    units: 'metres; +x east, +z south (north is -z); heights above local ground',
    sources: {
      island: 'NYC Open Data gthc-hcne (Borough Boundaries, clipped to shoreline)',
      buildings: 'NYC Open Data 5zhs-2jue (Building Footprints)',
      campus: 'Cornell Tech identified by address in DOB Job Application Filings (ic3t-wcy2)',
      ...Object.fromEntries(Object.entries(SURFACES).map(([k, s]) => [k, `NYC Open Data ${s.id} (Planimetric ${s.label})`])),
    },
    island,
    buildings,
    surfaces,
  }

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(snapshot))

  const missing = buildings.filter((b) => b.heightMissing).length
  console.log(`island: ${island.length} vertices, ${Math.round(area(island)).toLocaleString()} m²`)
  console.log(`buildings: ${buildings.length} (${buildings.filter((b) => b.campus).length} Cornell Tech, ${missing} without a height)`)
  for (const [k, list] of Object.entries(surfaces)) {
    const m2 = list.reduce((s, p) => s + area(p[0]) - p.slice(1).reduce((h, r) => h + area(r), 0), 0)
    console.log(`${k}: ${list.length} polygons, ${Math.round(m2).toLocaleString()} m²`)
  }
  console.log(`wrote ${OUT}`)
}

await main()
