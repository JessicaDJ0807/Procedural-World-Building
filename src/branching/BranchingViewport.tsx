import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mulberry32 } from '../noise'
import { createCameraGate, startRenderLoop, wakeOnInput, type RenderLoop } from '../renderLoop'
import { studyLights } from '../study/terrain'
import { VIEWPORT_BACKGROUND } from '../theme'
import { clarkEvans, distribute } from './distribution'
import { ForestRenderer, type FrameStats, type Placement } from './ForestRenderer'
import { LODS, buildVariant, type TreeVariant } from './lod'
import { AREA, PALETTES, type BranchingSettings } from './presets'
import { interpret, placeLeaves } from './skeleton'

export type BuildReport = {
  types: number
  segments: number
  leaves: number
  maxGeneration: number
  height: number
  turtleMs: number
  geometryMs: number
  truncated: boolean
  /** Variant 0's cost at each level. */
  lods: { triangles: number; branchTris: number; leafTris: number; segments: number; leaves: number; blobs: boolean }[]
}

export type ScatterReport = {
  placed: number
  refused: number
  ms: number
  ratio: number
  meanNearest: number
  minNearest: number
}

type Props = {
  settings: BranchingSettings
  /** The expanded string; the page owns the grammar so it can show the text. */
  text: string
  /** Bumped to ask for the camera to be re-aimed after the next build. */
  frameToken: number
  onBuild: (report: BuildReport) => void
  onScatter: (report: ScatterReport | null) => void
  onStats: (stats: FrameStats) => void
}

/** Thin enough to read as a line, thick enough to survive being instanced. */
const SKELETON_RADIUS = 0.035

/**
 * The page's scene, and the only place the pipeline's stages meet.
 *
 * Each stage is a separate effect keyed on that stage's own inputs, so a
 * slider re-runs the stage it belongs to and everything downstream of it,
 * and nothing upstream: a forest-count change re-scatters without rebuilding
 * a single tree, and a LOD threshold change touches neither.
 */
