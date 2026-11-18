// Topic 10: roads, blocks, plots, zoning maps, buildings and the site.
// Run with `npm test` (or `npm test city`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { area, inset, isSimple, orientedBox, pointInPolygon, segmentHit, signedArea, splitPolygon, type Polygon } from '../src/city/geometry'
import { buildSite } from '../src/city/ground'
import { MAX_ROAD_SLOPE, degrees, generateRoads, roadClearance, type RoadParams, type RoadStrategy } from '../src/city/roads'
import { extractBlocks } from '../src/city/blocks'
import { subdivide } from '../src/city/plots'
import { buildFields } from '../src/city/fields'
import { coherence, zoneAll, type ZoningParams } from '../src/city/zoning'
import { buildBuilding, FLOOR, type BuildingParams } from '../src/city/building'
import { layoutSite } from '../src/city/site'
import { citySpec, defaultCitySettings } from '../src/config/cityConfig'

const site1 = buildSite(1)
const roads = (strategy: RoadStrategy, seed = 1, extra: Partial<RoadParams> = {}) =>
  generateRoads(seed === 1 ? site1.ground : buildSite(seed).ground, { strategy, density: 0.5, width: 5, irregularity: 0.3, seed, ...extra })
const zoning = (extra: Partial<ZoningParams> = {}): ZoningParams => ({ buildThreshold: 0.2, greenThreshold: 0.42, blend: 0.08, maxFloors: 14, seed: 1, ...extra })
const fieldsFor = (net: ReturnType<typeof roads>) => buildFields(site1.ground, net.centre, { noiseScale: 90, noiseIntensity: 0.35, reach: 170, seed: 1 })

test('splitting a concave polygon conserves its area, in simple pieces', () => {
  // A U: cutting across both arms makes three pieces, which a half-plane clip cannot.
  const u: Polygon = [
    { x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }, { x: 20, z: 30 },
    { x: 20, z: 10 }, { x: 10, z: 10 }, { x: 10, z: 30 }, { x: 0, z: 30 },
  ]
  const pieces = splitPolygon(u, 0, 20, 0, 1)
  assert.equal(pieces.length, 3)
  const total = pieces.reduce((a, p) => a + area(p), 0)
  assert.ok(Math.abs(total - area(u)) < 1e-6, `${total} vs ${area(u)}`)
  for (const p of pieces) assert.ok(isSimple(p))
  // A line through a vertex is nudged off it rather than mis-pairing crossings.
  const through = splitPolygon(u, 10, 10, 1, 0)
  assert.ok(Math.abs(through.reduce((a, p) => a + area(p), 0) - area(u)) < 1e-3)
})

test('the oriented box of a rotated rectangle is the rectangle', () => {
  const a = 0.6
  const c = Math.cos(a)
  const s = Math.sin(a)
  const rect: Polygon = [[-10, -4], [10, -4], [10, 4], [-10, 4]].map(([x, z]) => ({ x: x * c - z * s + 5, z: x * s + z * c - 3 }))
  const box = orientedBox(rect)
  assert.ok(Math.abs(box.long - 20) < 1e-6 && Math.abs(box.short - 8) < 1e-6)
  assert.ok(Math.abs(Math.abs(box.ux * c + box.uz * s) - 1) < 1e-6, 'long axis follows the rectangle')
})

test('inset moves each side in by its own distance, and refuses a polygon too small to survive', () => {
  const sq: Polygon = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 }]
  const out = inset(sq, [1, 2, 3, 4])!
  assert.ok(Math.abs(area(out) - (20 - 1 - 3) * (20 - 2 - 4)) < 1e-6)
  assert.equal(inset(sq, [11, 11, 11, 11]), null)
})

test('every proposal is accounted for: grown, connected or refused', () => {
  for (const strategy of ['grid', 'organic', 'layered'] as const) {
    const n = roads(strategy)
    const refused = Object.values(n.rejected).reduce((a, b) => a + b, 0)
    assert.equal(n.grown + n.joined + n.snapped + n.extended + n.merged + refused, n.proposals, strategy)
  }
})

test('the same seed and parameters grow the same network', () => {
  const a = roads('organic')
  const b = roads('organic')
  assert.deepEqual(a.nodes, b.nodes)
  assert.deepEqual(a.edges, b.edges)
})

