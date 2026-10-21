import { FRAME, GLASS, LEDGE, UNGROWABLE, buildBuilding, type Building, type Overhang, type Volume } from '../green/building'
import { computeGeometry, computeMoisture, computeSun } from '../green/fields'
import { WILD_SPECIES } from './species'

/**
 * The world the plants grow in: a building, its environment, and the
 * architecture the plants have added to it.
 *
 * The building is the invented one from the earlier Explore (building.ts),
 * reused as it is — floors, windows, ledges at every floor line, balconies,
 * corners, a wing with a roof terrace. What is new is that it can change:
 * a Living Platform is added to the building's own lists, as an overhang
 * (which shades the band of wall beneath it at the sun's angle) and as a
 * volume (which throws a shadow onto anything else), and the fields are then
 * recomputed by the same code that computed them in the first place. So the
 * shade under a platform is not painted on — it is what the sunlight rule
 * says once the platform exists.
 *
 *     environment → plants → platform → environment
 */

export type Platform = {
  kind: 'living-platform'
  segment: number
  /** Span along the wall, and the height of its top. */
  s0: number
  s1: number
  y: number
  depth: number
  thickness: number
  /** The step it formed at. */
  step: number
  /** Cells whose sunlight fell when it formed. */
  shaded: number
}

/**
 * Surfaces the base field rules don't describe — on the Build page, pitched
 * roofs and the surfaces of living architecture (build/surfaces.ts). Optional:
 * without one, the fields are exactly as before, which is what Explore runs.
 */
export type SurfaceOverlay = {
  /** Per species, a 0–1 multiplier on env and suitability: how well this kind of surface suits it. */
  affinity: Float32Array[]
  /** Called after sun and moisture are computed, before they are combined: for the cells the base rules can't know. */
  adjust(world: World): void
}

