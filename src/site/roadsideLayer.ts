import * as THREE from 'three'
import { NO_SPECIES } from '../green/growth'
import type { GrowthParams } from '../green/params'
import { SPECIES, SPECIES_IDS } from '../green/species'
import { CampusSim, type SimMode, type SunSet } from './campusSim'
import { ROAD_SCALE, SURFACES, computeRoadsideMoisture, type Roadside } from './roadside'
import {
  FADE_STEPS,
  FLOWER_STEPS,
  FRESH_STEPS,
  HOURS_RAMP,
  MOISTURE_RAMP,
  SCENE,
  SITE_SPECIES,
  SUN_RAMP,
  SURFACE_COLOURS,
  flowering,
  growthColour,
  rampColour,
} from './siteLook'
import { vegetationOverlay, writeVegetation, type VegetationOverlay } from './siteVegetation'
import type { SiteDisplay, Tally } from './SiteViewport'

/** The ground's own colours, by surface — the page's layer colours, and the land's for unmapped ground. */
const BASE: Record<(typeof SURFACES)[number], string> = {
  unmapped: SCENE.land,
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
  private readonly looks = SITE_SPECIES
  /** The plants, as masses over the ground (siteVegetation.ts). */
  private readonly overlay: VegetationOverlay
  private readonly plants: THREE.Mesh
  /** Dying cells, as [cell, species, step of death], fading out. */
  private fading: number[] = []
  private painted = 0
  private readonly shown: Uint8Array
  private fieldsSeen: number
  display: SiteDisplay = 'final'
  /** The species the suitability view shows. */
  private focus = 0

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
    // The data views stay unhazed and untone-mapped, so they match their legends.
    this.fieldMaterial = new THREE.MeshBasicMaterial({ map: this.fieldTexture, transparent: true, depthWrite: false, fog: false, toneMapped: false })
    this.mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geometry, this.finalMaterial)
    this.mesh.renderOrder = 15
    this.mesh.receiveShadow = true
    // The plants ride on the ground quad as a child, so they show and hide
    // with it; picking still hits only the quad.
    this.overlay = vegetationOverlay(cols, rows)
    this.plants = new THREE.Mesh(geometry, this.overlay.material)
    this.plants.renderOrder = 16
    this.plants.receiveShadow = true
    this.mesh.add(this.plants)
    // The ground itself is only its surfaces now, painted once.
    for (let k = 0; k < data.building.count; k++) this.write(this.finalData, k, this.base[data.surface[k]])
    this.finalTexture.needsUpdate = true
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

  /** A grown cell into the plant layer. Env here carries the surface's habitat, so a plant hanging on in a crack reads stressed. */
  private paintCell(cell: number, colour: THREE.Color) {
    const g = this.sim.growth
    const sp = g.species[cell]
    const age = g.step - g.birth[cell]
    growthColour(sp, age, this.sim.fields.env[sp][cell], cell, colour, false)
    writeVegetation(this.overlay, this.data.building.texel[cell], colour, 1, sp, flowering(sp, age, cell))
  }

  private plantsChanged() {
    this.overlay.colour.needsUpdate = true
    this.overlay.kind.needsUpdate = true
  }

  /** As the campus's: the growth front and young vine settle and flower; the dead fade from withered to bare. */
  private animate(steps: number) {
    const g = this.sim.growth
    const step = g.step
    const colour = new THREE.Color()
    // Wide enough to catch every cell that crossed an age threshold in this advance.
    const horizon = Math.max(FRESH_STEPS, FLOWER_STEPS) + steps + 1
    for (let k = g.grown - 1; k >= 0; k--) {
      const cell = g.order[k]
      if (step - g.birth[cell] > horizon) break
      this.paintCell(cell, colour)
    }
    if (this.fading.length) {
      const keep: number[] = []
      for (let i = 0; i < this.fading.length; i += 3) {
        const cell = this.fading[i]
        if (g.birth[cell] >= 0) continue
        const since = step - this.fading[i + 2]
        const sp = this.fading[i + 1]
        writeVegetation(this.overlay, this.data.building.texel[cell], SITE_SPECIES[sp].withered, 1 - since / FADE_STEPS, sp, false)
        if (since < FADE_STEPS) keep.push(cell, sp, this.fading[i + 2])
      }
      this.fading = keep
    }
    this.plantsChanged()
  }

  /** As the campus's: survivors keep their colour, the dead go back to their surface, new growth is appended. */
  private paintFinal(full: boolean) {
    const g = this.sim.growth
    const colour = new THREE.Color()
    if (full || g.grown < this.painted) {
      this.overlay.colourData.fill(0)
      this.overlay.kindData.fill(0)
      this.shown.fill(0)
      this.painted = 0
    }
    for (let k = this.painted; k < g.grown; k++) {
      const cell = g.order[k]
      this.paintCell(cell, colour)
      this.shown[cell] = 1
    }
    this.painted = g.grown
    this.plantsChanged()
  }

  setDisplay(mode: SiteDisplay, focus = 0) {
    this.display = mode
    this.focus = focus
    this.mesh.material = mode === 'final' ? this.finalMaterial : this.fieldMaterial
    this.plants.visible = mode === 'final'
    if (mode === 'final') return
    const ramp = new THREE.Color()
    const empty = new THREE.Color('#2a2b2d')
    const { sim } = this
    const g = sim.growth
    for (let k = 0; k < this.data.building.count; k++) {
      if (mode === 'hours') rampColour(HOURS_RAMP, sim.hours[k], ramp)
      else if (mode === 'light') rampColour(SUN_RAMP, sim.energy[k], ramp)
      else if (mode === 'moisture') rampColour(MOISTURE_RAMP, sim.fields.moisture[k], ramp)
      else if (mode === 'surfaces') ramp.copy(this.base[this.data.surface[k]])
      else if (mode === 'suitability') rampColour(SUN_RAMP, sim.fields.suitability[this.focus][k], ramp)
      else ramp.copy(g.species[k] === NO_SPECIES ? empty : this.looks[g.species[k]].swatch)
      this.write(this.fieldData, k, ramp)
    }
    this.fieldTexture.needsUpdate = true
  }

  /** After growth changed: repaint what depends on it. */
  private repaint(full = false) {
    this.paintFinal(full)
    if (this.display === 'species') this.setDisplay('species', this.focus)
  }

  advance(steps: number) {
    const { sim } = this
    sim.advance(steps)
    const died = sim.takeDied()
    for (let d = 0; d < died.length; d += 3) {
      const cell = died[d]
      this.fading.push(cell, died[d + 1], died[d + 2])
      if (this.shown[cell]) {
        this.shown[cell] = 0
        this.painted--
      }
    }
    if (sim.fieldsVersion !== this.fieldsSeen) {
      this.fieldsSeen = sim.fieldsVersion
      this.repaint(true)
      if (this.display === 'hours' || this.display === 'light' || this.display === 'moisture' || this.display === 'suitability') this.setDisplay(this.display, this.focus)
    } else this.repaint()
    this.animate(steps)
  }

  reset(autoSeed: boolean) {
    this.sim.reset(autoSeed)
    this.fading = []
    this.fieldsSeen = this.sim.fieldsVersion
    this.repaint(true)
  }

  setMode(mode: SimMode) {
    this.sim.setMode(mode)
    this.fieldsSeen = this.sim.fieldsVersion
    this.repaint(true)
    if (this.display !== 'final') this.setDisplay(this.display, this.focus)
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
    if (this.display === 'moisture' || this.display === 'suitability') this.setDisplay(this.display, this.focus)
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

  setRaw(raw: boolean) {
    this.overlay.setRaw(raw)
  }

  /** Dev check: cells whose texel differs from a repaint from scratch. Should be 0. */
  checkPaint(): number {
    const before = this.overlay.colourData.slice()
    this.paintFinal(true)
    let wrong = 0
    const { texel, count } = this.data.building
    // Cells mid-fade differ from a fresh repaint on purpose.
    const fadingNow = new Set(this.fading.filter((_, i) => i % 3 === 0))
    for (let k = 0; k < count; k++) {
      if (fadingNow.has(k)) continue
      const t = texel[k] * 4
      const now = this.overlay.colourData
      if (before[t] !== now[t] || before[t + 1] !== now[t + 1] || before[t + 2] !== now[t + 2] || before[t + 3] !== now[t + 3]) wrong++
    }
    return wrong
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.finalMaterial.dispose()
    this.fieldMaterial.dispose()
    this.finalTexture.dispose()
    this.fieldTexture.dispose()
    this.overlay.dispose()
  }
}
