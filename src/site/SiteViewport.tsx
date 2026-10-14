import { useEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ROOF, inside } from '../green/building'
import { shellGeometry } from '../green/buildingMesh'
import type { GrowthParams } from '../green/params'
import { SPECIES_IDS } from '../green/species'
import { SEASONS } from '../green/sunPath'
import { NO_SPECIES } from '../green/growth'
import { applyMapDrag, clampTarget } from '../mapDrag'
import { createCameraGate, startRenderLoop, wakeOnInput } from '../renderLoop'
import { VIEWPORT_BACKGROUND, VIZ_ACCENT } from '../theme'
import type { Campus } from './campus'
import { CampusSim, type HistoryPoint, type SimMode, type SunSet } from './campusSim'
import { LEAF_RANGE, SiteLeaves } from './siteLeaves'
import { vegetationOverlay, writeVegetation } from './siteVegetation'
import { STRUCTURE_RANGE, SiteStructure } from './siteStructure'
import { buildFacade, facadeBuilding } from './facade'
import { SURFACE_TYPES, SURFACES } from './facadeSurfaces'
import type { Roadside } from './roadside'
import { RoadsideLayer } from './roadsideLayer'
import { centroid, type Polygon, type Site, type SiteBuilding, type SurfaceKind } from './siteData'
import {
  BUILDING_STONE,
  CAMPUS_STONE,
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
import { SunsetLight, contextTrees, fitHaze, glassMaterial, haze, skyDome } from './siteAtmosphere'
import { SEASON_DAY, dayOfPhase, lateAfternoon, sunAtClock } from './sunClock'
import { loadContext, massingMesh } from './siteContext'
import { buildLandscape, loadLandscape, type Landscape } from './siteLandscape'

export type SiteLayer = 'buildings' | 'green' | 'roads' | 'sidewalks' | 'parking'
export type SiteView = 'island' | 'campus'
/** How the campus is painted. Final is the buildings and what has grown on them; the rest are fields. */
export type SiteDisplay = 'final' | 'species' | 'hours' | 'light' | 'moisture' | 'surfaces' | 'suitability'
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
  /** The sun the scene is lit by: day of the year (1 January = 0) and clock hour. */
  sun: SunMoment
}

export type SunMoment = { day: number; hour: number }

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
  water: new THREE.Color(SCENE.water),
  land: new THREE.Color(SCENE.land),
  campus: new THREE.Color(CAMPUS_STONE),
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
  // Low and close, from the south-west, with the low sun behind the camera:
  // the campus's faces lit gold, Queens across the river behind it. The page
  // opens here — the island view from 3 km up made the towers nearest the
  // camera look like stretched boxes.
  campus: { position: [-680, 105, 850], target: [-405, 28, 612] },
}

