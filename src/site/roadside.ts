import { BLOCKED, EDGE, ROOF, type Building } from '../green/building'
import { horizontalTotal, sunSamples, type DaySun } from '../green/sunPath'
import type { Point, Site, SurfaceKind } from './siteData'

/**
 * The roadside study's ground: Roosevelt Island cut into 1 m cells, each
 * knowing what surface it is.
 *
 * ## The grid
 *
 * The island is 3.2 km long and about 250 m wide, running south-west to
 * north-east. A grid aligned with east and west would cover its whole
 * bounding box, mostly river; aligned with the island's long axis it covers a
 * strip a fifth the area. So the grid's columns run along the island and its
 * rows across it, and a cell's position in the world is the origin plus its
 * column along one axis and its row along the other. Nothing downstream cares
 * that the grid is turned: the growth model works on positions and a
 * neighbour table, and here the neighbours are grid offsets.
 *
 * ## Surfaces
 *
 * Every cell centre on land and outside a building footprint is a cell. Its
 * surface comes from the planimetric layers, painted in the same order the
 * page draws them, so a sidewalk crossing a lawn is sidewalk. Land under no
 * layer is *unmapped*: the city doesn't say what it is — on Roosevelt Island
 * mostly planting beds, lawns between buildings and the Cornell Tech grounds.
 */

export const SURFACES = ['unmapped', 'lawn', 'vacant', 'median', 'parking', 'sidewalk', 'roadbed'] as const
export type GroundSurface = (typeof SURFACES)[number]

/**
 * How much a plant can make of each surface: a multiplier on every species'
 * env and suitability. These are my assumptions, not measurements — the city
 * data says what a surface is, not how often it is mown, swept or driven on.
 *
 * - **Road** is driven on: nothing grows. Its cells exist only to shed water.
 * - **Sidewalks and parking** are paved: a plant lives in the cracks and at
 *   the edges, so a small fraction (0.15 and 0.25 — parking is trodden less).
 * - **Lawns** are mown: 0.5.
 * - **Unmapped ground** is mostly planting and lawn nobody has classed: 0.8.
 * - **Medians and vacant lots** are left alone: 0.9 and 1.
 */
export const HABITAT: Record<GroundSurface, number> = {
  unmapped: 0.8,
  lawn: 0.5,
  vacant: 1,
  median: 0.9,
  parking: 0.25,
  sidewalk: 0.15,
  roadbed: 0,
}

/** Surfaces that shed their rain rather than soak it up. */
const PAVED: GroundSurface[] = ['parking', 'sidewalk', 'roadbed']

/** Painter's order, bottom first, as the page draws the layers. */
const LAYERS: [SurfaceKind, GroundSurface][] = [
  ['recreation', 'lawn'],
  ['park', 'lawn'],
  ['openSpace', 'lawn'],
  ['vacant', 'vacant'],
  ['parking', 'parking'],
  ['roadbed', 'roadbed'],
  ['median', 'median'],
  ['sidewalk', 'sidewalk'],
]

export const ROAD_CELL = 1

export type Roadside = {
  building: Building
  /** Each cell's surface, as an index into SURFACES. */
  surface: Uint8Array
  /** HABITAT, per cell. */
  habitat: Float32Array
  /** Fraction of the cells within 3 m that are paved — where runoff comes from. */
  paved: Float32Array
  /** Within 2 m of a paved edge: the curb strip. */
  curb: Uint8Array
  /** The grid: origin, the along and across axes (unit, world x and z), and size. */
  grid: { ox: number; oz: number; ux: number; uz: number; vx: number; vz: number; cols: number; rows: number }
  /** For each grid square, its cell, or −1 for river, building or the edge of the grid. */
  cellAt: Int32Array
  /** Every building footprint and height, for the shadows. */
  casters: { ring: Point[]; height: number }[]
  ms: number
}

