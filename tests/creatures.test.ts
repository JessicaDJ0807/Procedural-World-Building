// Topic 11: Creatures — genome, skeleton, IK, gaits, locomotion, behaviour,
// mutation and the saved shape. Run with `npm test creatures`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GENES, LEG_COUNTS, defaultGenome, mutate, randomGenome, repair, type Genome } from '../src/creatures/genome'
import { buildCreature } from '../src/creatures/skeleton'
import { boneLengths, solveTwoBone } from '../src/creatures/ik'
import { gaitPattern, stanceAt } from '../src/creatures/gait'
import { Body, STEP } from '../src/creatures/animate'
import { feel, makeBrain, makeHabitat, perceive, think } from '../src/creatures/behavior'
import { Lab, brainParams } from '../src/creatures/lab'
import { creatureSpec, defaultCreatureSettings } from '../src/config/creatureConfig'

const genomes = (n: number) => Array.from({ length: n }, (_, i) => randomGenome(i + 1))

test('a seed rolls the same creature every time, and repair leaves a repaired genome alone', () => {
  assert.deepEqual(randomGenome(42), randomGenome(42))
  assert.notDeepEqual(randomGenome(42), randomGenome(43))
  for (const g of genomes(300)) {
    assert.deepEqual(repair(g), g)
    for (const spec of GENES) {
      const v = g[spec.key] as number
      assert.ok(v >= spec.min - 1e-9 && v <= spec.max + 1e-9, `${spec.key} ${v}`)
    }
  }
})

test('repair keeps anatomy that holds together', () => {
  // Eight legs on a three-segment body: segments are added, one per pair.
  const a = repair({ ...defaultGenome(), topology: 'segmented', segments: 3, legs: 8 })
  assert.equal(a.segments, 4)
  // Radial symmetry with two legs is bilateral.
  assert.equal(repair({ ...defaultGenome(), symmetry: 'radial', legs: 2 }).symmetry, 'bilateral')
  // Stubby legs under a tall body are lengthened until they can lift it.
  const b = repair({ ...defaultGenome(), bodyHeight: 2, legLength: 0.4 })
  assert.ok(b.legLength > 0.4)
  // Junk becomes the default, not NaN.
  const c = repair({ ...defaultGenome(), bodyLength: NaN, legs: 5 as Genome['legs'], topology: 'blob' as Genome['topology'] })
  assert.equal(c.bodyLength, defaultGenome().bodyLength)
  assert.equal(c.legs, defaultGenome().legs)
  assert.equal(c.topology, defaultGenome().topology)
})

test('the skeleton is one tree from the root, and the leg count rebuilds it', () => {
  for (const legs of LEG_COUNTS) {
    const c = buildCreature({ ...defaultGenome(), legs })
    assert.equal(c.limbs.length, legs)
    assert.equal(c.joints.filter((j) => j.kind === 'hip').length, legs)
    // Every joint reaches the root by its parents, with no cycles.
    for (const j of c.joints) {
      let k = j.id
      let hops = 0
      while (c.joints[k].parent >= 0 && hops < c.joints.length) {
        k = c.joints[k].parent
        hops++
      }
      assert.equal(k, c.root, `${j.name} does not reach the root`)
    }
    // Every hip hangs from a spine joint; every toe rests on the ground.
    for (const l of c.limbs) {
      const parent = c.joints[c.joints[l.joints[0]].parent]
      assert.ok(parent.kind === 'spine', `${l.name} hangs from ${parent.kind}`)
      assert.ok(Math.abs(l.restToe.y) < 1e-9)
      // The rest pose was solved by IK: the thigh has its length.
      const root = c.joints[l.joints[l.ikRoot]].bind
      const knee = c.joints[l.joints[l.ikRoot + 1]].bind
      assert.ok(Math.abs(Math.hypot(knee.x - root.x, knee.y - root.y, knee.z - root.z) - l.a) < 1e-6)
    }
  }
})

