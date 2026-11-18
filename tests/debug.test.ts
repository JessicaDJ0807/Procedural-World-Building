// The Debug layer reads the simulation; these check that what it reads is the
// simulation's own answer, and that reading changes nothing. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RECIPES, recipeGame } from '../src/architecture/specimens'
import { findNode } from '../src/build/living'
import { suitabilityBand } from '../src/build/debugLayer'
import type { BuildGame } from '../src/build/game'

/** Runs a recipe's game step by step, calling `each` after every step. */
function grow(steps: number, each?: (g: BuildGame) => void) {
  const g = recipeGame(RECIPES.bridge[0])
  for (let k = 0; k < steps; k++) {
    g.advance(1)
    each?.(g)
  }
  return g
}

test('mutation points: the candidate the debug view marks next is the node the game forms', () => {
  // At every step, before the game's own look: findNode (as the game calls it) and the first
  // ready candidate agree — the same cell and combination, or both nothing.
  let checked = 0
  let agreedOnANode = 0
  const g = recipeGame(RECIPES.bridge[0])
  for (let k = 0; k < 420; k++) {
    const candidates = g.nodeCandidates()
    const ready = candidates.find((c) => c.ready) ?? null
    // findNode with the game's own arguments: read through the same accessors nodeCandidates uses.
    const internal = g as unknown as { declined: Set<number>; nodeSurfaces: Parameters<typeof findNode>[4] }
    const node = findNode(g.sim.growth, g.building, g.living, internal.declined, internal.nodeSurfaces)
    assert.deepEqual(ready ? { cell: ready.cell, combo: ready.combo } : null, node, `step ${g.sim.step}`)
    checked++
    if (node) agreedOnANode++
    // Every candidate that "meets" really meets the thresholds it reports.
    for (const c of candidates) if (c.meets) assert.ok(c.count >= c.need && c.age >= c.minAge && !c.crowded)
    g.advance(1)
  }
  assert.ok(checked === 420 && agreedOnANode > 0, `${agreedOnANode} steps with a node ready`)
})

test('reading for the debug view changes nothing: the same growth, structures and step', () => {
  const read = (g: BuildGame) => {
    g.nodeCandidates()
    g.sim.growth.tipDirections()
    g.sim.growth.tipSpecies()
    g.sim.growth.tipCells()
    g.sim.growth.contacts()
  }
  const a = grow(500, read)
  const b = grow(500)
  assert.deepEqual([...a.sim.growth.depth], [...b.sim.growth.depth])
  assert.equal(a.sim.growth.grown, b.sim.growth.grown)
  assert.deepEqual(
    a.living.map((l) => [l.kind, l.born, l.node]),
    b.living.map((l) => [l.kind, l.born, l.node]),
  )
})

test('growth directions are the tips’ own: one unit vector per tip, from the growth', () => {
  const g = grow(200)
  const dirs = g.sim.growth.tipDirections()
  const cells = g.sim.growth.tipCells()
  assert.equal(dirs.length, cells.length * 3)
  assert.ok(cells.length > 0)
  for (let t = 0; t < cells.length; t++) {
    const l = Math.hypot(dirs[t * 3], dirs[t * 3 + 1], dirs[t * 3 + 2])
    assert.ok(Math.abs(l - 1) < 1e-4, `tip ${t} direction length ${l}`)
  }
})

test('suitability bands follow the growth’s own entry rule', () => {
  // A cell is entered only above 0.1, with chance 0.05 + 0.95·s².
  assert.equal(suitabilityBand(0.1, true), 'none')
  assert.equal(suitabilityBand(0.9, false), 'none')
  assert.equal(suitabilityBand(0.2, true), 'low')
  assert.equal(suitabilityBand(0.45, true), 'moderate')
  assert.equal(suitabilityBand(0.8, true), 'high')
})
