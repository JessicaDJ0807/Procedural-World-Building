import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ROOF, inside } from '../green/building'
import { shellGeometry } from '../green/buildingMesh'
import type { GrowthParams } from '../green/params'
import { SPECIES_IDS, SPECIES_LOOK } from '../green/species'
import { SEASONS } from '../green/sunPath'
import { NO_SPECIES } from '../green/growth'
import { applyMapDrag, clampTarget } from '../mapDrag'
import { createCameraGate, startRenderLoop, wakeOnInput } from '../renderLoop'
import { VIEWPORT_BACKGROUND, VIZ_ACCENT } from '../theme'
import type { Campus } from './campus'
import { CampusSim, type HistoryPoint, type SimMode, type SunSet } from './campusSim'
import { LEAF_RANGE, SiteLeaves } from './siteLeaves'
import type { Roadside } from './roadside'
import { RoadsideLayer } from './roadsideLayer'
import { centroid, type Polygon, type Site, type SiteBuilding, type SurfaceKind } from './siteData'
import { HOURS_RAMP, MOISTURE_RAMP, SUN_RAMP, SURFACE_COLOURS, rampColour } from './siteLook'

export type SiteLayer = 'buildings' | 'green' | 'roads' | 'sidewalks' | 'parking'
export type SiteView = 'island' | 'campus'
/** How the campus is painted. Final is the buildings and what has grown on them; the rest are fields. */
export type SiteDisplay = 'final' | 'species' | 'hours' | 'light' | 'moisture'
export type Seeding = 'auto' | 'manual'

/** Which study is running: growth on the Cornell Tech buildings, or along the island's roads. */
export type Study = 'campus' | 'roadside'

export type SiteReport = {
  study: Study
  step: number
  grown: number
  coverage: number
  bySpecies: number[]
  tips: number
  stepMs: number
  fieldMs: number
  /** Over a year: which one, and the month. Null on a fixed day. */
  year: number
  month: string | null
  /** Coverage every 200 steps since the last reset. The same array each time; read, don't keep. */
  history: HistoryPoint[]
  /** Per campus building (index into site.buildings): its cells, and how many each species holds. */
  byBuilding: Tally[]
  /** The same by which way a wall faces, and roofs. */
  byFacing: Tally[]
  /** Leaf instances drawn right now; 0 when the camera is too far for leaves. */
  leaves: number
  /** Roadside only: what has grown by surface, then near pavement and farther. */
  bySurface: Tally[]
}

export type Tally = { key: string | number; cells: number; grown: number[] }

/** Compass sectors for walls: a wall faces north when its normal points within 45° of −z. */
const FACINGS = ['North', 'East', 'South', 'West'] as const

/** 1× is 8 steps a second, as on Explore. The campus is sixteen times the invented building's wall, so it gets a 64×. */
const STEPS_PER_SECOND = 8
const MAX_STEPS_PER_FRAME = 24
/** As on Explore: this many steps with nothing grown, and Play stops itself. */
export const SITE_STALL_STEPS = 600
const PLAYING_FPS = 30

/** Most hours of direct sun any cell gets: the June day, sunrise to sunset above 2°. The legend's end. */
export const MAX_SUN_HOURS = 15
/** A target further out than this has panned off the island into the river. */
const PAN_BOUNDS = { x0: -1200, x1: 1200, z0: -1500, z1: 1500 }

/** Which layer toggle each surface answers to. */
const SURFACE_LAYER: Record<SurfaceKind, SiteLayer> = {
  recreation: 'green',
  park: 'green',
  openSpace: 'green',
  vacant: 'green',
  median: 'roads',
  roadbed: 'roads',
  sidewalk: 'sidewalks',
  parking: 'parking',
}

/**
 * Painter's order for the flat layers, bottom first. They all lie at y = 0
 * and are drawn without writing depth, so this order alone decides which
 * shows where two overlap. Lifting each layer a few centimetres would be the
 * obvious alternative, but with the near plane at 2 m a 24-bit depth buffer
 * resolves only about 3 cm at 1 km and about a metre at the 6 km zoom limit
 * (z² / (near · 2²⁴)), so the layers would flicker through one another.
 */
const SURFACE_ORDER: SurfaceKind[] = ['recreation', 'park', 'openSpace', 'vacant', 'parking', 'roadbed', 'median', 'sidewalk']

const COLOURS = {
  water: new THREE.Color('#2c3a43'),
  land: new THREE.Color('#8c877a'),
  building: new THREE.Color('#c9c3b8'),
  campus: new THREE.Color('#dcb77a'),
  selected: new THREE.Color(VIZ_ACCENT),
}

/**
 * The island runs 3.2 km from south-west to north-east and is barely 250 m
 * wide, so the island view looks across it from the east-south-east and from
 * high up — at the first try's 32° it read as a thin strip on the horizon.
 * North stays −z; the compass says where it is.
 */