test('two-bone IK keeps both bones their length, reaches what it can, and says when it cannot', () => {
  const root = { x: 0, y: 2, z: 0 }
  const pole = { x: 1, y: 0, z: 0 }
  const near = solveTwoBone(root, { x: 0.4, y: 0.6, z: 0.3 }, 1, 0.9, pole)
  const [a, b] = boneLengths(root, near)
  assert.ok(Math.abs(a - 1) < 1e-9 && Math.abs(b - 0.9) < 1e-9)
  assert.ok(near.reached)
  assert.ok(Math.hypot(near.end.x - 0.4, near.end.y - 0.6, near.end.z - 0.3) < 1e-9)
  // The knee bends toward the pole.
  assert.ok(near.mid.x > 0.2)
  const far = solveTwoBone(root, { x: 0, y: -5, z: 0 }, 1, 0.9, pole)
  assert.equal(far.reached, false)
  const [a2, b2] = boneLengths(root, far)
  assert.ok(Math.abs(a2 - 1) < 1e-9 && Math.abs(b2 - 0.9) < 1e-9)
})

test('gaits: tripods, trots, a lateral-sequence walk and a wave, as tables of phases', () => {
  const c6 = buildCreature({ ...defaultGenome(), legs: 6, symmetry: 'bilateral' })
  const tripod = gaitPattern(c6, 'walk')
  // L1, R2, L3 share a phase; R1, L2, R3 the other.
  const phase = (pair: number, side: number) => tripod.offsets[c6.limbs.findIndex((l) => l.pair === pair && l.side === side)]
  assert.equal(phase(0, -1), phase(1, 1))
  assert.equal(phase(0, -1), phase(2, -1))
  assert.equal(phase(0, 1), phase(1, -1))
  assert.notEqual(phase(0, -1), phase(0, 1))
  // At duty 0.5 a tripod has exactly three feet down, away from the changeovers.
  const run = gaitPattern(c6, 'run')
  for (const t of [0.1, 0.3, 0.6, 0.9]) assert.equal(stanceAt(run, t).filter(Boolean).length, 3)

  const c4 = buildCreature({ ...defaultGenome(), legs: 4, symmetry: 'bilateral' })
  const idx = (pair: number, side: number) => c4.limbs.findIndex((l) => l.pair === pair && l.side === side)
  const trot = gaitPattern(c4, 'run')
  assert.equal(trot.offsets[idx(0, -1)], trot.offsets[idx(1, 1)])
  assert.equal(trot.offsets[idx(0, 1)], trot.offsets[idx(1, -1)])
  // A lateral-sequence walk lands left hind, left fore, right hind, right fore.
  const walk = gaitPattern(c4, 'walk')
  const touchdown = (i: number) => (1 - walk.offsets[i]) % 1
  const order = [idx(1, -1), idx(0, -1), idx(1, 1), idx(0, 1)].map(touchdown)
  for (let k = 1; k < 4; k++) assert.ok(order[k] > order[k - 1], `footfalls ${order}`)
  // Never fewer than two feet down while walking.
  for (let t = 0; t < 1; t += 0.01) assert.ok(stanceAt(walk, t).filter(Boolean).length >= 2)

  // A wave gait lifts each leg a quarter cycle after the one behind it.
  const c8 = buildCreature({ ...defaultGenome(), legs: 8, symmetry: 'bilateral' })
  const wave = gaitPattern(c8, 'walk')
  const lift = (pair: number) => (((wave.duty - wave.offsets[c8.limbs.findIndex((l) => l.pair === pair && l.side === -1)]) % 1) + 1) % 1
  const lifts = [3, 2, 1, 0].map(lift)
  for (let k = 1; k < 4; k++) assert.ok(Math.abs(((lifts[k] - lifts[k - 1] + 1) % 1) - 0.25) < 1e-9, `wave ${lifts}`)
})

