import { FLOOR_HEIGHT, GLASS, inside } from '../green/building'
import type { WildGrowth } from './growth'
import { CLIMBER, SPREADER } from './species'
import { PLATFORM, type Platform, type World } from './world'

/**
 * The growth grammar: what two species meeting can turn into.
 *
 * A rule names the two species it needs, says where an encounter between
 * them would put its piece of architecture, and lists the conditions that
 * must all hold there. The simulation evaluates the rules wherever the two
 * species overlap; when every condition passes, the mutation forms.
 *
 *     compatible growth + mature enough + valid architectural location
 *       = mutation
 *
 * There is one rule — Climber + Spreader → Living Platform. Another would be
 * another entry in RULES (say, Spreader + a third species → a window), with
 * its own site and conditions; nothing else would change.
 */

export type Check = { label: string; ok: boolean; detail: string; place: boolean }

/** Where a rule would build, for one encounter. */
export type Site = { segment: number; s0: number; s1: number; y: number }

export type Evaluation = { rule: Rule; cell: number; site: Site; checks: Check[]; ok: boolean }

type Context = { world: World; growth: WildGrowth; site: Site; cell: number }

export type Rule = {
  kind: Platform['kind']
  /** The two species that must meet, by index. */
  species: [number, number]
  /** Where an encounter at `cell` would build; null where it makes no sense at all (a roof). */
  site: (world: World, cell: number) => Site | null
  /** `place`: a condition about where, not about the plants — all of these passing is an encounter at a valid spot. */
  conditions: { label: string; place: boolean; test: (c: Context) => { ok: boolean; detail: string } }[]
  /** The piece of architecture, once every condition passes. */
  build: (site: Site, step: number) => Platform
}

/** Each species needs this many cells within the site's reach. */
const MIN_CELLS = 10
/** And they must share at least this many cells there: overlapping, not just touching. In an object so a measurement can vary it. */
export const GRAMMAR = { minShared: 4 }
/** And their mean age there must be at least this many steps. */
const MIN_AGE = 40
/** Two platforms are at least this far apart, centre to centre. */
const SPACING = 5
/** A platform stays this clear of a wall's ends — of the corners. */
const END_MARGIN = 0.6
/** And is at least this wide. */
const MIN_WIDTH = 1.5

/** The cells within reach of a site: along its span, from 1.8 below the slab to 0.6 above. */
function reach(world: World, site: Site): number[] {
  return world.cellsNear({ ...site, thickness: PLATFORM.thickness }, 1.8, 0.6)
}

