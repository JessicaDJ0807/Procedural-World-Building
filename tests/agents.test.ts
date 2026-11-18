// Topic 9: the agent simulation, its trail field, and its saved shape.
// Run with `npm test` (or `npm test agents`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DESTINATIONS,
  PLACED_RADIUS,
  WALL_MID,
  WORLD_W,
  buildEnvironment,
  canPlace,
  cellOf,
  gapClosedBy,
  isBlocked,
  snapToGap,
} from '../src/agents/environment'
import { DT, Simulation, runFor, type AgentParams, type DecisionKind } from '../src/agents/simulation'
import { TrailField } from '../src/agents/trail'
import { PRESETS } from '../src/agents/presets'
import { agentSpec, defaultAgentSettings, MAX_PLACED } from '../src/config/agentConfig'

const preset = (id: string, agents = 160): AgentParams => ({
  agents,
  speed: 12,
  ...PRESETS.find((p) => p.id === id)!.params,
})

const steps = (seconds: number) => Math.round(seconds / DT)

test('the same seed and parameters replay the same run, step for step', () => {
  const a = runFor(7, preset('collective'), 40)
  const b = runFor(7, preset('collective'), 40)
  assert.deepEqual(
    a.agents.map((x) => [x.x, x.y, x.state, x.target]),
    b.agents.map((x) => [x.x, x.y, x.state, x.target]),
  )
  assert.equal(a.trail.total(), b.trail.total())
  assert.equal(a.tripsCompleted, b.tripsCompleted)
})

test('a different seed is a different world and a different run', () => {
  const a = runFor(1, preset('collective'), 10)
  const b = runFor(2, preset('collective'), 10)
  assert.notDeepEqual(a.env.gaps, b.env.gaps)
  assert.notEqual(a.trail.total(), b.trail.total())
})

test('every destination can reach every other, on every seed', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const env = buildEnvironment(seed)
    for (const d of DESTINATIONS) {
      for (let k = 0; k < DESTINATIONS.length; k++) {
        const from = cellOf(d.x, d.y)
        assert.ok(Number.isFinite(env.distance[k][from]), `seed ${seed}: ${d.label} → ${DESTINATIONS[k].label}`)
      }
    }
  }
})

test('the walking distance is never shorter than the straight line', () => {
  const env = buildEnvironment(1)
  const [a, b] = DESTINATIONS
  const walk = env.distance[1][cellOf(a.x, a.y)]
  const straight = Math.hypot(a.x - b.x, a.y - b.y) - b.r
  assert.ok(walk >= straight * 0.97, `${walk} against ${straight}`)
  // And the wall makes it longer: the straight line from A to B is blocked.
  assert.ok(walk > straight * 1.01)
})

test('no agent ever stands inside an obstacle, including a block placed mid-run', () => {
  const sim = new Simulation(3, preset('adaptive', 240))
  const check = () => {
    for (const a of sim.agents) assert.ok(!isBlocked(sim.env, a.x, a.y), `agent ${a.id} at ${a.x.toFixed(2)},${a.y.toFixed(2)}`)
  }
  for (let s = 0; s < steps(30); s++) {
    sim.step()
    check()
  }
  const gap = sim.env.gaps[1]
  const block = { x: WALL_MID, y: (gap.y0 + gap.y1) / 2, r: PLACED_RADIUS }
  sim.setEnvironment(buildEnvironment(3, [block]))
  check()
  for (let s = 0; s < steps(30); s++) {
    sim.step()
    check()
  }
})

test('every agent reaches the four states, and none is stuck for long', () => {
  for (const id of ['independent', 'collective', 'adaptive']) {
    const sim = new Simulation(5, preset(id))
    const seen = new Set<string>()
    let longest = 0
    for (let s = 0; s < steps(120); s++) {
      sim.step()
      for (const a of sim.agents) {
        seen.add(a.state)
        if (a.state === 'explore' || a.state === 'navigate') longest = Math.max(longest, a.tripTime)
      }
    }
    const expected = id === 'independent' ? ['idle', 'explore', 'rest'] : ['idle', 'explore', 'navigate', 'rest']
    for (const state of expected) assert.ok(seen.has(state), `${id}: never ${state}`)
    // A typical trip is 8–11 s; anything near a minute would be an agent wedged somewhere.
    assert.ok(longest < 45, `${id}: a trip ran ${longest.toFixed(1)} s`)
    assert.ok(sim.tripsCompleted > 1000, `${id}: only ${sim.tripsCompleted} trips`)
  }
})

test('with trail influence at zero, no decision ever follows a trail', () => {
  const sim = new Simulation(2, preset('independent'))
  const kinds = new Set<DecisionKind>()
  for (let s = 0; s < steps(60); s++) {
    sim.step()
    for (const a of sim.agents) kinds.add(a.decision.kind)
  }
  assert.ok(!kinds.has('trail'))
  // Navigate is still reachable, but only by seeing the goal.
  assert.ok(kinds.has('sight'))
})

