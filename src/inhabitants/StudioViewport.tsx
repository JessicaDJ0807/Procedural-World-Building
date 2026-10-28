import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applyViewControls } from '../cameraControls'
import { createCameraGate, startRenderLoop, wakeOnInput } from '../renderLoop'
import { buildTown } from '../build/townMesh'
import { TOWN_SCALE } from '../build/townBuilding'
import { livingObject, type LivingObject } from '../build/livingMesh'
import { WildVegetation } from '../wildform/wildVegetation'
import { BEHAVIOR_NAMES } from './agent'
import { InhabitantsView, inhabitantModel, type Pose } from './inhabitantMesh'
import type { StudioSim } from './scenarios'

export type Overlays = { labels: boolean; path: boolean; walkable: boolean }

type Props = {
  /** The scenario running, or null for the portrait: one inhabitant on a plinth. */
  sim: StudioSim | null
  portrait: { coat: number; pose: Pose }
  playing: boolean
  selected: number
  overlays: Overlays
  /** Keep the camera on the selected inhabitant: they're Play-sized, small in a whole scene. */
  follow: boolean
  resetToken: number
  /** A click in the scene: the walkable cell under it, or −1 where nothing grows. */
  onPick: (cell: number) => void
  /** A few times a second while running, so the inspector reads fresh state. */
  onTick: () => void
}

const REGION_HERE = new THREE.Color('#5aa05a')
const REGION_ELSEWHERE = new THREE.Color('#c0584a')

/**
 * The Inhabitants studio's stage, built once like the Architecture page's: a
 * pale floor, soft light, one shadowing key. A scenario is drawn with the
 * game's own pieces — Build's town geometry, Wildform's vegetation, Build's
 * living architecture, and the inhabitants' shared models — over its own
 * game (scenarios.ts). The portrait is the same model, alone on a plinth.
 *
 * Overlays, off by default: a label over each inhabitant naming its
 * behavior; the selected one's planned route and destination; and the
 * walkable cells, green where the selected one can reach and red where it
 * can't.
 */
