#!/usr/bin/env node
/**
 * Fetch the landscape of Roosevelt Island south of the Cornell Tech loop road
 * — trees, green areas, footpaths and ground heights — and write it as
 * context for the Site page.
 *
 *   node scripts/fetch-roosevelt-landscape.mjs
 *
 * Writes public/site/roosevelt-landscape.json. A separate file and script
 * from fetch-roosevelt-island.mjs for the same reason as the context
 * buildings: the island snapshot is what the docs' numbers were measured on,
 * and this is scenery. It reads that snapshot's origin and leaves it alone.
 *
 * ## What comes from where
 *
 * The city's planimetric layers stop at the edge of the state's parks: in the
 * island snapshot, everything south of the campus buildings — the campus
 * lawn, Southpoint Park, Four Freedoms Park — is unmapped land, drawn as bare
 * ground. So:
 *
 * - **Trees**, first from NYC Parks' Forestry Tree Points (hn5i-inap), which
 *   carry a trunk diameter and a species; then from OpenStreetMap, which maps
 *   the state parks' trees too (the Four Freedoms allées, Southpoint's
 *   groves). An OSM tree within 2.5 m of a city tree is the same tree and is
 *   dropped. The 2015 street-tree census (uvpi-gqnh) is superseded by the
 *   Forestry points and has none here.
 * - **Green areas and paths** from OpenStreetMap: lawns (landuse=grass),
 *   planted beds (leisure=garden), woods, grassland, the shingle shore, the
 *   park outlines with their names, and footways, steps and pedestrian ways.
 * - **Ground heights** from the city's planimetric Elevation Points
 *   (9uxf-ng6q), in feet: the ground points only (feature code 3000). The
 *   3020 points sit on structures — one is 36 m up, on a campus roof — and are
 *   left out, as are six ground-coded points 44–51 m up, which are the
 *   Queensboro Bridge's deck where it crosses the island.
 *
 * OpenStreetMap data © OpenStreetMap contributors, under the ODbL.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ISLAND = join(ROOT, 'public', 'site', 'roosevelt-island.json')
const OUT = join(ROOT, 'public', 'site', 'roosevelt-landscape.json')
const API = 'https://data.cityofnewyork.us/resource'
/** The main Overpass server, then a public mirror for when it is overloaded. */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
const FEET = 0.3048
/** The landscape zone: the island south of this line (metres, +z south), just north of the campus loop road. */
const ZONE_Z = 520
/** Higher than any ground on the island: the Queensboro Bridge's deck. */
const NOT_GROUND = 15
/** An OSM tree this close to a city tree is the same tree. */
const SAME_TREE = 2.5
const PATH_WIDTH = { footway: 2.5, path: 2, steps: 2.5, pedestrian: 4, cycleway: 3 }
const AREA_KIND = [
  ['landuse', 'grass', 'lawn'],
  ['leisure', 'pitch', 'lawn'],
  ['leisure', 'garden', 'garden'],
  ['natural', 'wood', 'wood'],
  ['natural', 'grassland', 'meadow'],
  ['natural', 'shingle', 'shingle'],
  ['leisure', 'park', 'park'],
]

function projector(lon0, lat0) {
  const phi = (lat0 * Math.PI) / 180
  const mLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi)
  const mLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi)
  return ([lon, lat]) => [(lon - lon0) * mLon, -(lat - lat0) * mLat]
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

const round = ([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]

/** Fetches JSON, retrying a busy server (Overpass answers 429 and 504 under load) up to four times. */
async function json(url, init) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init)
    if (res.ok) return res.json()
    if (attempt >= 4 || ![429, 502, 503, 504].includes(res.status)) throw new Error(`${url.slice(0, 80)}…: HTTP ${res.status}`)
    await new Promise((r) => setTimeout(r, attempt * 10_000))
  }
}

