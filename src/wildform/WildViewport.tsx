import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applyViewControls, clampTarget } from '../cameraControls'
import { createCameraGate, startRenderLoop, wakeOnInput } from '../renderLoop'
import { VIEWPORT_BACKGROUND } from '../theme'
import { BLOCKED, GLASS, HEIGHT } from '../green/building'
import { detailGeometry, shellGeometry } from '../green/buildingMesh'
import { sunDirection } from '../green/fields'
import type { Check } from './grammar'
import { MUTATION_NAMES } from './names'
import { platformObject, type PlatformObject } from './platformMesh'
import { WildSim, type SimEvent, type Settings } from './sim'
import { CLIMBER, SPREADER, WILD_SPECIES } from './species'
import { PLATFORM } from './world'
import { WildVegetation } from './wildVegetation'

export type Display = 'final' | 'layers' | 'sun' | 'moisture' | 'suitability' | 'architecture' | 'interaction'
export type CameraView = 'perspective' | 'front'

export type WildReport = {
  step: number
  coverage: number
  bySpecies: number[]
  tips: number
  /** Share of the growable surface both species hold, and that has more than one layer. */
  overlap: number
  layered: number
  /** Layers that withered while something grew over them. */
  smothered: number
  platforms: number
  events: SimEvent[]
  /** The grammar's verdict on the most promising encounter, while one is pending. */
  candidate: { label: string; checks: Check[] } | null
  milestones: { met: number | null; formed: number | null }
  withered: number[]
  stepMs: number
  fieldMs: number
}

type Props = {
  settings: Settings
  display: Display
  /** The species whose suitability the Suitability view shows. */
  focus: number
  running: boolean
  speed: number
  stepToken: number
  resetToken: number
  /** Re-run to an exact step: the timeline's jumps. */
  jump: { step: number; token: number } | null
  camera: CameraView
  cameraToken: number
  onReport: (report: WildReport) => void
}

/** Steps per second at 1×: 4× is 32 a second, and the demo's platform forms in about 23 seconds. */
const STEPS_PER_SECOND = 8
const MAX_STEPS_PER_FRAME = 24
const PLAYING_FPS = 30
/** How long a platform takes to grow in, ms. */
const FORM_MS = 1600
/** How long an annotation stays up, ms. */
const NOTE_MS = 4200
const PAN_BOUNDS = { x0: -30, x1: 22, z0: -22, z1: 22 }

const VIEWS: Record<CameraView, { position: [number, number, number]; target: [number, number, number] }> = {
  // From the front-left, low enough to see under the platform once it forms:
  // both planting spots, the wall they climb, and the inside corner.
  perspective: { position: [-20, 12.5, 27], target: [-2.5, 5.6, 0] },
  front: { position: [-2.5, 6.5, 33], target: [-2.5, 6.2, 0] },
}

const RAMPS: Record<'sun' | 'moisture' | 'suitability' | 'architecture', [string, string, string]> = {
  moisture: ['#24282c', '#3a5870', '#a3c8e0'],
  sun: ['#1f2023', '#6e5c3a', '#f2e0ae'],
  suitability: ['#23261f', '#4d6a34', '#bcdc90'],
  architecture: ['#222326', '#5a4e6d', '#d3c1e8'],
}
/** The slate blue the page uses for its accents: newly shaded cells, and the site the grammar is weighing. */
const SLATE = new THREE.Color('#7f9bc4')
const AMBER = new THREE.Color('#e0a352')

