import { mulberry32 } from '../noise'
import { buildBuilding, type BuildingParams, type BuildingResult } from './building'
import { pointInPolygon, distanceToOutline, type Polygon } from './geometry'
import { sampleMap, type Fields } from './fields'
import type { Ground } from './ground'
import { roadClearance, type RoadNetwork } from './roads'
import type { BuildingType, Zone } from './zoning'

/**
 * Experiment E: zones become things.
 *
 * A building plot gets one building from the same generator as Experiment D.
 * Zoning has already decided the floors and the type; the plot decides the
 * footprint and which way it faces; the style — roof slope, balconies, facade
 * variation — is D's, so the two experiments are visibly the same generator.
 *
 * The footprint is the plot's bounding box, turned to face the road, cut to
 * the type's limits and set back from the kerb, then shrunk until all four
 * corners are inside the plot — plots are rarely rectangles. A plot that
 * cannot hold its type's smallest footprint stays empty and is counted.
 *
 * Vegetation is scattered by category and thinned by the vegetation map, so
 * the same park is lusher where the map is greener; and outside the blocks
 * the countryside is planted by the vegetation map alone.
 */
export type Style = Pick<BuildingParams, 'roofSlope' | 'balconyChance' | 'facadeVariation'>

export type Placement = {
  zone: Zone
  /** What was built: the zoned type, or a smaller one if the plot could not hold it. */
  type: BuildingType
  x: number
  z: number
  /** Ground height under the lowest corner: the building is sunk, never floating. */
  y: number
  rot: number
  params: BuildingParams
  result: BuildingResult
}

export type TreeKind = 'tree' | 'shrub' | 'conifer'
export type Tree = { x: number; y: number; z: number; scale: number; kind: TreeKind; tint: number }

export type SiteLayout = {
  buildings: Placement[]
  trees: Tree[]
  /** Building plots too awkward for even a house. */
  unfit: number
  /** Buildings stepped down a type because the plot could not hold the one zoned. */
  downgraded: number
  floors: number
  ms: number
}

const LIMITS: Record<BuildingType, { w: [number, number]; d: [number, number]; front: number; roof: 'flat' | 'pitched' }> = {
  house: { w: [4.5, 11], d: [4.5, 9], front: 2.5, roof: 'pitched' },
  apartment: { w: [6, 24], d: [6, 14], front: 1, roof: 'flat' },
  tower: { w: [6.5, 16], d: [6.5, 16], front: 1.5, roof: 'flat' },
}

export function layoutSite(
  zones: Zone[],
  blocks: Polygon[],
  ground: Ground,
  fields: Fields,
  net: RoadNetwork,
  style: Style,
  seed: number,
): SiteLayout {
  const started = performance.now()
  const buildings: Placement[] = []
  const trees: Tree[] = []
  let unfit = 0
  let downgraded = 0
  let floors = 0

  for (const zone of zones) {
    const plot = zone.plot
    const rand = mulberry32(seed * 4243 + plot.id * 17 + 5)
    if (zone.category === 'building' && zone.type) {
      // The plot can veto the type: a tower that will not fit becomes an
      // apartment block, one that still will not fit becomes a house — lot
      // size limiting building type, as real zoning does.
      let placed: Placement | null = null
      const ladder = TYPE_LADDER.slice(TYPE_LADDER.indexOf(zone.type))
      for (const type of ladder) {
        placed = fit(zone, type, Math.min(zone.floors, MAX_FLOORS[type]), ground, style, seed)
        if (placed) {
          if (type !== zone.type) downgraded++
          break
        }
      }
      if (placed) {
        buildings.push(placed)
        floors += placed.params.floors
      } else unfit++
      // Houses keep a back garden; give it a tree now and then.
      if (placed?.type === 'house' && rand() < 0.5) scatter(plot.polygon, 7, 0.4, 'tree', 2, rand, ground, trees, placed)
    } else if (zone.category === 'park') {
      scatter(plot.polygon, 5.5, 0.35 + 0.6 * zone.sample.vegetation, 'tree', 1.5, rand, ground, trees)
    } else if (zone.category === 'garden') {
      scatter(plot.polygon, 3.2, 0.55, 'shrub', 1.2, rand, ground, trees)
      scatter(plot.polygon, 9, 0.5, 'tree', 2, rand, ground, trees)
    } else {
      scatter(plot.polygon, 9, 0.25 * zone.sample.vegetation, 'tree', 1.5, rand, ground, trees)
    }
  }

  // The countryside: everywhere outside the blocks that is land, clear of
  // roads and not too steep, planted by the vegetation map alone.
  const rand = mulberry32(seed * 977 + 13)
  const half = ground.half
  const spacing = 6.5
  for (let x = -half + 3; x < half - 3; x += spacing) {
    for (let z = -half + 3; z < half - 3; z += spacing) {
      const px = x + (rand() - 0.5) * spacing * 0.9
      const pz = z + (rand() - 0.5) * spacing * 0.9
      const roll = rand()
      const veg = sampleMap(fields, fields.maps.vegetation, px, pz)
      if (roll > Math.pow(veg, 1.3) * 0.95) continue
      if (!ground.isLand(px, pz) || ground.slope(px, pz) > 26) continue
      if (blocks.some((b) => pointInPolygon(b, px, pz))) continue
      if (roadClearance(net, px, pz) < 2) continue
      const high = ground.elevation(px, pz)
      trees.push({
        x: px,
        y: ground.height(px, pz),
        z: pz,
        scale: 0.8 + rand() * 0.6,
        kind: high > 0.55 && rand() < 0.7 ? 'conifer' : 'tree',
        tint: rand(),
      })
    }
  }

  return { buildings, trees, unfit, downgraded, floors, ms: performance.now() - started }
}