export function BranchingViewport({ settings, text, frameToken, onBuild, onScatter, onStats }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<SceneState | null>(null)
  const latest = useRef({ settings, onBuild, onScatter, onStats })
  const framePending = useRef(true)

  useEffect(() => {
    latest.current = { settings, onBuild, onScatter, onStats }
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
    // Far enough out that every LOD ring sits in clear air; it only softens
    // the square's far edge into the background.
    scene.fog = new THREE.Fog(VIEWPORT_BACKGROUND, 150, 340)
    studyLights(scene)

    const camera = new THREE.PerspectiveCamera(40, container.clientWidth / Math.max(container.clientHeight, 1), 0.05, 800)
    camera.position.set(8, 6, 14)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 3, 0)
    controls.maxPolarAngle = Math.PI * 0.49
    controls.minDistance = 0.4
    controls.maxDistance = 260
    controls.update()
    const gate = createCameraGate()

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(AREA * 3, AREA * 3, 96, 96).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    )
    scene.add(ground)

    // The LOD rings: where, on the ground, the distance from the camera
    // crosses each threshold. Coloured for the level a tree switches *to*.
    const rings = LODS.slice(1).map((lod) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.985, 1, 160).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: lod.colour, transparent: true, opacity: 0.75, depthWrite: false }),
      )
      ring.renderOrder = 1
      ring.visible = false
      scene.add(ring)
      return ring
    })

    const forest = new ForestRenderer()
    scene.add(forest.group)

    let lastStats = ''
    const loop = startRenderLoop(() => {
      controls.update()
      const moved = gate(camera.position, controls.target)
      const state = sceneRef.current
      if (state) placeRings(state, latest.current.settings)
      const stats = forest.update(camera, moved)
      if (stats) {
        // Published only when the answer changed, not on every frame of an
        // orbit — the page re-renders on each publish.
        const key = `${stats.visible}|${stats.perLod.join(',')}|${stats.triangles}`
        if (key !== lastStats) {
          lastStats = key
          latest.current.onStats(stats)
        }
      }
      renderer.render(scene, camera)
      return moved
    })
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      forest.markDirty()
      loop.wake()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    const stopWaking = wakeOnInput(loop)
    sceneRef.current = { scene, camera, controls, loop, forest, ground, rings, variants: [] }

    return () => {
      stopWaking()
      loop.dispose()
      observer.disconnect()
      controls.dispose()
      forest.dispose()
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      for (const ring of rings) {
        ring.geometry.dispose()
        ;(ring.material as THREE.Material).dispose()
      }
      sceneRef.current = null
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => {
    framePending.current = true
  }, [frameToken])

  const { tree, forest, lod, display } = settings
  const types = display.view === 'forest' ? forest.treeTypes : 1

  // Stage 1–3: grammar text → skeletons → meshes at four levels, per tree type.
  useEffect(() => {
    const state = sceneRef.current
    if (!state) return
    const { tree, display } = latest.current.settings
    const palette = PALETTES[tree.palette]
    let turtleMs = 0
    const startedAll = performance.now()
    const variants: TreeVariant[] = []
    let truncated = false
    for (let v = 0; v < types; v++) {
      const seed = tree.seed + v * 101
      const skeleton = interpret(text, { ...tree, seed })
      turtleMs += skeleton.ms
      truncated ||= skeleton.truncated
      const sites = placeLeaves(skeleton, tree.leafDensity, seed, tree.leafPlacement)
      variants.push(
        buildVariant(skeleton, sites, {
          leafShape: tree.leafShape,
          leafPlacement: tree.leafPlacement,
          leafSize: tree.leafSize,
          palette,
          colourByGeneration: display.colourByGeneration,
          skeletonRadius: display.showSkeleton ? SKELETON_RADIUS : null,
        }, seed),
      )
    }
    const geometryMs = performance.now() - startedAll - turtleMs
    state.variants = variants
    state.forest.setVariants(variants)
    const first = variants[0]
    latest.current.onBuild({
      types,
      segments: first.skeleton.segments.length,
      leaves: first.sites.length,
      maxGeneration: first.skeleton.maxGeneration,
      height: first.height,
      turtleMs,
      geometryMs,
      truncated,
      lods: first.lods.map((l) => ({
        triangles: l.branchTris + l.leafTris,
        branchTris: l.branchTris,
        leafTris: l.leafTris,
        segments: l.segments,
        leaves: l.leafCount,
        blobs: l.blobs,
      })),
    })
    paintGround(state.ground, tree.palette)
    placeTrees(state, latest.current.settings, latest.current.onScatter)
    if (framePending.current) {
      framePending.current = false
      frameCamera(state, latest.current.settings)
    }
    state.loop.wake()
    // Every input of the build is listed; the display flags are here because
    // they change the meshes' vertex colours and radii, not just visibility.
  }, [
    text, types, tree.angle, tree.segmentLength, tree.lengthDecay, tree.trunkRadius, tree.thicknessDecay,
    tree.angleJitter, tree.lengthJitter, tree.branchRoll, tree.tropism, tree.seed, tree.leafSize,
    tree.leafDensity, tree.leafShape, tree.leafPlacement, tree.palette, display.showSkeleton, display.colourByGeneration,
  ])

  // Stage 4: where the trees go. Re-runs alone when only the forest changed.
  useEffect(() => {
    const state = sceneRef.current
    if (!state || !state.variants.length) return
    placeTrees(state, latest.current.settings, latest.current.onScatter)
    if (framePending.current) {
      framePending.current = false
      frameCamera(state, latest.current.settings)
    }
    state.loop.wake()
  }, [
    display.view, forest.strategy, forest.count, forest.scatterSeed, forest.minSpacing, forest.clusterCount,
    forest.clusterRadius, forest.jitter, forest.treeScale, forest.scaleVariation, forest.rotationVariation, frameToken,
  ])

  // Stage 5: LOD policy and display. No geometry is touched.
  useEffect(() => {
    const state = sceneRef.current
    if (!state) return
    const { lod, display } = latest.current.settings
    // Auto LOD is a forest behaviour. A single tree framed to fill the view
    // is usually further away than the first threshold, so under auto it
    // would open at LOD 1 — the Tree view holds it at the manual level
    // instead, which is also how each level is inspected up close.
    state.forest.setPolicy({ auto: lod.auto && display.view === 'forest', manual: lod.manual, thresholds: [lod.near, lod.mid, lod.far], hysteresis: lod.hysteresis })
    state.forest.setDisplay(display.showLeaves, display.showLodColours)
    state.forest.setProgress(display.view === 'tree' ? display.progress : 1)
    state.loop.wake()
  }, [lod.auto, lod.manual, lod.near, lod.mid, lod.far, lod.hysteresis, display.showLeaves, display.showLodColours, display.progress, display.view, display.showRings])

  return <div ref={containerRef} className="shader-viewport study-viewport" />
}

type SceneState = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  loop: RenderLoop
  forest: ForestRenderer
  ground: THREE.Mesh
  rings: THREE.Mesh[]
  variants: TreeVariant[]
}

/** How far apart the lineup's four trees stand: their widest reach, and air. */
const lineupSpacing = (variant: TreeVariant, scale: number) =>
  Math.max(variant.skeleton.radius * 2 + variant.height * 0.15, variant.height * 0.5) * scale * 1.15

