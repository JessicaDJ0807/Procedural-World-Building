import { buildRiver } from './river'
import type { WorldSpec } from './worlds'

/**
 * Checks a river is a river.
 *
 * Every constraint here is one the construction is supposed to guarantee, which
 * is the point: a check that can only fail if the generator is wrong is worth
 * having, and one that restates a value the generator just computed is not.
 *
 * Run from a script rather than at startup — it walks the whole course, and the
 * answer cannot change between runs for a fixed seed.
 */
export type RiverReport = {
  world: string
  nodes: number
  length: number
  fall: number
  problems: string[]
}

export function validateRiver(spec: WorldSpec): RiverReport | null {
  if (!spec.river) return null
  const river = buildRiver(spec.terrain, spec.river)
  const problems: string[] = []
  const { nodes } = river

  if (nodes.length < 2) problems.push('course has fewer than two nodes')

  let rises = 0
  let worstRise = 0
  let shallow = 0
  let narrow = 0
  let jumps = 0
  let worstJump = 0

  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]
    const b = nodes[i]

    // Water must never climb downstream. 1e-6 of tolerance for float noise.
    const rise = b.water - a.water
    if (rise > 1e-6) {
      rises++
      worstRise = Math.max(worstRise, rise)
    }
    // The bed must stay under the water, or there is no river there.
    if (b.bed >= b.water) shallow++
    if (b.width <= 0) narrow++

    // Neighbouring nodes should be a step apart. A gap means the route jumped,
    // which would show as a tear in the water ribbon.
    const gap = Math.hypot(b.x - a.x, b.z - a.z)
    if (gap > spec.river.step * 1.6) {
      jumps++
      worstJump = Math.max(worstJump, gap)
    }
  }

  if (rises) problems.push(`${rises} uphill steps, worst ${worstRise.toFixed(3)} units`)
  if (shallow) problems.push(`${shallow} nodes with the bed at or above the water`)
  if (narrow) problems.push(`${narrow} nodes with a non-positive width`)
  if (jumps) problems.push(`${jumps} discontinuities, worst gap ${worstJump.toFixed(1)} units`)

  /*
   * Self-overlap. Two parts of the course running within a channel width of
   * each other merge into one braided mess, and the carve between them never
   * releases back to ground level — a cross-section taken across the river came
   * back as bed, briefly ridge, then bed again, ninety units out.
   *
   * Only pairs far apart along the course count: neighbours are supposed to be
   * close, that is what a course is.
   */
  let overlaps = 0
  let closest = Infinity
  const apart = Math.ceil(spec.river.influence / spec.river.step) * 3
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + apart; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z)
      if (d < closest) closest = d
      if (d < spec.river.influence * 1.3) overlaps++
    }
  }
  if (overlaps) {
    problems.push(
      `${overlaps} self-overlapping pairs, closest ${closest.toFixed(0)} units ` +
        `(needs ${(spec.river.influence * 1.3).toFixed(0)})`,
    )
  }

  /*
   * The course has to run through the region a presenter will walk, but it does
   * not have to stop there. A river that leaves the area reads as continuing;
   * one that ends in the middle of the map reads as unfinished. So the source
   * must be inside and most of the course with it, and the outlet is free.
   */
  const inside = nodes.filter((n) => Math.abs(n.x) <= 1800 && Math.abs(n.z) <= 1800).length
  const head = nodes[0]
  if (Math.abs(head.x) > 1800 || Math.abs(head.z) > 1800) problems.push('the source is outside the play area')
  if (inside / nodes.length < 0.6) {
    problems.push(`only ${((inside / nodes.length) * 100).toFixed(0)}% of the course is in the play area`)
  }

  return {
    world: spec.name,
    nodes: nodes.length,
    length: river.length,
    fall: nodes[0].water - nodes[nodes.length - 1].water,
    problems,
  }
}