const TYPE_LADDER: BuildingType[] = ['tower', 'apartment', 'house']
const MAX_FLOORS: Record<BuildingType, number> = { tower: Infinity, apartment: 6, house: 2 }

function fit(zone: Zone, type: BuildingType, floors: number, ground: Ground, style: Style, seed: number): Placement | null {
  const { plot } = zone
  const lim = LIMITS[type]
  const box = plot.box
  // Which box axis points at the road decides which side is the front.
  const alongLong = Math.abs(plot.facing.x * box.ux + plot.facing.z * box.uz) > Math.SQRT1_2
  const sign = alongLong
    ? Math.sign(plot.facing.x * box.ux + plot.facing.z * box.uz) || 1
    : Math.sign(-plot.facing.x * box.uz + plot.facing.z * box.ux) || 1
  // Front direction (world) and the across-the-front direction.
  const fx = alongLong ? box.ux * sign : -box.uz * sign
  const fz = alongLong ? box.uz * sign : box.ux * sign
  const depthAvail = (alongLong ? box.long : box.short) - 1.6
  const widthAvail = (alongLong ? box.short : box.long) - 1.6
  let w = Math.min(lim.w[1], widthAvail)
  let d = Math.min(lim.d[1], depthAvail - lim.front)
  if (type === 'tower') w = Math.min(w, d * 1.3)
  if (w < lim.w[0] || d < lim.d[0]) return null

  for (let attempt = 0; attempt < 16; attempt++) {
    // Pushed to the front of the plot, a setback from the kerb.
    const shift = Math.max(0, (depthAvail - d) / 2 - lim.front)
    const cx = box.cx + fx * shift
    const cz = box.cz + fz * shift
    const corners = [
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ].map(([a, b]) => ({ x: cx + fx * (d / 2) * a - fz * (w / 2) * b, z: cz + fz * (d / 2) * a + fx * (w / 2) * b }))
    const inside = corners.every((c) => pointInPolygon(plot.polygon, c.x, c.z) && distanceToOutline(plot.polygon, c.x, c.z) > 0.4)
    if (inside) {
      const y = Math.min(...corners.map((c) => ground.height(c.x, c.z)), ground.height(cx, cz))
      const params: BuildingParams = {
        width: w,
        depth: d,
        floors,
        roof: lim.roof,
        roofSlope: style.roofSlope,
        // Towers get fewer balconies than apartments; houses' are on the upper floor only.
        balconyChance: style.balconyChance * (type === 'tower' ? 0.5 : 1),
        facadeVariation: style.facadeVariation,
        seed: seed * 31 + plot.id,
      }
      return { zone, type, x: cx, z: cz, y, rot: Math.atan2(fx, fz), params, result: buildBuilding(params) }
    }
    // Narrow first, keeping the depth: a plot is usually a trapezoid whose
    // slanted ends catch the far corners, and the front is the long side.
    // Shrinking both together put the depth under its minimum after one step.
    if (w > lim.w[0] + 0.01) w = Math.max(lim.w[0], w * 0.85)
    else if (d > lim.d[0] + 0.01) d = Math.max(lim.d[0], d * 0.88)
    else return null
  }
  return null
}

/** Jittered grid inside a polygon, kept at `margin` from its edge and off any building. */
function scatter(
  poly: Polygon,
  spacing: number,
  keep: number,
  kind: TreeKind,
  margin: number,
  rand: () => number,
  ground: Ground,
  out: Tree[],
  avoid?: Placement | null,
) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const p of poly) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x)
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z)
  }
  for (let x = x0 + spacing / 2; x < x1; x += spacing) {
    for (let z = z0 + spacing / 2; z < z1; z += spacing) {
      const px = x + (rand() - 0.5) * spacing * 0.8
      const pz = z + (rand() - 0.5) * spacing * 0.8
      if (rand() > keep) continue
      if (!pointInPolygon(poly, px, pz) || distanceToOutline(poly, px, pz) < margin) continue
      if (!ground.isLand(px, pz)) continue
      if (avoid) {
        // In the building's frame: outside its footprint, with a metre spare.
        const dx = px - avoid.x
        const dz = pz - avoid.z
        const s = Math.sin(avoid.rot)
        const c = Math.cos(avoid.rot)
        const lx = dx * c - dz * s
        const lz = dx * s + dz * c
        if (Math.abs(lx) < avoid.params.width / 2 + 2 && Math.abs(lz) < avoid.params.depth / 2 + 2) continue
      }
      out.push({ x: px, y: ground.height(px, pz), z: pz, scale: kind === 'shrub' ? 0.5 + rand() * 0.3 : 0.75 + rand() * 0.55, kind, tint: rand() })
    }
  }
}
