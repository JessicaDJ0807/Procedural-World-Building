import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { propGeometry } from '../explore/props'
import { createCameraGate, startRenderLoop, wakeOnInput, type RenderLoop } from '../renderLoop'
import { VIEWPORT_BACKGROUND } from '../theme'
import {
  buildStudyTerrain,
  groundColour,
  studyLights,
  terrainGeometry,
  waterPlane,
  type StudyTerrain,
} from '../study/terrain'
import { ASSETS, KINDS, allFactors, groundAt, type AssetKind, type Factors, type Ground, type Rules } from './rules'
import { scatter, type Placement } from './scatter'

export type DebugView = 'natural' | 'tree' | 'bush' | 'rock' | 'all' | 'elevation' | 'slope' | 'water'

export type Probe = { x: number; z: number; ground: Ground; factors: Record<AssetKind, Factors> } | null

export type ScatterReport = {
  counts: Record<AssetKind, number>
  candidates: Record<AssetKind, number>
  scatterMs: number
  terrainMs: number
  maskMs: number
}

type Props = {
  terrainSeed: number
  scatterSeed: number
  rules: Rules
  debug: DebugView
  showAssets: boolean
  showWater: boolean
  onReport: (report: ScatterReport) => void
  onProbe: (probe: Probe) => void
}

/**
 * One InstancedMesh per silhouette, five in all: two tree shapes, one bush,
 * two rocks. A few thousand instances cost five draw calls, where separate
 * meshes would cost one each. Capacity is the candidate count, which no rule
 * can exceed, so nothing is ever reallocated — a scatter only rewrites matrices
 * and sets `count`.
 */
const MESHES: { kind: AssetKind; variant: number; geometry: string; squash: number }[] = [
  { kind: 'tree', variant: 0, geometry: 'tree:0', squash: 1 },
  { kind: 'tree', variant: 1, geometry: 'tree:2', squash: 1 },
  { kind: 'bush', variant: 0, geometry: 'tuft:2', squash: 0.75 },
  { kind: 'rock', variant: 0, geometry: 'rock:0', squash: 0.7 },
  { kind: 'rock', variant: 1, geometry: 'rock:1', squash: 0.8 },
]

