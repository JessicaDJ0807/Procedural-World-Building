import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applyViewControls, clampTarget } from '../cameraControls'
import { createCameraGate, startRenderLoop, wakeOnInput, type RenderLoop } from '../renderLoop'
import { terrainGeometry } from '../study/terrain'
import { VIEWPORT_BACKGROUND } from '../theme'
import type { BuildingResult } from './building'
import {
  BuildingInstances,
  CATEGORY_COLOURS,
  TreeInstances,
  outlineGeometry,
  paintGround,
  plotFillGeometry,
  roadGeometry,
} from './cityMeshes'
import { pointInPolygon } from './geometry'
import type { Site } from './ground'
import type { RoadNetwork } from './roads'
import type { SiteLayout } from './site'
import type { Zone } from './zoning'
import { isTravelling } from './sim/inhabitants'
import type { ResourceId } from './sim/resources'
import { SimLayer } from './sim/simMeshes'
import type { CitySim, SimStats } from './sim/urban'

export type Layers = { roads: boolean; plots: boolean; zoning: boolean; buildings: boolean; vegetation: boolean; agents: boolean; network: boolean }

type Props = {
  stage: 'site' | 'studio'
  site: Site
  net: RoadNetwork
  zones: Zone[] | null
  /** Plot fills scaled toward their centres; under 1 leaves the ground showing round them. */
  fillShrink: number
  /** Sampler for the heatmap, or null for the plain ground. */
  heat: ((x: number, z: number) => number) | null
  layout: SiteLayout | null
  studio: BuildingResult
  show: Layers
  hovered: number
  onHover: (index: number) => void
  /** The simulation for F, G and H; null in A–E. The viewport steps it. */
  sim: CitySim | null
  running: boolean
  /** Simulated minutes per real second. */
  simSpeed: number
  /** Bumped to advance exactly one step while paused. */
  stepToken: number
  resource: ResourceId
  selectedAgent: number
  onSelectAgent: (id: number) => void
  onSimReport: (stats: SimStats) => void
}

type SceneState = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  loop: RenderLoop
  key: THREE.DirectionalLight
  siteGroup: THREE.Group
  studioGroup: THREE.Group
  terrain: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  water: THREE.Mesh
  roads: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  fills: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  outlines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  highlight: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  buildings: BuildingInstances
  trees: TreeInstances
  studioBuilding: BuildingInstances
  pad: THREE.Mesh
}

const SITE_VIEW = { position: new THREE.Vector3(190, 380, 440), target: new THREE.Vector3(0, 0, 15) }