/** The island's long axis: the direction of the two outline vertices farthest apart. */
function longAxis(ring: Point[]): [number, number] {
  let best = 0
  let axis: [number, number] = [1, 0]
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      const dx = ring[j][0] - ring[i][0]
      const dz = ring[j][1] - ring[i][1]
      const d = dx * dx + dz * dz
      if (d > best) {
        best = d
        axis = [dx, dz]
      }
    }
  }
  const len = Math.hypot(axis[0], axis[1])
  return [axis[0] / len, axis[1] / len]
}

/**
 * Fills the grid squares whose centres fall inside a set of rings, even–odd,
 * so holes are holes. Rings are in grid units (column, row). `set` is called
 * once per square inside.
 */
export function fillRings(rings: [number, number][][], cols: number, rows: number, set: (index: number) => void) {
  let minR = Infinity
  let maxR = -Infinity
  for (const ring of rings) {
    for (const [, r] of ring) {
      minR = Math.min(minR, r)
      maxR = Math.max(maxR, r)
    }
  }
  const r0 = Math.max(0, Math.floor(minR))
  const r1 = Math.min(rows - 1, Math.ceil(maxR))
  const xs: number[] = []
  for (let r = r0; r <= r1; r++) {
    const y = r + 0.5
    xs.length = 0
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > y !== yj > y) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi))
      }
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5))
      const c1 = Math.min(cols - 1, Math.floor(xs[k + 1] - 0.5))
      for (let c = c0; c <= c1; c++) set(r * cols + c)
    }
  }
}