const VIEWS: Record<SiteView, { position: [number, number, number]; target: [number, number, number] }> = {
  island: { position: [1740, 3390, 1220], target: [0, 0, 0] },
  campus: { position: [-90, 260, 900], target: [-405, 20, 615] },
}

type Props = {
  study: Study
  /** The ground and its three days of sun, once the worker has built them. */
  roadside: { data: Roadside; suns: SunSet } | null
  site: Site
  campus: Campus
  /** The three traced days; a year's light is interpolated between them. */
  suns: SunSet
  mode: SimMode
  display: SiteDisplay
  params: GrowthParams
  running: boolean
  speed: number
  stepToken: number
  resetToken: number
  seeding: Seeding
  /** The species a click plants, as an index into SPECIES_IDS. */
  plantSpecies: number
  onReport: (report: SiteReport) => void
  onStall: (step: number) => void
  layers: Record<SiteLayer, boolean>
  selected: number | null
  onSelect: (index: number | null) => void
  view: SiteView
  viewToken: number
  /** Frame one building. A new token flies again, even to the same building. */
  focus: { index: number; token: number } | null
}

/** A polygon as a flat triangulated shape on the ground plane. */
function flat(polygon: Polygon): THREE.BufferGeometry {
  // Shape in (x, −z), so rotating −90° about x lays it flat with +z intact.
  const toVec = ([x, z]: [number, number]) => new THREE.Vector2(x, -z)
  const shape = new THREE.Shape(polygon[0].map(toVec))
  for (const hole of polygon.slice(1)) shape.holes.push(new THREE.Path(hole.map(toVec)))
  const geo = new THREE.ShapeGeometry(shape)
  geo.rotateX(-Math.PI / 2)
  return geo
}

function prism(b: SiteBuilding): THREE.BufferGeometry {
  const toVec = ([x, z]: [number, number]) => new THREE.Vector2(x, -z)
  const shape = new THREE.Shape(b.outline[0].map(toVec))
  for (const hole of b.outline.slice(1)) shape.holes.push(new THREE.Path(hole.map(toVec)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false })
  geo.rotateX(-Math.PI / 2)
  const out = geo.index ? geo.toNonIndexed() : geo
  out.deleteAttribute('uv')
  return out
}

function label(b: SiteBuilding): string {
  const name = b.name ?? (b.feature === 5110 ? 'Garage' : `Building ${b.bin}`)
  const height = b.heightMissing ? 'height not recorded' : `${b.height.toFixed(0)} m`
  return `${name} · ${height}${b.year ? ` · ${b.year}` : ''}`
}

/** Ranges of a merged mesh: triangle `starts[k]` up to `starts[k + 1]` belong to `indices[k]`. */
function merged(site: Site, indices: number[]) {
  const parts = indices.map((i) => prism(site.buildings[i]))
  const starts: number[] = []
  let triangles = 0
  for (const p of parts) {
    starts.push(triangles)
    triangles += p.attributes.position.count / 3
  }
  starts.push(triangles)
  const geo = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  const of = (face: number) => {
    let lo = 0
    let hi = starts.length - 2
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= face) lo = mid
      else hi = mid - 1
    }
    return indices[lo]
  }
  return { geo, starts, triangles, of }
}

/**
 * Roosevelt Island from the snapshot: water, land, the planimetric surfaces,
 * and every building extruded from its footprint to its recorded roof height.
 *
 * The Cornell Tech buildings are not extruded but drawn from their cells — the
 * same surface the growth model works on — so the whole-day sun can be painted
 * onto them cell by cell, exactly as Explore paints its fields.
 */
