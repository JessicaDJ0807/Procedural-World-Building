// Seed tracking: what the player plants is counted at the planting action,
// and nothing else adds to it. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GLASS } from '../src/green/building'
import { BuildGame, DRAPER_SEED } from '../src/build/game'
import { blockEdge, edgeLength } from '../src/build/draper'
import { deserializeWorld, serializeWorld } from '../src/build/worldState'

/** The lawn with a three-storey stepping-stone tower — the docs' stepping-stone run. */
function lawn(seed = 1): BuildGame {
  const g = new BuildGame()
  g.seed = seed
  g.restart()
  for (let y = 0; y < 3; y++) g.edit(6, y, 6, 3)
  return g
}

/** The wall cell nearest (x, z) facing nx: where a player would click. */
function wallCell(g: BuildGame, x: number, z: number, nx: number): number {
  const b = g.building
  let best = -1
  let bd = Infinity
  for (const c of b.ground) {
    const d = Math.hypot(b.px[c] - x, b.pz[c] - z)
    if (Math.round(b.nx[c]) === nx && Math.round(b.nz[c]) === 0 && d < bd) {
      bd = d
      best = c
    }
  }
  return best
}

/** Plants a Draper on the tower's eave facing nx; true if the game took it. */
const drape = (g: BuildGame, nx: number) => {
  const e = blockEdge(g.town, 6, 2, 6, nx, 0, 'top')!
  return g.plantDraper(e, edgeLength(e) / 2)
}

const plantPairs = (g: BuildGame) => {
  for (const [x, z, nx] of [
    [-12, -1.5, 1],
    [-3, -1.5, -1],
    [0, -1.5, 1],
    [12, -1.5, -1],
  ] as [number, number, number][]) {
    assert.ok(g.plant(0, wallCell(g, x, z - 0.6, nx)))
    assert.ok(g.plant(1, wallCell(g, x, z + 0.6, nx)))
  }
}

test('a new world starts with no seeds, counted from the start', () => {
  const g = new BuildGame()
  assert.deepEqual(g.seeds, [0, 0, 0])
  assert.equal(g.seedsPlanted, 0)
  assert.equal(g.seedsComplete, true)
})

test('each successful planting counts one, by species', () => {
  const g = lawn()
  plantPairs(g)
  assert.ok(drape(g, 1))
  assert.ok(drape(g, -1))
  assert.deepEqual(g.seeds, [4, 4, 2])
  assert.equal(g.seedsPlanted, 10)
})

test('a refused planting changes nothing', () => {
  const g = lawn()
  const cell = wallCell(g, 0, -2.1, 1)
  assert.ok(g.plant(0, cell))
  const before = [...g.seeds]
  // A plant never grows onto its own kind: the same seed on the same cell is refused.
  assert.equal(g.plant(0, cell), false)
  // Nor on glass, nor off the building.
  const glass = [...Array(g.building.count).keys()].find((i) => g.building.flags[i] & GLASS)!
  assert.equal(g.plant(1, glass), false)
  assert.equal(g.plant(1, -1), false)
  // A second Draper where one already hangs is refused too.
  assert.ok(drape(g, 1))
  const withDraper = [...g.seeds]
  assert.equal(drape(g, 1), false)
  assert.deepEqual(g.seeds, withDraper)
  assert.deepEqual(withDraper, [before[0], before[1], before[2] + 1])
})

test('growth, spreading Drapers and mutations add nothing', () => {
  const g = lawn()
  plantPairs(g)
  for (const nx of [1, -1]) {
    assert.ok(g.plant(0, wallCell(g, -1.5 + nx * 1.5, -0.6, nx)))
    assert.ok(drape(g, nx))
  }
  const planted = [...g.seeds]
  g.advance(1500)
  assert.deepEqual(g.seeds, planted)
  // So the case was really exercised: structures formed, and Drapers spread onto them on their own.
  assert.ok(g.living.length > 0, 'structures formed')
  assert.ok(g.drapers.list.length > planted[DRAPER_SEED], 'Drapers spread onto living architecture')
})

test('a winter and the regrowth after it add nothing', () => {
  const g = lawn()
  plantPairs(g)
  g.advance(300)
  const planted = [...g.seeds]
  const layersBefore = g.sim.growth.grown
  g.setWarmth(0.15)
  g.advance(500)
  g.setWarmth(1)
  g.advance(500)
  assert.deepEqual(g.seeds, planted)
  assert.ok(g.sim.growth.grown > layersBefore, 'the plants grew on')
})

test('undo takes back blocks, not seeds; restart and a new world reset them', () => {
  const g = lawn()
  plantPairs(g)
  assert.ok(g.undo())
  assert.deepEqual(g.seeds, [4, 4, 0])
  g.restart()
  assert.deepEqual(g.seeds, [0, 0, 0])
  plantPairs(lawnOn(g))
  g.newWorld(42)
  assert.deepEqual(g.seeds, [0, 0, 0])
  assert.equal(g.seedsComplete, true)
})

/** The stepping stone again, on a game that was restarted. */
function lawnOn(g: BuildGame): BuildGame {
  for (let y = 0; y < 3; y++) g.edit(6, y, 6, 3)
  return g
}

test('a saved world comes back with its seeds, and counts on from them', () => {
  const g = lawn()
  plantPairs(g)
  assert.ok(drape(g, 1))
  g.advance(400)
  const { head, body } = serializeWorld(g)
  const h = new BuildGame()
  h.load(deserializeWorld(head, body))
  assert.deepEqual(h.seeds, [4, 4, 1])
  assert.equal(h.seedsComplete, true)
  assert.ok(drape(h, -1))
  assert.deepEqual(h.seeds, [4, 4, 2])
})

test('a world saved before seeds were counted loads with a partial count, not an invented one', () => {
  const g = lawn()
  plantPairs(g)
  const { head, body } = serializeWorld(g)
  const old = JSON.parse(body)
  delete old.counters.seeds
  const h = new BuildGame()
  h.load(deserializeWorld(head, JSON.stringify(old)))
  assert.deepEqual(h.seeds, [0, 0, 0])
  assert.equal(h.seedsComplete, false)
  assert.ok(drape(h, 1))
  assert.deepEqual(h.seeds, [0, 0, 1])
  // Saved again, it keeps saying so: the count is still only since it was opened.
  const again = serializeWorld(h)
  const k = new BuildGame()
  k.load(deserializeWorld(again.head, again.body))
  assert.deepEqual(k.seeds, [0, 0, 1])
  assert.equal(k.seedsComplete, false)
})

test('nonsense seed counts in a save are ignored, not trusted', () => {
  const g = lawn()
  const { head, body } = serializeWorld(g)
  const bad = JSON.parse(body)
  bad.counters.seeds = [-1, 'x', 2]
  const h = new BuildGame()
  h.load(deserializeWorld(head, JSON.stringify(bad)))
  assert.deepEqual(h.seeds, [0, 0, 0])
  assert.equal(h.seedsComplete, false)
})