test('trails evaporate at exactly the set rate once nobody is walking', () => {
  const sim = runFor(1, preset('collective'), 20)
  sim.setParams({ ...sim.params, agents: 0 })
  const before = sim.trail.total()
  for (let s = 0; s < steps(10); s++) sim.step()
  const expected = before * Math.exp(-sim.params.evaporation * 10)
  // Diffusion moves trail but does not create or destroy it.
  assert.ok(Math.abs(sim.trail.total() - expected) / expected < 1e-3, `${sim.trail.total()} against ${expected}`)
})

test('diffusion conserves trail and never lets it into a wall', () => {
  const env = buildEnvironment(1)
  const field = new TrailField(env.blocked)
  field.deposit(WALL_MID - 3, 5, 100)
  for (let s = 0; s < 300; s++) field.step(DT, 0, 0.6)
  assert.ok(Math.abs(field.total() - 100) < 1e-3)
  for (let c = 0; c < env.blocked.length; c++) if (env.blocked[c]) assert.equal(field.data[c], 0)
})

test('concentration: an even spread scores the fraction, one hot cell scores near 1', () => {
  const blocked = new Uint8Array(WORLD_W * 100)
  const field = new TrailField(blocked)
  field.data.fill(1)
  assert.ok(Math.abs(field.concentration(0.05) - 0.05) < 1e-3)
  field.clear()
  field.data[5000] = 10
  assert.equal(field.concentration(0.05), 1)
})

test('trails make the colony agree on shorter routes than walkers alone', () => {
  // The topic's central measurement, held as a test so a change to the rules
  // that loses the effect is caught. Seeds 1 and 4; the chapter has five.
  for (const seed of [1, 4]) {
    const alone = runFor(seed, preset('independent'), 150)
    const together = runFor(seed, preset('collective'), 150)
    const a = alone.tripSummary()!
    const b = together.tripSummary()!
    assert.ok(b.excess < a.excess, `seed ${seed}: excess ${b.excess} with trails, ${a.excess} without`)
    assert.ok(Math.max(...together.gapShares()) > Math.max(...alone.gapShares()), `seed ${seed}: route agreement`)
    assert.ok(together.trail.concentration() > alone.trail.concentration(), `seed ${seed}: concentration`)
  }
})

test('a block dropped near a gap snaps to it and seals it', () => {
  const sim = runFor(1, preset('collective'), 60)
  const gap = sim.env.gaps[1]
  const near = snapToGap(sim.env, { x: WALL_MID + 2.5, y: (gap.y0 + gap.y1) / 2 - 3, r: PLACED_RADIUS })
  assert.equal(gapClosedBy(sim.env, near), 1)
  assert.equal(canPlace(sim.env, near), 'ok')
  sim.setEnvironment(buildEnvironment(1, [near]))
  sim.recentCrossings = []
  for (let s = 0; s < steps(60); s++) sim.step()
  assert.ok(sim.recentCrossings.length > 20)
  assert.ok(!sim.recentCrossings.includes(1), 'an agent crossed through the closed gap')
})

test('a block on a destination, or one that would cut the map in two, is refused', () => {
  const env = buildEnvironment(1)
  const a = DESTINATIONS[0]
  assert.equal(canPlace(env, { x: a.x, y: a.y, r: PLACED_RADIUS }), 'destination')
  const seal = (i: number) => ({ x: WALL_MID, y: (env.gaps[i].y0 + env.gaps[i].y1) / 2, r: PLACED_RADIUS })
  const two = buildEnvironment(1, [seal(0), seal(1)])
  assert.equal(two.placed.length, 2)
  assert.equal(canPlace(two, seal(2)), 'disconnects')
})

test('the saved shape: defaults round-trip, junk is repaired, blocks are capped', () => {
  const d = defaultAgentSettings()
  assert.deepEqual(agentSpec.parse(JSON.parse(JSON.stringify(d))).settings, d)
  const junk = agentSpec.parse({ agents: 'many', influence: 99, evaporation: -1, preset: 'swarm', seed: 2.6, placed: 'x' }).settings
  assert.equal(junk.agents, d.agents)
  assert.equal(junk.influence, 4)
  assert.equal(junk.evaporation, 0.01)
  assert.equal(junk.preset, 'custom')
  assert.equal(junk.seed, 3)
  assert.deepEqual(junk.placed, [])
  const many = agentSpec.parse({ placed: Array.from({ length: 40 }, () => ({ x: 40, y: 40, r: 99 })) }).settings
  assert.equal(many.placed.length, MAX_PLACED)
  assert.ok(many.placed.every((c) => c.r === PLACED_RADIUS))
  assert.equal(agentSpec.parse(null).repairs.length, 1)
})

test('the presets change parameters and nothing else', () => {
  for (const p of PRESETS) assert.deepEqual(Object.keys(p.params).sort(), ['evaporation', 'exploration', 'influence'])
})
