import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applyMapDrag, clampTarget } from '../mapDrag'
import { createCameraGate, startRenderLoop, wakeOnInput } from '../renderLoop'
import { VIEWPORT_BACKGROUND } from '../theme'
import { BLOCKED, GLASS, HEIGHT, buildBuilding } from './building'
import { detailGeometry, isStairHousing, shellGeometry } from './buildingMesh'
import { combine, computeGeometry, computeMoisture, computeSun, sunDirection, type Fields } from './fields'
import { Growth, NO_SPECIES } from './growth'
import type { GrowthParams } from './params'
import { SPECIES_IDS, SPECIES_LOOK, type SpeciesId } from './species'
import { Vegetation } from './vegetation'

export type Display = 'final' | 'species' | 'moisture' | 'sun' | 'suitability' | 'geometry'
export type CameraView = 'front' | 'corner'

export type GrowthReport = {
  step: number
  grown: number
  coverage: number
  /** Each species' share of the growable wall, in SPECIES_IDS order. */
  bySpecies: number[]
  tips: number
  leaves: number
  /** Mean main-thread cost of one simulation step, ms. */
  stepMs: number
  /** Mean cost of recomputing the fields after a parameter change, ms. */
  fieldMs: number
  fps: number
}

type Props = {
  params: GrowthParams
  display: Display
  running: boolean
  /** 1, 4 or 16. */
  speed: number
  /** Incrementing it advances one step. */
  stepToken: number
  /** Incrementing it replants the seeds. */
  resetToken: number
  camera: CameraView
  cameraToken: number
  showLeaves: boolean
  /** Called once when growth has stopped — no new cell for STALL_STEPS steps — while playing. */
  onStall: (lastGrowthStep: number) => void
  /** The species whose suitability the Suitability view shows. */
  focus: SpeciesId
  onReport: (report: GrowthReport) => void
}

/** Simulation steps per second at 1×. 16× is 128 a second — a mature facade in under ten seconds. */
const STEPS_PER_SECOND = 8
/** A slow frame must not turn into a burst of hundreds of steps. */
const MAX_STEPS_PER_FRAME = 24
/**
 * Steps without a single new cell before Play stops by itself. See the note
 * on stall detection in docs/project/green-architecture.md for the measured
 * gaps this was chosen against.
 */
export const STALL_STEPS = 600
const PAN_BOUNDS = { x0: -30, x1: 22, z0: -22, z1: 22 }
/** The frame cap while growth plays. */
const PLAYING_FPS = 30

const VIEWS: Record<CameraView, { position: [number, number, number]; target: [number, number, number] }> = {
  front: { position: [-3, 9, 46], target: [-3, 7, 0] },
  // From above the front-left, so the inside corner, the west walls and the
  // terrace on the wing's roof are all in view.
  corner: { position: [-30, 21, 32], target: [-3, 6.5, -1] },
}

/**
 * Colour ramps for the debug views. Three stops each, dark to light, in one
 * hue family per field — restrained enough to sit beside the neutral chrome,
 * distinct enough that a screenshot says which field it is.
 */
const RAMPS: Record<Exclude<Display, 'final' | 'species'>, [string, string, string]> = {
  moisture: ['#24282c', '#3a5870', '#a3c8e0'],
  sun: ['#1f2023', '#6e5c3a', '#f2e0ae'],
  suitability: ['#23261f', '#4d6a34', '#bcdc90'],
  geometry: ['#222326', '#5a4e6d', '#d3c1e8'],
}

const building = buildBuilding()
const geometryField = computeGeometry(building)