for (const strategy of ['grid', 'organic', 'layered'] as const) {
  test(`${strategy}: the network is planar and every road is on land and under ${MAX_ROAD_SLOPE}°`, () => {
    const net = roads(strategy)
    const { nodes, edges } = net
    assert.ok(edges.length > 50, `${edges.length} edges`)
    for (let i = 0; i < edges.length; i++) {
      const a = nodes[edges[i].a]
      const b = nodes[edges[i].b]
      for (let s = 0; s <= 8; s++) {
        const x = a.x + ((b.x - a.x) * s) / 8
        const z = a.z + ((b.z - a.z) * s) / 8
        assert.ok(site1.ground.isLand(x, z), `edge ${i} over water`)
        assert.ok(site1.ground.slope(x, z) <= MAX_ROAD_SLOPE + 1e-6, `edge ${i} too steep`)
      }
      for (let j = i + 1; j < edges.length; j++) {
        const e = edges[i]
        const f = edges[j]
        if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue
        const p = nodes[f.a]
        const q = nodes[f.b]
        const hit = segmentHit(a.x, a.z, b.x - a.x, b.z - a.z, p.x, p.z, q.x - p.x, q.z - p.z)
        const crosses = hit && hit.t > 1e-6 && hit.t < 1 - 1e-6 && hit.u > 1e-6 && hit.u < 1 - 1e-6
        assert.ok(!crosses, `edges ${i} and ${j} cross without a junction`)
      }
    }
  })
}

