// The land round the town: reproducible from its seed, never touching the
// town's ground, and never changing the game. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEEP, KINDS, Landscape, PATH_DEFAULTS, PATH_LIMITS, QUIET, STREAM_DEFAULTS, STREAM_LIMITS, capOf, inGap, outside, scatter, toBuilding } from '../src/build/landscape'
import { lawnHeight } from '../src/build/lawn'
import { BuildGame } from '../src/build/game'
import { deserializeWorld, serializeWorld } from '../src/build/worldState'

const samples = (n: number, extent: number) => {
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) out.push([((i * 7919) % 1000) / 1000 * 2 * extent - extent, ((i * 104729) % 997) / 997 * 2 * extent - extent])
  return out
}

test('the same seed gives the same land, a different seed a different one', () => {
  const a = new Landscape(42)
  const b = new Landscape(42)
  const c = new Landscape(43)
  let differs = 0
  for (const [x, z] of samples(500, 80)) {
    assert.equal(a.height(x, z), b.height(x, z))
    assert.equal(a.moisture(x, z), b.moisture(x, z))
    assert.equal(a.fertility(x, z), b.fertility(x, z))
    if (Math.abs(a.height(x, z) - c.height(x, z)) > 1e-6) differs++
  }
  assert.ok(differs > 300, `different seeds differ (${differs} of 500)`)
  for (const k of KINDS) assert.deepEqual(scatter(a, k, 'medium'), scatter(b, k, 'medium'))
})

test('the town’s ground is untouched: within KEEP of the grid, height is lawnHeight exactly', () => {
  for (const seed of [1, 7, 99]) {
    const L = new Landscape(seed)
    for (const [x, z] of samples(2000, 7 + KEEP)) {
      if (outside(x, z) > KEEP) continue
      assert.equal(L.height(x, z), lawnHeight(x, z))
    }
  }
})

test('the hills are gentle: the ridge no higher than 6 units, twice the tallest building, no slope steeper than 1 in 2', () => {
  // Several seeds, on a grid: one seed at scattered samples passed while three others ran to
  // 0.59 where the clearing's rim met the ridge's foot.
  for (const seed of [1, 4, 5, 9, 42]) {
    const L = new Landscape(seed)
    let top = 0
    let steepest = 0
    let banks = 0
    let bankSamples = 0
    let bankSteep = 0
    for (let x = -90; x <= 90; x += 1.5)
      for (let z = -90; z <= 90; z += 1.5) {
        top = Math.max(top, Math.abs(L.height(x, z)))
        const e = 0.5
        const s = Math.hypot(L.height(x + e, z) - L.height(x - e, z), L.height(x, z + e) - L.height(x, z - e)) / (2 * e)
        // The stream's banks are held to their own bound: carving a level channel into a hillside
        // already near 1 in 2 makes the uphill bank steeper than the hill, and since the water was
        // kept below the ground on its lower side too (it had stood on a levee), more so. Measured:
        // 0.48–0.52 on four of these five seeds; on seed 4, where it crosses a side slope at the
        // ridge's foot near the town, 0.87 at most, 10 of 1,140 bank samples over 0.6.
        if (L.streamEdge(x, z) < 12) {
          banks = Math.max(banks, s)
          bankSamples++
          if (s > 0.6) bankSteep++
        } else steepest = Math.max(steepest, s)
      }
    assert.ok(top < 6, `seed ${seed}: highest ${top.toFixed(2)}`)
    assert.ok(steepest < 0.5, `seed ${seed}: steepest ${steepest.toFixed(2)}`)
    assert.ok(banks < 0.9, `seed ${seed}: steepest bank ${banks.toFixed(2)}`)
    assert.ok(bankSteep < 0.02 * bankSamples, `seed ${seed}: ${bankSteep} of ${bankSamples} bank samples steeper than 0.6`)
  }
})

test('the fields stay in 0–1, and moisture is higher in hollows than on crests', () => {
  const L = new Landscape(3)
  let low = 0, lowN = 0, high = 0, highN = 0
  for (const [x, z] of samples(4000, 80)) {
    for (const v of [L.moisture(x, z), L.fertility(x, z), L.elevation(x, z), L.relief(x, z)]) assert.ok(v >= 0 && v <= 1)
    // The relief: the hills without the clearing's rim, which is shaped land, not a crest.
    const e = L.relief(x, z)
    if (e < 0.35) { low += L.moisture(x, z); lowN++ }
    if (e > 0.65) { high += L.moisture(x, z); highN++ }
  }
  assert.ok(lowN > 20 && highN > 20)
  assert.ok(low / lowN > high / highN, `hollows ${(low / lowN).toFixed(2)} vs crests ${(high / highN).toFixed(2)}`)
})