export function GreenViewport(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  const api = useRef<{
    setParams: (p: GrowthParams, previous: GrowthParams | null) => void
    reset: (seed: number) => void
    stepOnce: () => void
    setDisplay: () => void
    flyTo: (view: CameraView) => void
    wake: () => void
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
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    // Drawn on demand, not every frame. Only the building casts shadows — the
    // plants cannot (see vegetation.ts) — and the building never moves, so the
    // map changes only when the sun does. Redrawing it every frame was 2 of the
    // 10 draw calls per frame and a full 2048² depth pass, for an identical map.
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(VIEWPORT_BACKGROUND)
    const camera = new THREE.PerspectiveCamera(34, container.clientWidth / Math.max(container.clientHeight, 1), 0.5, 200)
    const start = VIEWS[latest.current.camera]
    camera.position.set(...start.position)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(...start.target)
    controls.maxPolarAngle = Math.PI * 0.495
    controls.minDistance = 8
    controls.maxDistance = 70
    applyMapDrag(controls)
    controls.update()
    const gate = createCameraGate()

    // --- light: one sun that follows the sunlight field's direction ---
    scene.add(new THREE.HemisphereLight(0xc9d4e0, 0x3d3a34, 0.85))
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.3)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -22
    sun.shadow.camera.right = 22
    sun.shadow.camera.top = 22
    sun.shadow.camera.bottom = -22
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 80
    sun.shadow.bias = -0.0006
    sun.shadow.normalBias = 0.03
    sun.target.position.set(-3, HEIGHT / 2, 0)
    scene.add(sun, sun.target)

    // --- building ---
    const { count, texel, texW, texH } = building
    // Texels no cell owns are never meant to show, but nearest sampling at a
    // roof's edge can land on one; white is the lit material's neutral.
    const texData = new Uint8Array(texW * texH * 4).fill(255)
    const fieldTexture = new THREE.DataTexture(texData, texW, texH, THREE.RGBAFormat)
    // Nearest: the cells are the simulation's real resolution, and blurring
    // them would show a smoothness the model does not have.
    fieldTexture.magFilter = THREE.NearestFilter
    fieldTexture.minFilter = THREE.NearestFilter
    fieldTexture.colorSpace = THREE.SRGBColorSpace
    fieldTexture.needsUpdate = true

    // Lit: the texture (white, darkened where damp) times the vertex colour,
    // which tells wall from roof. Field views: the texture alone, unlit.
    const wallLit = new THREE.MeshStandardMaterial({ roughness: 0.92, map: fieldTexture, vertexColors: true })
    const wallField = new THREE.MeshBasicMaterial({ map: fieldTexture })
    // Sun-facing sides cast. three.js's default for a one-sided material is to
    // draw only its back faces into the shadow map, which suits closed solids;
    // the shell is open quads, and at the L's inside corner the wall casting
    // the shadow then left a hairline unshadowed along the corner — a dashed
    // light strip down the corner and along the ledges, shimmering whenever
    // anything near it changed. Zeroing the normal bias left it; casting from
    // the front faces removed it, with no acne in the Front, Corner or a
    // grazing view at the existing bias.
    wallLit.shadowSide = THREE.FrontSide
    wallField.shadowSide = THREE.FrontSide
    const shell = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(shellGeometry(building), wallLit)
    shell.castShadow = true
    shell.receiveShadow = true
    const detailMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, shadowSide: THREE.FrontSide })
    const details = new THREE.Mesh(detailGeometry(building), detailMaterial)
    details.castShadow = true
    details.receiveShadow = true
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(48, 64),
      new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.x = -3
    ground.receiveShadow = true
    scene.add(shell, details, ground)

    const vegetation = new Vegetation(building)
    scene.add(...vegetation.meshes)

    // --- simulation state ---
    const growth = new Growth(building)
    let fields: Fields = combine(
      building,
      { sun: new Float32Array(count), moisture: new Float32Array(count), geometry: geometryField },
      latest.current.params,
    )
    let pending = 0
    let stepCost = 0
    let stepCount = 0
    let fieldMs = 0
    let frames = 0
    let since = performance.now()
    let lastFps = 0
    let lastStepMs = 0
    // Set by anything that changes the state while paused — Step, Reset, a
    // parameter — so the readout does not wait for the half-second timer,
    // which only runs while frames are being drawn.
    let dirty = true
    let stallReported = false

    const paint = () => {
      const display = latest.current.display
      const flags = building.flags
      if (display === 'final') {
        // Damp staining: the wall darkens up to 22% where it is wettest. Glass
        // cells are under a pane and never seen.
        for (let i = 0; i < count; i++) {
          const t = texel[i] * 4
          const value = Math.round(255 * (1 - 0.22 * fields.moisture[i]))
          texData[t] = value
          texData[t + 1] = value
          texData[t + 2] = Math.round(value * 0.985)
          texData[t + 3] = 255
        }
      } else if (display === 'species') {
        // Who holds each cell: the territories, flat, in each species' swatch.
        // Repainted after every step while this view is up, since it is the
        // one view that shows the growth rather than a field.
        const swatches = SPECIES_IDS.map((id) => new THREE.Color(SPECIES_LOOK[id].swatch).convertLinearToSRGB())
        for (let i = 0; i < count; i++) {
          const t = texel[i] * 4
          if (flags[i] & (GLASS | BLOCKED)) {
            texData.set([18, 20, 22, 255], t)
            continue
          }
          const sp = growth.species[i]
          if (sp === NO_SPECIES) {
            texData.set([46, 48, 51, 255], t)
            continue
          }
          const c = swatches[sp]
          texData[t] = Math.round(c.r * 255)
          texData[t + 1] = Math.round(c.g * 255)
          texData[t + 2] = Math.round(c.b * 255)
          texData[t + 3] = 255
        }
      } else {
        const focus = SPECIES_IDS.indexOf(latest.current.focus)
        const source =
          display === 'moisture' ? fields.moisture : display === 'sun' ? fields.sun : display === 'geometry' ? fields.geometry : fields.suitability[focus]
        const stops = RAMPS[display].map((hex) => new THREE.Color(hex))
        const c = new THREE.Color()
        for (let i = 0; i < count; i++) {
          const t = texel[i] * 4
          if (flags[i] & (GLASS | BLOCKED)) {
            texData.set([18, 20, 22, 255], t)
            continue
          }
          const v = Math.min(1, Math.max(0, source[i]))
          if (v < 0.5) c.copy(stops[0]).lerp(stops[1], v * 2)
          else c.copy(stops[1]).lerp(stops[2], (v - 0.5) * 2)
          // The ramp is authored in sRGB; the texture is tagged sRGB, so the
          // bytes are the sRGB values themselves.
          c.convertLinearToSRGB()
          texData[t] = Math.round(c.r * 255)
          texData[t + 1] = Math.round(c.g * 255)
          texData[t + 2] = Math.round(c.b * 255)
          texData[t + 3] = 255
        }
      }
      fieldTexture.needsUpdate = true
      shell.material = display === 'final' ? wallLit : wallField
      // In a field view the panes would hide the glass cells the field marks,
      // and the leaves would hide the field: the stems stay, so growth can
      // still be read against the field under it.
      details.visible = display === 'final'
      for (const mesh of vegetation.foliage) mesh.visible = display === 'final' && latest.current.showLeaves
    }

    const setParams = (p: GrowthParams, previous: GrowthParams | null) => {
      const started = performance.now()
      const needsSun = !previous || previous.sunAzimuth !== p.sunAzimuth
      const needsMoisture = needsSun || !previous || previous.rain !== p.rain
      const sunField = needsSun ? computeSun(building, p.sunAzimuth) : fields.sun
      const moisture = needsMoisture ? computeMoisture(building, p.rain, sunField) : fields.moisture
      fields = combine(building, { sun: sunField, moisture, geometry: geometryField }, p)
      fieldMs = performance.now() - started
      dirty = true
      const [lx, ly, lz] = sunDirection(p.sunAzimuth)
      sun.position.set(lx * 40, HEIGHT / 2 + ly * 40, lz * 40)
      if (needsSun) renderer.shadowMap.needsUpdate = true
      paint()
    }

    const reset = (seed: number) => {
      growth.reset(seed, latest.current.params)
      vegetation.clear()
      vegetation.sync(growth, fields.moisture)
      if (latest.current.display === 'species') paint()
      pending = 0
      vegetation.uStep.value = 0
      stepCost = 0
      stepCount = 0
      stallReported = false
      dirty = true
    }

    const advance = (n: number) => {
      const started = performance.now()
      for (let k = 0; k < n; k++) growth.advance(fields, latest.current.params)
      stepCost += performance.now() - started
      stepCount += n
      vegetation.sync(growth, fields.moisture)
      if (latest.current.display === 'species') paint()
      dirty = true
    }

    // --- camera presets: a short eased flight rather than a jump ---
    let flight: { from: THREE.Vector3; fromT: THREE.Vector3; to: THREE.Vector3; toT: THREE.Vector3; t: number } | null = null
    const flyTo = (view: CameraView) => {
      const v = VIEWS[view]
      flight = {
        from: camera.position.clone(),
        fromT: controls.target.clone(),
        to: new THREE.Vector3(...v.position),
        toT: new THREE.Vector3(...v.target),
        t: 0,
      }
    }

    const loop = startRenderLoop((delta) => {
      const { running, speed, onReport, onStall } = latest.current
      // 30 frames a second while growth plays, 60 otherwise. Growth is paced in
      // steps per second, not per frame, so the cap halves the drawing without
      // slowing the simulation; the cost is a less fluid orbit during play.
      loop.setMaxFps(running ? PLAYING_FPS : 60)
      if (running && !stallReported && growth.step - growth.lastGrowth >= STALL_STEPS) {
        // Growth has stopped: stop stepping and drawing for nothing. Once per
        // run — Play again carries on, and only a reset re-arms it.
        stallReported = true
        onStall(growth.lastGrowth)
      }
      if (running) {
        pending += delta * STEPS_PER_SECOND * speed
        const whole = Math.min(Math.floor(pending), MAX_STEPS_PER_FRAME)
        if (whole > 0) advance(whole)
        pending = Math.min(pending - whole, 1)
        // The fraction between steps keeps stems drawing out smoothly at 1×.
        vegetation.uStep.value = growth.step + pending
      } else {
        vegetation.uStep.value = growth.step
      }

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
      // The building is about 22 × 10; a target more than a building away
      // from it has panned off into empty ground.
      clampTarget(controls, camera, PAN_BOUNDS)
      renderer.render(scene, camera)

      frames++
      const now = performance.now()
      if (now - since > 500 || dirty) {
        if (now - since > 500) {
          lastFps = (frames * 1000) / (now - since)
          frames = 0
          since = now
        }
        dirty = false
        onReport({
          step: growth.step,
          grown: growth.grown,
          coverage: growth.coverage(),
          bySpecies: SPECIES_IDS.map((_, sp) => growth.coverageOf(sp)),
          tips: growth.activeTips,
          leaves: vegetation.leafCount,
          stepMs: stepCount ? stepCost / stepCount : lastStepMs,
          fieldMs,
          fps: running ? lastFps : 0,
        })
        if (stepCount) lastStepMs = stepCost / stepCount
        stepCost = 0
        stepCount = 0
      }
      // Paused, nothing animates — the age uniform is pinned to a whole step —
      // so the loop can sleep as soon as the camera settles.
      return running || flying || gate(camera.position, controls.target)
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

    // --- what the rooftop boxes are, on hover ---
    // They are the one thing on the building that never grows, and the reason
    // is not visible: they are not surfaces the simulation has cells on. So the
    // label says so, rather than leaving it to look like a rule about plants.
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const unitAt = (event: PointerEvent) => {
      if (!details.visible) return null
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObjects([shell, details], false)[0]
      if (!hit) return null
      const { x, y, z } = hit.point
      return (
        building.units.find((u) => {
          const roofY = building.roofs[u.roof].y
          // A little margin, for the pad, the cap and the door that stand proud of the box.
          return Math.abs(x - u.x) <= u.w / 2 + 0.2 && Math.abs(z - u.z) <= u.d / 2 + 0.2 && y > roofY + 0.02 && y <= roofY + u.h + 0.2
        }) ?? null
      )
    }
    const onMove = (event: PointerEvent) => {
      const tip = tipRef.current
      if (!tip) return
      const unit = event.buttons ? null : unitAt(event)
      if (!unit) {
        tip.hidden = true
        return
      }
      const stair = isStairHousing(unit.h)
      const title = document.createElement('strong')
      title.textContent = stair ? 'Stair housing' : 'Rooftop equipment'
      const body = document.createElement('span')
      body.textContent = stair
        ? 'Where the stairs come out onto the roof. Bare because the model grows plants only on the building’s walls and roofs, and this is neither. It still shades the roof beside it, and growth follows its edge.'
        : 'Air-handling units. Bare because the model has no surface on them to grow on — and a real roof keeps them clear for airflow and servicing. They shade the roof, and rain collects against them.'
      tip.replaceChildren(title, body)
      const rect = containerRef.current!.getBoundingClientRect()
      tip.hidden = false
      tip.style.transform = `translate(${Math.min(event.clientX - rect.left + 14, rect.width - 290)}px, ${event.clientY - rect.top + 14}px)`
    }
    const onLeave = () => {
      if (tipRef.current) tipRef.current.hidden = true
    }
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerleave', onLeave)

    setParams(latest.current.params, null)
    reset(latest.current.params.seed)

    // Dev only: run to an exact step, so a captured figure and the numbers
    // beside it describe the same state rather than "about nine seconds in".
    if (import.meta.env.DEV) {
      ;(window as unknown as { __greenAdvanceTo?: (n: number) => number }).__greenAdvanceTo = (n) => {
        if (n > growth.step) advance(n - growth.step)
        vegetation.uStep.value = growth.step
        loop.wake()
        return growth.grown
      }
      // And put the camera anywhere, for a close-up figure no preset view gives.
      ;(window as unknown as { __greenCamera?: (p: number[], t: number[]) => void }).__greenCamera = (p, t) => {
        camera.position.set(p[0], p[1], p[2])
        controls.target.set(t[0], t[1], t[2])
        controls.update()
        loop.wake()
      }
    }

    api.current = {
      setParams,
      reset,
      stepOnce: () => advance(1),
      setDisplay: paint,
      flyTo,
      wake: () => loop.wake(),
    }

    return () => {
      api.current = null
      stopWaking()
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      loop.dispose()
      observer.disconnect()
      controls.dispose()
      vegetation.dispose()
      for (const mesh of [shell, details, ground]) mesh.geometry.dispose()
      for (const material of [wallLit, wallField, detailMaterial, ground.material]) material.dispose()
      fieldTexture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  // Parameters: fields are recomputed and the growth carries on from where it
  // is, so conditions can be changed mid-season and the response watched. Only
  // the seed restarts it.
  const previous = useRef<GrowthParams | null>(null)
  const { params, display, showLeaves, focus, stepToken, resetToken, camera, cameraToken } = props
  useEffect(() => {
    const prev = previous.current
    previous.current = params
    if (!prev) return
    api.current?.setParams(params, prev)
    // A new seed, or a species switched on or off, restarts: a species added
    // mid-season would have no seeds, and one removed would leave its growth
    // standing with nothing able to extend it.
    const roster = (p: GrowthParams) => SPECIES_IDS.map((id) => p.species[id].enabled).join()
    if (prev.seed !== params.seed || roster(prev) !== roster(params)) api.current?.reset(params.seed)
    api.current?.wake()
  }, [params])

  useEffect(() => {
    api.current?.setDisplay()
    api.current?.wake()
  }, [display, showLeaves, focus])

  const firstStep = useRef(stepToken)
  useEffect(() => {
    if (stepToken === firstStep.current) return
    api.current?.stepOnce()
    api.current?.wake()
  }, [stepToken])

  const firstReset = useRef(resetToken)
  useEffect(() => {
    if (resetToken === firstReset.current) return
    api.current?.reset(latest.current.params.seed)
    api.current?.wake()
  }, [resetToken])

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
      <div ref={tipRef} className="green-tip" hidden />
    </div>
  )
}
