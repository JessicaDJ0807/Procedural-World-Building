// The inhabitants' minds: tested by what they do in real scenes (the studio's
// own games), not by what fields they have. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCENARIOS, StudioSim } from '../src/inhabitants/scenarios'
import { audit, consider, type Inhabitant } from '../src/inhabitants/agent'
import { comfortAt, coverAt } from '../src/inhabitants/mind'
import { Population } from '../src/inhabitants/population'
import { BuildGame } from '../src/build/game'
import { deserializeWorld, serializeWorld } from '../src/build/worldState'

const scene = (id: string) => new StudioSim(SCENARIOS.find((s) => s.id === id)!)
const run = (sim: StudioSim, seconds: number, each?: () => void) => {
  for (let t = 0; t < seconds; t += 0.1) {
    sim.update(0.1)
    each?.()
  }
}
const CURIOUS = { curiosity: 0.9, caution: 0.1, sociability: 0.5 }
const CAUTIOUS = { curiosity: 0.25, caution: 0.9, sociability: 0.5 }

test('low energy: it rests rather than explores', () => {
  const sim = scene('explore')
  const a = sim.agents[0]
  a.needs = { energy: 0.08, comfort: 0.8, curiosity: 0.9 }
  const d = consider(a, sim.nav, sim.conditions)!
  assert.equal(d.chosen, 'rest', JSON.stringify(d.options.map((o) => [o.goal, o.score.toFixed(2)])))
  // And the same inhabitant, rested and curious, explores.
  a.needs = { energy: 0.9, comfort: 0.8, curiosity: 0.9 }
  assert.equal(consider(a, sim.nav, sim.conditions)!.chosen, 'explore')
  // Left to itself from exhaustion, it ends up resting, and its energy comes back.
  a.needs = { energy: 0.08, comfort: 0.8, curiosity: 0.9 }
  let rested = false
  let peak = 0
  run(sim, 40, () => {
    rested ||= a.behavior === 'resting'
    peak = Math.max(peak, a.needs.energy)
  })
  assert.ok(rested, a.log.map((l) => l.text).join(' | '))
  // Resting brought its energy back (it may have set off again since).
  assert.ok(peak > 0.6, `energy peaked at ${peak.toFixed(2)}`)
})

test('a curious inhabitant goes to see a new structure when it forms; a cautious one later or not at all', () => {
  // Seconds from the bridge maturing until it has been there; 90 if it never went. Three runs each.
  const findTime = (traits: typeof CURIOUS, seed: number) => {
    const sim = scene('forming')
    const a = sim.agents[0]
    sim.agents.splice(1)
    a.traits = { ...traits }
    a.needs = { energy: 0.9, comfort: 0.8, curiosity: 0.6 }
    let s = seed * 7717 + 3
    a.rng = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    let matured = -1
    for (let t = 0; t < 120; t += 0.1) {
      sim.update(0.1)
      const bridge = sim.game.living.find((l) => l.matured)
      if (bridge && matured < 0) matured = t
      if (bridge && a.known.has(bridge.id) && (a.behavior !== 'discovering' || a.target !== bridge.id)) return { wait: t - matured, log: a.log.map((l) => l.text) }
    }
    return { wait: 90, log: a.log.map((l) => l.text) }
  }
  const curious = [1, 2, 3].map((k) => findTime(CURIOUS, k))
  const cautious = [1, 2, 3].map((k) => findTime(CAUTIOUS, k))
  const mean = (l: { wait: number }[]) => l.reduce((n, x) => n + x.wait, 0) / l.length
  assert.ok(curious.every((r) => r.wait < 90), `the curious one reached the bridge: ${curious.map((r) => r.log.join(' | ')).join('\n')}`)
  assert.ok(curious.some((r) => r.log.some((l) => /Discovering/.test(l))), 'by deciding to go and see it')
  assert.ok(mean(cautious) > mean(curious) * 1.3, `after maturing, curious ${mean(curious).toFixed(1)} s, cautious ${mean(cautious).toFixed(1)} s`)
})

