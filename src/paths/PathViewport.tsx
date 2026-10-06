import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createCameraGate, startRenderLoop, wakeOnInput, type RenderLoop } from '../renderLoop'
import { VIEWPORT_BACKGROUND } from '../theme'
import {
  buildStudyTerrain,
  elevationAbove,
  groundColour,
  sampleField,
  studyLights,
  terrainGeometry,
  updateTerrainHeights,
  waterPlane,
  type StudyTerrain,
} from '../study/terrain'
import { MAX_PATHS, MAX_POINTS, PATH_COLOURS, type PathKind, type PathRef, type PathSettings } from '../config/pathConfig'
import { buildRoad, type RoadResult } from './road'
import { buildRiver, type RiverResult } from './river'
import type { P2, Sample } from './spline'

export type PathReport = {
  /** The active path's numbers; which half is filled depends on its kind. */
  road: RoadResult['stats'] | null
  river: (RiverResult['stats'] & { ending: RiverResult['ending'] }) | null
  /** Every road's earthworks together. */
  totals: { cut: number; fill: number }
  /** Along-path elevation for the active path, downsampled for the chart. */
  profile: { s: number[]; ground: number[]; path: number[]; bed: number[] | null }
  buildMs: number
}

type Props = {
  settings: PathSettings
  showRoad: boolean
  showRiver: boolean
  onReport: (report: PathReport) => void
  onMovePoint: (ref: PathRef, index: number, point: P2) => void
  onPick: (ref: PathRef) => void
}

/** Every point of every path can have a handle. */
const HANDLE_POOL = MAX_PATHS * 2 * MAX_POINTS
/** Height of the "map" the 2D spline is drawn on in the debug view. */
const MAP_LIFT = 0.9

type Owner = { ref: PathRef; index: number }

type Scene = {
  scene: THREE.Scene
  loop: RenderLoop
  camera: THREE.PerspectiveCamera
  terrain: StudyTerrain | null
  terrainMesh: THREE.Mesh | null
  lake: THREE.Mesh | null
  /** One ribbon per path, pooled; a group per kind so the View toggles hide all of a kind. */
  roads: THREE.Group
  rivers: THREE.Group
  roadMaterial: THREE.Material
  riverMaterial: THREE.Material
  debug: THREE.Group
  handles: THREE.Mesh[]
  /** Which path and point each visible handle stands for. */
  handleOwner: (Owner | null)[]
}

