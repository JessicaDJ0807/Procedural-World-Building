import * as THREE from 'three'
import { NO_SPECIES } from '../green/growth'
import type { GrowthParams } from '../green/params'
import { SPECIES, SPECIES_IDS, SPECIES_LOOK } from '../green/species'
import { CampusSim, type SimMode, type SunSet } from './campusSim'
import { ROAD_SCALE, SURFACES, computeRoadsideMoisture, type Roadside } from './roadside'
import { HOURS_RAMP, MOISTURE_RAMP, SUN_RAMP, SURFACE_COLOURS, rampColour } from './siteLook'
import type { SiteDisplay, Tally } from './SiteViewport'

/** The ground's own colours, by surface — the page's layer colours, and the land's for unmapped ground. */
const BASE: Record<(typeof SURFACES)[number], string> = {
  unmapped: '#8c877a',
  lawn: SURFACE_COLOURS.recreation,
  vacant: SURFACE_COLOURS.vacant,
  median: SURFACE_COLOURS.median,
  parking: SURFACE_COLOURS.parking,
  sidewalk: SURFACE_COLOURS.sidewalk,
  roadbed: SURFACE_COLOURS.roadbed,
}

export const SURFACE_LABELS: Record<(typeof SURFACES)[number], string> = {
  unmapped: 'Unmapped ground',
  lawn: 'Lawn',
  vacant: 'Vacant lot',
  median: 'Median',
  parking: 'Parking',
  sidewalk: 'Sidewalk',
  roadbed: 'Road',
}

/**
 * The roadside study on screen: the ground grid as one textured quad laid
 * over the island, and the simulation that grows on it.
 *
 * One texel per cell, in the grid's own orientation, so the quad is turned to
 * the island's axis and nothing is resampled. Cells are their surface's colour
 * until something grows, then their species' green; texels that are river or
 * building are transparent, so the page's own layers show through where the
 * grid has no cell.
 */
export class RoadsideLayer {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>
  readonly sim: CampusSim
  readonly data: Roadside
  private readonly finalData: Uint8Array
  private readonly fieldData: Uint8Array
  private readonly finalTexture: THREE.DataTexture
  private readonly fieldTexture: THREE.DataTexture
  private readonly finalMaterial: THREE.MeshLambertMaterial
  private readonly fieldMaterial: THREE.MeshBasicMaterial
  private readonly base: THREE.Color[]
  private readonly looks: { lush: THREE.Color; dry: THREE.Color; swatch: THREE.Color }[]
  private painted = 0
  private readonly shown: Uint8Array
  private fieldsSeen: number
  display: SiteDisplay = 'final'