async function main() {
  const island = JSON.parse(await readFile(ISLAND, 'utf8'))
  const { lon: lon0, lat: lat0 } = island.origin
  const project = projector(lon0, lat0)
  const onIsland = ([x, z]) => z >= ZONE_Z && inside(island.island, x, z)
  // The zone's box in degrees, for the queries: the island's south end.
  const xs = island.island.map((p) => p[0])
  const zs = island.island.map((p) => p[1])
  const mLat = 111132.92
  const mLon = 111412.84 * Math.cos((lat0 * Math.PI) / 180)
  const south = lat0 - Math.max(...zs) / mLat - 0.0005
  const north = lat0 - ZONE_Z / mLat + 0.0005
  const west = lon0 + Math.min(...xs) / mLon - 0.0005
  const east = lon0 + Math.max(...xs) / mLon + 0.0005
  const box = `${north},${west},${south},${east}`
  const q = (where) => encodeURIComponent(where)

  // --- trees: the city's first ---
  const forestry = await json(`${API}/hn5i-inap.json?$limit=50000&$select=dbh,genusspecies,location&$where=${q(`within_box(location,${box})`)}`)
  const trees = []
  for (const t of forestry) {
    const p = project(t.location.coordinates)
    if (!onIsland(p)) continue
    const [x, z] = round(p)
    trees.push({ x, z, src: 'nyc', dbh: t.dbh ? Math.round(Number(t.dbh) * 2.54) : undefined, species: t.genusspecies?.split(' - ')[1] })
  }
  const cityTrees = trees.length

  // --- OpenStreetMap: trees, areas, paths ---
  const bbox = `(${south},${west},${north},${east})`
  const query = `[out:json][timeout:90];(node["natural"="tree"]${bbox};way["landuse"="grass"]${bbox};way["leisure"~"^(garden|park|pitch)$"]${bbox};way["natural"~"^(wood|grassland|shingle)$"]${bbox};way["highway"~"^(footway|path|steps|pedestrian|cycleway)$"]${bbox};);out geom;`
  let osm
  for (const server of OVERPASS) {
    try {
      osm = await json(server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'procedural-world-building coursework' },
        body: `data=${encodeURIComponent(query)}`,
      })
      break
    } catch (err) {
      if (server === OVERPASS.at(-1)) throw err
      console.warn(`${server}: ${err.message}; trying the next server`)
    }
  }
  const areas = []
  const paths = []
  let osmTrees = 0
  let duplicates = 0
  for (const e of osm.elements) {
    const tags = e.tags ?? {}
    if (e.type === 'node') {
      const p = project([e.lon, e.lat])
      if (!onIsland(p)) continue
      if (trees.some((t) => t.src === 'nyc' && Math.hypot(t.x - p[0], t.z - p[1]) < SAME_TREE)) {
        duplicates++
        continue
      }
      const [x, z] = round(p)
      trees.push({ x, z, src: 'osm', leaf: tags.leaf_type })
      osmTrees++
      continue
    }
    if (e.type !== 'way' || !e.geometry) continue
    const pts = e.geometry.map((g) => project([g.lon, g.lat]))
    if (!pts.some(onIsland)) continue
    const closed = e.nodes && e.nodes[0] === e.nodes.at(-1)
    const highway = tags.highway
    if (highway) {
      // A closed pedestrian way tagged as an area is a plaza; otherwise a line.
      if (closed && tags.area === 'yes') areas.push({ kind: 'plaza', ring: pts.slice(0, -1).map(round) })
      else paths.push({ kind: highway, width: Number(tags.width) || PATH_WIDTH[highway] || 2, line: pts.map(round) })
      continue
    }
    const kind = AREA_KIND.find(([k, v]) => tags[k] === v)?.[2]
    if (!kind || !closed) continue
    areas.push({ kind, name: tags.name, ring: pts.slice(0, -1).map(round) })
  }

  // --- ground heights ---
  const elevation = await json(`${API}/9uxf-ng6q.json?$limit=50000&$select=the_geom,elevation,feat_code&$where=${q(`within_box(the_geom,${box}) and feat_code='3000'`)}`)
  const heights = []
  for (const e of elevation) {
    const p = project(e.the_geom.coordinates)
    if (!onIsland(p) || Number(e.elevation) * FEET > NOT_GROUND) continue
    heights.push([...round(p), Math.round(Number(e.elevation) * FEET * 100) / 100])
  }

  const out = {
    name: 'Roosevelt Island, south of the Cornell Tech loop road',
    fetched: new Date().toISOString().slice(0, 10),
    origin: island.origin,
    zoneZ: ZONE_Z,
    sources: {
      trees: `NYC Open Data hn5i-inap (Forestry Tree Points), ${cityTrees} trees; OpenStreetMap natural=tree, ${osmTrees} more (${duplicates} duplicates of city trees dropped)`,
      areas: 'OpenStreetMap: landuse=grass, leisure=garden/park/pitch, natural=wood/grassland/shingle',
      paths: 'OpenStreetMap: highway=footway/path/steps/pedestrian/cycleway',
      heights: 'NYC Open Data 9uxf-ng6q (Planimetric Elevation Points), ground points (feat_code 3000), feet to metres',
      licence: 'OpenStreetMap data © OpenStreetMap contributors, ODbL',
    },
    trees,
    areas,
    paths,
    heights,
  }
  await writeFile(OUT, JSON.stringify(out))
  console.log(`${trees.length} trees (${cityTrees} city, ${osmTrees} OSM, ${duplicates} duplicates dropped), ${areas.length} areas, ${paths.length} paths, ${heights.length} heights → ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