export function PathViewport({ settings, showRoad, showRiver, onReport, onMovePoint, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const latest = useRef({ onMovePoint, onPick, showRoad, showRiver })

  useEffect(() => {
    latest.current = { onMovePoint, onPick, showRoad, showRiver }
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(VIEWPORT_BACKGROUND)
    studyLights(scene)
    // Aspect and aim are set here, not left to the first resize and the first
    // frame. Handle picking projects through this camera, and a press that
    // arrives before the first frame — measured: eight seconds after load on
    // a busy machine — saw aspect 1 and a camera still looking down −z, so
    // every handle projected off the bottom of the screen and the press fell
    // through to the orbit.
    const camera = new THREE.PerspectiveCamera(
      40,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.05,
      100,
    )
    camera.position.set(0, 8.6, 11.8)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0.4, 0)
    controls.maxPolarAngle = Math.PI * 0.47
    controls.minDistance = 2
    controls.maxDistance = 24
    controls.update()
    camera.updateMatrixWorld()
    const gate = createCameraGate()

    // Polygon offset rather than a vertical nudge alone: a ribbon draped on a
    // surface it was built from z-fights at every grazing angle otherwise.
    // One material per kind, shared by every ribbon of that kind.
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x9d9384, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })
    const riverMaterial = new THREE.MeshStandardMaterial({ color: 0x6a8aa6, roughness: 0.3, transparent: true, opacity: 0.88, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })
    const roads = new THREE.Group()
    const rivers = new THREE.Group()
    scene.add(roads, rivers)
    const debug = new THREE.Group()
    scene.add(debug)

    const handleGeometry = new THREE.SphereGeometry(0.11, 16, 12)
    const handles: THREE.Mesh[] = []
    for (let i = 0; i < HANDLE_POOL; i++) {
      const mesh = new THREE.Mesh(handleGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff }))
      mesh.visible = false
      mesh.renderOrder = 5
      scene.add(mesh)
      handles.push(mesh)
    }

    const loop = startRenderLoop(() => {
      roads.visible = latest.current.showRoad
      rivers.visible = latest.current.showRiver
      controls.update()
      renderer.render(scene, camera)
      return gate(camera.position, controls.target)
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

    sceneRef.current = {
      scene, loop, camera, terrain: null, terrainMesh: null, lake: null,
      roads, rivers, roadMaterial, riverMaterial, debug, handles,
      handleOwner: new Array(HANDLE_POOL).fill(null),
    }

    // Dragging a handle. Listened for in the capture phase on the container,
    // which runs before OrbitControls' own listener on the canvas, so a press
    // on a handle can switch the orbit off before it starts.
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let dragging: (Owner & { pointerId: number }) | null = null
    let pending = 0
    let lastMove: PointerEvent | null = null

    const aim = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
    }
    // Nearest handle in screen space, within a fixed pixel radius, rather than
    // a raycast against the spheres: a handle is a tenth of a unit across and
    // only a few pixels wide from the default camera, and a target that small
    // is missed as often as it is hit. Screen distance also stays the same
    // size at every zoom, which is what a grab target should do.
    const projected = new THREE.Vector3()
    const pickHandle = (event: PointerEvent): Owner | null => {
      const state = sceneRef.current
      if (!state) return null
      const rect = container.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      let best = -1
      let bestD = 18
      state.handles.forEach((h, i) => {
        if (!h.visible) return
        projected.copy(h.position).project(camera)
        if (projected.z > 1) return // behind the camera
        const sx = ((projected.x + 1) / 2) * rect.width
        const sy = ((1 - projected.y) / 2) * rect.height
        const d = Math.hypot(sx - px, sy - py)
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      return best < 0 ? null : state.handleOwner[best]
    }

    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      const owner = pickHandle(event)
      if (!owner) return
      dragging = { ...owner, pointerId: event.pointerId }
      controls.enabled = false
      container.setPointerCapture(event.pointerId)
      latest.current.onPick(owner.ref)
      event.stopPropagation()
    }
    const move = (event: PointerEvent) => {
      if (!dragging) {
        container.style.cursor = pickHandle(event) ? 'grab' : ''
        return
      }
      lastMove = event
      if (pending) return
      // One rebuild per frame at most, however fast the pointer reports.
      pending = requestAnimationFrame(() => {
        pending = 0
        if (dragging && lastMove) apply(dragging, lastMove)
      })
    }
    const apply = (target: Owner, event: PointerEvent) => {
      const state = sceneRef.current
      if (!state?.terrainMesh || !state.terrain) return
      aim(event)
      const hit = raycaster.intersectObject(state.terrainMesh, false)[0]
      if (!hit) return
      const limit = state.terrain.size / 2 - 0.15
      latest.current.onMovePoint(target.ref, target.index, {
        x: Math.min(limit, Math.max(-limit, hit.point.x)),
        z: Math.min(limit, Math.max(-limit, hit.point.z)),
      })
    }
    const up = (event: PointerEvent) => {
      if (!dragging) return
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId)
      // The release always lands the point where the pointer let go. A frame
      // still pending at this moment would find the drag over and do nothing,
      // and on a loaded machine that frame arrives after the release every
      // time — measured: a whole drag came to nothing.
      cancelAnimationFrame(pending)
      pending = 0
      apply(dragging, event)
      dragging = null
      lastMove = null
      controls.enabled = true
    }
    container.addEventListener('pointerdown', down, { capture: true })
    container.addEventListener('pointermove', move)
    container.addEventListener('pointerup', up)
    container.addEventListener('pointercancel', up)

    return () => {
      cancelAnimationFrame(pending)
      container.removeEventListener('pointerdown', down, { capture: true })
      container.removeEventListener('pointermove', move)
      container.removeEventListener('pointerup', up)
      container.removeEventListener('pointercancel', up)
      stopWaking()
      loop.dispose()
      observer.disconnect()
      controls.dispose()
      const state = sceneRef.current
      if (state) {
        for (const mesh of [state.terrainMesh, state.lake]) {
          if (!mesh) continue
          mesh.geometry.dispose()
          ;(mesh.material as THREE.Material).dispose()
        }
        poolTo(state.roads, 0, state.roadMaterial)
        poolTo(state.rivers, 0, state.riverMaterial)
        clearGroup(state.debug)
      }
      roadMaterial.dispose()
      riverMaterial.dispose()
      handleGeometry.dispose()
      for (const h of handles) (h.material as THREE.Material).dispose()
      sceneRef.current = null
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  // The ground, rebuilt only for a new seed. Declared before the path effect,
  // which also depends on the seed, so the paths are built on the new ground.
  useEffect(() => {
    const state = sceneRef.current
    if (!state) return
    for (const mesh of [state.terrainMesh, state.lake]) {
      if (!mesh) continue
      state.scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    const terrain = buildStudyTerrain(settings.terrainSeed)
    state.terrain = terrain
    state.terrainMesh = new THREE.Mesh(
      terrainGeometry(terrain, terrain.height),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    )
    state.lake = waterPlane(terrain)
    state.scene.add(state.terrainMesh, state.lake)
  }, [settings.terrainSeed])

  useEffect(() => {
    const state = sceneRef.current
    if (!state?.terrain || !state.terrainMesh) return
    const started = performance.now()
    const t = state.terrain

    // Every rebuild starts from the untouched ground, and the order is the
    // design. Rivers carve first, each on the ground the ones before it left —
    // so a later river can find an earlier one's channel and join it. Roads
    // are graded last, over everything: where a road crosses a river it fills
    // the channel (a causeway, which is what a road with no bridge is), and
    // where it crosses another road the later grade wins (a junction).
    const height = Float32Array.from(t.height)
    const channels = new Float32Array(height.length)
    const riverResults = settings.rivers.map((r) => {
      const result = buildRiver(t, height, r.points, r.params, channels)
      for (let k = 0; k < channels.length; k++) channels[k] = Math.max(channels[k], result.weight[k])
      return result
    })
    const roadWeight = new Float32Array(height.length)
    const roadResults = settings.roads.map((r) => {
      const result = buildRoad(t, height, r.points, r.params)
      for (let k = 0; k < roadWeight.length; k++) roadWeight[k] = Math.max(roadWeight[k], result.weight[k])
      return result
    })
    updateTerrainHeights(state.terrainMesh.geometry, height)
    paint(t, state.terrainMesh.geometry, height, roadWeight, channels, settings.debug)

    // Ribbons drape on the final ground, so an earlier road's surface follows
    // a later road's grade through a junction rather than floating over it.
    poolTo(state.roads, roadResults.length, state.roadMaterial)
    roadResults.forEach((road, i) => {
      replaceGeometry(
        state.roads.children[i] as THREE.Mesh,
        ribbon(road.samples, road.halfWidth, (x, z) => sampleField(t, height, x, z) + 0.006),
      )
    })
    poolTo(state.rivers, riverResults.length, state.riverMaterial)
    riverResults.forEach((river, i) => {
      replaceGeometry(
        state.rivers.children[i] as THREE.Mesh,
        ribbon(river.samples, river.halfWidth.map((w) => w * 0.85), (_x, _z, j) => river.surface[j]),
      )
    })
    placeHandles(state, settings, t, height)
    clearGroup(state.debug)
    if (settings.debug) buildDebug(state.debug, t, settings, roadResults, riverResults, height)

    const { kind, index } = settings.active
    const road = kind === 'road' ? roadResults[index] : undefined
    const river = kind === 'river' ? riverResults[index] : undefined
    const active = road ?? river
    const profile = active
      ? downsample(
          active.samples.map((s) => s.s),
          active.raw,
          road ? road.grade : river!.surface,
          river ? river.bed : null,
        )
      : { s: [], ground: [], path: [], bed: null }
    onReport({
      road: road ? road.stats : null,
      river: river ? { ...river.stats, ending: river.ending } : null,
      totals: {
        cut: roadResults.reduce((a, r) => a + r.stats.cut, 0),
        fill: roadResults.reduce((a, r) => a + r.stats.fill, 0),
      },
      profile,
      buildMs: performance.now() - started,
    })
    state.loop.wake()
  }, [settings, onReport])

  useEffect(() => {
    sceneRef.current?.loop.wake()
  }, [showRoad, showRiver])

  return <div ref={containerRef} className="shader-viewport study-viewport" />
}

/** Grows or shrinks a group of ribbon meshes to `count`, disposing what it drops. */
function poolTo(group: THREE.Group, count: number, material: THREE.Material) {
  while (group.children.length < count) group.add(new THREE.Mesh(new THREE.BufferGeometry(), material))
  while (group.children.length > count) {
    const mesh = group.children[group.children.length - 1] as THREE.Mesh
    group.remove(mesh)
    mesh.geometry.dispose()
  }
}

function replaceGeometry(mesh: THREE.Mesh, geometry: THREE.BufferGeometry) {
  mesh.geometry.dispose()
  mesh.geometry = geometry
}

function clearGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child)
    const object = child as THREE.Mesh
    object.geometry?.dispose()
    ;(object.material as THREE.Material | undefined)?.dispose()
  }
}