test('a planted foot stays where it landed: on a straight path, every legged creature, walking and running', () => {
  let legged = 0
  for (const g of genomes(120)) {
    for (const drive of ['walk', 'run'] as const) {
      const lab = new Lab(g, 'studio', 1)
      lab.setDrive(drive)
      if (!lab.creature.limbs.length) continue
      legged++
      const planted = new Map<number, { x: number; z: number }>()
      for (let i = 0; i < 480; i++) {
        lab.step()
        lab.body.legs.forEach((leg, k) => {
          if (!leg.planted) {
            planted.delete(k)
            return
          }
          const was = planted.get(k)
          // Nothing writes to a planted toe…
          if (was) assert.ok(was.x === leg.toe.x && was.z === leg.toe.z)
          else planted.set(k, { x: leg.toe.x, z: leg.toe.z })
          // …and after the first second, the IK puts the foot exactly there.
          if (i > 60) assert.ok(leg.error < 1e-6, `seed ${g.bodySeed} ${drive}: leg ${k} ${leg.error}`)
        })
        assert.ok(lab.body.pos.every(Number.isFinite))
      }
    }
  }
  assert.ok(legged > 150)
})

test('the spine follows the head: with no sway, every torso joint lies on the path the head took', () => {
  const lab = new Lab({ ...defaultGenome(), sway: 0, legs: 4 }, 'studio', 1)
  lab.setInPlace(false)
  const heads: { x: number; z: number }[] = []
  for (let i = 0; i < 900; i++) {
    lab.step()
    heads.push({ x: lab.body.x, z: lab.body.z })
  }
  const c = lab.creature
  // The torso; the tail wags whatever the sway.
  for (const id of c.spine.slice(c.tail.length)) {
    const p = lab.body.joint(id)
    let best = Infinity
    for (let k = 1; k < heads.length; k++) {
      const a = heads[k - 1]
      const b = heads[k]
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / Math.max((b.x - a.x) ** 2 + (b.z - a.z) ** 2, 1e-12)))
      best = Math.min(best, Math.hypot(p.x - a.x - t * (b.x - a.x), p.z - a.z - t * (b.z - a.z)))
    }
    assert.ok(best < 0.01, `${c.joints[id].name} is ${best} off the path`)
  }
})

test('a legless body slithers: every point of it is on one ground-fixed wave', () => {
  const g = { ...defaultGenome(), legs: 0 as const, sway: 0.6 }
  const c = buildCreature(g)
  const body = new Body(c, { x: 0, z: 0, heading: 0 })
  // Heading +x on a straight path: the wave is z = A·env·sin(2π s / λ), and s
  // is the position along the ground, so the wave does not move as the body does.
  for (let i = 0; i < 240; i++) body.step(STEP, { speed: 1, heading: null, look: null })
  const h = c.spine.length - 1
  for (let i = 0; i < h; i++) {
    const p = body.joint(c.spine[i])
    const d = c.spineX[h] - c.spineX[i]
    const s = body.odometer - d
    const along = d / (c.spineX[h] - c.spineX[0])
    const expected = c.swayAmp * (0.3 + 0.7 * Math.pow(along, 0.7)) * Math.sin((2 * Math.PI * s) / body.wavelength)
    assert.ok(Math.abs(p.z - expected) < 1e-6, `joint ${i}: ${p.z} vs ${expected}`)
  }
})

test('perception comes from the eyes: side eyes see food beside the head, forward eyes do not', () => {
  const habitat = makeHabitat(1)
  habitat.food = [{ x: 0, z: 4, regrow: 0 }]
  const head = { x: 0, z: 0, heading: 0 }
  const forward = buildCreature({ ...defaultGenome(), eyePlacement: 0, antennae: 0 })
  const side = buildCreature({ ...defaultGenome(), eyePlacement: 1, antennae: 0 })
  const blind = buildCreature({ ...defaultGenome(), eyes: 0, antennae: 0 })
  assert.equal(perceive(head, habitat, forward.senses).length, 0)
  assert.deepEqual(perceive(head, habitat, side.senses), [{ index: 0, by: 'sight' }])
  assert.equal(perceive(head, habitat, blind.senses).length, 0)
  habitat.food = [{ x: 0.5, z: 0.2, regrow: 0 }]
  assert.deepEqual(perceive(head, habitat, blind.senses), [{ index: 0, by: 'touch' }])
})

