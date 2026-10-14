#!/usr/bin/env node
/**
 * Fetch the buildings across the river from Roosevelt Island and write them
 * as context for the Site page.
 *
 *   node scripts/fetch-roosevelt-context.mjs
 *
 * Writes public/site/roosevelt-context.json: the Manhattan and Queens
 * footprints within 1.2 km of the island's long axis, as an outline and a
 * roof height each — massing only, drawn hazy behind the island. Nothing is
 * simulated on them.
 *
 * A separate file and script from fetch-roosevelt-island.mjs on purpose: the
 * island snapshot is what every number in the docs was measured on, and
 * re-fetching it to add scenery would quietly move them. This reads that
 * snapshot's origin, so the two line up, and leaves it alone.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ISLAND = join(ROOT, 'public', 'site', 'roosevelt-island.json')
const OUT = join(ROOT, 'public', 'site', 'roosevelt-context.json')
const FEET = 0.3048
/** How far from the island's axis to reach: across the river and a few blocks in, on each side. */
const REACH = 1200
/** Coarser than the island's 0.2 m: these are seen from a kilometre away, through haze. */
const SIMPLIFY = 0.5

function projector(lon0, lat0) {
  const phi = (lat0 * Math.PI) / 180
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

/** A closed ring, split at its farthest vertex before simplifying (see the island script). */
function ring(pts) {
  if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts = pts.slice(0, -1)
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
  return out.length >= 3 ? out.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]) : null
}

function inside(r, x, y) {
  let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]
    const [xj, yj] = r[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

async function main() {
  const island = JSON.parse(await readFile(ISLAND, 'utf8'))
  const { lon: lon0, lat: lat0 } = island.origin
  const project = projector(lon0, lat0)
  // The island's long axis, from its two farthest outline points.
  const pts = island.island
  let best = 0
  let A = pts[0]
  let B = pts[1]
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = (pts[j][0] - pts[i][0]) ** 2 + (pts[j][1] - pts[i][1]) ** 2
      if (d > best) {
        best = d
        A = pts[i]
        B = pts[j]
      }
    }
  }
  const len = Math.sqrt(best)
  const ux = (B[0] - A[0]) / len
  const uz = (B[1] - A[1]) / len
  // A box around the island and its reach, in degrees, for the query.
  const mLat = 111132.92
  const mLon = 111412.84 * Math.cos((lat0 * Math.PI) / 180)
  const xs = pts.map((p) => p[0])
  const zs = pts.map((p) => p[1])
  const pad = REACH + 200
  const west = lon0 + (Math.min(...xs) - pad) / mLon
  const east = lon0 + (Math.max(...xs) + pad) / mLon
  const north = lat0 - (Math.min(...zs) - pad) / mLat
  const south = lat0 - (Math.max(...zs) + pad) / mLat

  const url = new URL('https://data.cityofnewyork.us/resource/5zhs-2jue.json')
  url.searchParams.set('$where', `within_box(the_geom,${north},${west},${south},${east})`)
  url.searchParams.set('$select', 'height_roof,feature_code,the_geom')
  url.searchParams.set('$limit', '50000')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const rows = await res.json()

  const buildings = []
  for (const row of rows) {
    const feet = Number(row.height_roof)
    if (!(feet > 10)) continue
    for (const poly of row.the_geom.coordinates) {
      const outline = ring(poly[0].map(project))
      if (!outline) continue
      const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length
      const cz = outline.reduce((s, p) => s + p[1], 0) / outline.length
      // On the island: not context.
      if (inside(island.island, cx, cz)) continue
      // Within reach of the axis, and not far past either end of the island.
      const t = (cx - A[0]) * ux + (cz - A[1]) * uz
      const across = Math.abs((cx - A[0]) * -uz + (cz - A[1]) * ux)
      if (across > REACH || t < -500 || t > len + 500) continue
      buildings.push({ h: Math.round(feet * FEET * 10) / 10, o: outline })
    }
  }
  const out = {
    name: 'Roosevelt Island context',
    fetched: new Date().toISOString().slice(0, 10),
    origin: island.origin,
    source: 'NYC Open Data 5zhs-2jue (Building Footprints): Manhattan and Queens within 1.2 km of the island, outline and roof height (h, metres) only',
    buildings,
  }
  await writeFile(OUT, JSON.stringify(out))
  const verts = buildings.reduce((s, b) => s + b.o.length, 0)
  console.log(`${buildings.length} buildings, ${verts} vertices, tallest ${Math.max(...buildings.map((b) => b.h))} m`)
  console.log(`wrote ${OUT}`)
}

await main()