/** A strip of quads either side of the centreline, at heights the caller chooses. */
function ribbon(
  samples: Sample[],
  halfWidth: number[],
  heightAt: (x: number, z: number, i: number) => number,
): THREE.BufferGeometry {
  const positions = new Float32Array(samples.length * 2 * 3)
  const index: number[] = []
  samples.forEach((p, i) => {
    // The normal in plan is the tangent turned a quarter.
    const nx = -p.tz
    const nz = p.tx
    const w = halfWidth[i]
    const lx = p.x + nx * w
    const lz = p.z + nz * w
    const rx = p.x - nx * w
    const rz = p.z - nz * w
    positions.set([lx, heightAt(lx, lz, i), lz, rx, heightAt(rx, rz, i), rz], i * 6)
    if (i > 0) {
      const a = (i - 1) * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  // The winding follows the tangent, so the ribbon materials are double-sided
  // rather than this reasoning about which way each segment faces.
  return g
}

const colour = new THREE.Color()
const tint = new THREE.Color()
const WET = new THREE.Color(0x5f5a50)
const ROAD_TINT = new THREE.Color(PATH_COLOURS.road)
const RIVER_TINT = new THREE.Color(PATH_COLOURS.river)

function paint(
  t: StudyTerrain,
  geometry: THREE.BufferGeometry,
  height: Float32Array,
  road: Float32Array,
  river: Float32Array,
  debug: boolean,
) {
  const attr = geometry.getAttribute('color') as THREE.BufferAttribute
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  for (let k = 0; k < height.length; k++) {
    const slope = (Math.acos(Math.min(1, Math.max(-1, normal.getY(k)))) * 180) / Math.PI
    groundColour(Math.max(elevationAbove(t, height[k]), 0), slope, colour)
    if (debug) {
      // The footprint of each kind's influence on the ground, in its colour.
      colour.lerp(tint.copy(ROAD_TINT), road[k] * 0.55)
      colour.lerp(tint.copy(RIVER_TINT), river[k] * 0.6)
    } else {
      colour.lerp(WET, river[k] * 0.55)
    }
    attr.setXYZ(k, colour.r, colour.g, colour.b)
  }
  attr.needsUpdate = true
}

const isActive = (settings: PathSettings, kind: PathKind, index: number) =>
  settings.active.kind === kind && settings.active.index === index

function placeHandles(state: Scene, settings: PathSettings, t: StudyTerrain, height: Float32Array) {
  let n = 0
  for (const kind of ['road', 'river'] as const) {
    const paths = kind === 'road' ? settings.roads : settings.rivers
    paths.forEach((path, pathIndex) => {
      const active = isActive(settings, kind, pathIndex)
      path.points.forEach((p, index) => {
        if (n >= state.handles.length) return
        const h = state.handles[n]
        h.visible = true
        h.position.set(p.x, sampleField(t, height, p.x, p.z) + 0.12, p.z)
        // The active path's handles are full size and full colour; every
        // other path's stay grabbable but recede.
        h.scale.setScalar(active ? 1 : 0.7)
        ;(h.material as THREE.MeshBasicMaterial).color
          .setHex(PATH_COLOURS[kind])
          .multiplyScalar(active ? 1.15 : 0.6)
        // A river's first point is its source, and is drawn larger.
        if (kind === 'river' && index === 0) h.scale.multiplyScalar(1.35)
        state.handleOwner[n] = { ref: { kind, index: pathIndex }, index }
        n++
      })
    })
  }
  for (; n < state.handles.length; n++) {
    state.handles[n].visible = false
    state.handleOwner[n] = null
  }
}

/**
 * The projection made visible.
 *
 * The 2D spline is drawn flat on a "map" plane above the terrain, with a
 * vertical line from it down to the ground every few samples and a dot where
 * each lands. That is what "project a 2D line onto a 3D mesh" means, drawn
 * literally. Then the centreline the path was actually built to — the smoothed
 * grade, the descending water surface — shows how far that differs from the
 * raw projection. The active path is drawn at full strength and the others
 * recede, so several paths do not become one tangle of lines.
 */
function buildDebug(
  group: THREE.Group,
  t: StudyTerrain,
  settings: PathSettings,
  roads: RoadResult[],
  rivers: RiverResult[],
  height: Float32Array,
) {
  const top = t.maxHeight + MAP_LIFT
  const add = (object: THREE.Object3D) => {
    object.renderOrder = 4
    group.add(object)
  }
  const line = (points: number[], hex: number, opacity = 1, depthTest = true) =>
    new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)),
      new THREE.LineBasicMaterial({ color: hex, transparent: opacity < 1, opacity, depthTest }),
    )

  const draw = (kind: PathKind, index: number, result: RoadResult | RiverResult, built: number[], points: P2[]) => {
    const hex = PATH_COLOURS[kind]
    const faded = isActive(settings, kind, index) ? 1 : 0.35
    const flat: number[] = []
    const drops: number[] = []
    const dots: number[] = []
    const centre: number[] = []
    const every = Math.max(1, Math.round(result.samples.length / 40))
    result.samples.forEach((p, i) => {
      flat.push(p.x, top, p.z)
      centre.push(p.x, built[i] + (kind === 'road' ? 0.03 : 0.02), p.z)
      if (i % every === 0 || i === result.samples.length - 1) {
        drops.push(p.x, top, p.z, p.x, result.raw[i], p.z)
        dots.push(p.x, result.raw[i] + 0.01, p.z)
      }
    })
    add(line(flat, hex, 0.7 * faded))
    add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(drops, 3)),
        new THREE.LineBasicMaterial({ color: 0xe6e8ea, transparent: true, opacity: 0.25 * faded }),
      ),
    )
    add(
      new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(dots, 3)),
        new THREE.PointsMaterial({ color: 0xffffff, size: 5, sizeAttenuation: false, transparent: true, opacity: faded, depthTest: false }),
      ),
    )
    add(line(centre, hex, faded, false))

    // Control points on the map too, joined by a thin polygon — the input the
    // spline was fitted through.
    const ctrl: number[] = []
    for (const p of points) ctrl.push(p.x, top, p.z)
    add(line(ctrl, 0xe6e8ea, 0.35 * faded))
    for (const p of points) {
      add(line([p.x, top, p.z, p.x, sampleField(t, height, p.x, p.z) + 0.12, p.z], hex, 0.5 * faded))
    }
  }

  roads.forEach((road, i) => draw('road', i, road, road.grade, settings.roads[i].points))
  rivers.forEach((river, i) => {
    draw('river', i, river, river.surface, settings.rivers[i].points)
    // The raw downhill trace, before it was smoothed into a spline.
    const traced: number[] = []
    for (const p of river.traced) traced.push(p.x, sampleField(t, t.height, p.x, p.z) + 0.015, p.z)
    add(line(traced, 0xe6e8ea, isActive(settings, 'river', i) ? 0.5 : 0.2, false))
  })
}

function downsample(s: number[], ground: number[], path: number[], bed: number[] | null) {
  const n = Math.min(160, s.length)
  const pick = <T,>(a: T[]) => Array.from({ length: n }, (_, i) => a[Math.round((i / Math.max(n - 1, 1)) * (a.length - 1))])
  return { s: pick(s), ground: pick(ground), path: pick(path), bed: bed ? pick(bed) : null }
}