test('decorations keep clear of the town, stand on the ground, and follow the density', async () => {
  const { inProtected } = await import('../src/build/landscape')
  const L = new Landscape(11)
  // Only the low ground cover and the flowers may lie on the town's lawn — never on the protected
  // ground round the buildings and between them; everything else keeps its quiet margin.
  const onLawn = new Set(['flower', 'clover'])
  for (const k of KINDS) {
    const low = scatter(L, k, 'low')
    const med = scatter(L, k, 'medium')
    const high = scatter(L, k, 'high')
    assert.ok(low.length <= med.length && med.length <= high.length, `${k}: ${low.length} ≤ ${med.length} ≤ ${high.length}`)
    assert.ok(med.length <= capOf(k, 'medium'))
    for (const p of med) {
      if (onLawn.has(k)) assert.ok(!inProtected(p.x, p.z), `${k} on the protected ground at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`)
      else assert.ok(outside(p.x, p.z) >= QUIET, `${k} at ${outside(p.x, p.z).toFixed(2)} from the grid`)
      assert.equal(p.y, L.height(p.x, p.z))
    }
  }
  // The larger kinds stand further back.
  const shrubs = scatter(L, 'shrub', 'medium')
  assert.ok(shrubs.every((p) => outside(p.x, p.z) >= 7))
})

test('a world saves its landscape and loads it back; older saves get the world’s own seed', () => {
  const g = new BuildGame()
  g.setLandscape({ seed: 12345, density: 'high' })
  const { head, body } = serializeWorld(g)
  const h = new BuildGame()
  h.load(deserializeWorld(head, body))
  assert.deepEqual(h.landscape, { seed: 12345, density: 'high' })
  const old = JSON.parse(body)
  delete old.landscape
  const k = new BuildGame()
  k.load(deserializeWorld(head, JSON.stringify(old)))
  assert.deepEqual(k.landscape, { seed: head.seed, density: 'medium' })
  const bad = JSON.parse(body)
  bad.landscape = { seed: 'x', density: 'huge' }
  const m = new BuildGame()
  m.load(deserializeWorld(head, JSON.stringify(bad)))
  assert.deepEqual(m.landscape, { seed: head.seed, density: 'medium' })
})

test('changing the landscape is a saved change, and never changes the game', () => {
  const plant = (g: BuildGame) => {
    for (let y = 0; y < 3; y++) g.edit(6, y, 6, 3)
    const b = g.building
    const cells = [...b.ground].filter((c) => Math.round(b.nx[c]) === 1).slice(0, 2)
    g.plant(0, cells[0])
    g.plant(1, cells[1])
  }
  const a = new BuildGame()
  const b = new BuildGame()
  plant(a)
  plant(b)
  const before = b.changes
  b.setLandscape({ seed: 777, density: 'low' })
  assert.equal(b.changes, before + 1)
  a.advance(400)
  b.advance(400)
  assert.equal(a.sim.growth.grown, b.sim.growth.grown)
  assert.deepEqual([...a.sim.growth.depth], [...b.sim.growth.depth])
  // A new world takes its seed for its land.
  b.newWorld(31)
  assert.equal(b.landscape.seed, 31)
})

test('the forest: seeded, out of the meadow, an irregular clearing, young trees at its edge', async () => {
  const { scatterTrees } = await import('../src/build/landscape')
  const L = new Landscape(9)
  const a = scatterTrees(L, 'medium')
  assert.deepEqual(a, scatterTrees(new Landscape(9), 'medium'))
  assert.ok(a.length > 500, `${a.length} trees`)
  // No tree within 6 units of the buildable grid, nor in the meadow.
  for (const t of a) {
    assert.ok(outside(t.x, t.z) >= 6)
    assert.ok(L.pastEdge(t.x, t.z) > -12)
  }
  // The clearing isn't a circle: its radius varies by several units round the town.
  const radii = Array.from({ length: 72 }, (_, i) => L.clearingRadius((i / 72) * Math.PI * 2))
  assert.ok(Math.max(...radii) - Math.min(...radii) > 6, `radius ${Math.min(...radii).toFixed(1)}–${Math.max(...radii).toFixed(1)}`)
  assert.ok(Math.min(...radii) >= 12)
  // Trees at the edge are smaller than deep in the forest.
  const edge = a.filter((t) => L.pastEdge(t.x, t.z) < 4)
  const deep = a.filter((t) => L.pastEdge(t.x, t.z) > 20)
  const mean = (l: typeof a) => l.reduce((s, t) => s + t.scale, 0) / l.length
  assert.ok(edge.length > 10 && deep.length > 10)
  assert.ok(mean(edge) < mean(deep), `edge ${mean(edge).toFixed(2)} vs deep ${mean(deep).toFixed(2)}`)
})