  constructor(data: Roadside, suns: SunSet, params: GrowthParams, mode: SimMode, autoSeed: boolean) {
    this.data = data
    const { cols, rows, ox, oz, ux, uz, vx, vz } = data.grid
    const cell = data.building.cell
    this.sim = new CampusSim(
      {
        building: data.building,
        scale: ROAD_SCALE,
        habitat: data.habitat,
        moisture: (light, rain) => computeRoadsideMoisture(data, rain, light),
      },
      suns,
      params,
      mode,
    )
    this.sim.reset(autoSeed)
    this.fieldsSeen = this.sim.fieldsVersion

    const texture = (d: Uint8Array) => {
      const t = new THREE.DataTexture(d, cols, rows, THREE.RGBAFormat)
      t.magFilter = THREE.NearestFilter
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.generateMipmaps = true
      t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    this.finalData = new Uint8Array(cols * rows * 4)
    this.fieldData = new Uint8Array(cols * rows * 4)
    this.finalTexture = texture(this.finalData)
    this.fieldTexture = texture(this.fieldData)
    this.shown = new Uint8Array(data.building.count)
    this.base = SURFACES.map((s) => new THREE.Color(BASE[s]))
    this.looks = SPECIES_IDS.map((id) => ({
      lush: new THREE.Color(SPECIES_LOOK[id].lush),
      dry: new THREE.Color(SPECIES_LOOK[id].dry),
      swatch: new THREE.Color(SPECIES_LOOK[id].swatch),
    }))

    // The quad: the grid's rectangle, a hair above the page's ground layers.
    const W = cols * cell
    const H = rows * cell
    const corner = (u: number, v: number) => [ox + ux * u + vx * v, 0.05, oz + uz * u + vz * v]
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([...corner(0, 0), ...corner(W, 0), ...corner(W, H), ...corner(0, H)], 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
    // Wound to face up: corners go along the grid's columns then its rows,
    // and (column axis × row axis) points down, since the row axis is the
    // column axis turned a right angle to the left — so the triangles run the
    // other way round.
    geometry.setIndex([0, 2, 1, 0, 3, 2])
    // Drawn without depth, after the page's surfaces and before the
    // buildings, like the surfaces themselves.
    this.finalMaterial = new THREE.MeshLambertMaterial({ map: this.finalTexture, transparent: true, depthWrite: false })
    this.fieldMaterial = new THREE.MeshBasicMaterial({ map: this.fieldTexture, transparent: true, depthWrite: false })
    this.mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geometry, this.finalMaterial)
    this.mesh.renderOrder = 15
    this.paintFinal(true)
  }

  private write(target: Uint8Array, cell: number, c: THREE.Color) {
    const rgb = { r: 0, g: 0, b: 0 }
    c.getRGB(rgb, THREE.SRGBColorSpace)
    const t = this.data.building.texel[cell] * 4
    target[t] = Math.round(rgb.r * 255)
    target[t + 1] = Math.round(rgb.g * 255)
    target[t + 2] = Math.round(rgb.b * 255)
    target[t + 3] = 255
  }

  private plantColour(cell: number, out: THREE.Color) {
    const g = this.sim.growth
    const sp = g.species[cell]
    const wet = Math.min(1, this.sim.fields.moisture[cell] * 1.4)
    out.copy(this.looks[sp].dry).lerp(this.looks[sp].lush, wet)
    const h = Math.imul(cell ^ 0x9e3779b9, 0x85ebca6b) >>> 0
    return out.offsetHSL(((h & 255) / 255 - 0.5) * 0.03, 0, (((h >>> 8) & 255) / 255 - 0.5) * 0.16)
  }

  /** As the campus's: survivors keep their colour, the dead go back to their surface, new growth is appended. */
  private paintFinal(full: boolean) {
    const g = this.sim.growth
    const colour = new THREE.Color()
    if (full || g.grown < this.painted) {
      for (let k = 0; k < this.data.building.count; k++) this.write(this.finalData, k, this.base[this.data.surface[k]])
      this.shown.fill(0)
      this.painted = 0
    }
    for (let k = this.painted; k < g.grown; k++) {
      const cell = g.order[k]
      this.write(this.finalData, cell, this.plantColour(cell, colour))
      this.shown[cell] = 1
    }
    this.painted = g.grown
    this.finalTexture.needsUpdate = true
  }

  setDisplay(mode: SiteDisplay) {
    this.display = mode
    this.mesh.material = mode === 'final' ? this.finalMaterial : this.fieldMaterial
    if (mode === 'final') return
    const ramp = new THREE.Color()
    const empty = new THREE.Color('#2a2b2d')
    const { sim } = this
    const g = sim.growth
    for (let k = 0; k < this.data.building.count; k++) {
      if (mode === 'hours') rampColour(HOURS_RAMP, sim.hours[k], ramp)
      else if (mode === 'light') rampColour(SUN_RAMP, sim.energy[k], ramp)
      else if (mode === 'moisture') rampColour(MOISTURE_RAMP, sim.fields.moisture[k], ramp)
      else ramp.copy(g.species[k] === NO_SPECIES ? empty : this.looks[g.species[k]].swatch)
      this.write(this.fieldData, k, ramp)
    }
    this.fieldTexture.needsUpdate = true
  }

  /** After growth changed: repaint what depends on it. */
  private repaint(full = false) {
    this.paintFinal(full)
    if (this.display === 'species') this.setDisplay('species')
  }

  advance(steps: number) {
    const { sim } = this
    sim.advance(steps)
    const died = sim.takeDied()
    for (const cell of died) {
      this.write(this.finalData, cell, this.base[this.data.surface[cell]])
      if (this.shown[cell]) {
        this.shown[cell] = 0
        this.painted--
      }
    }
    if (sim.fieldsVersion !== this.fieldsSeen) {
      this.fieldsSeen = sim.fieldsVersion
      this.repaint(true)
      if (this.display === 'hours' || this.display === 'light' || this.display === 'moisture') this.setDisplay(this.display)
    } else this.repaint()
  }

  reset(autoSeed: boolean) {
    this.sim.reset(autoSeed)
    this.fieldsSeen = this.sim.fieldsVersion
    this.repaint(true)
  }

  setMode(mode: SimMode) {
    this.sim.setMode(mode)
    this.fieldsSeen = this.sim.fieldsVersion
    this.repaint(true)
    if (this.display !== 'final') this.setDisplay(this.display)
  }

  /** Returns true if it started again (a new roster or seed), as the campus does. */
  setParams(p: GrowthParams, previous: GrowthParams | null, autoSeed: boolean): boolean {
    this.sim.setParams(p)
    const roster = (q: GrowthParams) => SPECIES_IDS.map((id) => q.species[id].enabled).join()
    if (previous && (roster(p) !== roster(previous) || p.seed !== previous.seed)) {
      this.reset(autoSeed)
      return true
    }
    this.repaint(true)
    if (this.display === 'moisture') this.setDisplay('moisture')
    return false
  }

  plant(cell: number, species: number): boolean {
    if (!this.sim.plant(cell, species)) return false
    this.repaint()
    return true
  }

  /** The cell under a point on the quad, or −1. */
  cellAt(uv: THREE.Vector2): number {
    const { cols, rows } = this.data.grid
    const c = Math.floor(uv.x * cols)
    const r = Math.floor(uv.y * rows)
    if (c < 0 || r < 0 || c >= cols || r >= rows) return -1
    return this.data.cellAt[r * cols + c]
  }

  describe(cell: number, manual: boolean, plantSpecies: number): string {
    const { sim } = this
    const surface = SURFACE_LABELS[SURFACES[this.data.surface[cell]]]
    const hours = `${sim.hours[cell].toFixed(1)} h of sun`
    const held = sim.growth.species[cell]
    if (this.data.habitat[cell] === 0) return `${surface} · nothing grows here`
    if (manual) return held === NO_SPECIES ? `Click to plant ${SPECIES[SPECIES_IDS[plantSpecies]].name.toLowerCase()} · ${surface} · ${hours}` : `${surface} · already ${SPECIES_IDS[held]} · ${hours}`
    if (this.display === 'moisture') return `${surface} · moisture ${Math.round(sim.fields.moisture[cell] * 100)}% · ${hours}`
    if (held !== NO_SPECIES) return `${surface} · ${SPECIES[SPECIES_IDS[held]].name.toLowerCase()} · ${hours}`
    return `${surface} · ${hours}`
  }

  /**
   * What has grown, by surface, and on unpaved ground near pavement (within
   * 2 m) and farther — the comparison the study asks about.
   */
  tallies(): Tally[] {
    const g = this.sim.growth
    const { surface, habitat, curb } = this.data
    const out: Tally[] = SURFACES.filter((s) => s !== 'roadbed').map((s) => ({ key: SURFACE_LABELS[s], cells: 0, grown: [0, 0, 0] }))
    const near: Tally = { key: 'Near pavement', cells: 0, grown: [0, 0, 0] }
    const far: Tally = { key: 'Farther', cells: 0, grown: [0, 0, 0] }
    const roadCode = SURFACES.indexOf('roadbed')
    const paved = new Set(['parking', 'sidewalk', 'roadbed'].map((s) => SURFACES.indexOf(s as (typeof SURFACES)[number])))
    for (let k = 0; k < surface.length; k++) {
      if (habitat[k] === 0) continue
      const s = surface[k]
      const t = out[s < roadCode ? s : s - 1]
      t.cells++
      const sp = g.species[k]
      if (sp !== NO_SPECIES) t.grown[sp]++
      if (paved.has(s)) continue
      const band = curb[k] ? near : far
      band.cells++
      if (sp !== NO_SPECIES) band.grown[sp]++
    }
    return [...out, near, far]
  }

  /** Dev check: cells whose texel differs from a repaint from scratch. Should be 0. */
  checkPaint(): number {
    const before = this.finalData.slice()
    this.paintFinal(true)
    let wrong = 0
    const { texel, count } = this.data.building
    for (let k = 0; k < count; k++) {
      const t = texel[k] * 4
      if (before[t] !== this.finalData[t] || before[t + 1] !== this.finalData[t + 1] || before[t + 2] !== this.finalData[t + 2]) wrong++
    }
    return wrong
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.finalMaterial.dispose()
    this.fieldMaterial.dispose()
    this.finalTexture.dispose()
    this.fieldTexture.dispose()
  }
}