export function CityViewport(props: Props) {
  const { stage, site, net, zones, fillShrink, heat, layout, studio, show, hovered, onHover, sim, stepToken } = props
  const layerRef = useRef<SimLayer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SceneState | null>(null)
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(VIEWPORT_BACKGROUND)
    scene.fog = new THREE.Fog(VIEWPORT_BACKGROUND, 600, 1200)

    // A cool sky fill and a near-white key, low enough for the terrain to read
    // from its shading and for buildings to throw a shadow worth seeing.
    scene.add(new THREE.HemisphereLight(0xb4c3d4, 0x4a4c44, 1.05))
    const key = new THREE.DirectionalLight(0xfff6ea, 2.0)
    key.position.set(-160, 220, 120)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.4
    scene.add(key, key.target)

    const camera = new THREE.PerspectiveCamera(38, container.clientWidth / Math.max(container.clientHeight, 1), 0.5, 2400)
    camera.position.copy(SITE_VIEW.position)
    const controls = new OrbitControls(camera, renderer.domElement)
    applyViewControls(controls, { ground: true })
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI * 0.47
    controls.minDistance = 6
    controls.maxDistance = 900
    controls.target.copy(SITE_VIEW.target)
    controls.update()
    const gate = createCameraGate(0.02)

    const siteGroup = new THREE.Group()
    const studioGroup = new THREE.Group()
    scene.add(siteGroup, studioGroup)

    const terrain = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true }),
    )
    terrain.receiveShadow = true
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x4b7290, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.88 }),
    )
    water.receiveShadow = true
    const surface = (opacity = 1) =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
        transparent: opacity < 1,
        opacity,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    const roads = new THREE.Mesh(new THREE.BufferGeometry(), surface())
    roads.receiveShadow = true
    const fills = new THREE.Mesh(new THREE.BufferGeometry(), surface(0.92))
    fills.receiveShadow = true
    const outlines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }))
    const highlight = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }))
    highlight.renderOrder = 3
    const buildings = new BuildingInstances()
    const trees = new TreeInstances()
    siteGroup.add(terrain, water, roads, fills, outlines, highlight, buildings.group, trees.group)

    const studioBuilding = new BuildingInstances()
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x7f8b72, roughness: 1 }),
    )
    pad.receiveShadow = true
    const grid = new THREE.GridHelper(60, 20, 0x8c948a, 0x6f776e)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.35
    grid.position.y = 0.02
    studioGroup.add(pad, grid, studioBuilding.group)

    // The simulation advances in whole fixed steps of one simulated minute:
    // real time × speed is accumulated, and as many steps run as it covers.
    // A slow frame runs more steps, never a longer one, so the run is the
    // same at any frame rate.
    let owed = 0
    let lastReport = 0
    const loop = startRenderLoop((delta) => {
      controls.update()
      const s = stateRef.current
      const p = latest.current
      if (s) clampTarget(controls, camera, p.stage === 'site' ? { x0: -200, x1: 200, z0: -200, z1: 200 } : { x0: -30, x1: 30, z0: -30, z1: 30 })
      const moved = gate(camera.position, controls.target)
      const layer = layerRef.current
      let simulating = false
      if (layer && p.sim) {
        if (p.running) {
          owed += delta * p.simSpeed
          let n = 0
          while (owed >= 1 && n < 600) {
            p.sim.step()
            owed -= 1
            n++
          }
          simulating = true
          const now = performance.now()
          if (now - lastReport > 250) {
            lastReport = now
            p.onSimReport(p.sim.stats())
          }
        }
        layer.update(p.resource, p.selectedAgent, p.show.agents, p.show.network, p.running ? delta : 0, 0.5)
      }
      renderer.render(scene, camera)
      return moved || simulating
    })
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      loop.drawNow()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    const stopWaking = wakeOnInput(loop)

    // Hover: intersect the pointer ray with the ground by refining against the
    // height field — four plane hits converge on these gentle slopes, and it
    // costs nothing next to raycasting 51,000 terrain triangles per move.
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let dragging = false
    let downX = 0
    let downY = 0
    const groundPoint = (e: PointerEvent): [number, number] | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const { origin, direction } = raycaster.ray
      if (direction.y >= -1e-4) return null
      let h = 0
      let x = 0
      let z = 0
      for (let k = 0; k < 5; k++) {
        const t = (h - origin.y) / direction.y
        x = origin.x + direction.x * t
        z = origin.z + direction.z * t
        h = latest.current.site.ground.height(x, z)
      }
      return [x, z]
    }
    const onDown = (e: PointerEvent) => {
      dragging = true
      downX = e.clientX
      downY = e.clientY
    }
    const onUp = (e: PointerEvent) => {
      dragging = false
      // A click, not a drag: pick the nearest inhabitant on the road.
      const p = latest.current
      if (!p.sim || p.sim.mode === 'resources' || e.target !== renderer.domElement) return
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return
      const hit = groundPoint(e)
      if (!hit) return
      let best = -1
      let bestD = 10
      for (const a of p.sim.population.agents) {
        if (!isTravelling(a.task)) continue
        const d = Math.hypot(a.x - hit[0], a.z - hit[1])
        if (d < bestD) {
          bestD = d
          best = a.id
        }
      }
      if (best >= 0) {
        p.onSelectAgent(best)
        loop.wake()
      }
    }
    const onMove = (e: PointerEvent) => {
      const p = latest.current
      if (dragging || p.stage !== 'site' || !p.zones) return
      const hit = groundPoint(e)
      if (!hit) return p.onHover(-1)
      const [x, z] = hit
      const index = p.zones.findIndex((zone) => pointInPolygon(zone.plot.polygon, x, z))
      p.onHover(index)
    }
    const onLeave = () => latest.current.onHover(-1)
    renderer.domElement.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerleave', onLeave)

    stateRef.current = { scene, camera, controls, loop, key, siteGroup, studioGroup, terrain, water, roads, fills, outlines, highlight, buildings, trees, studioBuilding, pad }

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      stopWaking()
      loop.dispose()
      observer.disconnect()
      controls.dispose()
      for (const m of [terrain, water, roads, fills, pad]) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
      for (const l of [outlines, highlight]) {
        l.geometry.dispose()
        l.material.dispose()
      }
      grid.geometry.dispose()
      ;(grid.material as THREE.Material).dispose()
      buildings.dispose()
      layerRef.current?.dispose()
      layerRef.current = null
      trees.dispose()
      studioBuilding.dispose()
      stateRef.current = null
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  // The terrain: rebuilt with the seed only.
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    s.terrain.geometry.dispose()
    s.terrain.geometry = terrainGeometry(site.terrain, site.terrain.height)
    s.water.scale.set(site.terrain.size, 1, site.terrain.size)
    s.water.position.y = site.terrain.waterLevel
    s.loop.wake()
  }, [site])

  // Ground colour: the plain ground, or a zoning map. Recolours in place.
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    paintGround(s.terrain.geometry, site.terrain, heat)
    s.loop.wake()
  }, [site, heat])

  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    s.roads.geometry.dispose()
    s.roads.geometry = roadGeometry(net, site.ground)
    s.loop.wake()
  }, [net, site])

  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    const polys = zones ? zones.map((z) => z.plot.polygon) : []
    const colours = zones ? zones.map((z) => CATEGORY_COLOURS[z.category]) : []
    s.fills.geometry.dispose()
    s.fills.geometry = plotFillGeometry(polys, colours, site.ground, fillShrink)
    s.outlines.geometry.dispose()
    // Outlines are pale in every mode: the fill carries the category.
    s.outlines.geometry = outlineGeometry(polys, 0xe9e6dc, site.ground)
    s.loop.wake()
  }, [zones, fillShrink, site])

  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    s.buildings.set(layout ? layout.buildings.map((b) => ({ x: b.x, y: b.y, z: b.z, rot: b.rot, parts: b.result.parts })) : [])
    s.trees.set(layout ? layout.trees : [])
    s.loop.wake()
  }, [layout])

  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    s.studioBuilding.set([{ x: 0, y: 0, z: 0, rot: 0, parts: studio.parts }])
    s.loop.wake()
  }, [studio])

  // One drawing layer per simulation; a new simulation replaces it.
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    if (layerRef.current) {
      s.siteGroup.remove(layerRef.current.group)
      layerRef.current.dispose()
      layerRef.current = null
    }
    if (sim) {
      const layer = new SimLayer(sim, site.ground)
      layerRef.current = layer
      s.siteGroup.add(layer.group)
      latest.current.onSimReport(sim.stats())
    }
    s.loop.wake()
  }, [sim, site])

  // Step: one fixed step, then report, whatever the play state.
  const firstStep = useRef(stepToken)
  useEffect(() => {
    const s = stateRef.current
    if (!s || !sim || stepToken === firstStep.current) return
    sim.step()
    latest.current.onSimReport(sim.stats())
    s.loop.wake()
  }, [stepToken, sim])

  // F–H frame the town rather than the whole site: the subject is people and
  // pipes, and from the overview a commuter is a few pixels.
  const simView = sim !== null
  useEffect(() => {
    const s = stateRef.current
    if (!s || stage !== 'site') return
    const c = net.centre
    if (simView) {
      s.controls.target.set(c.x, 0, c.z)
      s.camera.position.set(c.x + 120, 215, c.z + 245)
    } else {
      s.camera.position.copy(SITE_VIEW.position)
      s.controls.target.copy(SITE_VIEW.target)
    }
    s.controls.update()
    s.loop.wake()
    // Only on entering or leaving the simulation, not on every new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simView, stage])

  // Anything that changes the drawing while paused needs one more frame.
  useEffect(() => {
    stateRef.current?.loop.wake()
  }, [props.running, props.resource, props.selectedAgent, show.agents, show.network])

  // Visibility only: nothing is rebuilt for a toggle.
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    s.siteGroup.visible = stage === 'site'
    s.studioGroup.visible = stage === 'studio'
    s.roads.visible = show.roads
    s.fills.visible = show.plots
    s.outlines.visible = show.plots
    s.buildings.group.visible = show.buildings
    s.trees.group.visible = show.vegetation
    s.loop.wake()
  }, [stage, show.roads, show.plots, show.buildings, show.vegetation])

  // Each stage gets its own camera and its own shadow frustum: the site needs
  // the whole 400 units covered, the studio a crisp shadow on one building.
  const studioSize = useMemo(() => {
    const wall = studio.parts.find((p) => p.kind === 'wall')
    return { span: Math.max(wall?.sx ?? 10, wall?.sz ?? 10), height: studio.height }
  }, [studio])
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    const cam = s.key.shadow.camera
    if (stage === 'site') {
      s.camera.position.copy(SITE_VIEW.position)
      s.controls.target.copy(SITE_VIEW.target)
      s.key.position.set(-160, 220, 120)
      s.key.target.position.set(0, 0, 0)
      cam.left = cam.bottom = -230
      cam.right = cam.top = 230
      cam.near = 1
      cam.far = 700
    } else {
      s.camera.position.set(34, 22, 42)
      s.controls.target.set(0, 7, 0)
      s.key.position.set(-30, 50, 26)
      s.key.target.position.set(0, 0, 0)
      cam.left = cam.bottom = -40
      cam.right = cam.top = 40
      cam.near = 1
      cam.far = 160
    }
    cam.updateProjectionMatrix()
    s.controls.update()
    s.loop.wake()
  }, [stage])

  // The studio camera follows the building's size, so a tall tower and a
  // cottage both fill the view.
  useEffect(() => {
    const s = stateRef.current
    if (!s || stage !== 'studio') return
    const r = Math.max(studioSize.span, studioSize.height * 0.9)
    s.pad.scale.setScalar(Math.max(studioSize.span * 1.2, 16))
    const dir = new THREE.Vector3(0.62, 0.42, 0.66).normalize()
    s.controls.target.set(0, studioSize.height * 0.42, 0)
    s.camera.position.copy(s.controls.target).addScaledVector(dir, r * 3.1 + 16)
    s.controls.update()
    s.loop.wake()
  }, [stage, studioSize])

  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    s.highlight.geometry.dispose()
    const z = zones && hovered >= 0 ? zones[hovered] : null
    s.highlight.geometry = z ? outlineGeometry([z.plot.polygon], 0xffffff, site.ground, 0.45) : new THREE.BufferGeometry()
    s.loop.wake()
  }, [hovered, zones, site])

  return <div ref={containerRef} className="scene-canvas city-viewport" onPointerLeave={() => onHover(-1)} />
}
