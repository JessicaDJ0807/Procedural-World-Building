// Topic 10, experiments F–H: the road graph, inhabitants, resources and the
// coupled simulation. Run with `npm test` (or `npm test citySim`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSite } from '../src/city/ground'
import { generateRoads } from '../src/city/roads'
import { extractBlocks } from '../src/city/blocks'
import { subdivide } from '../src/city/plots'
import { buildFields } from '../src/city/fields'
import { zoneAll } from '../src/city/zoning'
import { layoutSite } from '../src/city/site'
import { distanceToSegment } from '../src/city/geometry'
import { buildGraph, findRoute, shortestTree } from '../src/city/sim/graph'
import { MINUTES_PER_DAY, isTravelling, type Task } from '../src/city/sim/inhabitants'
import { allocate, RESOURCES } from '../src/city/sim/resources'
import { CitySim, REFERENCE_POPULATION, type SimMode, type SimParams } from '../src/city/sim/urban'
import { citySpec, defaultCitySettings } from '../src/config/cityConfig'

const seed = 1
const site = buildSite(seed)
const net = generateRoads(site.ground, { strategy: 'layered', density: 0.5, width: 5, irregularity: 0.3, seed })
const blocks = extractBlocks(net)
const { plots } = subdivide(blocks.blocks, net, { mode: 'irregular', size: 14, irregularity: 0.4, seed })
const fields = buildFields(site.ground, net.centre, { noiseScale: 90, noiseIntensity: 0.35, reach: 170, seed })
const zones = zoneAll(plots, fields, { buildThreshold: 0.2, greenThreshold: 0.42, blend: 0.08, maxFloors: 14, seed }, 'maps')
const layout = layoutSite(zones, blocks.blocks.map((b) => b.face), site.ground, fields, net, { roofSlope: 32, balconyChance: 0.35, facadeVariation: 0.5 }, seed)

const params = (extra: Partial<SimParams> = {}): SimParams => ({ population: 300, walkSpeed: 40, supply: 1, demand: 1, capacity: 1, policy: 'nearest', ...extra })
const make = (mode: SimMode, extra: Partial<SimParams> = {}) => new CitySim(mode, net, layout, zones, site.ground, params(extra), seed)
const run = (sim: CitySim, minutes: number) => {
  for (let i = 0; i < minutes; i++) sim.step()
  return sim
}

test('A* finds the same shortest distance as Dijkstra, never shorter than a straight line', () => {
  const g = buildGraph(net)
  const tree = shortestTree(g, 0)
  for (let to = 1; to < g.x.length; to += 3) {
    const r = findRoute(g, 0, to)!
    assert.ok(Math.abs(r.length - tree.dist[to]) < 1e-6, `node ${to}: ${r.length} vs ${tree.dist[to]}`)
    assert.ok(r.length >= Math.hypot(g.x[to] - g.x[0], g.z[to] - g.z[0]) - 1e-9)
    // Consecutive route nodes are joined by a road.
    for (let i = 1; i < r.nodes.length; i++) {
      const a = r.nodes[i - 1]
      const b = r.nodes[i]
      let joined = false
      for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) if (g.adjTo[k] === b) joined = true
      assert.ok(joined)
    }
  }
})

test('the distribution tree reaches every junction of a connected network', () => {
  const g = buildGraph(net)
  const tree = shortestTree(g, 5)
  assert.equal(tree.order.length, g.x.length)
  assert.ok(tree.dist.every(Number.isFinite))
})

test('the same seed and settings replay the same day, step for step', () => {
  const a = run(make('dynamics', { population: 360 }), 900)
  const b = run(make('dynamics', { population: 360 }), 900)
  assert.deepEqual(
    a.population.agents.map((x) => [x.task, x.x, x.z, x.trips]),
    b.population.agents.map((x) => [x.task, x.x, x.z, x.trips]),
  )
  assert.deepEqual(Array.from(a.activity), Array.from(b.activity))
})

test('every inhabitant keeps the schedule: home, work, park, home', () => {
  const sim = make('agents')
  const next: Record<Task, Task[]> = {
    home: ['toWork'],
    toWork: ['work', 'toPark', 'toHome'],
    work: ['toPark', 'toHome'],
    toPark: ['park'],
    park: ['toHome'],
    toHome: ['home'],
  }
  const last = sim.population.agents.map((a) => a.task)
  const cycles = new Array(last.length).fill(0)
  for (let i = 0; i < MINUTES_PER_DAY * 2; i++) {
    sim.step()
    sim.population.agents.forEach((a, k) => {
      if (a.task !== last[k]) {
        assert.ok(next[last[k]].includes(a.task), `agent ${k}: ${last[k]} → ${a.task}`)
        if (a.task === 'home') cycles[k]++
        last[k] = a.task
      }
    })
  }
  // Two days: everyone has been to work and back at least once.
  assert.ok(cycles.every((c) => c >= 1), `${cycles.filter((c) => c < 1).length} never came home`)
})

test('travellers are on a road, except on the short legs to and from a door', () => {
  const sim = make('agents')
  for (let i = 0; i < 120; i++) {
    sim.step()
    for (const a of sim.population.agents) {
      if (!isTravelling(a.task)) continue
      const legs = a.cum.length - 1
      let leg = 1
      while (leg < legs && a.cum[leg] < a.along) leg++
      if (leg === 1 || leg === legs) continue
      let best = Infinity
      for (const e of net.edges) {
        const p = net.nodes[e.a]
        const q = net.nodes[e.b]
        best = Math.min(best, distanceToSegment(a.x, a.z, p.x, p.z, q.x, q.z))
      }
      assert.ok(best < 1e-6, `agent ${a.id} is ${best} off the road`)
    }
  }
})