export function SiteViewport(props: Props) {
  const { site, campus, mode, display, layers, selected, view, viewToken, focus, params, stepToken, resetToken, seeding } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const compassRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  const api = useRef<{
    paint: (display: SiteDisplay) => void
    attachRoadside: (data: Roadside, suns: SunSet) => void
    setStudy: (study: Study) => void
    setMode: (mode: SimMode) => void
    setParams: (params: GrowthParams, previous: GrowthParams | null) => void
    reset: () => void
    stepOnce: () => void
    wake: () => void
    setLayers: (layers: Record<SiteLayer, boolean>) => void
    setSelected: (index: number | null) => void
    flyTo: (view: SiteView) => void
    frame: (index: number) => void
  } | null>(null)

  useEffect(() => {
    latest.current = props
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.prepend(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(VIEWPORT_BACKGROUND)
    const camera = new THREE.PerspectiveCamera(34, container.clientWidth / Math.max(container.clientHeight, 1), 2, 15000)
    camera.position.set(...VIEWS.island.position)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(...VIEWS.island.target)
    controls.maxPolarAngle = Math.PI * 0.47
    controls.minDistance = 40
    controls.maxDistance = 6000
    applyMapDrag(controls)
    controls.update()
    const gate = createCameraGate()

    // Low sun from the south-west, so the towers' long faces read apart. A
    // stand-in until the sunlight field is moved here with the real sun path.
    scene.add(new THREE.HemisphereLight(0xd6dde6, 0x4a463e, 1.1))
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.0)
    sun.position.set(-0.55, 0.62, 0.56)
    scene.add(sun)

    // --- ground: water, the island, then the surfaces in painter's order ---
    const flatMaterial = (colour: THREE.Color | string) =>
      new THREE.MeshLambertMaterial({ color: colour, depthWrite: false })
    const water = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2), flatMaterial(COLOURS.water))
    water.position.y = -0.5
    water.renderOrder = -2
    const land = new THREE.Mesh(flat([site.island]), flatMaterial(COLOURS.land))
    land.renderOrder = -1
    scene.add(water, land)

    const surfaceMeshes: { mesh: THREE.Mesh; layer: SiteLayer }[] = []
    SURFACE_ORDER.forEach((kind, i) => {
      const polygons = site.surfaces[kind]
      if (!polygons?.length) return
      const mesh = new THREE.Mesh(mergeGeometries(polygons.map(flat)), flatMaterial(SURFACE_COLOURS[kind]))
      mesh.renderOrder = i
      surfaceMeshes.push({ mesh, layer: SURFACE_LAYER[kind] })
      scene.add(mesh)
    })

    // --- context buildings: one merged mesh, with a triangle range per building ---
    const contextIndices = site.buildings.flatMap((b, i) => (b.campus ? [] : [i]))
    const context = merged(site, contextIndices)
    const colours = new Float32Array(context.triangles * 9)
    context.geo.setAttribute('color', new THREE.BufferAttribute(colours, 3))
    const rangeOf = new Map(contextIndices.map((siteIndex, k) => [siteIndex, k]))
    const paintBuilding = (i: number, colour: THREE.Color) => {
      const k = rangeOf.get(i)
      if (k === undefined) return
      for (let v = context.starts[k] * 3; v < context.starts[k + 1] * 3; v++) colour.toArray(colours, v * 3)
    }
    contextIndices.forEach((i) => paintBuilding(i, COLOURS.building))
    const buildingMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })
    const buildings = new THREE.Mesh(context.geo, buildingMaterial)
    buildings.renderOrder = 20
    // Outlines at the creases of every building, campus included, so a block
    // of towers reads as separate volumes from far enough away that shading
    // alone runs them together — and so the campus keeps its shape when it is
    // painted flat with a field.
    const allPrisms = merged(site, site.buildings.map((_, i) => i))
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(allPrisms.geo, 30),
      new THREE.LineBasicMaterial({ color: 0x3a3833, transparent: true, opacity: 0.45 }),
    )
    allPrisms.geo.dispose()
    edges.renderOrder = 21

    // --- the campus, from its cells ---
    const cells = campus.building
    const shellGeo = shellGeometry(cells)
    // Which building each shell vertex belongs to, for the selection tint:
    // walls come first, six vertices per segment in segment order; roof
    // triangles after, found by which footprint holds their centre.
    const segmentOwner = new Int16Array(cells.segments.length).fill(-1)
    for (let i = 0; i < cells.count; i++) if (cells.segment[i] >= 0) segmentOwner[cells.segment[i]] = campus.owner[i]
    const shellPos = shellGeo.attributes.position
    const vertexOwner = new Int16Array(shellPos.count).fill(-1)
    for (let v = 0; v < cells.segments.length * 6; v++) vertexOwner[v] = segmentOwner[Math.floor(v / 6)]
    for (let v = cells.segments.length * 6; v < shellPos.count; v += 3) {
      const x = (shellPos.getX(v) + shellPos.getX(v + 1) + shellPos.getX(v + 2)) / 3
      const z = (shellPos.getZ(v) + shellPos.getZ(v + 1) + shellPos.getZ(v + 2)) / 3
      const o = campus.indices.find((i) => inside(site.buildings[i].outline[0], x, z)) ?? -1
      vertexOwner[v] = vertexOwner[v + 1] = vertexOwner[v + 2] = o
    }
    const shellColours = shellGeo.attributes.color.array as Float32Array
    // The final view's colours are in its texture; the vertex colour only
    // tints the selected building toward the accent.
    const tint = new THREE.Color(1, 1, 1).lerp(COLOURS.selected, 0.6)
    const white = new THREE.Color(1, 1, 1)
    const paintCampus = (selectedIndex: number | null) => {
      for (let v = 0; v < shellPos.count; v++) {
        ;(vertexOwner[v] === selectedIndex && selectedIndex !== null ? tint : white).toArray(shellColours, v * 3)
      }
      shellGeo.attributes.color.needsUpdate = true
    }
    paintCampus(null)

    const { texW, texH } = cells
    // Nearest up close: one texel is one cell, and blurring them would show a
    // smoothness the model does not have. Mipmapped at a distance, where
    // nearest sampling of the cells striped the roofs with moiré.
    const cellTexture = (data: Uint8Array) => {
      const texture = new THREE.DataTexture(data, texW, texH, THREE.RGBAFormat)
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.generateMipmaps = true
      texture.colorSpace = THREE.SRGBColorSpace
      return texture
    }
    const texData = new Uint8Array(texW * texH * 4)
    const fieldTexture = cellTexture(texData)
    const finalData = new Uint8Array(texW * texH * 4)
    const finalTexture = cellTexture(finalData)
    const texelCell = new Int32Array(texW * texH).fill(-1)
    for (let i = 0; i < cells.count; i++) texelCell[cells.texel[i]] = i
    const campusPlain = new THREE.MeshLambertMaterial({ map: finalTexture, vertexColors: true })
    // Flat, not lit: a shaded face would read as less sun, which is the one
    // thing the field is there to say.
    const campusField = new THREE.MeshBasicMaterial({ map: fieldTexture })
    const shell = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(shellGeo, campusPlain)
    shell.renderOrder = 20
    scene.add(buildings, shell, edges)

    const leaves = new SiteLeaves(cells)
    scene.add(...leaves.meshes)
    let leavesBuiltAt = 0

    // --- the simulation ---
    const sim = new CampusSim(campus, latest.current.suns, latest.current.params, latest.current.mode)
    sim.reset(latest.current.seeding === 'auto')
    const growth = sim.growth
    const looks = SPECIES_IDS.map((id) => ({
      lush: new THREE.Color(SPECIES_LOOK[id].lush),
      dry: new THREE.Color(SPECIES_LOOK[id].dry),
      swatch: new THREE.Color(SPECIES_LOOK[id].swatch),
    }))
    const wallBase = COLOURS.campus
    const roofBase = COLOURS.campus.clone().multiplyScalar(0.86)
    // THREE.Color holds linear values; the textures are sRGB, so each colour
    // is converted on the way in. Writing the linear values straight in made
    // every cell darker than its colour — the campus brown instead of amber,
    // and the sun-hours view darker than its own legend.
    const srgb = { r: 0, g: 0, b: 0 }
    const write = (data: Uint8Array, cell: number, c: THREE.Color) => {
      c.getRGB(srgb, THREE.SRGBColorSpace)
      const t = cells.texel[cell] * 4
      data[t] = Math.round(srgb.r * 255)
      data[t + 1] = Math.round(srgb.g * 255)
      data[t + 2] = Math.round(srgb.b * 255)
      data[t + 3] = 255
    }
    /**
     * A grown cell's colour in the final view: its species' lush green, pulled
     * toward the dry one where the cell is dry, and nudged per cell in
     * lightness so a covered wall reads as foliage rather than paint. The
     * same rule Explore applies per leaf, applied per cell.
     */
    const plantColour = (cell: number, out: THREE.Color) => {
      const sp = growth.species[cell]
      const wet = Math.min(1, sim.fields.moisture[cell] * 1.4)
      out.copy(looks[sp].dry).lerp(looks[sp].lush, wet)
      const h = Math.imul(cell ^ 0x9e3779b9, 0x85ebca6b) >>> 0
      return out.offsetHSL(((h & 255) / 255 - 0.5) * 0.03, 0, (((h >>> 8) & 255) / 255 - 0.5) * 0.16)
    }
    const colour = new THREE.Color()
    // The grown cells listed first in `growth.order` that are already painted,
    // and a flag per cell for which ones those are.
    let painted = 0
    const shown = new Uint8Array(cells.count)
    const paintFinal = (full: boolean) => {
      if (full || growth.grown < painted) {
        for (let i = 0; i < cells.count; i++) write(finalData, i, cells.flags[i] & ROOF ? roofBase : wallBase)
        shown.fill(0)
        painted = 0
      }
      for (let k = painted; k < growth.grown; k++) {
        write(finalData, growth.order[k], plantColour(growth.order[k], colour))
        shown[growth.order[k]] = 1
      }
      if (full || growth.grown !== painted) finalTexture.needsUpdate = true
      painted = growth.grown
    }
    paintFinal(true)

    const ramp = new THREE.Color()
    const empty = new THREE.Color('#2a2b2d')
    const paint = (mode: SiteDisplay) => {
      shell.material = mode === 'final' ? campusPlain : campusField
      if (mode !== 'final') {
        texData.fill(90)
        for (let i = 0; i < cells.count; i++) {
          if (mode === 'hours') rampColour(HOURS_RAMP, sim.hours[i], ramp)
          else if (mode === 'light') rampColour(SUN_RAMP, sim.energy[i], ramp)
          else if (mode === 'moisture') rampColour(MOISTURE_RAMP, sim.fields.moisture[i], ramp)
          else ramp.copy(growth.species[i] === NO_SPECIES ? empty : looks[growth.species[i]].swatch)
          write(texData, i, ramp)
        }
        fieldTexture.needsUpdate = true
      }
      road?.setDisplay(mode)
      loop.wake()
    }
    /** After growth changes: the final texture always, the species view if it is showing. */
    const repaintGrowth = (full = false) => {
      paintFinal(full)
      if (latest.current.display === 'species') paint('species')
      dirty = true
      loop.wake()
    }

    let dirty = true
    let pending = 0
    let stallReported = false
    let fieldsSeen = sim.fieldsVersion

    // --- the roadside study, once its ground arrives ---
    let road: RoadsideLayer | null = null
    const roadActive = () => latest.current.study === 'roadside' && road !== null
    /** The simulation that Play, Step and the readout belong to. */
    const activeSim = () => (roadActive() ? road!.sim : sim)
    const attachRoadside = (data: Roadside, suns: SunSet) => {
      const { params, mode, seeding, display } = latest.current
      road = new RoadsideLayer(data, suns, params, mode, seeding === 'auto')
      road.setDisplay(display)
      road.mesh.visible = roadActive()
      scene.add(road.mesh)
      dirty = true
      loop.wake()
    }
    const setStudy = (study: Study) => {
      if (road) road.mesh.visible = study === 'roadside'
      stallReported = false
      pending = 0
      dirty = true
      loop.wake()
    }

    const advance = (steps: number) => {
      if (roadActive()) {
        road!.advance(steps)
        dirty = true
        loop.wake()
        return
      }
      sim.advance(steps)
      // Cells that died go back to bare wall. Die-back keeps the survivors in
      // birth order, so the painted ones are still listed first.
      // Within one call cells can grow, die, and others grow after them, so
      // the painted survivors are the painted count less the painted dead.
      const died = sim.takeDied()
      if (died.length) {
        for (const cell of died) {
          write(finalData, cell, cells.flags[cell] & ROOF ? roofBase : wallBase)
          if (shown[cell]) {
            shown[cell] = 0
            painted--
          }
        }
        finalTexture.needsUpdate = true
      }
      // Over a year the light, and with it the moisture, changes every 200
      // steps: every green shifts, and a field on screen is out of date.
      if (sim.fieldsVersion !== fieldsSeen) {
        fieldsSeen = sim.fieldsVersion
        repaintGrowth(true)
        const d = latest.current.display
        if (d === 'hours' || d === 'light' || d === 'moisture') paint(d)
      } else repaintGrowth()
    }
    const reset = () => {
      stallReported = false
      pending = 0
      if (roadActive()) {
        road!.reset(latest.current.seeding === 'auto')
        dirty = true
        loop.wake()
        return
      }
      sim.reset(latest.current.seeding === 'auto')
      repaintGrowth(true)
    }
    const setMode = (m: SimMode) => {
      road?.setMode(m)
      sim.setMode(m)
      fieldsSeen = sim.fieldsVersion
      // The cells' dryness shifts their green: repaint every grown one.
      repaintGrowth(true)
      if (latest.current.display !== 'final' && latest.current.display !== 'species') paint(latest.current.display)
    }
    const setParams = (p: GrowthParams, previous: GrowthParams | null) => {
      road?.setParams(p, previous, latest.current.seeding === 'auto')
      sim.setParams(p)
      const roster = (q: GrowthParams) => SPECIES_IDS.map((id) => q.species[id].enabled).join()
      if (previous && (roster(p) !== roster(previous) || p.seed !== previous.seed)) reset()
      else repaintGrowth(true)
      if (latest.current.display === 'moisture') paint('moisture')
    }

    let current: number | null = null
    const setSelected = (index: number | null) => {
      if (current !== null) paintBuilding(current, COLOURS.building)
      current = index
      if (current !== null) paintBuilding(current, COLOURS.selected)
      context.geo.attributes.color.needsUpdate = true
      paintCampus(index)
      loop.wake()
    }

    const setLayers = (l: Record<SiteLayer, boolean>) => {
      buildings.visible = edges.visible = shell.visible = l.buildings
      for (const { mesh, layer } of surfaceMeshes) mesh.visible = l[layer]
      loop.wake()
    }

    // --- picking ---
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    /** The building under the cursor, and the campus cell if it is on the campus. */
    const pick = (event: PointerEvent): { building: number; cell: number } | null => {
      if (!buildings.visible) return null
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObjects([buildings, shell], false)[0]
      if (!hit || hit.faceIndex == null) return null
      if (hit.object === buildings) return { building: context.of(hit.faceIndex), cell: -1 }
      if (!hit.uv) return null
      // A UV on a block's far edge lands one texel past it, in the gap.
      const u = Math.min(texW - 1, Math.floor(hit.uv.x * texW))
      const v = Math.min(texH - 1, Math.floor(hit.uv.y * texH))
      const cell = [v * texW + u, v * texW + u - 1, (v - 1) * texW + u, (v - 1) * texW + u - 1]
        .map((t) => (t >= 0 ? texelCell[t] : -1))
        .find((c) => c >= 0)
      if (cell === undefined) return null
      return { building: campus.owner[cell], cell }
    }
    /** In the roadside study: the ground cell under the cursor, unless a building is in front of it. */
    const pickGround = (event: PointerEvent): number => {
      if (!road || !roadActive()) return -1
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const targets = buildings.visible ? [buildings, shell, road.mesh] : [road.mesh]
      const hit = raycaster.intersectObjects(targets, false)[0]
      return hit && hit.object === road.mesh && hit.uv ? road.cellAt(hit.uv) : -1
    }
    const onMove = (event: PointerEvent) => {
      const tip = tipRef.current
      if (!tip) return
      if (road && roadActive() && !event.buttons) {
        const cell = pickGround(event)
        if (cell >= 0) {
          const rect = container.getBoundingClientRect()
          const manual = latest.current.seeding === 'manual'
          tip.hidden = false
          tip.textContent = road.describe(cell, manual, latest.current.plantSpecies)
          tip.style.transform = `translate(${event.clientX - rect.left + 14}px, ${event.clientY - rect.top + 14}px)`
          renderer.domElement.style.cursor = manual ? 'crosshair' : ''
          return
        }
      }
      // Not while dragging: a label chasing the cursor across a pan is noise.
      const hovered = event.buttons ? null : pick(event)
      if (hovered === null || hovered.building < 0) {
        tip.hidden = true
        renderer.domElement.style.cursor = ''
        return
      }
      const rect = container.getBoundingClientRect()
      const { display: mode, seeding: seedMode, plantSpecies } = latest.current
      const day = sim.month ?? SEASONS.find((x) => x.id === latest.current.mode.day)?.date ?? ''
      const name = site.buildings[hovered.building].name
      const c = hovered.cell
      let text = label(site.buildings[hovered.building])
      if (c >= 0) {
        const hours = `${sim.hours[c].toFixed(1)} h of sun`
        if (seedMode === 'manual') {
          const held = growth.species[c]
          text = held === NO_SPECIES ? `Click to plant ${SPECIES_IDS[plantSpecies] === 'vine' ? 'flowering vine' : SPECIES_IDS[plantSpecies]} here · ${hours}` : `${name} · already ${SPECIES_IDS[held]} · ${hours}`
        } else if (mode === 'hours') text = `${name} · ${sim.hours[c].toFixed(1)} h of direct sun · ${day}`
        else if (mode === 'light') text = `${name} · ${Math.round(sim.energy[c] * 100)}% of June's open-ground sun · ${day}`
        else if (mode === 'moisture') text = `${name} · moisture ${Math.round(sim.fields.moisture[c] * 100)}% · ${hours}`
        else if (growth.species[c] !== NO_SPECIES) text = `${name} · ${SPECIES_IDS[growth.species[c]]} · ${hours}`
      }
      tip.hidden = false
      tip.textContent = text
      tip.style.transform = `translate(${event.clientX - rect.left + 14}px, ${event.clientY - rect.top + 14}px)`
      renderer.domElement.style.cursor = c >= 0 && seedMode === 'manual' ? 'crosshair' : 'pointer'
    }
    const onLeave = () => {
      if (tipRef.current) tipRef.current.hidden = true
    }
    // A click is a press and release that barely moved — otherwise every
    // orbit would end by selecting whatever the cursor came to rest on.
    let down: { x: number; y: number } | null = null
    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY }
    }
    const onUp = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return
      down = null
      // In the roadside study, a manual click on the ground plants there.
      if (road && roadActive() && latest.current.seeding === 'manual') {
        const cell = pickGround(event)
        const sp = latest.current.plantSpecies
        if (cell >= 0) {
          if (latest.current.params.species[SPECIES_IDS[sp]].enabled && road.plant(cell, sp)) {
            stallReported = false
            dirty = true
            loop.wake()
          }
          return
        }
      }
      const hit = pick(event)
      // In manual mode a click on the campus plants rather than selects.
      if (!roadActive() && latest.current.seeding === 'manual' && hit && hit.cell >= 0) {
        const sp = latest.current.plantSpecies
        // A species switched off has no fields; its seed would die on the first step.
        if (latest.current.params.species[SPECIES_IDS[sp]].enabled && sim.plant(hit.cell, sp)) {
          stallReported = false
          repaintGrowth()
        }
        return
      }
      latest.current.onSelect(hit && hit.building >= 0 ? hit.building : null)
    }
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerleave', onLeave)
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)

    // --- camera flights ---
    let flight: { from: THREE.Vector3; fromT: THREE.Vector3; to: THREE.Vector3; toT: THREE.Vector3; t: number } | null = null
    const flyBetween = (to: THREE.Vector3, toT: THREE.Vector3) => {
      flight = { from: camera.position.clone(), fromT: controls.target.clone(), to, toT, t: 0 }
      loop.wake()
    }
    const flyTo = (v: SiteView) => flyBetween(new THREE.Vector3(...VIEWS[v].position), new THREE.Vector3(...VIEWS[v].target))
    // Keep the bearing the camera already has and only close the distance, so
    // framing a building never swings the view round to an unfamiliar side.
    const frame = (index: number) => {
      const b = site.buildings[index]
      const [x, z] = centroid(b.outline[0])
      const target = new THREE.Vector3(x, b.height * 0.45, z)
      const away = camera.position.clone().sub(controls.target).normalize()
      const distance = Math.max(140, b.height * 3.2)
      flyBetween(target.clone().addScaledVector(away, distance), target)
    }

    // Per building and per facing, counted fresh for each report: one pass
    // over the cells, about a millisecond, twice a second.
    const facingOf = new Int8Array(cells.count)
    for (let i = 0; i < cells.count; i++) {
      if (cells.flags[i] & ROOF) {
        facingOf[i] = 4
        continue
      }
      const deg = ((Math.atan2(cells.nx[i], -cells.nz[i]) * 180) / Math.PI + 360) % 360
      facingOf[i] = Math.floor(((deg + 45) % 360) / 90)
    }
    const tallies = () => {
      const byBuilding = new Map<number, Tally>(campus.indices.map((i) => [i, { key: i, cells: 0, grown: [0, 0, 0] }]))
      const byFacing: Tally[] = [...FACINGS, 'Roofs'].map((key) => ({ key, cells: 0, grown: [0, 0, 0] }))
      for (let i = 0; i < cells.count; i++) {
        const b = byBuilding.get(campus.owner[i])
        const f = byFacing[facingOf[i]]
        const sp = growth.species[i]
        if (b) b.cells++
        f.cells++
        if (sp !== NO_SPECIES) {
          if (b) b.grown[sp]++
          f.grown[sp]++
        }
      }
      return { byBuilding: [...byBuilding.values()], byFacing }
    }

    let since = performance.now()
    const loop = startRenderLoop((delta) => {
      const { running, speed, onReport, onStall } = latest.current
      // 30 frames a second while it plays, as on Explore: growth is paced in
      // steps per second, not per frame, so the cap costs smoothness, not speed.
      loop.setMaxFps(running ? PLAYING_FPS : 60)
      const ag = activeSim().growth
      if (running && !stallReported && ag.step - ag.lastGrowth >= SITE_STALL_STEPS) {
        stallReported = true
        onStall(ag.lastGrowth)
      }
      if (running) {
        pending += delta * STEPS_PER_SECOND * speed
        const whole = Math.min(Math.floor(pending), MAX_STEPS_PER_FRAME)
        if (whole > 0) advance(whole)
        pending = Math.min(pending - whole, 1)
      }
      let flying = false
      if (flight) {
        flight.t = Math.min(1, flight.t + delta / 1.1)
        const e = flight.t < 0.5 ? 2 * flight.t * flight.t : 1 - Math.pow(-2 * flight.t + 2, 2) / 2
        camera.position.lerpVectors(flight.from, flight.to, e)
        controls.target.lerpVectors(flight.fromT, flight.toT, e)
        flying = flight.t < 1
        if (!flying) flight = null
      }
      controls.update()
      clampTarget(controls, camera, PAN_BOUNDS)
      // Leaves only close up, in the final view, with the buildings shown.
      const close =
        camera.position.distanceTo(controls.target) < LEAF_RANGE && latest.current.display === 'final' && latest.current.layers.buildings
      leaves.visible = close
      let leavesPending = false
      if (close && leaves.stale(controls.target, growth, sim.fieldsVersion)) {
        // At most once a second while it plays: a rebuild is a pass over the
        // grown cells and up to 164,000 matrices, 40–55 ms in Node. It
        // rebuilds at once when paused.
        const now = performance.now()
        if (!running || now - leavesBuiltAt > 1000) {
          leaves.rebuild(controls.target, growth, sim.fields.moisture, sim.fieldsVersion)
          leavesBuiltAt = now
          dirty = true
        } else leavesPending = true
      }
      renderer.render(scene, camera)
      // North is −z. Seen from +z (azimuth 0) it points straight up the screen,
      // and the arrow turns with the camera as it orbits.
      if (compassRef.current) compassRef.current.style.transform = `rotate(${controls.getAzimuthalAngle()}rad)`
      const now = performance.now()
      if (dirty || now - since > 500) {
        dirty = false
        since = now
        const s = activeSim()
        const g = s.growth
        onReport({
          study: roadActive() ? 'roadside' : 'campus',
          step: g.step,
          grown: g.grown,
          coverage: g.coverage(),
          bySpecies: SPECIES_IDS.map((_, k) => g.coverageOf(k)),
          tips: g.activeTips,
          stepMs: s.stepMs,
          fieldMs: s.fieldMs,
          year: s.year,
          month: s.month,
          history: s.history,
          ...tallies(),
          leaves: close ? leaves.count : 0,
          bySurface: road && roadActive() ? road.tallies() : [],
        })
      }
      return running || flying || leavesPending || gate(camera.position, controls.target)
    })

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      loop.wake()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    const stopWaking = wakeOnInput(loop)

    // Dev only: run to an exact step, so a captured figure and the numbers
    // beside it describe the same state, as Explore's __greenAdvanceTo does.
    if (import.meta.env.DEV) {
      // A camera anywhere, for close-up figures.
      ;(window as unknown as { __siteCamera?: (p: number[], t: number[]) => void }).__siteCamera = (p, t) => {
        camera.position.set(p[0], p[1], p[2])
        controls.target.set(t[0], t[1], t[2])
        controls.update()
        loop.wake()
      }
      ;(window as unknown as { __siteAdvanceTo?: (n: number) => number }).__siteAdvanceTo = (n) => {
        const g = activeSim().growth
        if (n > g.step) advance(n - g.step)
        return g.grown
      }
      // And check the incremental painting against a repaint from scratch:
      // the number of cells whose texel differs. Should always be 0.
      ;(window as unknown as { __siteCheckPaint?: () => number }).__siteCheckPaint = () => {
        if (road && roadActive()) return road.checkPaint()
        const before = finalData.slice()
        paintFinal(true)
        let wrong = 0
        for (let i = 0; i < cells.count; i++) {
          const t = cells.texel[i] * 4
          if (before[t] !== finalData[t] || before[t + 1] !== finalData[t + 1] || before[t + 2] !== finalData[t + 2]) wrong++
        }
        return wrong
      }
    }

    paint(latest.current.display)
    api.current = {
      paint,
      attachRoadside,
      setStudy,
      setMode,
      setParams,
      reset,
      stepOnce: () => advance(1),
      wake: () => loop.wake(),
      setLayers,
      setSelected,
      flyTo,
      frame,
    }

    return () => {
      api.current = null
      stopWaking()
      loop.dispose()
      observer.disconnect()
      controls.dispose()
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose()
      })
      for (const m of [buildingMaterial, campusPlain, campusField, edges.material, water.material, land.material, ...surfaceMeshes.map((s) => s.mesh.material)]) {
        ;(m as THREE.Material).dispose()
      }
      fieldTexture.dispose()
      finalTexture.dispose()
      leaves.dispose()
      road?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [site, campus])

  useEffect(() => {
    api.current?.paint(display)
  }, [display, campus])

  // The ground arrives after the campus; attach it once, to this scene.
  const { roadside, study } = props
  useEffect(() => {
    if (roadside) api.current?.attachRoadside(roadside.data, roadside.suns)
  }, [roadside, campus])

  useEffect(() => {
    api.current?.setStudy(study)
  }, [study])

  // A new day, a year, or die-back switched carries the growth on under it,
  // as a parameter change does on Explore; only Reset, a new roster or a new
  // seed starts again.
  const firstMode = useRef(true)
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false
      return
    }
    api.current?.setMode(mode)
  }, [mode])

  const previousParams = useRef<GrowthParams | null>(null)
  useEffect(() => {
    if (previousParams.current) api.current?.setParams(params, previousParams.current)
    previousParams.current = params
  }, [params])

  useEffect(() => {
    if (stepToken > 0) api.current?.stepOnce()
  }, [stepToken])

  useEffect(() => {
    if (resetToken > 0) api.current?.reset()
  }, [resetToken])

  // Switching between automatic and manual seeding starts again: automatic
  // replants, manual clears for planting by hand.
  const firstSeeding = useRef(true)
  useEffect(() => {
    if (firstSeeding.current) {
      firstSeeding.current = false
      return
    }
    api.current?.reset()
  }, [seeding])

  useEffect(() => {
    api.current?.wake()
  }, [props.running])

  useEffect(() => {
    api.current?.setLayers(layers)
  }, [layers, site, campus])

  useEffect(() => {
    api.current?.setSelected(selected)
  }, [selected, site, campus])

  useEffect(() => {
    if (viewToken > 0) api.current?.flyTo(view)
    // Only a new token flies; the view alone changing is the button's state catching up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewToken])

  useEffect(() => {
    if (focus) api.current?.frame(focus.index)
  }, [focus])

  return (
    <div ref={containerRef} className="site-viewport">
      <div ref={tipRef} className="site-tip" hidden />
      <div className="site-compass" aria-label="North">
        <div ref={compassRef} className="site-compass-needle">
          <span>N</span>
        </div>
      </div>
    </div>
  )
}