function placeTrees(state: SceneState, settings: BranchingSettings, onScatter: (r: ScatterReport | null) => void) {
  const { forest, display } = settings
  const variant = state.variants[0]
  let placements: Placement[]
  if (display.view === 'tree') {
    placements = [{ x: 0, z: 0, yaw: 0, scale: forest.treeScale, variant: 0, tint: 1 }]
    onScatter(null)
  } else if (display.view === 'lineup') {
    const gap = lineupSpacing(variant, forest.treeScale)
    placements = LODS.map((_, level) => ({ x: (level - 1.5) * gap, z: 0, yaw: 0, scale: forest.treeScale, variant: 0, tint: 1, lod: level }))
    onScatter(null)
  } else {
    const scatter = distribute({
      strategy: forest.strategy,
      count: forest.count,
      seed: forest.scatterSeed,
      area: AREA,
      minSpacing: forest.minSpacing,
      clusterCount: forest.clusterCount,
      clusterRadius: forest.clusterRadius,
      jitter: forest.jitter,
    })
    // Per-tree variation from its own stream, so changing the scale variation
    // never moves a tree and changing the strategy never resizes one.
    const rand = mulberry32(forest.scatterSeed * 31 + 7)
    const types = state.variants.length
    placements = scatter.points.map((p) => {
      const a = rand()
      const b = rand()
      const c = rand()
      const d = rand()
      return {
        x: p.x,
        z: p.z,
        yaw: (b * 2 - 1) * Math.PI * forest.rotationVariation,
        scale: forest.treeScale * (1 + (a * 2 - 1) * forest.scaleVariation),
        variant: Math.min(types - 1, Math.floor(c * types)),
        tint: 0.86 + d * 0.28,
      }
    })
    const ce = clarkEvans(scatter.points, AREA)
    onScatter({ placed: scatter.points.length, refused: scatter.refused, ms: scatter.ms, ratio: ce.ratio, meanNearest: ce.meanNearest, minNearest: ce.minNearest })
  }
  state.forest.setPlacements(placements)
}

function frameCamera(state: SceneState, settings: BranchingSettings) {
  const { camera, controls } = state
  const variant = state.variants[0]
  const scale = settings.forest.treeScale
  const h = variant.height * scale
  const reach = variant.skeleton.radius * scale
  if (settings.display.view === 'forest') {
    // Standing at the square's near edge, looking almost level across it.
    // The bottom of a 40° view meets the ground about 18 units ahead, so the
    // nearest visible trees are inside the first threshold and the far edge
    // is past the last: the opening view holds all four levels. From higher
    // up, as first written, the nearest visible ground was 22 units away and
    // not a single tree on screen was at LOD 0.
    controls.target.set(0, 3, 0)
    camera.position.set(3, 10, AREA / 2 + 2)
  } else {
    const width = settings.display.view === 'lineup' ? lineupSpacing(variant, scale) * 4 : Math.max(h * 0.75, reach * 2)
    // Fit height against the vertical field of view and width against the
    // horizontal one, and take whichever needs the camera further back.
    const tanV = Math.tan((camera.fov * Math.PI) / 360)
    const fit = Math.max(h / (2 * tanV), width / (2 * tanV * camera.aspect))
    controls.target.set(0, h * 0.48, 0)
    const dir = settings.display.view === 'lineup' ? new THREE.Vector3(0, 0.18, 1) : new THREE.Vector3(0.5, 0.22, 1)
    camera.position.copy(controls.target).addScaledVector(dir.normalize(), fit * 1.15)
  }
  controls.update()
  state.forest.markDirty()
}

/** Rings at the horizontal radius where 3D distance reaches each threshold. */
function placeRings(state: SceneState, settings: BranchingSettings) {
  const { lod, display, forest } = settings
  const show = display.showRings && display.view === 'forest' && lod.auto
  const variant = state.variants[0]
  const cam = state.camera.position
  const dy = cam.y - (variant ? variant.centreY * forest.treeScale : 0)
  ;[lod.near, lod.mid, lod.far].forEach((t, i) => {
    const ring = state.rings[i]
    const r2 = t * t - dy * dy
    ring.visible = show && r2 > 0
    if (!ring.visible) return
    const r = Math.sqrt(r2)
    ring.position.set(cam.x, 0.04, cam.z)
    ring.scale.set(r, 1, r)
  })
}

const groundColour = new THREE.Color()
const groundHigh = new THREE.Color()

function paintGround(ground: THREE.Mesh, paletteId: keyof typeof PALETTES) {
  const palette = PALETTES[paletteId]
  const geometry = ground.geometry
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  let colour = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  if (!colour) {
    colour = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3)
    geometry.setAttribute('color', colour)
  }
  groundColour.set(palette.ground)
  groundHigh.set(palette.groundHigh)
  const c = new THREE.Color()
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const z = position.getZ(i)
    // Two sine octaves: enough to keep a flat plane from reading as a
    // flat colour, too smooth to be mistaken for a distribution.
    const n = 0.5 + 0.25 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) + 0.25 * Math.sin(z * 0.13 + x * 0.05)
    c.copy(groundColour).lerp(groundHigh, n)
    colour.setXYZ(i, c.r, c.g, c.b)
  }
  colour.needsUpdate = true
}