export function buildRoadside(site: Site): Roadside {
  const start = performance.now()
  const cell = ROAD_CELL
  const [ux, uz] = longAxis(site.island)
  const vx = -uz
  const vz = ux
  // The island's extent along and across the axis, with a cell of margin.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (const [x, z] of site.island) {
    const u = x * ux + z * uz
    const v = x * vx + z * vz
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  minU -= cell
  minV -= cell
  const cols = Math.ceil((maxU - minU) / cell) + 2
  const rows = Math.ceil((maxV - minV) / cell) + 2
  const ox = minU * ux + minV * vx
  const oz = minU * uz + minV * vz
  const toGrid = ([x, z]: Point): [number, number] => {
    const dx = x - ox
    const dz = z - oz
    return [(dx * ux + dz * uz) / cell, (dx * vx + dz * vz) / cell]
  }

  const n = cols * rows
  // 255 = not ground: river or building.
  const kind = new Uint8Array(n).fill(255)
  fillRings([site.island.map(toGrid)], cols, rows, (i) => (kind[i] = 0))
  for (const [layer, surface] of LAYERS) {
    const code = SURFACES.indexOf(surface)
    for (const polygon of site.surfaces[layer] ?? []) {
      fillRings(polygon.map((ring) => ring.map(toGrid)), cols, rows, (i) => {
        if (kind[i] !== 255) kind[i] = code
      })
    }
  }
  for (const b of site.buildings) fillRings(b.outline.map((ring) => ring.map(toGrid)), cols, rows, (i) => (kind[i] = 255))

  // --- cells ---
  const cellAt = new Int32Array(n).fill(-1)
  let count = 0
  for (let i = 0; i < n; i++) if (kind[i] !== 255) cellAt[i] = count++
  const f32 = () => new Float32Array(count)
  const b: Building = {
    cell,
    count,
    px: f32(), py: f32(), pz: f32(),
    nx: f32(), ny: f32().fill(1), nz: f32(),
    ax: f32().fill(ux), ay: f32(), az: f32().fill(uz),
    ux: f32().fill(vx), uy: f32(), uz: f32().fill(vz),
    flags: new Uint8Array(count),
    neighbours: new Int32Array(count * 8).fill(-1),
    segment: new Int16Array(count).fill(-1),
    along: f32(),
    cornerDist: f32().fill(Infinity),
    cornerInside: new Uint8Array(count),
    texel: new Int32Array(count),
    texW: cols,
    texH: rows,
    columns: [],
    ground: new Int32Array(0),
    segments: [],
    roofs: [],
    units: [],
    volumes: [],
    corners: [],
    windows: [],
    overhangs: [],
  }
  const surface = new Uint8Array(count)
  const habitat = new Float32Array(count)
  const pavedCode = new Set(PAVED.map((p) => SURFACES.indexOf(p)))
  const isPaved = new Uint8Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const k = cellAt[i]
      if (k < 0) continue
      const u = (c + 0.5) * cell
      const v = (r + 0.5) * cell
      b.px[k] = ox + ux * u + vx * v
      b.pz[k] = oz + uz * u + vz * v
      b.texel[k] = i
      surface[k] = kind[i]
      habitat[k] = HABITAT[SURFACES[kind[i]]]
      // ROOF marks a flat, upward-facing cell for the shared field code; the
      // road can never be grown on.
      b.flags[k] = ROOF | (habitat[k] === 0 ? BLOCKED : 0)
      if (pavedCode.has(kind[i])) isPaved[i] = 1
    }
  }

  // Neighbours by grid offset, in the slot order (across, up) = (column, row).
  const SLOT_OFFSETS: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = cellAt[r * cols + c]
      if (k < 0) continue
      SLOT_OFFSETS.forEach(([dc, dr], slot) => {
        const cc = c + dc
        const rr = r + dr
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) return
        b.neighbours[k * 8 + slot] = cellAt[rr * cols + cc]
      })
    }
  }

  // Paved share within 3 m — a 7 × 7 box, by summed-area table — and the curb
  // strip: unpaved cells within 2 m of pavement, and paved cells within 2 m of
  // something unpaved.
  const sat = new Float64Array((cols + 1) * (rows + 1))
  const land = new Float64Array((cols + 1) * (rows + 1))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const at = (r + 1) * (cols + 1) + (c + 1)
      sat[at] = isPaved[i] + sat[at - 1] + sat[at - (cols + 1)] - sat[at - (cols + 1) - 1]
      land[at] = (cellAt[i] >= 0 ? 1 : 0) + land[at - 1] + land[at - (cols + 1)] - land[at - (cols + 1) - 1]
    }
  }
  const boxSum = (t: Float64Array, c: number, r: number, h: number) => {
    const c0 = Math.max(0, c - h)
    const r0 = Math.max(0, r - h)
    const c1 = Math.min(cols, c + h + 1)
    const r1 = Math.min(rows, r + h + 1)
    return t[r1 * (cols + 1) + c1] - t[r0 * (cols + 1) + c1] - t[r1 * (cols + 1) + c0] + t[r0 * (cols + 1) + c0]
  }
  const paved = new Float32Array(count)
  const curb = new Uint8Array(count)
  const ground: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const k = cellAt[i]
      if (k < 0) continue
      const landNear = boxSum(land, c, r, 3)
      paved[k] = landNear > 0 ? boxSum(sat, c, r, 3) / landNear : 0
      const pavedNear = boxSum(sat, c, r, 2)
      const landNear2 = boxSum(land, c, r, 2)
      const mixed = pavedNear > 0 && pavedNear < landNear2
      if (mixed) curb[k] = 1
      // A growable cell next to pavement: an edge to follow, and where seeds go.
      if (habitat[k] > 0 && !isPaved[i] && boxSum(sat, c, r, 1) > 0) {
        b.flags[k] |= EDGE
        ground.push(k)
      }
    }
  }
  b.ground = Int32Array.from(ground)

  const casters = site.buildings.map((bd) => ({ ring: bd.outline[0], height: bd.height }))
  return {
    building: b,
    surface,
    habitat,
    paved,
    curb,
    grid: { ox, oz, ux, uz, vx, vz, cols, rows },
    cellAt,
    casters,
    ms: performance.now() - start,
  }
}

/**
 * A day of sun on the ground, by drawing shadows rather than casting rays.
 *
 * On flat ground a prism's shadow is exact and simple: the footprint swept
 * along the sun's direction by height ÷ tan(elevation). The sweep of an
 * outline is the outline at both ends plus, for each edge, the parallelogram
 * it traces — so each half hour, every building's edge parallelograms are
 * filled into a shadow mask, and every ground cell outside the mask gets that
 * half hour of sun. The same answer the campus's rays give a flat roof, at a
 * cost proportional to the shadowed area rather than to cells × buildings.
 */