type Props = {
  study: Study
  /** Detailed façades (windows, louvers, ledges, with their effect on growth), or the plain massing. */
  facades: boolean
  /** Debug: draw the simulation's cells as squares instead of plant masses. */
  rawCells: boolean
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
  /** Light the scene at this day and hour; null follows the growth's day, late in the afternoon. */
  sunMoment: SunMoment | null
  /** Overlays drawn over the scene, such as the sun dial. */
  children?: ReactNode
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
    setRaw: (raw: boolean) => void
    setFacades: (on: boolean) => void
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
    // Filmic tone mapping, for a sunset's range: a bright orange sun on pale
    // stone would clip to flat white without it. The data views opt out.
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.12
    // Shadows from the low sun, drawn on demand: the sun never moves, so the
    // map changes only when the view moves far enough to refit it.
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.shadowMap.autoUpdate = false
    container.prepend(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(VIEWPORT_BACKGROUND)
    scene.add(skyDome())
    const fog = haze()
    scene.fog = fog
    const camera = new THREE.PerspectiveCamera(34, container.clientWidth / Math.max(container.clientHeight, 1), 2, 15000)
    camera.position.set(...VIEWS.campus.position)
    const controls = new OrbitControls(camera, renderer.domElement)
    // The hover label describes what was under the pointer; once the view
    // moves without it — a scroll to zoom — it describes something else.
    controls.addEventListener('start', () => {
      if (tipRef.current) tipRef.current.hidden = true
    })
    controls.enableDamping = true
    controls.target.set(...VIEWS.campus.target)
    controls.maxPolarAngle = Math.PI * 0.47
    controls.minDistance = 40
    controls.maxDistance = 6000
    applyMapDrag(controls)
    controls.update()
    const gate = createCameraGate()

    // Golden hour: a low orange sun over Manhattan, cool sky light in the
    // shadows. Mood, not the growth model's sun — see siteAtmosphere.ts.
    const light = new SunsetLight(scene)

    // --- ground: water, the island, then the surfaces in painter's order ---
    const flatMaterial = (colour: THREE.Color | string) =>
      new THREE.MeshLambertMaterial({ color: colour, depthWrite: false })
    // The river: plain slate, unlit, taking only the haze. Glossy, with
    // nothing to reflect, it read as a dark void; lit, the lavender sky light
    // turned it purple.
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: COLOURS.water, depthWrite: false }),
    )
    water.position.y = -0.5
    water.renderOrder = -2
    const land = new THREE.Mesh(flat([site.island]), flatMaterial(COLOURS.land))
    land.renderOrder = -1
    land.receiveShadow = true
    scene.add(water, land)
    // The island's planted context, as generic trees; and the real buildings
    // across the river, added when their file arrives (0.26 MB gzipped, about
    // 50 ms to build).
    const trees = contextTrees(site)
    scene.add(trees)
    let disposed = false
    // The south's landscape — lawns, parks, relief, mapped and procedural
    // trees — when its file arrives; the generic trees step aside there.
    // Buildings study only: the roadside study paints the same ground as its
    // own 1 m cells, and the two drawn together were a patchwork, the
    // landscape's mounds poking up through the roadside's flat ground.
    let landscape: Landscape | null = null
    let treesOutside: THREE.Group | null = null
    const showLandscape = () => {
      const on = landscape !== null && latest.current.study === 'campus'
      if (landscape) landscape.group.visible = on && latest.current.layers.green
      trees.visible = !on
      if (treesOutside) treesOutside.visible = on
      renderer.shadowMap.needsUpdate = true
    }
    loadLandscape().then(
      (data) => {
        if (disposed) return
        landscape = buildLandscape(site, data)
        treesOutside = contextTrees(site, landscape.covers)
        scene.add(landscape.group, treesOutside)
        showLandscape()
        loop.wake()
      },
      () => {
        // Scenery only: without it the south stays bare ground.
      },
    )
    loadContext().then(
      (ctx) => {
        if (disposed) return
        scene.add(massingMesh(ctx))
        loop.wake()
      },
      () => {
        // Scenery only: without it the page still works, with an empty shore.
      },
    )

    const surfaceMeshes: { mesh: THREE.Mesh; layer: SiteLayer }[] = []
    SURFACE_ORDER.forEach((kind, i) => {
      const polygons = site.surfaces[kind]
      if (!polygons?.length) return
      const mesh = new THREE.Mesh(mergeGeometries(polygons.map(flat)), flatMaterial(SURFACE_COLOURS[kind]))
      mesh.renderOrder = i
      mesh.receiveShadow = true
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
    // Each building its own stone, by a hash of its index: mostly cream,
    // sandstone and taupe, now and then clay or terracotta.
    const stones = BUILDING_STONE.map(([c, share]) => ({ colour: new THREE.Color(c), share }))
    const stoneOf = (i: number) => {
      let h = Math.imul((i + 1) ^ 0x9e3779b9, 0x85ebca6b)
      h ^= h >>> 15
      let t = (h >>> 0) / 4294967296
      for (const st of stones) {
        if (t < st.share) return st.colour
        t -= st.share
      }
      return stones[0].colour
    }
    contextIndices.forEach((i) => paintBuilding(i, stoneOf(i)))
    const buildingMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 })
    const buildings = new THREE.Mesh(context.geo, buildingMaterial)
    buildings.renderOrder = 20
    buildings.castShadow = true
    buildings.receiveShadow = true
    // Outlines at the creases of every building, campus included, so a block
    // of towers reads as separate volumes from far enough away that shading
    // alone runs them together — and so the campus keeps its shape when it is
    // painted flat with a field.
    const allPrisms = merged(site, site.buildings.map((_, i) => i))
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(allPrisms.geo, 30),
      new THREE.LineBasicMaterial({ color: SCENE.edges, transparent: true, opacity: 0.22 }),
    )
    allPrisms.geo.dispose()
    edges.renderOrder = 21

    // --- the campus, from its cells ---
    const cells = campus.building
    // The procedural façades: a surface type per cell, and the boxes that show them.
    const facade = buildFacade(campus, site)
    const facadeMesh = new THREE.Group()
    for (const mesh of [
      new THREE.Mesh(facade.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 })),
      new THREE.Mesh(facade.glass, glassMaterial()),
    ]) {
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.renderOrder = 20
      facadeMesh.add(mesh)
    }
    facadeMesh.visible = latest.current.facades
    scene.add(facadeMesh)
    const surfaceDebug = SURFACE_TYPES.map((t) => new THREE.Color(SURFACES[t].debug))
    // Each campus building's façade, as its three largest surface types.
    const facadeMix = new Map<number, string>()
    {
      const counts = new Map<number, number[]>()
      for (let i = 0; i < cells.count; i++) {
        const o = campus.owner[i]
        if (o < 0) continue
        const row = counts.get(o) ?? new Array(SURFACE_TYPES.length).fill(0)
        row[facade.surface[i]]++
        counts.set(o, row)
      }
      for (const [o, row] of counts) {
        const total = row.reduce((a, b) => a + b, 0)
        const top = row.map((n, k) => [n, k]).sort((a, b) => b[0] - a[0]).slice(0, 3)
        facadeMix.set(o, top.map(([n, k]) => `${Math.round((100 * n) / total)}% ${SURFACES[SURFACE_TYPES[k]].label.toLowerCase()}`).join(', '))
      }
    }
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
    // The stone is vertex colour — walls, and roofs a shade darker — tinted
    // toward the accent on the selected building. The plants are a separate
    // layer over it (siteVegetation.ts).
    const wallBase = COLOURS.campus
    const roofBase = COLOURS.campus.clone().multiplyScalar(0.88)
    const tinted = new THREE.Color()
    const wallVertices = cells.segments.length * 6
    const paintCampus = (selectedIndex: number | null) => {
      for (let v = 0; v < shellPos.count; v++) {
        const own = vertexOwner[v]
        const facadeWall = latest.current.facades && own >= 0 ? facade.wallColour.get(own) : undefined
        tinted.copy(v < wallVertices ? (facadeWall ?? wallBase) : roofBase)
        if (vertexOwner[v] === selectedIndex && selectedIndex !== null) tinted.lerp(COLOURS.selected, 0.5)
        tinted.toArray(shellColours, v * 3)
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
    // The plants at Site scale: masses drawn from the cells, over the stone.
    const overlay = vegetationOverlay(texW, texH)
    const texelCell = new Int32Array(texW * texH).fill(-1)
    for (let i = 0; i < cells.count; i++) texelCell[cells.texel[i]] = i
    const campusPlain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
    // Flat, not lit: a shaded face would read as less sun, which is the one
    // thing the field is there to say. Nor hazed or tone-mapped, so a colour
    // on screen is the colour in the legend.
    const campusField = new THREE.MeshBasicMaterial({ map: fieldTexture, fog: false, toneMapped: false })
    const shell = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(shellGeo, campusPlain)
    shell.renderOrder = 20
    shell.castShadow = true
    shell.receiveShadow = true
    const plants = new THREE.Mesh(shellGeo, overlay.material)
    plants.renderOrder = 21
    plants.receiveShadow = true
    scene.add(buildings, shell, plants, edges)

    // Three levels of detail over the same growth: masses (the plant layer)
    // everywhere, stems and clusters at medium range, full leaves close up.
    const leaves = new SiteLeaves(cells)
    scene.add(...leaves.meshes)
    let leavesBuiltAt = 0
    const structure = new SiteStructure(cells)
    scene.add(structure.group)
    let structureBuiltAt = 0

    // --- the simulation ---
    // With façades the growth runs on the same cells and neighbours with the
    // façade's flags, seeds and coefficients; the seed and tip counts stay the
    // massing's, so the two compare at the same planting density.
    const massScale = (cells.ground.length * cells.cell) / 64
    const makeSim = (on: boolean) =>
      on
        ? new CampusSim(
            {
              building: facadeBuilding(cells, facade),
              scale: massScale,
              habitatBySpecies: facade.habitat,
              moistureBonus: facade.moisture,
              lightScale: facade.light,
            },
            latest.current.suns,
            latest.current.params,
            latest.current.mode,
          )
        : new CampusSim(campus, latest.current.suns, latest.current.params, latest.current.mode)
    let sim = makeSim(latest.current.facades)
    sim.reset(latest.current.seeding === 'auto')
    let growth = sim.growth
    const looks = SITE_SPECIES
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
     * A grown cell into the plant layer: its colour by species, age and
     * stress (siteLook's growthColour; flowers are the layer's own flecks),
     * its species, and whether it is in flower.
     */
    const paintCell = (cell: number) => {
      const sp = growth.species[cell]
      const age = growth.step - growth.birth[cell]
      growthColour(sp, age, sim.fields.env[sp][cell], cell, colour, false)
      writeVegetation(overlay, cells.texel[cell], colour, 1, sp, flowering(sp, age, cell))
    }
    const plantsChanged = () => {
      overlay.colour.needsUpdate = true
      overlay.kind.needsUpdate = true
    }
    const colour = new THREE.Color()
    // The grown cells listed first in `growth.order` that are already painted,
    // and a flag per cell for which ones those are.
    let painted = 0
    const shown = new Uint8Array(cells.count)
    const paintFinal = (full: boolean) => {
      if (full || growth.grown < painted) {
        overlay.colourData.fill(0)
        overlay.kindData.fill(0)
        shown.fill(0)
        painted = 0
      }
      for (let k = painted; k < growth.grown; k++) {
        paintCell(growth.order[k])
        shown[growth.order[k]] = 1
      }
      if (full || growth.grown !== painted) plantsChanged()
      painted = growth.grown
    }
    paintFinal(true)

    const ramp = new THREE.Color()
    const empty = new THREE.Color('#2a2b2d')
    const paint = (mode: SiteDisplay) => {
      shell.material = mode === 'final' ? campusPlain : campusField
      plants.visible = mode === 'final' && latest.current.layers.buildings
      if (mode !== 'final') {
        texData.fill(90)
        for (let i = 0; i < cells.count; i++) {
          if (mode === 'hours') rampColour(HOURS_RAMP, sim.hours[i], ramp)
          else if (mode === 'light') rampColour(SUN_RAMP, sim.energy[i], ramp)
          else if (mode === 'moisture') rampColour(MOISTURE_RAMP, sim.fields.moisture[i], ramp)
          else if (mode === 'surfaces') ramp.copy(surfaceDebug[facade.surface[i]])
          else if (mode === 'suitability') rampColour(SUN_RAMP, sim.fields.suitability[latest.current.plantSpecies][i], ramp)
          else ramp.copy(growth.species[i] === NO_SPECIES ? empty : looks[growth.species[i]].swatch)
          write(texData, i, ramp)
        }
        fieldTexture.needsUpdate = true
      }
      road?.setDisplay(mode, latest.current.plantSpecies)
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

    // --- growth that changes colour as it ages ---
    // Dying cells, as [cell, species, step of death], fading out.
    let fading: number[] = []
    /**
     * After each advance: the growth front settles from fresh to its
     * species' green, young vine cells come into flower, and dead cells fade
     * from withered brown-grey back to bare wall. All three touch only the
     * cells still changing — the youngest few thousand at the end of the
     * birth-ordered list, and the dying — never the whole campus.
     */
    const animate = (steps: number) => {
      const step = growth.step
      // Wide enough to catch every cell that crossed an age threshold in this advance.
      const horizon = Math.max(FRESH_STEPS, FLOWER_STEPS) + steps + 1
      for (let k = growth.grown - 1; k >= 0; k--) {
        const cell = growth.order[k]
        if (step - growth.birth[cell] > horizon) break
        paintCell(cell)
      }
      if (fading.length) {
        const keep: number[] = []
        for (let i = 0; i < fading.length; i += 3) {
          const cell = fading[i]
          // Regrown since: the growth paints it.
          if (growth.birth[cell] >= 0) continue
          // Withered brown-grey, thinning: its occupancy falls to nothing over
          // FADE_STEPS, so the mass shrinks back from the dying cells.
          const since = step - fading[i + 2]
          const sp = fading[i + 1]
          writeVegetation(overlay, cells.texel[cell], SITE_SPECIES[sp].withered, 1 - since / FADE_STEPS, sp, false)
          if (since < FADE_STEPS) keep.push(cell, sp, fading[i + 2])
        }
        fading = keep
      }
      plantsChanged()
    }

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
      showLandscape()
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
      for (let d = 0; d < died.length; d += 3) {
        const cell = died[d]
        fading.push(cell, died[d + 1], died[d + 2])
        if (shown[cell]) {
          shown[cell] = 0
          painted--
        }
      }
      // Over a year the light, and with it the moisture, changes every 200
      // steps: every green shifts, and a field on screen is out of date.
      if (sim.fieldsVersion !== fieldsSeen) {
        fieldsSeen = sim.fieldsVersion
        repaintGrowth(true)
        const d = latest.current.display
        if (d === 'hours' || d === 'light' || d === 'moisture') paint(d)
      } else repaintGrowth()
      animate(steps)
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
      fading = []
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
      if (current !== null) paintBuilding(current, stoneOf(current))
      current = index
      if (current !== null) paintBuilding(current, COLOURS.selected)
      context.geo.attributes.color.needsUpdate = true
      paintCampus(index)
      loop.wake()
    }

    const setLayers = (l: Record<SiteLayer, boolean>) => {
      buildings.visible = edges.visible = shell.visible = l.buildings
      facadeMesh.visible = l.buildings && latest.current.facades
      plants.visible = l.buildings && latest.current.display === 'final'
      for (const { mesh, layer } of surfaceMeshes) mesh.visible = l[layer]
      showLandscape()
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
      // With façades on, what this piece of wall is and what it means to a
      // plant, and the building's façade mix: why a building is bare is
      // usually there — the Graduate Hotel is 39% glass.
      if (c >= 0 && latest.current.facades) {
        const info = SURFACES[SURFACE_TYPES[facade.surface[c]]]
        text += `\n${info.label}: ${info.note}`
        const mix = facadeMix.get(hovered.building)
        if (mix) text += `\nFaçade: ${mix}`
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

    // The sun the scene shows: the growth's day (whole days, so a playing year
    // redraws shadows once a simulated day, not every frame), late in the
    // afternoon — or the paused page's chosen moment.
    const lit: SunMoment = { day: -1, hour: -1 }
    const sunMoment = (): SunMoment => {
      const chosen = latest.current.sunMoment
      if (chosen) return chosen
      const d = latest.current.mode.day
      const day = d === 'year' ? Math.floor(dayOfPhase(activeSim().phase)) : SEASON_DAY[d]
      return { day, hour: lateAfternoon(site.origin.lat, site.origin.lon, day) }
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
      const viewDistance = camera.position.distanceTo(controls.target)
      fitHaze(fog, viewDistance)
      const moment = sunMoment()
      if (moment.day !== lit.day || moment.hour !== lit.hour) {
        lit.day = moment.day
        lit.hour = moment.hour
        light.setSun(sunAtClock(site.origin.lat, site.origin.lon, moment.day, moment.hour), fog)
        renderer.shadowMap.needsUpdate = true
        dirty = true
      }
      if (light.fit(controls.target, viewDistance)) renderer.shadowMap.needsUpdate = true
      // Leaves only close up, in the final view, with the buildings shown.
      const close =
        camera.position.distanceTo(controls.target) < LEAF_RANGE &&
        latest.current.display === 'final' &&
        latest.current.layers.buildings &&
        !latest.current.rawCells
      leaves.visible = close
      let leavesPending = false
      if (close && leaves.stale(controls.target, growth, sim.fieldsVersion)) {
        // At most once a second while it plays: a rebuild is a pass over the
        // grown cells and up to 164,000 matrices, 40–55 ms in Node. It
        // rebuilds at once when paused.
        const now = performance.now()
        if (!running || now - leavesBuiltAt > 1000) {
          leaves.rebuild(controls.target, growth, sim.fields.env, sim.fieldsVersion, latest.current.facades ? facade.lift : null)
          leavesBuiltAt = now
          dirty = true
        } else leavesPending = true
      }
      // The middle level: stems, the growth front and leaf clusters, at medium range.
      const middle =
        viewDistance > STRUCTURE_RANGE[0] &&
        viewDistance < STRUCTURE_RANGE[1] &&
        latest.current.display === 'final' &&
        latest.current.layers.buildings &&
        !latest.current.rawCells
      structure.visible = middle
      if (middle && structure.stale(growth, sim.fieldsVersion)) {
        const now = performance.now()
        if (!running || now - structureBuiltAt > 1000) {
          structure.rebuild(growth, sim.fields.env, sim.fieldsVersion, latest.current.facades ? facade.lift : null)
          structureBuiltAt = now
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
          sun: { ...lit },
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
        const before = overlay.colourData.slice()
        paintFinal(true)
        let wrong = 0
        // Cells mid-fade differ from a fresh repaint on purpose.
        const fadingNow = new Set(fading.filter((_, i) => i % 3 === 0))
        for (let i = 0; i < cells.count; i++) {
          if (fadingNow.has(i)) continue
          const t = cells.texel[i] * 4
          const now = overlay.colourData
          if (before[t] !== now[t] || before[t + 1] !== now[t + 1] || before[t + 2] !== now[t + 2] || before[t + 3] !== now[t + 3]) wrong++
        }
        return wrong
      }
    }

    paint(latest.current.display)
    // Detailed or massing: a new simulation on the chosen surface, from the start.
    const setFacades = (on: boolean) => {
      sim = makeSim(on)
      growth = sim.growth
      sim.reset(latest.current.seeding === 'auto')
      fading = []
      stallReported = false
      pending = 0
      fieldsSeen = sim.fieldsVersion
      facadeMesh.visible = on && latest.current.layers.buildings
      paintCampus(current)
      repaintGrowth(true)
      paint(latest.current.display)
    }

    const setRaw = (raw: boolean) => {
      overlay.setRaw(raw)
      road?.setRaw(raw)
      loop.wake()
    }
    if (latest.current.rawCells) overlay.setRaw(true)

    api.current = {
      paint,
      attachRoadside,
      setStudy,
      setRaw,
      setFacades,
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
      disposed = true
      stopWaking()
      loop.dispose()
      observer.disconnect()
      controls.dispose()
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose()
          for (const m of Array.isArray(object.material) ? object.material : [object.material]) (m as THREE.Material).dispose()
        }
      })
      // The shell swaps materials with the display; the one not on it now isn't in the scene.
      campusPlain.dispose()
      campusField.dispose()
      fieldTexture.dispose()
      overlay.dispose()
      leaves.dispose()
      structure.dispose()
      road?.dispose()
      landscape?.dispose()
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

  const { rawCells } = props
  useEffect(() => {
    api.current?.setRaw(rawCells)
  }, [rawCells])

  const { facades } = props
  const firstFacades = useRef(true)
  useEffect(() => {
    if (firstFacades.current) {
      firstFacades.current = false
      return
    }
    api.current?.setFacades(facades)
  }, [facades])

  // The suitability view is for the species chosen to plant; repaint when it changes.
  const { plantSpecies } = props
  useEffect(() => {
    if (latest.current.display === 'suitability') api.current?.paint('suitability')
  }, [plantSpecies])

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
  }, [props.running, props.sunMoment, props.mode])

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
      {props.children}
    </div>
  )
}