const LIVING_PLATFORM: Rule = {
  kind: 'living-platform',
  species: [CLIMBER, SPREADER],
  site: (world, cell) => {
    const b = world.building
    const si = b.segment[cell]
    if (si < 0) return null
    const seg = b.segments[si]
    // At the floor line nearest the encounter, centred on it along the wall —
    // as wide as the wall allows, up to the full width, and no narrower than
    // MIN_WIDTH: on a one-block wall in a town from the Build page, a
    // full-width platform would hang past the corner.
    const y = Math.round(b.py[cell] / FLOOR_HEIGHT) * FLOOR_HEIGHT
    const width = Math.min(PLATFORM.width, seg.length - 2 * END_MARGIN)
    if (width < MIN_WIDTH) return null
    const half = width / 2
    const centre = Math.min(seg.length - END_MARGIN - half, Math.max(END_MARGIN + half, b.along[cell]))
    return { segment: si, s0: centre - half, s1: centre + half, y }
  },
  conditions: [
    {
      label: 'Both mature and overlapping here',
      place: false,
      test: ({ world, growth, site }) => {
        const cells = reach(world, site)
        const n = [0, 0]
        const age = [0, 0]
        let shared = 0
        for (const i of cells) {
          for (const sp of [CLIMBER, SPREADER]) {
            if (!growth.has(sp, i)) continue
            n[sp]++
            age[sp] += growth.step - growth.bornAt(sp, i)
          }
          if (growth.mask[i] === 3) shared++
        }
        const meanAge = n.map((c, k) => (c ? age[k] / c : 0))
        const ok = n[CLIMBER] >= MIN_CELLS && n[SPREADER] >= MIN_CELLS && shared >= GRAMMAR.minShared && meanAge[CLIMBER] >= MIN_AGE && meanAge[SPREADER] >= MIN_AGE
        return {
          ok,
          detail: `Climber ${n[CLIMBER]} cells, ${Math.round(meanAge[CLIMBER])} steps old · Spreader ${n[SPREADER]}, ${Math.round(meanAge[SPREADER])} · ${shared} shared (need ${MIN_CELLS} each, ${GRAMMAR.minShared} shared, ${MIN_AGE} steps old)`,
        }
      },
    },
    {
      label: 'On a facade, above the ground floor',
      place: true,
      test: ({ world, site }) => {
        const seg = world.building.segments[site.segment]
        const ok = site.y >= FLOOR_HEIGHT && site.y <= seg.y1 - FLOOR_HEIGHT && site.y > seg.y0
        return { ok, detail: `Floor line at ${site.y} m on a wall ${seg.y0}–${seg.y1} m` }
      },
    },
    {
      label: 'Free space outward',
      place: true,
      test: ({ world, site }) => {
        const b = world.building
        const seg = b.segments[site.segment]
        // No balcony, cornice or earlier platform in the way on this wall…
        const blocked = b.overhangs.find(
          (o) => o.segment === site.segment && o.kind !== 'ledge' && o.s1 > site.s0 && o.s0 < site.s1 && Math.abs(o.y + o.thickness - site.y) < 2.4,
        )
        if (blocked) return { ok: false, detail: `A ${blocked.kind === 'balcony' ? 'balcony or platform' : blocked.kind} is in the way` }
        // …and the slab's outer edge is in open air, not inside another part of the building.
        const mid = (site.s0 + site.s1) / 2
        const ox = seg.ax + seg.dx * mid + seg.nx * (PLATFORM.depth + 0.2)
        const oz = seg.az + seg.dz * mid + seg.nz * (PLATFORM.depth + 0.2)
        const solid = b.volumes.find((v) => site.y > v.y0 && site.y - PLATFORM.thickness < v.y1 && inside(v.polygon, ox, oz))
        if (solid) return { ok: false, detail: 'Another part of the building stands in front' }
        const near = world.platforms.find((p) => {
          const ps = b.segments[p.segment]
          const px = ps.ax + ps.dx * (p.s0 + p.s1) / 2
          const pz = ps.az + ps.dz * (p.s0 + p.s1) / 2
          const sx = seg.ax + seg.dx * mid
          const sz = seg.az + seg.dz * mid
          return Math.hypot(px - sx, pz - sz, p.y - site.y) < SPACING
        })
        if (near) return { ok: false, detail: `Within ${SPACING} m of another Living Platform` }
        return { ok: true, detail: `${PLATFORM.depth} m of open air in front of the wall` }
      },
    },
    {
      label: 'Not across a window',
      place: true,
      test: ({ world, site }) => {
        const top = site.y + 0.3
        const bottom = site.y - PLATFORM.thickness - 0.1
        const win = world.building.windows.find((w) => w.segment === site.segment && w.s1 > site.s0 && w.s0 < site.s1 && w.y1 > bottom && w.y0 < top)
        return win ? { ok: false, detail: 'The slab would cut across a window' } : { ok: true, detail: 'The slab sits on solid wall between windows' }
      },
    },
    {
      label: 'Supported by the plants below',
      place: false,
      test: ({ world, growth, site }) => {
        const b = world.building
        const under = world.cellsNear({ ...site, thickness: PLATFORM.thickness }, 1.5, 0)
        let wall = 0
        let rooted = 0
        for (const i of under) {
          if (b.flags[i] & GLASS) continue
          wall++
          if (growth.mask[i]) rooted++
        }
        const ok = wall >= under.length * 0.5 && rooted >= wall * 0.35
        return { ok, detail: `${rooted} of ${wall} wall cells under it grown (need 35%)` }
      },
    },
  ],
  build: (site, step) => ({ kind: 'living-platform', ...site, depth: PLATFORM.depth, thickness: PLATFORM.thickness, step, shaded: 0 }),
}

export const RULES: Rule[] = [LIVING_PLATFORM]

/**
 * Evaluates every rule at every cell the two species share. Returns the
 * first site where everything passes, if any, and otherwise the most nearly
 * satisfied one — what the interaction view shows as "waiting on…".
 */
export function evaluate(world: World, growth: WildGrowth, contacts: number[]): { ready: Evaluation | null; best: Evaluation | null } {
  let best: Evaluation | null = null
  let bestPasses = -1
  const seen = new Set<string>()
  for (const rule of RULES) {
    for (const cell of contacts) {
      const site = rule.site(world, cell)
      if (!site) continue
      const key = `${rule.kind}:${site.segment}:${site.y}:${Math.round(site.s0 * 2)}`
      if (seen.has(key)) continue
      seen.add(key)
      const checks = rule.conditions.map((c) => ({ label: c.label, place: c.place, ...c.test({ world, growth, site, cell }) }))
      const ok = checks.every((c) => c.ok)
      const evaluation = { rule, cell, site, checks, ok }
      if (ok) return { ready: evaluation, best: evaluation }
      const passes = checks.filter((c) => c.ok).length
      if (passes > bestPasses) {
        best = evaluation
        bestPasses = passes
      }
    }
  }
  return { ready: null, best }
}