export const PLATFORM = { width: 3.4, depth: 1.9, thickness: 0.34 }

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export class World {
  /** The building as first built; never changed. The invented one unless another is given — a town from the Build page. */
  readonly base: Building
  /** The building now: the base plus whatever the plants have added. Its flags, overhangs and volumes are this world's own copies. */
  building: Building
  platforms: Platform[] = []
  /** Cells given full support by living architecture (the Build page's grown structures): something for climbers to climb. */
  livingSupport = new Set<number>()
  sun: Float32Array<ArrayBufferLike>
  moisture: Float32Array<ArrayBufferLike>
  geometry: Float32Array<ArrayBufferLike>
  /** Per species: can it live here (moisture × light). */
  env: Float32Array[]
  /** Per species: where a tip would rather go (env weighted toward support). */
  suitability: Float32Array[]
  /** Per species: the moisture half of env, kept so env can be worked out under other light (a plant shaded by the layers above it). */
  moistureMatch: Float32Array[]
  /** The sun before the last platform formed, for the debug view of what changed. */
  sunBefore: Float32Array | null = null
  rain = 0.5
  sunAzimuth = 20
  /** Cost of the last field recompute, ms. */
  fieldMs = 0
  /** Set before the first recompute (a WildSim's reset) to describe surfaces the base rules don't. */
  overlay: SurfaceOverlay | null = null
  private readonly baseGeometry: Float32Array

  constructor(base: Building = buildBuilding()) {
    this.base = base
    const n = base.count
    this.building = this.copy()
    this.sun = new Float32Array(n)
    this.moisture = new Float32Array(n)
    this.geometry = new Float32Array(n)
    this.env = WILD_SPECIES.map(() => new Float32Array(n))
    this.suitability = WILD_SPECIES.map(() => new Float32Array(n))
    this.moistureMatch = WILD_SPECIES.map(() => new Float32Array(n))
    this.baseGeometry = computeGeometry(base)
  }

  private copy(): Building {
    return { ...this.base, flags: Uint8Array.from(this.base.flags), overhangs: [...this.base.overhangs], volumes: [...this.base.volumes] }
  }

  reset() {
    this.building = this.copy()
    this.platforms = []
    this.livingSupport = new Set()
    this.sunBefore = null
    this.recompute()
  }

  setEnvironment(rain: number, sunAzimuth: number) {
    this.rain = rain
    this.sunAzimuth = sunAzimuth
    this.recompute()
  }

  /** The wall cells a platform spans, `below` units under its slab and `above` over it. */
  cellsNear(p: Pick<Platform, 'segment' | 's0' | 's1' | 'y' | 'thickness'>, below: number, above = 0): number[] {
    const b = this.building
    const out: number[] = []
    for (let i = 0; i < b.count; i++) {
      if (b.segment[i] !== p.segment) continue
      if (b.along[i] < p.s0 || b.along[i] > p.s1) continue
      const y = b.py[i]
      if (y < p.y - p.thickness - below || y > p.y + above) continue
      out.push(i)
    }
    return out
  }

  /**
   * Adds a platform to the building and recomputes the fields. Returns the
   * number of cells whose sunlight fell.
   *
   * - It joins `overhangs`, so the sun rule shades the wall under it on its
   *   own wall, and `volumes`, so it throws a shadow anywhere else.
   * - The band of wall it is rooted in becomes a ledge and a frame: support
   *   to follow, and a place water collects.
   * - The wall under it gets support in the geometry field: the roots and
   *   struts that hold it up are something to climb.
   */
  addPlatform(p: Platform): number {
    const b = this.building
    const seg = b.segments[p.segment]
    const overhang: Overhang = { segment: p.segment, s0: p.s0, s1: p.s1, y: p.y - p.thickness, depth: p.depth, thickness: p.thickness, kind: 'balcony' }
    const ax = seg.ax + seg.dx * p.s0
    const az = seg.az + seg.dz * p.s0
    const bx = seg.ax + seg.dx * p.s1
    const bz = seg.az + seg.dz * p.s1
    const volume: Volume = {
      polygon: [
        [ax, az],
        [bx, bz],
        [bx + seg.nx * p.depth, bz + seg.nz * p.depth],
        [ax + seg.nx * p.depth, az + seg.nz * p.depth],
      ],
      y0: p.y - p.thickness,
      y1: p.y,
    }
    b.overhangs = [...b.overhangs, overhang]
    b.volumes = [...b.volumes, volume]
    for (const i of this.cellsNear(p, 0, 0)) if (!(b.flags[i] & UNGROWABLE)) b.flags[i] |= LEDGE | FRAME
    this.sunBefore = Float32Array.from(this.sun)
    this.platforms.push(p)
    this.recompute()
    let shaded = 0
    for (let i = 0; i < b.count; i++) if (this.sun[i] < this.sunBefore[i] - 0.05) shaded++
    p.shaded = shaded
    return shaded
  }

  /** A species' env in a cell when the light reaching it is `sun` — less than the cell's own under layers of other plants. */
  envUnder(sp: number, cell: number, sun: number): number {
    const l = Math.min(1, Math.max(0.08, 1 - 1.1 * Math.abs(sun - WILD_SPECIES[sp].lightPreference)))
    return this.moistureMatch[sp][cell] * l
  }

  /**
   * Living architecture grown on the Build page: its solids cast shadows and
   * the cells it stands against become support. Recomputes the fields once.
   * Returns how many cells' sunlight fell.
   */
  addLiving(volumes: Volume[], support: number[]): number {
    const before = Float32Array.from(this.sun)
    this.building.volumes = [...this.building.volumes, ...volumes]
    for (const i of support) this.livingSupport.add(i)
    this.recompute()
    let shaded = 0
    for (let i = 0; i < this.building.count; i++) if (this.sun[i] < before[i] - 0.05) shaded++
    return shaded
  }

  private recompute() {
    const started = performance.now()
    const b = this.building
    this.sun = computeSun(b, this.sunAzimuth)
    this.moisture = computeMoisture(b, this.rain, this.sun)
    this.overlay?.adjust(this)
    // The base building's geometry, plus support under each platform: full at
    // its underside, fading over 1.5 units down the wall.
    const geometry = Float32Array.from(this.baseGeometry)
    for (const p of this.platforms) {
      for (const i of this.cellsNear(p, 1.5, 0)) {
        if (b.flags[i] & GLASS) continue
        const under = p.y - p.thickness - b.py[i]
        geometry[i] = Math.max(geometry[i], 1 - Math.max(0, under) / 1.5 * 0.5)
      }
    }
    for (const i of this.livingSupport) if (!(b.flags[i] & GLASS)) geometry[i] = 1
    this.geometry = geometry
    WILD_SPECIES.forEach((sp, k) => {
      const env = this.env[k]
      const suit = this.suitability[k]
      const affinity = this.overlay?.affinity[k]
      for (let i = 0; i < b.count; i++) {
        if (b.flags[i] & UNGROWABLE) {
          env[i] = 0
          suit[i] = 0
          continue
        }
        const m = smoothstep(0.06 * sp.moistureNeed, sp.moistureNeed, this.moisture[i])
        const l = Math.min(1, Math.max(0.08, 1 - 1.1 * Math.abs(this.sun[i] - sp.lightPreference)))
        this.moistureMatch[k][i] = m
        env[i] = m * l
        if (affinity) env[i] *= affinity[i]
        suit[i] = env[i] * (1 - sp.support + sp.support * geometry[i])
      }
    })
    this.fieldMs = performance.now() - started
  }
}