test('curious and cautious natures behave differently in the same place', () => {
  // Over several runs, the curious one covers more ground and explores more of the time.
  let ground = [0, 0]
  const exploring = [0, 0]
  for (const seed of [0, 1, 2]) {
    const sim = scene('explore')
    const [a, b] = sim.agents
    a.traits = { ...CURIOUS }
    b.traits = { ...CAUTIOUS }
    for (const x of [a, b]) {
      x.needs = { energy: 0.8, comfort: 0.8, curiosity: 0.5 }
      x.rng = (() => {
        let s = seed * 977 + x.id
        return () => ((s = (s * 16807) % 2147483647) / 2147483647)
      })()
    }
    run(sim, 150, () => {
      if (a.behavior === 'exploring' || a.behavior === 'discovering') exploring[0] += 0.1
      if (b.behavior === 'exploring' || b.behavior === 'discovering') exploring[1] += 0.1
    })
    ground = [ground[0] + a.visits.size, ground[1] + b.visits.size]
  }
  assert.ok(ground[0] > ground[1], `places known: curious ${ground[0]}, cautious ${ground[1]}`)
  assert.ok(exploring[0] > exploring[1] * 1.3, `seconds exploring: curious ${exploring[0].toFixed(0)}, cautious ${exploring[1].toFixed(0)}`)
})

test('in a downpour, it seeks shelter where there is some within reach', () => {
  const sim = scene('shelter')
  const open = comfortAt(sim.nav, sim.agents[0].cell, { ...sim.conditions }) // for reference only
  void open
  // Whenever one settles in shelter, note how covered and how comfortable it is there.
  const settled: { id: number; cover: number; comfort: number }[] = []
  const was = new Map<number, string>()
  run(sim, 60, () => {
    for (const a of sim.agents) {
      if (a.behavior === 'resting' && a.goal === 'shelter' && was.get(a.id) !== 'resting') settled.push({ id: a.id, cover: coverAt(sim.nav, a.cell), comfort: comfortAt(sim.nav, a.cell, sim.conditions) })
      was.set(a.id, a.behavior)
    }
  })
  assert.ok(settled.length >= 1, sim.agents.map((a) => a.log.map((l) => l.text).join(' | ')).join('\n'))
  // Uncovered ground in this downpour feels 0.45; every shelter it chose was covered and far better.
  for (const s of settled) {
    assert.ok(s.cover > 0.4, `#${s.id} sheltered with cover ${s.cover.toFixed(2)}`)
    assert.ok(s.comfort > 0.7, `#${s.id} sheltered at comfort ${s.comfort.toFixed(2)}`)
  }
  // While it pours, those who sheltered stay sheltered: no walking straight back out into it.
  const sheltered = sim.agents.filter((a) => a.goal === 'shelter' && a.behavior === 'resting')
  assert.ok(sheltered.length >= 1)
  run(sim, 30)
  for (const a of sheltered) assert.ok(coverAt(sim.nav, a.cell) > 0.4, `#${a.id} went back out: ${a.log.slice(-4).map((l) => l.text).join(' | ')}`)
  // Stop the rain: shelter stops being worth seeking, and they leave it.
  sim.setWeather(0, false)
  for (const a of sim.agents) assert.notEqual(consider(a, sim.nav, sim.conditions)!.chosen, 'shelter')
  run(sim, 15)
  for (const a of sheltered) assert.ok(a.log.some((l) => /weather has cleared/.test(l.text)), `#${a.id}: ${a.log.slice(-3).map((l) => l.text).join(' | ')}`)
})