export function WildViewport(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  const api = useRef<{
    applySettings: (next: Settings, previous: Settings) => void
    reset: () => void
    stepOnce: () => void
    jumpTo: (step: number) => void
    paint: () => void
    flyTo: (view: CameraView) => void
    wake: () => void
  } | null>(null)

  useEffect(() => {
    latest.current = props
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const sim = new WildSim()
    sim.reset(latest.current.settings)
    const building = sim.world.base

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    // On demand: the building and its platforms only change when a platform
    // forms (and while it grows in), or when the sun moves.
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(VIEWPORT_BACKGROUND)
    const camera = new THREE.PerspectiveCamera(34, container.clientWidth / Math.max(container.clientHeight, 1), 0.5, 200)
    const start = VIEWS[latest.current.camera]
    camera.position.set(...start.position)
    const controls = new OrbitControls(camera, renderer.domElement)
    applyViewControls(controls, { ground: true })
    controls.enableDamping = true
    controls.target.set(...start.target)
    controls.maxPolarAngle = Math.PI * 0.495
    controls.minDistance = 6
    controls.maxDistance = 70
    controls.update()
    const gate = createCameraGate()

    // Warm sun, cool sky: depth from the light, not from colour in the materials.
    scene.add(new THREE.HemisphereLight(0xc4d0e0, 0x3a3631, 0.9))
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 })
    sun.shadow.bias = -0.0006
    sun.shadow.normalBias = 0.03
    sun.target.position.set(-3, HEIGHT / 2, 0)
    scene.add(sun, sun.target)
    const placeSun = () => {
      const [lx, ly, lz] = sunDirection(sim.world.sunAzimuth)
      sun.position.set(lx * 40, HEIGHT / 2 + ly * 40, lz * 40)
      renderer.shadowMap.needsUpdate = true
    }

    // --- the building: the field texture over the shell, and its details ---
    const { count, texel, texW, texH } = building
    const texData = new Uint8Array(texW * texH * 4).fill(255)
    const fieldTexture = new THREE.DataTexture(texData, texW, texH, THREE.RGBAFormat)
    fieldTexture.magFilter = THREE.NearestFilter
    fieldTexture.minFilter = THREE.NearestFilter
    fieldTexture.colorSpace = THREE.SRGBColorSpace
    fieldTexture.needsUpdate = true
    const wallLit = new THREE.MeshStandardMaterial({ roughness: 0.92, map: fieldTexture, vertexColors: true, shadowSide: THREE.FrontSide })
    const wallField = new THREE.MeshBasicMaterial({ map: fieldTexture, shadowSide: THREE.FrontSide })
    const shell = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(shellGeometry(building), wallLit)
    shell.castShadow = true
    shell.receiveShadow = true
    const detailMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, shadowSide: THREE.FrontSide })
    const details = new THREE.Mesh(detailGeometry(building), detailMaterial)
    details.castShadow = true
    details.receiveShadow = true
    const ground = new THREE.Mesh(new THREE.CircleGeometry(48, 64), new THREE.MeshStandardMaterial({ color: 0x2b2d2f, roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.x = -3
    ground.receiveShadow = true
    scene.add(shell, details, ground)

    const vegetation = new WildVegetation(building)
    scene.add(...vegetation.meshes)

    // --- Living Platforms: one object per platform, grown in when it forms ---
    const platforms: { obj: PlatformObject; started: number }[] = []
    const syncPlatforms = (animate: boolean) => {
      while (platforms.length < sim.platforms.length) {
        const p = sim.platforms[platforms.length]
        const obj = platformObject(building, p, platforms.length * 17 + 3)
        scene.add(obj.group)
        platforms.push({ obj, started: animate ? performance.now() : -Infinity })
        if (!animate) obj.grow(1)
        renderer.shadowMap.needsUpdate = true
        if (animate) {
          const seg = building.segments[p.segment]
          const mid = (p.s0 + p.s1) / 2
          note(`${MUTATION_NAMES[p.kind]} formed`, new THREE.Vector3(seg.ax + seg.dx * mid + seg.nx * PLATFORM.depth, p.y + 0.4, seg.az + seg.dz * mid + seg.nz * PLATFORM.depth))
        }
      }
    }
    const clearPlatforms = () => {
      for (const { obj } of platforms) {
        scene.remove(obj.group)
        obj.dispose()
      }
      platforms.length = 0
      renderer.shadowMap.needsUpdate = true
    }

    // --- annotations: a short label beside what just happened ---
    let noteAt: THREE.Vector3 | null = null
    let noteUntil = 0
    const note = (text: string, at: THREE.Vector3) => {
      if (!noteRef.current) return
      noteRef.current.textContent = text
      noteAt = at
      noteUntil = performance.now() + NOTE_MS
    }
    const projected = new THREE.Vector3()
    const placeNote = (now: number) => {
      const el = noteRef.current
      if (!el) return false
      if (!noteAt || now > noteUntil) {
        el.hidden = true
        return false
      }
      projected.copy(noteAt).project(camera)
      const rect = container.getBoundingClientRect()
      el.hidden = projected.z > 1
      el.style.transform = `translate(${((projected.x + 1) / 2) * rect.width}px, ${((1 - projected.y) / 2) * rect.height}px) translate(-50%, -100%)`
      el.style.opacity = String(Math.min(1, (noteUntil - now) / 600))
      return true
    }

    // --- painting the field texture for the current view ---
    const ramp = (name: keyof typeof RAMPS) => RAMPS[name].map((h) => new THREE.Color(h))
    const swatch = WILD_SPECIES.map((s) => new THREE.Color(s.look.swatch))
    const paint = () => {
      const display = latest.current.display
      const { world, growth } = sim
      const flags = world.building.flags
      const c = new THREE.Color()
      const write = (i: number) => {
        c.convertLinearToSRGB()
        const t = texel[i] * 4
        texData[t] = Math.round(c.r * 255)
        texData[t + 1] = Math.round(c.g * 255)
        texData[t + 2] = Math.round(c.b * 255)
        texData[t + 3] = 255
      }
      if (display === 'final') {
        for (let i = 0; i < count; i++) {
          const v = Math.round(255 * (1 - 0.2 * world.moisture[i]))
          texData.set([v, v, Math.round(v * 0.985), 255], texel[i] * 4)
        }
      } else if (display === 'layers') {
        // The stack in each cell: the top species' colour, brighter for each
        // layer under it, and warmed toward amber where both species are in it.
        const top = [new THREE.Color('#4f7d5a'), new THREE.Color('#8f9447')]
        for (let i = 0; i < count; i++) {
          const d = growth.depth[i]
          if (flags[i] & (GLASS | BLOCKED)) c.set('#141618')
          else if (!d) c.set('#2c2f33')
          else {
            // Two deep always holds both species — nothing grows onto its own.
            c.copy(top[growth.top(i)]).multiplyScalar(0.55 + 0.3 * d)
            c.lerp(AMBER, 0.28 * (d - 1))
          }
          write(i)
        }
      } else if (display === 'interaction') {
        // The two species dimmed, where they overlap amber, active tips white,
        // the site the grammar is weighing slate blue, and the shade a
        // platform made, slate blue too.
        const site = new Uint8Array(count)
        if (sim.candidate) for (const i of world.cellsNear({ ...sim.candidate.site, thickness: PLATFORM.thickness }, 1.8, 0.6)) site[i] = 1
        const tips = new Uint8Array(count)
        for (const i of growth.tipCells()) tips[i] = 1
        const shadeBefore = world.sunBefore
        for (let i = 0; i < count; i++) {
          if (flags[i] & (GLASS | BLOCKED)) c.set('#141618')
          else if (tips[i]) c.set('#f4f1ea')
          else if (growth.mask[i] === 3) c.set('#e0a352')
          else {
            const m = growth.mask[i]
            c.set(m === 0 ? '#2c2f33' : m === 1 ? '#3d5c46' : '#6b6d3c')
            if (m) c.lerp(swatch[m === 1 ? CLIMBER : SPREADER], 0.25)
            if (site[i]) c.lerp(SLATE, 0.45)
            if (shadeBefore && world.sun[i] < shadeBefore[i] - 0.05) c.lerp(SLATE, 0.6)
          }
          write(i)
        }
      } else {
        const name = display === 'suitability' ? 'suitability' : display === 'architecture' ? 'architecture' : display
        const source = display === 'moisture' ? world.moisture : display === 'sun' ? world.sun : display === 'architecture' ? world.geometry : world.suitability[latest.current.focus]
        const stops = ramp(name)
        const before = world.sunBefore
        for (let i = 0; i < count; i++) {
          if (flags[i] & (GLASS | BLOCKED)) {
            c.set('#141618')
            write(i)
            continue
          }
          const v = Math.min(1, Math.max(0, source[i]))
          if (v < 0.5) c.copy(stops[0]).lerp(stops[1], v * 2)
          else c.copy(stops[1]).lerp(stops[2], (v - 0.5) * 2)
          // In the sunlight view, shade a platform made is marked: the field changed here.
          if (display === 'sun' && before && world.sun[i] < before[i] - 0.05) c.lerp(SLATE, 0.55)
          write(i)
        }
      }
      fieldTexture.needsUpdate = true
      shell.material = display === 'final' ? wallLit : wallField
      details.visible = display === 'final'
      for (const mesh of vegetation.foliage) mesh.visible = display === 'final'
    }

    let pending = 0
    let dirty = true
    let lastPlatforms = 0
    let lastEvents = 0
    let vegetationAt = 0
    let revisionDrawn = sim.revision

    const afterSteps = (animate: boolean) => {
      // Rebuilding the plants after withering is a full pass; at most four times a second.
      const now = performance.now()
      if (sim.revision === revisionDrawn || now - vegetationAt > 250 || !latest.current.running) {
        vegetation.sync(sim.growth, sim.world.moisture, sim.revision)
        revisionDrawn = sim.revision
        vegetationAt = now
      }
      if (sim.platforms.length !== lastPlatforms) {
        syncPlatforms(animate)
        lastPlatforms = sim.platforms.length
      }
      // The first time the grammar is waiting on a single condition, say so beside it.
      if (sim.events.length && sim.events.length !== lastEvents) {
        const last = sim.events[sim.events.length - 1]
        if (last.text.startsWith('Interaction detected') && sim.candidate) {
          const i = sim.candidate.cell
          note('Interaction detected', new THREE.Vector3(building.px[i] + building.nx[i] * 0.6, building.py[i] + 0.5, building.pz[i] + building.nz[i] * 0.6))
        }
      }
      lastEvents = sim.events.length
      if (latest.current.display !== 'final') paint()
      dirty = true
    }

    const advance = (n: number) => {
      sim.advance(n)
      afterSteps(true)
    }

    const reset = () => {
      sim.reset(latest.current.settings)
      clearPlatforms()
      lastPlatforms = 0
      lastEvents = 0
      noteUntil = 0
      vegetation.sync(sim.growth, sim.world.moisture, sim.revision)
      revisionDrawn = sim.revision
      vegetation.uStep.value = 0
      pending = 0
      placeSun()
      paint()
      dirty = true
    }

    const jumpTo = (step: number) => {
      sim.reset(latest.current.settings)
      clearPlatforms()
      lastPlatforms = 0
      sim.advance(step)
      lastEvents = sim.events.length
      // A jump to the very step a platform formed plays its formation; any other shows it grown.
      const forming = sim.platforms.length > 0 && sim.platforms[sim.platforms.length - 1].step === step
      syncPlatforms(false)
      if (forming) {
        platforms[platforms.length - 1].started = performance.now()
        platforms[platforms.length - 1].obj.grow(0)
      }
      lastPlatforms = sim.platforms.length
      vegetation.sync(sim.growth, sim.world.moisture, sim.revision)
      revisionDrawn = sim.revision
      vegetation.uStep.value = sim.step
      placeSun()
      paint()
      dirty = true
    }

    const applySettings = (next: Settings, previous: Settings) => {
      if (next.preset !== previous.preset || next.seed !== previous.seed || next.mutations !== previous.mutations) {
        reset()
        return
      }
      if (next.rain !== previous.rain || next.sunAzimuth !== previous.sunAzimuth) {
        // Mid-run: the fields change under the growth, which responds.
        sim.setEnvironment(next.rain, next.sunAzimuth)
        placeSun()
        paint()
        dirty = true
      }
    }

    let flight: { from: THREE.Vector3; fromT: THREE.Vector3; to: THREE.Vector3; toT: THREE.Vector3; t: number } | null = null
    const flyTo = (view: CameraView) => {
      const v = VIEWS[view]
      flight = { from: camera.position.clone(), fromT: controls.target.clone(), to: new THREE.Vector3(...v.position), toT: new THREE.Vector3(...v.target), t: 0 }
    }

    let reportAt = 0
    const loop = startRenderLoop((delta) => {
      const { running, speed, onReport } = latest.current
      loop.setMaxFps(running ? PLAYING_FPS : 60)
      if (running) {
        pending += delta * STEPS_PER_SECOND * speed
        const whole = Math.min(Math.floor(pending), MAX_STEPS_PER_FRAME)
        if (whole > 0) advance(whole)
        pending = Math.min(pending - whole, 1)
        vegetation.uStep.value = sim.step + pending
      } else {
        vegetation.uStep.value = sim.step
      }
      const now = performance.now()
      if (running && sim.revision !== revisionDrawn && now - vegetationAt > 250) afterSteps(true)

      let animating = false
      for (const p of platforms) {
        const t = (now - p.started) / FORM_MS
        if (t <= 1.05) {
          p.obj.grow(Math.min(1, t))
          animating = true
        }
      }
      if (animating) renderer.shadowMap.needsUpdate = true

      let flying = false
      if (flight) {
        flight.t = Math.min(1, flight.t + delta / 0.7)
        const e = flight.t < 0.5 ? 2 * flight.t * flight.t : 1 - Math.pow(-2 * flight.t + 2, 2) / 2
        camera.position.lerpVectors(flight.from, flight.to, e)
        controls.target.lerpVectors(flight.fromT, flight.toT, e)
        flying = flight.t < 1
        if (!flying) flight = null
      }
      controls.update()
      clampTarget(controls, camera, PAN_BOUNDS)
      renderer.render(scene, camera)
      const noting = placeNote(now)

      if (dirty || now - reportAt > 400) {
        dirty = false
        reportAt = now
        const cand = sim.candidate
        onReport({
          step: sim.step,
          coverage: sim.growth.coverage(),
          bySpecies: [CLIMBER, SPREADER].map((sp) => sim.growth.coverageOf(sp)),
          tips: sim.growth.activeTips,
          overlap: sim.growth.overlap(),
          layered: sim.growth.layering(),
          smothered: sim.growth.smothered,
          platforms: sim.platforms.length,
          events: [...sim.events],
          candidate: cand ? { label: MUTATION_NAMES[cand.rule.kind], checks: cand.checks } : null,
          milestones: { ...sim.milestones },
          withered: Array.from(sim.growth.witheredBy),
          stepMs: sim.stepMs,
          fieldMs: sim.world.fieldMs,
        })
      }
      return running || flying || animating || noting || gate(camera.position, controls.target)
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

    placeSun()
    reset()

    if (import.meta.env.DEV) {
      // Dev only: run to an exact step, and place the camera, for figures.
      const w = window as unknown as { __wildAdvanceTo?: (n: number) => number; __wildCamera?: (p: number[], t: number[]) => void }
      w.__wildAdvanceTo = (n) => {
        if (n > sim.step) advance(n - sim.step)
        vegetation.uStep.value = sim.step
        loop.wake()
        return sim.step
      }
      w.__wildCamera = (p, t) => {
        camera.position.set(p[0], p[1], p[2])
        controls.target.set(t[0], t[1], t[2])
        controls.update()
        loop.wake()
      }
    }

    api.current = { applySettings, reset, stepOnce: () => advance(1), jumpTo, paint, flyTo, wake: () => loop.wake() }

    return () => {
      api.current = null
      stopWaking()
      loop.dispose()
      observer.disconnect()
      controls.dispose()
      vegetation.dispose()
      clearPlatforms()
      for (const mesh of [shell, details, ground]) mesh.geometry.dispose()
      for (const material of [wallLit, wallField, detailMaterial, ground.material]) material.dispose()
      fieldTexture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  const previous = useRef<Settings | null>(null)
  const { settings, display, focus, stepToken, resetToken, jump, camera, cameraToken } = props
  useEffect(() => {
    const prev = previous.current
    previous.current = settings
    if (!prev) return
    api.current?.applySettings(settings, prev)
    api.current?.wake()
  }, [settings])

  useEffect(() => {
    api.current?.paint()
    api.current?.wake()
  }, [display, focus])

  const firstStep = useRef(stepToken)
  useEffect(() => {
    if (stepToken === firstStep.current) return
    api.current?.stepOnce()
    api.current?.wake()
  }, [stepToken])

  const firstReset = useRef(resetToken)
  useEffect(() => {
    if (resetToken === firstReset.current) return
    api.current?.reset()
    api.current?.wake()
  }, [resetToken])

  useEffect(() => {
    if (!jump) return
    api.current?.jumpTo(jump.step)
    api.current?.wake()
  }, [jump])

  const firstCamera = useRef(cameraToken)
  useEffect(() => {
    if (cameraToken === firstCamera.current) return
    api.current?.flyTo(camera)
    api.current?.wake()
  }, [camera, cameraToken])

  useEffect(() => {
    api.current?.wake()
  }, [props.running])

  return (
    <div className="green-viewport" ref={containerRef}>
      <div ref={noteRef} className="wild-note" hidden />
    </div>
  )
}