export function StudioViewport(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })
  const api = useRef<{ show: (sim: StudioSim | null) => void; reset: () => void; wake: () => void } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const labelLayer = labelsRef.current
    if (!container || !labelLayer) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    container.insertBefore(renderer.domElement, labelLayer)

    const STUDIO = new THREE.Color('#ecebe4')
    const scene = new THREE.Scene()
    scene.background = STUDIO
    const camera = new THREE.PerspectiveCamera(30, container.clientWidth / Math.max(1, container.clientHeight), 0.05, 400)
    const controls = new OrbitControls(camera, renderer.domElement)
    applyViewControls(controls, { ground: true })
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI * 0.49
    const gate = createCameraGate()

    scene.add(new THREE.HemisphereLight('#ffffff', '#d4cfc2', 1.7))
    const key = new THREE.DirectionalLight('#fff7ea', 2.2)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    scene.add(key, key.target)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e1e3d6', roughness: 1 }))
    floor.position.y = -0.01
    floor.receiveShadow = true
    scene.add(floor)
    const townMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })

    // --- the portrait: one inhabitant on a plinth ---
    const portrait = new THREE.Group()
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.06, 0.18, 48), new THREE.MeshStandardMaterial({ color: '#d9d6cb', roughness: 0.9 }))
    plinth.position.y = 0.09
    plinth.receiveShadow = true
    const sitter = inhabitantModel(0)
    sitter.group.position.y = 0.18
    portrait.add(plinth, sitter.group)
    scene.add(portrait)

    // --- a scenario ---
    type Shown = {
      sim: StudioSim
      root: THREE.Group
      town: THREE.Mesh
      grown: THREE.Group
      vegetation: WildVegetation
      vegetationFor: unknown
      drawn: number
      living: Map<number, LivingObject>
      view: InhabitantsView
      walkable: THREE.Points
      walkableFor: string
      route: THREE.Line
      marker: THREE.Group
      labels: Map<number, HTMLDivElement>
      bounds: THREE.Box3
    }
    let shown: Shown | null = null

    const routeMat = new THREE.LineBasicMaterial({ color: '#d0832f', depthTest: false, transparent: true })
    const pointsMat = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })
    const markerMat = new THREE.MeshBasicMaterial({ color: '#d0832f', depthTest: false, transparent: true })
    const markerBad = new THREE.MeshBasicMaterial({ color: '#c0584a', depthTest: false, transparent: true })

    const clearScene = () => {
      if (!shown) return
      scene.remove(shown.root)
      shown.town.geometry.dispose()
      for (const m of shown.vegetation.meshes) shown.grown.remove(m)
      shown.vegetation.dispose()
      for (const o of shown.living.values()) o.dispose()
      shown.view.dispose()
      shown.walkable.geometry.dispose()
      shown.route.geometry.dispose()
      shown.marker.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose())
      for (const el of shown.labels.values()) el.remove()
      shown = null
    }

    /** Draws what changed in the scenario's game: the town, the plants, the structures. */
    const syncWorld = (s: Shown) => {
      const game = s.sim.game
      if (s.vegetationFor !== game.building) {
        for (const m of s.vegetation.meshes) s.grown.remove(m)
        s.vegetation.dispose()
        s.vegetation = new WildVegetation(game.building)
        s.grown.add(...s.vegetation.meshes)
        s.vegetationFor = game.building
        s.drawn = -1
        s.town.geometry.dispose()
        s.town.geometry = buildTown(game.town).geometry
      }
      const rev = game.sim.revision * 1000 + game.revision
      if (rev !== s.drawn) {
        s.vegetation.sync(game.sim.growth, game.sim.world.moisture, rev)
        s.drawn = rev
        renderer.shadowMap.needsUpdate = true
      }
      s.vegetation.uStep.value = game.sim.step
      for (const l of game.living) {
        let o = s.living.get(l.id)
        if (!o) {
          o = livingObject(l)
          s.living.set(l.id, o)
          s.grown.add(o.group)
        }
        o.grow(game.sim.step - l.born)
      }
    }

    const show = (sim: StudioSim | null) => {
      clearScene()
      portrait.visible = !sim
      if (sim) {
        const root = new THREE.Group()
        const town = new THREE.Mesh(buildTown(sim.game.town).geometry, townMaterial)
        town.castShadow = true
        town.receiveShadow = true
        const grown = new THREE.Group()
        grown.scale.setScalar(1 / TOWN_SCALE)
        const vegetation = new WildVegetation(sim.game.building)
        grown.add(...vegetation.meshes)
        const view = new InhabitantsView()
        grown.add(view.group)
        const walkable = new THREE.Points(new THREE.BufferGeometry(), pointsMat)
        walkable.renderOrder = 5
        const route = new THREE.Line(new THREE.BufferGeometry(), routeMat)
        route.renderOrder = 6
        const marker = new THREE.Group()
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 8, 24), markerMat)
        const pin = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 12).rotateX(Math.PI), markerMat)
        pin.position.y = 0.6
        marker.add(ring, pin)
        marker.renderOrder = 7
        grown.add(walkable, route, marker)
        root.add(town, grown)
        scene.add(root)
        root.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(town)
        shown = { sim, root, town, grown, vegetation, vegetationFor: sim.game.building, drawn: -1, living: new Map(), view, walkable, walkableFor: '', route, marker, labels: new Map(), bounds }
        syncWorld(shown)
        view.sync(sim.agents, 0)
      }
      frame(false)
    }

    // --- camera ---
    let tween: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t: number } | null = null
    const frame = (smooth: boolean) => {
      let centre: THREE.Vector3
      let radius: number
      if (shown) {
        centre = shown.bounds.getCenter(new THREE.Vector3())
        radius = shown.bounds.getBoundingSphere(new THREE.Sphere()).radius
      } else {
        centre = new THREE.Vector3(0, 0.75, 0)
        radius = 1.2
      }
      const dir = new THREE.Vector3(0.55, shown ? 0.5 : 0.25, 0.9).normalize()
      const fit = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * (camera.aspect < 1 ? 1.3 / camera.aspect : 1.05)
      const pos = centre.clone().addScaledVector(dir, fit)
      floor.scale.setScalar(Math.max(4, radius * 10))
      key.position.copy(centre).add(new THREE.Vector3(-0.6, 1.3, 0.8).multiplyScalar(Math.max(2, radius * 2.5)))
      key.target.position.copy(centre)
      const r = Math.max(2, radius * 1.4)
      Object.assign(key.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.1, far: r * 5 })
      key.shadow.camera.updateProjectionMatrix()
      renderer.shadowMap.needsUpdate = true
      controls.minDistance = radius * 0.25
      controls.maxDistance = radius * 6
      if (smooth) tween = { from: [camera.position.clone(), controls.target.clone()], to: [pos, centre], t: 0 }
      else {
        tween = null
        camera.position.copy(pos)
        controls.target.copy(centre)
        controls.update()
      }
      loop.wake()
    }

    // --- overlays ---
    const v = new THREE.Vector3()
    const updateOverlays = (s: Shown) => {
      const { overlays, selected } = latest.current
      const nav = s.sim.nav
      const agent = s.sim.agents.find((a) => a.id === selected) ?? s.sim.agents[0]
      // Walkable cells, coloured by whether the selected inhabitant can reach them.
      s.walkable.visible = overlays.walkable
      const here = agent && agent.cell >= 0 ? nav.region[agent.cell] : -1
      const keyNow = `${s.sim.rebuilds}:${here}`
      if (overlays.walkable && keyNow !== s.walkableFor) {
        s.walkableFor = keyNow
        const pos: number[] = []
        const col: number[] = []
        const b = nav.building
        for (let i = 0; i < b.count; i++) {
          if (!nav.walkable[i]) continue
          pos.push(b.px[i] + b.nx[i] * 0.15, b.py[i] + b.ny[i] * 0.15, b.pz[i] + b.nz[i] * 0.15)
          const c = nav.region[i] === here ? REGION_HERE : REGION_ELSEWHERE
          col.push(c.r, c.g, c.b)
        }
        s.walkable.geometry.dispose()
        s.walkable.geometry = new THREE.BufferGeometry()
        s.walkable.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
        s.walkable.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      }
      // The planned route and the destination.
      const route = overlays.path && agent ? [agent.pos, ...agent.path.map((c) => nav.pos(c))] : []
      s.route.visible = route.length > 1
      if (route.length > 1) {
        s.route.geometry.dispose()
        s.route.geometry = new THREE.BufferGeometry().setFromPoints(route.map((p) => new THREE.Vector3(p[0], p[1] + 0.3, p[2])))
      }
      const dest = agent?.destinationPos
      s.marker.visible = overlays.path && !!dest
      if (dest && agent) {
        s.marker.position.set(dest[0], dest[1] + 0.25, dest[2])
        const bad = agent.behavior === 'no-route'
        for (const m of s.marker.children as THREE.Mesh[]) m.material = bad ? markerBad : markerMat
        s.marker.children[0].rotation.x = Math.PI / 2
      }
      // Labels: each inhabitant's behavior, over its head.
      const w = container.clientWidth
      const h = container.clientHeight
      for (const a of s.sim.agents) {
        let el = s.labels.get(a.id)
        if (!el) {
          el = document.createElement('div')
          el.className = 'studio-label'
          labelLayer.appendChild(el)
          s.labels.set(a.id, el)
        }
        el.hidden = !overlays.labels
        if (!overlays.labels) continue
        el.textContent = `${a.id} · ${BEHAVIOR_NAMES[a.behavior]}`
        el.classList.toggle('is-selected', a.id === selected)
        v.set(a.pos[0] + a.up[0] * 1.6, a.pos[1] + a.up[1] * 1.6, a.pos[2] + a.up[2] * 1.6).divideScalar(TOWN_SCALE)
        v.project(camera)
        el.style.visibility = v.z > 1 ? 'hidden' : 'visible'
        el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`
      }
    }

    // --- picking: a click (not a drag) sends the selected inhabitant ---
    const ray = new THREE.Raycaster()
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
    const onUp = (e: PointerEvent) => {
      if (!down || !shown || e.button !== 0) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 5) return
      const r = renderer.domElement.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
      const targets: THREE.Object3D[] = [shown.town, ...shown.vegetation.meshes, ...[...shown.living.values()].map((o) => o.group)]
      const hit = ray.intersectObjects(targets, true)[0]
      if (!hit) return
      const p = hit.point.clone().multiplyScalar(TOWN_SCALE)
      latest.current.onPick(shown.sim.nav.nearest([p.x, p.y, p.z], 0.7))
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)

    let time = 0
    let tick = 0
    let following = false
    const loop = startRenderLoop((delta) => {
      let moving = false
      if (tween) {
        tween.t = Math.min(1, tween.t + delta / 0.7)
        const e = tween.t * tween.t * (3 - 2 * tween.t)
        camera.position.lerpVectors(tween.from[0], tween.to[0], e)
        controls.target.lerpVectors(tween.from[1], tween.to[1], e)
        moving = tween.t < 1
        if (!moving) tween = null
      }
      const { playing, portrait: pp } = latest.current
      const dt = playing ? delta : 0
      time += dt
      if (shown) {
        if (playing) shown.sim.update(delta)
        syncWorld(shown)
        shown.view.sync(shown.sim.agents, dt)
        // Follow: ease the target onto the selected inhabitant, keeping the camera's offset, closing in once.
        const fa = latest.current.follow ? (shown.sim.agents.find((a) => a.id === latest.current.selected) ?? shown.sim.agents[0]) : undefined
        if (fa) {
          const t = new THREE.Vector3(fa.pos[0], fa.pos[1], fa.pos[2]).divideScalar(TOWN_SCALE)
          const offset = camera.position.clone().sub(controls.target)
          if (!following) {
            following = true
            offset.setLength(Math.min(offset.length(), 5))
          }
          const k = Math.min(1, delta * 4)
          controls.target.lerp(t, k)
          camera.position.copy(controls.target).add(offset)
          moving = true
        } else following = false
        updateOverlays(shown)
        tick += delta
        if (tick > 0.2) {
          tick = 0
          latest.current.onTick()
        }
      } else {
        sitter.setCoat(pp.coat)
        sitter.animate(pp.pose, time)
      }
      controls.update()
      renderer.render(scene, camera)
      return playing || moving || gate(camera.position, controls.target)
    })
    const stopWaking = wakeOnInput(loop)
    const observer = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = container
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      loop.wake()
    })
    observer.observe(container)

    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__studioMemory = () => ({ ...renderer.info.memory })
      // Dev only: the scenario running, and where a cell is on screen — so a headless test can click it for real.
      ;(window as unknown as Record<string, unknown>).__studioSim = () => shown?.sim ?? null
      ;(window as unknown as Record<string, unknown>).__studioScreen = (cell: number) => {
        if (!shown) return null
        const p = shown.sim.nav.pos(cell)
        const q = new THREE.Vector3(p[0], p[1], p[2]).divideScalar(TOWN_SCALE).project(camera)
        const r = renderer.domElement.getBoundingClientRect()
        return { x: r.left + ((q.x + 1) / 2) * r.width, y: r.top + ((1 - q.y) / 2) * r.height }
      }
    }

    api.current = { show, reset: () => frame(true), wake: () => loop.wake() }
    show(latest.current.sim)

    return () => {
      api.current = null
      clearScene()
      stopWaking()
      observer.disconnect()
      loop.dispose()
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      for (const m of [townMaterial, routeMat, pointsMat, markerMat, markerBad, floor.material as THREE.Material, plinth.material as THREE.Material]) m.dispose()
      floor.geometry.dispose()
      plinth.geometry.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  const { sim, resetToken, playing, overlays, selected, portrait, follow } = props
  useEffect(() => {
    api.current?.show(sim)
  }, [sim])
  const firstReset = useRef(resetToken)
  useEffect(() => {
    if (resetToken !== firstReset.current) api.current?.reset()
  }, [resetToken])
  useEffect(() => {
    api.current?.wake()
  }, [playing, overlays, selected, portrait, follow])

  return (
    <div className="studio-viewport" ref={containerRef}>
      <div className="studio-labels" ref={labelsRef} aria-hidden="true" />
    </div>
  )
}