test('a grid runs on two perpendicular directions; organic roads do not', () => {
  // Share of road length within 10° of the grid's two axes (mod 90°).
  const aligned = (strategy: RoadStrategy) => {
    const net = roads(strategy, 1, { irregularity: 0 })
    const angles = net.edges.map((e) => {
      const a = net.nodes[e.a]
      const b = net.nodes[e.b]
      return { angle: ((Math.atan2(b.z - a.z, b.x - a.x) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2), len: Math.hypot(b.x - a.x, b.z - a.z) }
    })
    const main = angles.reduce((m, x) => (x.len > m.len ? x : m)).angle
    let on = 0
    let total = 0
    for (const { angle, len } of angles) {
      const d = Math.min(Math.abs(angle - main), Math.PI / 2 - Math.abs(angle - main))
      if (d < (10 * Math.PI) / 180) on += len
      total += len
    }
    return on / total
  }
  assert.ok(aligned('grid') > 0.9, `grid ${aligned('grid')}`)
  assert.ok(aligned('organic') < 0.6, `organic ${aligned('organic')}`)
})

test('layered roads have both kinds, and organic tidying leaves fewer dead ends than junctions', () => {
  const layered = roads('layered')
  assert.ok(layered.edges.some((e) => e.kind === 'primary'))
  assert.ok(layered.edges.some((e) => e.kind === 'secondary'))
  const organic = roads('organic')
  const d = degrees(organic)
  assert.ok(d.filter((x) => x === 1).length < d.filter((x) => x >= 3).length / 2)
})

for (const strategy of ['grid', 'organic', 'layered'] as const) {
  test(`${strategy}: blocks are simple and plots never sit on a road or overlap`, () => {
    const net = roads(strategy)
    const blocks = extractBlocks(net)
    assert.ok(blocks.blocks.length > 10, `${blocks.blocks.length} blocks`)
    for (const b of blocks.blocks) {
      assert.ok(isSimple(b.outline) && signedArea(b.outline) > 0)
    }
    for (const mode of ['grid', 'irregular'] as const) {
      const { plots } = subdivide(blocks.blocks, net, { mode, size: 14, irregularity: 0.4, seed: 1 })
      assert.ok(plots.length > 40)
      for (const p of plots) {
        // Every corner and edge midpoint is off every road.
        for (let i = 0; i < p.polygon.length; i++) {
          const a = p.polygon[i]
          const b = p.polygon[(i + 1) % p.polygon.length]
          assert.ok(roadClearance(net, a.x, a.z) > -1e-6, `plot ${p.id} corner on a road`)
          assert.ok(roadClearance(net, (a.x + b.x) / 2, (a.z + b.z) / 2) > -1e-6, `plot ${p.id} edge on a road`)
        }
      }
      // Plots tile their block: the areas add up to no more than the block.
      for (const b of blocks.blocks) {
        const sum = plots.filter((p) => p.block === b.id).reduce((a, p) => a + p.area, 0)
        assert.ok(sum <= b.area + 1e-6, `block ${b.id}: ${sum} > ${b.area}`)
      }
    }
  })
}

test('with a hard threshold, building is exactly the plots whose density clears it', () => {
  const net = roads('layered')
  const { plots } = subdivide(extractBlocks(net).blocks, net, { mode: 'irregular', size: 14, irregularity: 0.4, seed: 1 })
  const fields = fieldsFor(net)
  const zones = zoneAll(plots, fields, zoning({ blend: 0 }), 'maps')
  for (const z of zones) {
    if (z.rule === 'sliver' || z.rule === 'wet') continue
    const clears = z.sample.density >= 0.2
    assert.equal(z.rule === 'dense' || z.rule === 'courtyard', clears, `plot ${z.plot.id}`)
  }
  // Raising the threshold never builds a plot that was not built before.
  const built = (t: number) => new Set(zoneAll(plots, fields, zoning({ blend: 0, buildThreshold: t }), 'maps').filter((z) => z.category === 'building').map((z) => z.plot.id))
  const low = built(0.2)
  const high = built(0.4)
  assert.ok(high.size < low.size)
  for (const id of high) assert.ok(low.has(id))
})

test('maps make districts: neighbouring plots agree far more often than when dealt at random', () => {
  for (const seed of [1, 2, 3]) {
    const site = buildSite(seed)
    const net = generateRoads(site.ground, { strategy: 'layered', density: 0.5, width: 5, irregularity: 0.3, seed })
    const { plots } = subdivide(extractBlocks(net).blocks, net, { mode: 'irregular', size: 14, irregularity: 0.4, seed })
    const fields = buildFields(site.ground, net.centre, { noiseScale: 90, noiseIntensity: 0.35, reach: 170, seed })
    const maps = coherence(zoneAll(plots, fields, zoning({ seed }), 'maps'))
    const random = coherence(zoneAll(plots, fields, zoning({ seed }), 'random'))
    assert.ok(maps > random + 0.2, `seed ${seed}: maps ${maps.toFixed(2)}, random ${random.toFixed(2)}`)
  }
})

const building = (extra: Partial<BuildingParams> = {}): BuildingParams => ({
  width: 14, depth: 10, floors: 5, roof: 'flat', roofSlope: 32, balconyChance: 0, facadeVariation: 0, seed: 1, ...extra,
})

test('a building is a deterministic function of its parameters', () => {
  assert.deepEqual(buildBuilding(building({ facadeVariation: 0.7, balconyChance: 0.5 })), buildBuilding(building({ facadeVariation: 0.7, balconyChance: 0.5 })))
})

test('floors set the wall height; balcony probability 0 and 1 are none and every eligible window', () => {
  const plain = buildBuilding(building())
  const wall = plain.parts.find((p) => p.kind === 'wall')!
  assert.equal(wall.sy, 5 * FLOOR)
  assert.equal(plain.balconies, 0)
  // At no variation the bay is 2.8: a 14-wide face has 4 bays. Front and back,
  // floors 1–4, every window: 4 × 4 × 2.
  const full = buildBuilding(building({ balconyChance: 1 }))
  assert.equal(full.balconies, 32)
})

test('a pitched roof rises by half the short side times the tangent of the slope', () => {
  const b = buildBuilding(building({ roof: 'pitched', roofSlope: 45, width: 14, depth: 10 }))
  const gable = b.parts.find((p) => p.kind === 'gable')!
  assert.ok(Math.abs(gable.sy - 5) < 1e-9)
  assert.equal(gable.rot, 0, 'the ridge runs along the longer side')
  assert.ok(!b.parts.some((p) => p.kind === 'parapet'))
})

test('every building stands inside its plot, and no tree stands on a road', () => {
  const net = roads('layered')
  const blocks = extractBlocks(net)
  const { plots } = subdivide(blocks.blocks, net, { mode: 'irregular', size: 14, irregularity: 0.4, seed: 1 })
  const fields = fieldsFor(net)
  const zones = zoneAll(plots, fields, zoning(), 'maps')
  const layout = layoutSite(zones, blocks.blocks.map((b) => b.face), site1.ground, fields, net, { roofSlope: 32, balconyChance: 0.35, facadeVariation: 0.5 }, 1)
  assert.ok(layout.buildings.length > 40)
  for (const b of layout.buildings) {
    const s = Math.sin(b.rot)
    const c = Math.cos(b.rot)
    for (const [lx, lz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = b.x + (lx * b.params.width) / 2 * c + (lz * b.params.depth) / 2 * s
      const z = b.z - (lx * b.params.width) / 2 * s + (lz * b.params.depth) / 2 * c
      assert.ok(pointInPolygon(b.zone.plot.polygon, x, z), `building on plot ${b.zone.plot.id} overhangs it`)
    }
  }
  for (const t of layout.trees) assert.ok(roadClearance(net, t.x, t.z) > 0, `tree at ${t.x.toFixed(1)}, ${t.z.toFixed(1)} on a road`)
})

test('a saved world survives the round trip, and junk becomes defaults', () => {
  const s = { ...defaultCitySettings(), seed: 42, strategy: 'organic' as const, maxFloors: 9, experiment: 'site' as const }
  assert.deepEqual(citySpec.parse(JSON.parse(JSON.stringify(s))).settings, s)
  const junk = citySpec.parse({ seed: 'x', density: 7, strategy: 'radial', map: 'noise', show: { roads: 3 } }).settings
  const d = defaultCitySettings()
  assert.equal(junk.seed, d.seed)
  assert.equal(junk.density, 1, 'out of range is clamped')
  assert.equal(junk.strategy, d.strategy)
  assert.equal(junk.map, d.map)
  assert.equal(typeof junk.show.roads, 'boolean')
  assert.deepEqual(citySpec.parse(null).settings, d)
})