test('allocation never gives more than asked, more than made, or more than a pipe carries — and accounts for every unit', () => {
  const sim = make('resources')
  for (const policy of ['nearest', 'shared'] as const) {
    for (const [supply, capacity] of [[1, 1], [0.5, 1], [1, 0.2], [0.3, 0.3]]) {
      const demand = new Float64Array(sim.places.length)
      sim.places.forEach((p) => (demand[p.id] = p.kind === 'park' ? 0 : p.residents + p.jobs))
      const ref = demand.reduce((a, b) => a + b, 0)
      const a = allocate(sim.networks.energy, sim.places, demand, ref * supply, ref * capacity, policy)
      for (let i = 0; i < demand.length; i++) assert.ok(a.delivered[i] <= demand[i] + 1e-9)
      assert.ok(a.given <= a.supply + 1e-6)
      for (let n = 0; n < a.flow.length; n++) assert.ok(a.flow[n] <= a.capacity[n] + 1e-6)
      assert.ok(Math.abs(a.demand - (a.given + a.shortSupply + a.shortNetwork + a.unreachable)) < 1e-6)
    }
  }
})

test('a shortage is put down to the limit that bound', () => {
  const sim = make('resources')
  const demand = new Float64Array(sim.places.length)
  sim.places.forEach((p) => (demand[p.id] = p.kind === 'park' ? 0 : p.residents + p.jobs))
  const ref = demand.reduce((a, b) => a + b, 0)
  // Ample pipes, half the supply: every unit short is the plant's.
  const plant = allocate(sim.networks.energy, sim.places, demand, ref * 0.5, ref * 10)
  assert.ok(plant.shortSupply > 0 && plant.shortNetwork === 0)
  // Ample supply, thin pipes: every unit short is the network's.
  const pipes = allocate(sim.networks.energy, sim.places, demand, ref * 10, ref * 0.05)
  assert.ok(pipes.shortNetwork > 0 && pipes.shortSupply === 0)
})

test('nearest first serves in order; shared rations everyone to the same fraction', () => {
  const sim = make('resources')
  const net0 = sim.networks.water
  const demand = new Float64Array(sim.places.length)
  sim.places.forEach((p) => (demand[p.id] = p.kind === 'park' ? 0 : p.residents + p.jobs))
  const ref = demand.reduce((a, b) => a + b, 0)
  // Ample pipes, half the supply.
  const near = allocate(net0, sim.places, demand, ref * 0.5, ref * 10, 'nearest')
  let seenShort = false
  for (const id of net0.order) {
    if (demand[id] <= 0) continue
    const share = near.delivered[id] / demand[id]
    if (seenShort) assert.ok(share < 1e-9, 'a building after the first short one was served')
    if (share < 1 - 1e-9) seenShort = true
  }
  const shared = allocate(net0, sim.places, demand, ref * 0.5, ref * 10, 'shared')
  for (const id of net0.order) if (demand[id] > 0) assert.ok(Math.abs(shared.delivered[id] / demand[id] - 0.5) < 1e-9)
})

test('H: at the reference population nothing closes; above it, served nearest-first, workplaces close and workers are turned away', () => {
  const fine = run(make('dynamics', { population: REFERENCE_POPULATION }), MINUTES_PER_DAY)
  assert.equal(fine.stats().closed, 0)
  const over = run(make('dynamics', { population: 450 }), MINUTES_PER_DAY)
  const s = over.stats()
  assert.ok(s.closed > 0 && s.turnedAway > 0, `${s.closed} closed, ${s.turnedAway} turned away`)
  // Shared rationing at the same population closes nothing: 450 asks 1.4× supply.
  assert.equal(run(make('dynamics', { population: 450, policy: 'shared' }), MINUTES_PER_DAY).stats().closed, 0)
})

test('H: closed buildings reopen when the population falls back', () => {
  const sim = run(make('dynamics', { population: 450 }), MINUTES_PER_DAY)
  const closed = sim.stats().closed
  sim.setParams(params({ population: 150 }))
  run(sim, MINUTES_PER_DAY)
  assert.ok(sim.stats().closed < closed / 4, `${closed} → ${sim.stats().closed}`)
})

test('the statistics add up', () => {
  const sim = run(make('dynamics'), 600)
  const s = sim.stats()
  assert.equal(Object.values(s.counts).reduce((a, b) => a + b, 0), s.population)
  assert.equal(s.travelling, s.counts.toWork + s.counts.toPark + s.counts.toHome)
  for (const r of RESOURCES) assert.ok(s.resources![r].given <= s.resources![r].supply + 1e-6)
})

test('a saved world keeps the simulation settings, and repairs nonsense', () => {
  const d = defaultCitySettings()
  const saved = { ...d, experiment: 'dynamics' as const, population: 420, policy: 'shared' as const, resource: 'water' as const }
  assert.deepEqual(citySpec.parse(JSON.parse(JSON.stringify(saved))).settings, saved)
  const junk = citySpec.parse({ population: 1e6, policy: 'random', resource: 'gas' }).settings
  assert.equal(junk.population, 800)
  assert.equal(junk.policy, d.policy)
  assert.equal(junk.resource, d.resource)
})