test('with no shelter in reach, it falls back to something else and doesn’t get stuck', () => {
  const sim = scene('apart')
  sim.setWeather(2, true)
  run(sim, 60)
  for (const a of sim.agents) {
    const d = consider(a, sim.nav, sim.conditions)!
    const sh = d.options.find((o) => o.goal === 'shelter')!
    assert.equal(sh.available, false, `#${a.id}: shelter on bare walls?`)
    assert.ok(sh.unavailable && sh.unavailable.length > 0)
    assert.ok(d.chosen !== null)
    // It kept living: states changed, and it isn't frozen in one.
    assert.ok(a.log.filter((l) => l.kind === 'state').length >= 3, `#${a.id}: ${a.log.map((l) => l.text).join(' | ')}`)
  }
})

test('it never sets out for a place it can’t reach', () => {
  // Two buildings, no structure between: every place it walks to is in its own region.
  const sim = scene('apart')
  const homes = sim.agents.map((a) => sim.nav.region[a.cell])
  assert.notEqual(homes[0], homes[1], 'the two start apart')
  let walks = 0
  run(sim, 120, () => {
    sim.agents.forEach((a, k) => {
      if (a.destination >= 0 && a.behavior !== 'no-route') {
        walks++
        assert.equal(sim.nav.region[a.destination], homes[k], `#${a.id} set out for another region`)
      }
    })
  })
  assert.ok(walks > 0)
})

test('when growth withers under a route, it replans, gives up or strands — never walks on nothing', () => {
  const sim = scene('dieback')
  const startCells = sim.nav.walkableCount
  const stepsOff: string[] = []
  run(sim, 45, () => {
    for (const a of sim.agents) if (a.cell >= 0 && !sim.nav.walkable[a.cell] && a.next < 0) stepsOff.push(`#${a.id} on cell ${a.cell}`)
  })
  assert.ok(sim.nav.walkableCount < startCells * 0.9, `winter withered ${startCells} → ${sim.nav.walkableCount} walkable cells`)
  assert.deepEqual(stepsOff.slice(0, 3), [])
  const told = sim.agents.flatMap((a) => a.log.map((l) => l.text)).filter((t) => /gone|withered|Found its footing/.test(t))
  const replans = sim.agents.reduce((n, a) => n + a.replans, 0)
  assert.ok(told.length > 0 || replans > 0, 'the withering reached their routes')
})

test('paused, nothing changes; a reloaded world has the same natures in it', () => {
  const sim = scene('explore')
  run(sim, 5)
  const snap = JSON.stringify(sim.agents.map((a) => [a.pos, a.needs, a.behavior]))
  for (let k = 0; k < 50; k++) sim.update(0)
  assert.equal(JSON.stringify(sim.agents.map((a) => [a.pos, a.needs, a.behavior])), snap)

  // Play: a grown world, saved and loaded, gets inhabitants with the same natures.
  const g = new BuildGame()
  const plantNear = (x: number, nx: number) => {
    const b = g.building
    let best = -1, bd = Infinity
    for (const c of b.ground) {
      const d = Math.abs(b.px[c] - x)
      if (Math.round(b.nx[c]) === nx && Math.round(b.nz[c]) === 0 && d < bd) {
        bd = d
        best = c
      }
    }
    return best
  }
  for (const [x, nx] of [[-12, 1], [-3, -1], [3, 1], [12, -1]] as const) {
    g.plant(0, plantNear(x, nx))
    g.plant(1, plantNear(x, nx))
  }
  g.advance(700)
  const pop = new Population()
  pop.update(g, 0.1, true)
  assert.ok(pop.agents.length > 0, 'inhabitants arrived')
  const { head, body } = serializeWorld(g)
  const h = new BuildGame()
  h.load(deserializeWorld(head, body))
  const pop2 = new Population()
  pop2.update(h, 0.1, true)
  assert.deepEqual(pop2.agents.map((a) => a.traits), pop.agents.map((a) => a.traits).slice(0, pop2.agents.length))
})

test('every change of state any of them made is in the transition table', () => {
  assert.equal(audit.invalid, 0)
})

void (0 as unknown as Inhabitant)