export function computeRoadsideSun(rs: Roadside, latitudeDeg: number, declinationDeg: number): DaySun {
  const start = performance.now()
  const { cols, rows, ox, oz, ux, uz, vx, vz } = rs.grid
  const b = rs.building
  const samples = sunSamples(latitudeDeg, declinationDeg)
  const reference = horizontalTotal(sunSamples(latitudeDeg, 23.44))
  const hours = new Float32Array(b.count)
  const light = new Float32Array(b.count)
  const mask = new Uint8Array(cols * rows)
  const toGrid = (x: number, z: number): [number, number] => {
    const dx = x - ox
    const dz = z - oz
    return [(dx * ux + dz * uz) / b.cell, (dx * vx + dz * vz) / b.cell]
  }
  const rings = rs.casters.map((c) => ({ ring: c.ring.map(([x, z]) => toGrid(x, z)), height: c.height }))

  for (const s of samples) {
    const [lx, ly, lz] = s.dir
    const horizontal = Math.hypot(lx, lz)
    // The top of a wall of height h falls h / tan(elevation) away from the
    // sun, in grid units.
    const away = toGrid(ox - lx / horizontal, oz - lz / horizontal)
    const run = ly / horizontal
    mask.fill(0)
    for (const { ring, height } of rings) {
      const len = height / run
      const dc = away[0] * len
      const dr = away[1] * len
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j]
        const c = ring[i]
        fillRings([[a, c, [c[0] + dc, c[1] + dr], [a[0] + dc, a[1] + dr]]], cols, rows, (k) => (mask[k] = 1))
      }
    }
    const weight = s.intensity * s.dir[1] * s.hours
    for (let k = 0; k < b.count; k++) {
      if (mask[b.texel[k]]) continue
      hours[k] += s.hours
      light[k] += weight
    }
  }
  for (let k = 0; k < b.count; k++) light[k] /= reference
  return { light, hours, reference, openGround: horizontalTotal(samples), samples, ms: performance.now() - start }
}

/**
 * Moisture on the ground: rain, plus what the pavement sheds.
 *
 * An unpaved cell catches rain where it falls, and the water off the paved
 * cells within 3 m of it as well: rain × (0.6 + 1.2 × the paved share around
 * it). A paved cell keeps a little in its cracks (0.3 of the rain). Then the
 * sun dries it, up to 55% where the light is strongest, and the result is
 * saturated through 1 − e^(−1.6·m) — the same drying and saturation as the
 * building's rule. There is no terrain: on an island this flat, water goes to
 * the nearest unpaved edge, which is what the 3 m box stands for.
 */
/**
 * Soil catches rain at 1.0 — more than a wall's 0.35 or a roof's 0.6, since
 * ground holds what lands on it — plus 1.5 times the paved share within 3 m
 * of runoff; a crack in pavement keeps 0.3. At the walls' 0.6 the open ground
 * was so dry that four years grew 5% of the island. Runoff turned out to
 * matter only when rain is short: see the Roosevelt Island doc.
 */
export const ROAD_MOISTURE = { soil: 1.0, runoff: 1.5, crack: 0.3 }

/**
 * Seeds and tips, as a multiple of the species' own counts. Set by hand
 * rather than from the length of edge (26,916 m of it, which would mean 420×
 * and tens of thousands of tips): 60× plants 1,184 seeds along the pavement
 * edges and keeps a step near 0.1–0.2 ms.
 */
export const ROAD_SCALE = 60

export function computeRoadsideMoisture(rs: Roadside, rain: number, light: Float32Array): Float32Array {
  const b = rs.building
  const out = new Float32Array(b.count)
  const pavedCodes = new Set(PAVED.map((p) => SURFACES.indexOf(p)))
  const { soil, runoff, crack } = ROAD_MOISTURE
  for (let k = 0; k < b.count; k++) {
    const wet = pavedCodes.has(rs.surface[k]) ? rain * crack : rain * (soil + runoff * rs.paved[k])
    out[k] = 1 - Math.exp(-1.6 * wet * (1 - 0.55 * light[k]))
  }
  return out
}