export function DistributionViewport({
  terrainSeed,
  scatterSeed,
  rules,
  debug,
  showAssets,
  showWater,
  onReport,
  onProbe,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    scene: THREE.Scene
    loop: RenderLoop
    terrainMesh: THREE.Mesh | null
    water: THREE.Mesh | null
    marker: THREE.Mesh
    instanced: THREE.InstancedMesh[]
    terrain: StudyTerrain | null
  } | null>(null)
  const latest = useRef({ rules, scatterSeed, debug, onReport, onProbe, showAssets, showWater })
  const reportRef = useRef<Partial<ScatterReport>>({})
  /** Where the probe last landed, so a rule change can re-ask the same point. */
  const probePoint = useRef<{ x: number; z: number } | null>(null)

  useEffect(() => {
    latest.current = { rules, scatterSeed, debug, onReport, onProbe, showAssets, showWater }
  })

  // Renderer, camera, lights and the instanced meshes outlive every rebuild.
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
    // Aspect and aim set at creation, so a hover before the first frame
    // probes through the camera the user is actually looking through.
    const camera = new THREE.PerspectiveCamera(40, container.clientWidth / Math.max(container.clientHeight, 1), 0.05, 100)
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

    const instanced = MESHES.map((spec) => {
      const capacity = Math.floor(10 / ASSETS[spec.kind].spacing) ** 2
      const mesh = new THREE.InstancedMesh(
        propGeometry(spec.geometry),
        new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true }),
        capacity,
      )
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
      mesh.count = 0
      // Instances spread over the whole terrain; the geometry's own bounds
      // would cull all of them the moment the origin left the frame.
      mesh.frustumCulled = false
      scene.add(mesh)
      return mesh
    })

    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xe6e8ea, depthTest: false, transparent: true, opacity: 0.9 }),
    )
    marker.rotation.x = -Math.PI / 2
    marker.renderOrder = 10
    marker.visible = false
    scene.add(marker)

    const loop = startRenderLoop(() => {
      // Visibility is read here rather than set from an effect: it is a view
      // toggle, and the frame is the one place that owns the scene graph.
      for (const mesh of instanced) mesh.visible = latest.current.showAssets
      const water = sceneRef.current?.water
      if (water) water.visible = latest.current.showWater
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
    sceneRef.current = { scene, loop, terrainMesh: null, water: null, marker, instanced, terrain: null }

    // The probe: raycast the terrain under the pointer and ask every rule
    // about that point. Throttled to one per frame by rAF.
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let pending = 0
    let lastEvent: PointerEvent | null = null
    const probeAt = (event: PointerEvent) => {
      lastEvent = event
      if (pending) return
      pending = requestAnimationFrame(() => {
        pending = 0
        const state = sceneRef.current
        const e = lastEvent
        if (!state?.terrainMesh || !state.terrain || !e) return
        const rect = container.getBoundingClientRect()
        ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
        raycaster.setFromCamera(ndc, camera)
        const hit = raycaster.intersectObject(state.terrainMesh, false)[0]
        if (!hit) {
          marker.visible = false
          probePoint.current = null
          latest.current.onProbe(null)
        } else {
          const { x, z } = hit.point
          const ground = groundAt(state.terrain, x, z)
          marker.visible = true
          marker.position.set(x, hit.point.y + 0.02, z)
          probePoint.current = { x, z }
          latest.current.onProbe({
            x,
            z,
            ground,
            factors: allFactors(latest.current.rules, ground, x, z, latest.current.scatterSeed),
          })
        }
        loop.wake()
      })
    }
    const leave = () => {
      marker.visible = false
      probePoint.current = null
      latest.current.onProbe(null)
      loop.wake()
    }
    container.addEventListener('pointermove', probeAt)
    container.addEventListener('pointerleave', leave)

    return () => {
      cancelAnimationFrame(pending)
      container.removeEventListener('pointermove', probeAt)
      container.removeEventListener('pointerleave', leave)
      stopWaking()
      loop.dispose()
      observer.disconnect()
      controls.dispose()
      for (const mesh of instanced) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        mesh.dispose()
      }
      marker.geometry.dispose()
      ;(marker.material as THREE.Material).dispose()
      const state = sceneRef.current
      if (state) disposeGround(state)
      sceneRef.current = null
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  // Terrain: rebuilt only when its seed changes. Declared before the scatter
  // and mask effects, which also depend on terrainSeed, so in the same commit
  // they run after it and pick the new ground up.
  useEffect(() => {
    const state = sceneRef.current
    if (!state) return
    disposeGround(state)
    const terrain = buildStudyTerrain(terrainSeed)
    state.terrain = terrain
    state.terrainMesh = new THREE.Mesh(
      terrainGeometry(terrain, terrain.height),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    )
    state.scene.add(state.terrainMesh)
    state.water = waterPlane(terrain)
    state.scene.add(state.water)
    reportRef.current.terrainMs = terrain.buildMs
  }, [terrainSeed])

  useEffect(() => {
    const state = sceneRef.current
    if (!state?.terrain) return
    const result = scatter(state.terrain, rules, scatterSeed)
    writeInstances(state.instanced, result.placements)
    const counts = { tree: 0, bush: 0, rock: 0 }
    for (const kind of KINDS) counts[kind] = result.placements[kind].length
    reportRef.current = { ...reportRef.current, counts, candidates: result.candidates, scatterMs: result.ms }
    publish(reportRef.current, latest.current.onReport)
    // A slider moved under a still pointer: the numbers in the probe were
    // computed against the old rule, so ask the same point again.
    const point = probePoint.current
    if (point) {
      const ground = groundAt(state.terrain, point.x, point.z)
      latest.current.onProbe({ ...point, ground, factors: allFactors(rules, ground, point.x, point.z, scatterSeed) })
    }
    state.loop.wake()
  }, [rules, scatterSeed, terrainSeed])

  // The mask is the same function the scatter sampled, evaluated per vertex.
  useEffect(() => {
    const state = sceneRef.current
    if (!state?.terrain || !state.terrainMesh) return
    const started = performance.now()
    paintTerrain(state.terrain, state.terrainMesh.geometry, rules, scatterSeed, debug)
    reportRef.current.maskMs = performance.now() - started
    publish(reportRef.current, latest.current.onReport)
    state.loop.wake()
  }, [rules, scatterSeed, terrainSeed, debug])

  useEffect(() => {
    sceneRef.current?.loop.wake()
  }, [showAssets, showWater])

  return <div ref={containerRef} className="shader-viewport study-viewport" />
}

function disposeGround(state: { scene: THREE.Scene; terrainMesh: THREE.Mesh | null; water: THREE.Mesh | null }) {
  for (const mesh of [state.terrainMesh, state.water]) {
    if (!mesh) continue
    state.scene.remove(mesh)
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
  }
  state.terrainMesh = null
  state.water = null
}

function publish(report: Partial<ScatterReport>, onReport: (r: ScatterReport) => void) {
  if (!report.counts || !report.candidates) return
  onReport({
    counts: report.counts,
    candidates: report.candidates,
    scatterMs: report.scatterMs ?? 0,
    terrainMs: report.terrainMs ?? 0,
    maskMs: report.maskMs ?? 0,
  })
}

const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const yawQ = new THREE.Quaternion()
const scale = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

function writeInstances(meshes: THREE.InstancedMesh[], placements: Record<AssetKind, Placement[]>) {
  MESHES.forEach((spec, index) => {
    const mesh = meshes[index]
    let n = 0
    for (const p of placements[spec.kind]) {
      if (p.variant !== spec.variant || n >= mesh.instanceMatrix.count) continue
      yawQ.setFromAxisAngle(UP, p.yaw)
      rotation.copy(p.tilt ?? yawQ)
      if (p.tilt) rotation.multiply(yawQ)
      position.set(p.x, p.y, p.z)
      scale.set(p.scale, p.scale * spec.squash, p.scale)
      matrix.compose(position, rotation, scale)
      mesh.setMatrixAt(n, matrix)
      mesh.setColorAt(n, p.colour)
      n++
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })
}

const colour = new THREE.Color()
const DARK = new THREE.Color(0x2b2d31)
const MASKS: Record<AssetKind, THREE.Color> = {
  tree: new THREE.Color(ASSETS.tree.mask),
  bush: new THREE.Color(ASSETS.bush.mask),
  rock: new THREE.Color(ASSETS.rock.mask),
}
const WATER_NEAR = new THREE.Color(0x7d9cc9)
const RAMP_LOW = new THREE.Color(0x30343a)
const RAMP_HIGH = new THREE.Color(0xe6e0d4)

/**
 * Colours every vertex for the chosen view.
 *
 * The probability views put the terrain in near-black and light it in the
 * asset's colour by probability, so a mask reads as "where this may grow" at a
 * glance and the instances standing on it can be checked against it. The
 * input views — elevation, slope, water — are the three fields the rules read,
 * so a mask can be traced back to the ground that produced it.
 */
function paintTerrain(
  t: StudyTerrain,
  geometry: THREE.BufferGeometry,
  rules: Rules,
  seed: number,
  view: DebugView,
) {
  const attr = geometry.getAttribute('color') as THREE.BufferAttribute
  const half = t.size / 2
  for (let j = 0; j < t.res; j++) {
    for (let i = 0; i < t.res; i++) {
      const k = j * t.res + i
      const x = -half + i * t.cell
      const z = -half + j * t.cell
      const ground: Ground = {
        height: t.height[k],
        elevation: (t.height[k] - t.waterLevel) / (t.maxHeight - t.waterLevel),
        slope: t.slope[k],
        waterDist: t.waterDist[k],
        underwater: t.height[k] < t.waterLevel,
      }
      if (view === 'natural') {
        groundColour(Math.max(ground.elevation, 0), ground.slope, colour)
      } else if (view === 'elevation') {
        colour.copy(RAMP_LOW).lerp(RAMP_HIGH, Math.max(0, Math.min(1, ground.elevation)))
      } else if (view === 'slope') {
        colour.copy(RAMP_LOW).lerp(RAMP_HIGH, Math.min(ground.slope / 45, 1))
      } else if (view === 'water') {
        colour.copy(RAMP_LOW).lerp(WATER_NEAR, Math.exp(-ground.waterDist / 1.2))
      } else {
        const f = allFactors(rules, ground, x, z, seed)
        if (view === 'all') {
          colour.copy(DARK)
          for (const kind of KINDS) colour.lerp(MASKS[kind], f[kind].p * 0.75)
        } else {
          colour.copy(DARK).lerp(MASKS[view], f[view].p)
        }
      }
      attr.setXYZ(k, colour.r, colour.g, colour.b)
    }
  }
  attr.needsUpdate = true
}