test('the landforms: a ridge to the north-west, an open valley to the north-north-east', async () => {
  const { scatterTrees } = await import('../src/build/landscape')
  const L = new Landscape(4)
  const at = (deg: number, r: number) => { const a = (deg * Math.PI) / 180; return [Math.sin(a) * r, -Math.cos(a) * r] as const }
  // The ridge's crest wanders and has saddles: its highest point in the north-west sector, not one sample.
  let ridge = 0
  for (let deg = 290; deg <= 340; deg += 2) for (let r = 38; r <= 62; r += 2) ridge = Math.max(ridge, L.height(...at(deg, r)))
  assert.ok(ridge > 3, `ridge ${ridge.toFixed(2)}`)
  assert.ok(L.corridor(...at(17, 40)) > 0.8)
  // The valley keeps its sightline: far fewer trees along it than either side.
  const trees = scatterTrees(L, 'medium')
  const inBand = (deg: number) => trees.filter((t) => { const a = (Math.atan2(t.x, -t.z) * 180) / Math.PI; const d = ((a - deg + 540) % 360) - 180; return Math.abs(d) < 8 && Math.hypot(t.x, t.z) > 25 }).length
  assert.ok(inBand(17) * 3 < inBand(90) + inBand(270), `valley ${inBand(17)} vs east ${inBand(90)}, west ${inBand(270)}`)
  // All six families grow; the two accents, weeping and crooked, are the rarest.
  const count = [0, 0, 0, 0, 0, 0]
  for (const t of trees) count[t.variant]++
  assert.ok(count.every((n) => n > 0), count.join(','))
  for (const accent of [2, 5]) for (const common of [0, 1, 3, 4]) assert.ok(count[accent] < count[common], count.join(','))
})