test('the decision list: the first rule that holds sets the state', () => {
  const c = buildCreature(defaultGenome())
  const p = brainParams(c)
  const habitat = makeHabitat(1)
  habitat.food = [{ x: 3, z: 0, regrow: 0 }]
  habitat.obstacles = []
  const head = { x: 0, z: 0, heading: 0, speed: 0 }
  const tired = makeBrain(1, 0.1, 0.9)
  think(tired, head, habitat, p, STEP)
  assert.equal(tired.rule, 'tired')
  assert.equal(tired.state, 'rest')
  // Resting carries on past the threshold until energy is back over 0.85.
  tired.energy = 0.5
  think(tired, head, habitat, p, STEP)
  assert.equal(tired.rule, 'resting')
  const hungry = makeBrain(1, 0.9, 0.9)
  const cmd = think(hungry, head, habitat, p, STEP)
  assert.equal(hungry.state, 'seek')
  assert.ok(Math.abs(cmd.heading!) < 1e-9 && cmd.speed > 0)
  // A rock dead ahead outranks the food behind it.
  habitat.obstacles = [{ x: 1.4, z: 0, r: 0.6 }]
  assert.ok(feel(head, habitat, 3, 0.5))
  think(hungry, head, habitat, p, STEP)
  assert.equal(hungry.state, 'avoid')
})

test('in the habitat: it eats, it rests, it never walks into a rock, and the same seed replays exactly', () => {
  const run = (seed: number) => {
    const lab = new Lab(defaultGenome(), 'habitat', seed)
    const seen = new Set<string>()
    let clearance = Infinity
    for (let i = 0; i < 60 * 300; i++) {
      lab.step()
      seen.add(lab.brain.state)
      for (const o of lab.habitat.obstacles) clearance = Math.min(clearance, Math.hypot(lab.body.x - o.x, lab.body.z - o.z) - o.r)
    }
    return { lab, seen, clearance }
  }
  const a = run(3)
  assert.ok(a.lab.brain.eaten > 0)
  for (const s of ['idle', 'wander', 'seek', 'avoid', 'rest']) assert.ok(a.seen.has(s), `never ${s}`)
  assert.ok(a.clearance > 0, `inside a rock by ${-a.clearance}`)
  const b = run(3)
  assert.deepEqual([b.lab.body.x, b.lab.body.z, b.lab.brain.eaten, b.lab.brain.energy], [a.lab.body.x, a.lab.body.z, a.lab.brain.eaten, a.lab.brain.energy])
})

test('mutation changes some genes, never all, is seeded, and always yields a repaired genome', () => {
  for (let s = 1; s <= 400; s++) {
    const parent = randomGenome(s)
    const { genome, changes } = mutate(parent, 0.4, s)
    assert.deepEqual(mutate(parent, 0.4, s).genome, genome)
    assert.deepEqual(repair(genome), genome)
    assert.ok(changes.length >= 1 && changes.length < 20, `${changes.length} changes`)
    assert.equal(genome.bodySeed, parent.bodySeed)
    assert.equal(buildCreature(genome).limbs.length, genome.legs)
  }
})

test('a saved world keeps the creature, and repairs nonsense', () => {
  const d = defaultCreatureSettings()
  const saved = { ...d, tab: 'variation' as const, genome: randomGenome(7), origin: randomGenome(7), parent: randomGenome(6), generation: 3 }
  assert.deepEqual(creatureSpec.parse(JSON.parse(JSON.stringify(saved))).settings, saved)
  const junk = creatureSpec.parse({ genome: { legs: 7, bodyLength: 'long', eyes: 99 }, tab: 'nope', animSpeed: 50 }).settings
  assert.equal(junk.genome.legs, defaultGenome().legs)
  assert.equal(junk.genome.bodyLength, defaultGenome().bodyLength)
  assert.equal(junk.genome.eyes, 8)
  assert.equal(junk.tab, d.tab)
  assert.equal(junk.animSpeed, 2)
})