test('the forest is mixed all round: no side all conifers or all broadleaves', async () => {
  const { scatterTrees, isEvergreen, CROOKED } = await import('../src/build/landscape')
  // Within 60 units, in each eighth of the compass, conifers are between 15% and 75% of the
  // trees. Groves once took their family from the terrain: the ridge side was 76–86% conifers
  // and the east 0%.
  for (const seed of [1, 4, 9, 42]) {
    const L = new Landscape(seed)
    const sectors = Array.from({ length: 8 }, () => ({ conifer: 0, all: 0 }))
    for (const t of scatterTrees(L, 'medium')) {
      if (Math.hypot(t.x, t.z) > 60) continue
      const s = sectors[Math.floor((((Math.atan2(t.x, -t.z) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * 8)]
      s.all++
      if (isEvergreen(t.variant) && t.variant !== CROOKED) s.conifer++
    }
    for (const s of sectors) {
      assert.ok(s.all > 20, `seed ${seed}: ${s.all} trees in a sector`)
      const share = s.conifer / s.all
      assert.ok(share > 0.15 && share < 0.75, `seed ${seed}: ${sectors.map((q) => Math.round((100 * q.conifer) / q.all)).join(' ')}% conifers by sector`)
    }
  }
})

test('the footpaths: seeded, never between the buildings, each to one building only, kept clear', async () => {
  const { scatterTrees, inGap, toBuilding } = await import('../src/build/landscape')
  // The two buildings' footprints' centres, x: west −5, east 5.
  const near = (x: number, z: number, cx: number) => Math.hypot(Math.max(0, Math.abs(x - cx) - 1), Math.max(0, Math.abs(z) - 1))
  for (const seed of [1, 4, 9, 42]) {
    const L = new Landscape(seed)
    assert.deepEqual(L.paths, new Landscape(seed).paths)
    assert.ok(L.paths.length >= 2 && L.paths.length <= 3, `${L.paths.length} paths`)
    for (const p of L.paths) {
      let west = Infinity, east = Infinity
      for (let i = 0; i < p.x.length; i++) {
        // Never in the gap between the buildings, nor on a wall.
        assert.ok(!inGap(p.x[i], p.z[i]), `seed ${seed}: a path in the gap at (${p.x[i].toFixed(1)}, ${p.z[i].toFixed(1)})`)
        assert.ok(toBuilding(p.x[i], p.z[i]) >= 0.55, `seed ${seed}: a path on a wall`)
        west = Math.min(west, near(p.x[i], p.z[i], -5))
        east = Math.min(east, near(p.x[i], p.z[i], 5))
      }
      // No path comes within 4 units of both buildings: nothing on the ground joins them.
      assert.ok(west > 4 || east > 4, `seed ${seed}: a path near both buildings (${west.toFixed(1)}, ${east.toFixed(1)})`)
      // A footpath, not a road: under a unit and a half wide.
      assert.ok(Math.max(...p.half) < 0.8)
    }
    // The main path comes to the west building's outer side.
    const main = L.paths[0]
    const end = main.x.length - 1
    assert.ok(main.x[end] < -6 && near(main.x[end], main.z[end], -5) < 1.5, `ends at (${main.x[end].toFixed(1)}, ${main.z[end].toFixed(1)})`)
    // Trees and decorations keep off it.
    for (const t of scatterTrees(L, 'medium')) assert.ok(L.pathEdge(t.x, t.z) >= 1)
    for (const k of KINDS) for (const d of scatter(L, k, 'medium')) assert.ok(L.onPath(d.x, d.z) < 0.999, `${k} on a path`)
  }
})

test('the stream: seeded, off the town, flowing downhill, sitting in its banks', async () => {
  const { scatterTrees } = await import('../src/build/landscape')
  for (const seed of [1, 4, 9, 42]) {
    const L = new Landscape(seed)
    const st = L.stream
    assert.deepEqual(st, new Landscape(seed).stream)
    assert.ok(st.s[st.s.length - 1] > 120, `${st.s[st.s.length - 1].toFixed(0)} units long`)
    for (let i = 0; i < st.x.length; i++) {
      // Well off the grid: its banks fade before the town's ground (tested with KEEP above).
      assert.ok(outside(st.x[i], st.z[i]) >= 9, `seed ${seed}: water ${outside(st.x[i], st.z[i]).toFixed(1)} off the grid`)
      // Downhill all the way.
      if (i) assert.ok(st.level![i] <= st.level![i - 1] + 1e-9)
    }
    // It leaves through the open valley, into the haze.
    const last = st.x.length - 1
    assert.ok(L.corridor(st.x[last], st.z[last]) > 0.5 && Math.hypot(st.x[last], st.z[last]) > 140)
    // The bed is under the water, and the bank has closed over the water ribbon's edge (its own
    // side's half-width plus 0.12) — no gap, nothing floating. Each side has its own width: the
    // inside of a bend is wider.
    for (let i = 2; i < st.x.length - 2; i += 3) {
      const tx = st.x[i + 1] - st.x[i - 1], tz = st.z[i + 1] - st.z[i - 1]
      const len = Math.hypot(tx, tz)
      for (const side of [-1, 1]) {
        const half = st.half[i] * (1 + side * st.skew![i])
        const at = (d: number) => L.height(st.x[i] + (-tz / len) * side * d, st.z[i] + (tx / len) * side * d)
        assert.ok(at(0) < st.level![i], `seed ${seed}: dry bed at ${i}`)
        assert.ok(at(half + 0.12) > st.level![i] - 0.005, `seed ${seed}: water's edge exposed at ${i}`)
      }
    }
    // It sits in its channel, not on a levee: the ground rises past the water's edge (a lip you
    // can see, 0.12 or more on average 0.6 units out), and on under a tenth of sides does the
    // ground within 3 units dip more than 0.1 below the water. Before the water was held below
    // the ground on both sides, it stood up to 0.8 above the meadow on its lower side. Measured:
    // 0 of 96 sides on seeds 1 and 42, 3 on seed 9, 7 on seed 4 (the ridge's foot, to −0.65).
    {
      let perched = 0, sides = 0, rise = 0
      for (let i = 10; i < st.x.length - 1 && st.s[i] <= 120; i += 4) {
        const tx = st.x[i + 1] - st.x[i - 1], tz = st.z[i + 1] - st.z[i - 1]
        const len = Math.hypot(tx, tz)
        for (const side of [-1, 1]) {
          const half = st.half[i] * (1 + side * st.skew![i])
          const at = (d: number) => L.height(st.x[i] + (-tz / len) * side * d, st.z[i] + (tx / len) * side * d) - st.level![i]
          sides++
          rise += at(half + 0.6)
          if (Math.min(at(half + 1.2), at(half + 3)) < -0.1) perched++
        }
      }
      assert.ok(rise / sides >= 0.12, `seed ${seed}: the bank rises ${(rise / sides).toFixed(2)} 0.6 past the edge`)
      assert.ok(perched < 0.1 * sides, `seed ${seed}: ${perched} of ${sides} sides perched`)
    }
    // Every stone set in the stream shows above the water and stands in the bed: placed at a fixed
    // size, all of them were 5–25 cm under once the stream was deepened, and only the white rings
    // the water draws round them showed.
    {
      const { streamRocks } = await import('../src/build/landscape')
      for (const r of streamRocks(L)) {
        let m = 0
        for (let i = 0; i < st.x.length; i++) if (Math.hypot(st.x[i] - r.x, st.z[i] - r.z) < Math.hypot(st.x[m] - r.x, st.z[m] - r.z)) m = i
        const semi = 0.275 * r.tall!
        const centre = r.y + 0.1 * r.tall!
        assert.ok(centre + semi > st.level![m] + 0.04, `seed ${seed}: a stream stone only ${(centre + semi - st.level![m]).toFixed(2)} above the water`)
        assert.ok(centre - semi < L.height(r.x, r.z), `seed ${seed}: a stream stone floating over its bed`)
      }
    }
    // Trees and decorations keep out of the water; reeds stand at its edge.
    for (const t of scatterTrees(L, 'medium')) assert.ok(L.streamEdge(t.x, t.z) >= 1.3)
    for (const k of KINDS) {
      const placed = scatter(L, k, 'medium')
      if (k === 'reed') {
        // In clumps along the lush reaches, so far fewer than a fringe: 71–150 on four seeds.
        assert.ok(placed.length > 40, `${placed.length} reeds`)
        for (const r of placed) assert.ok(Math.abs(L.streamEdge(r.x, r.z) - 0.35) < 2)
      } else for (const d of placed) assert.ok(L.streamEdge(d.x, d.z) > 0, `${k} in the water`)
    }
  }
})

test('the clearing’s accents: one of each, apart, off the lawn, paths and water', async () => {
  const { clearingAccents, inProtected, scatterTrees } = await import('../src/build/landscape')
  for (const seed of [1, 4, 9, 42]) {
    const L = new Landscape(seed)
    const acc = clearingAccents(L)
    assert.deepEqual(acc, clearingAccents(new Landscape(seed)))
    assert.ok(acc.length >= 3, `seed ${seed}: ${acc.length} accents`)
    assert.equal(new Set(acc.map((a) => a.kind)).size, acc.length)
    for (const a of acc) {
      assert.ok(outside(a.x, a.z) >= 5 && !inProtected(a.x, a.z), `seed ${seed}: ${a.kind} on the town's lawn`)
      assert.ok(L.onPath(a.x, a.z) < 0.05 && L.streamEdge(a.x, a.z) >= 2.5, `seed ${seed}: ${a.kind} on a path or bank`)
      for (const b of acc) if (b !== a) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 6, `seed ${seed}: ${a.kind} and ${b.kind} together`)
    }
    for (const t of scatterTrees(L, 'medium')) for (const a of acc) assert.ok(Math.hypot(a.x - t.x, a.z - t.z) >= 2.2)
  }
})

test('the Lab’s stream and path parameters: their defaults are the tuned land, exactly', () => {
  for (const seed of [1, 4, 9]) {
    const a = new Landscape(seed)
    const b = new Landscape(seed, { stream: { ...STREAM_DEFAULTS }, paths: { ...PATH_DEFAULTS } })
    assert.deepEqual(b.stream, a.stream)
    assert.deepEqual(b.paths, a.paths)
    for (const [x, z] of samples(300, 60)) assert.equal(b.height(x, z), a.height(x, z))
  }
})

test('at every limit of the stream and the paths, the town’s ground is untouched and the paths keep out of the gap', () => {
  const ends = [
    ...(Object.keys(STREAM_LIMITS) as (keyof typeof STREAM_LIMITS)[]).flatMap((k) => STREAM_LIMITS[k].map((v) => ({ stream: { [k]: v } }))),
    ...(Object.keys(PATH_LIMITS) as (keyof typeof PATH_LIMITS)[]).flatMap((k) => PATH_LIMITS[k].map((v) => ({ paths: { [k]: v } }))),
    { stream: { width: 1.5, meander: 2, distance: 14, pools: 4 } },
  ]
  for (const lines of ends) {
    const L = new Landscape(4, lines)
    for (const [x, z] of samples(400, 12)) if (outside(x, z) < KEEP) assert.equal(L.height(x, z), lawnHeight(x, z), JSON.stringify(lines))
    for (let i = 0; i < L.stream.x.length; i++) {
      assert.ok(outside(L.stream.x[i], L.stream.z[i]) >= 9, JSON.stringify(lines))
      if (i) assert.ok(L.stream.level![i] <= L.stream.level![i - 1] + 1e-9)
    }
    for (const p of L.paths) for (let i = 0; i < p.x.length; i++) assert.ok(!inGap(p.x[i], p.z[i]) && toBuilding(p.x[i], p.z[i]) >= 0.5, JSON.stringify(lines))
  }
})

test('the stream at each of its limits keeps the banks’ bound, on the seed that gives first', () => {
  // Seed 4, where the stream crosses a side slope at the ridge's foot: 0.87 at the defaults, and
  // where each limit was set (landscape.ts, STREAM_LIMITS) — 0.73–0.88 there. Same measure as the
  // hills test: a 1.5 grid, steepest bank under 0.9, under 2% of bank samples over 0.6.
  for (const k of Object.keys(STREAM_LIMITS) as (keyof typeof STREAM_LIMITS)[])
    for (const v of STREAM_LIMITS[k]) {
      const L = new Landscape(4, { stream: { [k]: v } })
      let banks = 0, n = 0, over = 0
      for (let x = -90; x <= 90; x += 1.5)
        for (let z = -90; z <= 90; z += 1.5) {
          if (L.streamEdge(x, z) >= 12) continue
          const e = 0.5
          const s = Math.hypot(L.height(x + e, z) - L.height(x - e, z), L.height(x, z + e) - L.height(x, z - e)) / (2 * e)
          banks = Math.max(banks, s)
          n++
          if (s > 0.6) over++
        }
      assert.ok(banks < 0.9 && over < 0.02 * n, `${k} ${v}: steepest bank ${banks.toFixed(2)}, ${over} of ${n} over 0.6`)
    }
})

test('fewer paths leave the rest where they were; slope avoidance trades length for grade', () => {
  const all = new Landscape(9)
  for (const count of [0, 1, 2]) {
    const L = new Landscape(9, { paths: { count } })
    assert.equal(L.paths.length, count)
    assert.deepEqual(L.paths, all.paths.slice(0, count))
  }
  // Mean length over five seeds: straighter with no price on slope, longer with a high one.
  const mean = (slope: number) => {
    let len = 0, n = 0
    for (const seed of [1, 4, 9, 23, 77]) for (const p of new Landscape(seed, { paths: { slope } }).paths) {
        len += p.s[p.s.length - 1]
        n++
      }
    return len / n
  }
  const flat = mean(0), tuned = mean(40), steep = mean(120)
  assert.ok(flat < tuned && tuned < steep, `${flat.toFixed(0)} < ${tuned.toFixed(0)} < ${steep.toFixed(0)}`)
})

test('a world saves its stream and path parameters, brought into range; older saves get the tuned ones', () => {
  const g = new BuildGame()
  g.setLandscape({ stream: { width: 1.25 }, paths: { count: 1 } })
  g.setLandscape({ stream: { pools: 2 } })
  assert.deepEqual(g.landscape.stream, { width: 1.25, pools: 2 })
  const { head, body } = serializeWorld(g)
  const h = new BuildGame()
  h.load(deserializeWorld(head, body))
  assert.deepEqual(h.landscape.stream, { ...STREAM_DEFAULTS, width: 1.25, pools: 2 })
  assert.deepEqual(h.landscape.paths, { ...PATH_DEFAULTS, count: 1 })
  // Out of range, or not numbers: clamped, or the lower limit.
  const odd = JSON.parse(body)
  odd.landscape.stream = { width: 9, pools: 2.6, meander: 'x' }
  const k = new BuildGame()
  k.load(deserializeWorld(head, JSON.stringify(odd)))
  assert.deepEqual(k.landscape.stream, { width: 1.5, meander: 0.25, distance: 10, pools: 3 })
  // Reset: back to a world with none, which is the tuned land.
  h.resetLandscapeLines()
  assert.equal(h.landscape.stream, undefined)
  assert.equal(h.landscape.paths, undefined)
})
