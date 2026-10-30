import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applyViewControls } from '../cameraControls'
import { createCameraGate, startRenderLoop, wakeOnInput } from '../renderLoop'
import { sunDirection } from '../green/fields'
import { DAY, daySky } from './sky'
import { WildVegetation } from '../wildform/wildVegetation'
import type { BuildGame } from './game'
import { SEG, anchorForBlock, anchorForLiving, blockEdge, edgeAt, edgeLength, type Edge } from './draper'
import { DraperView } from './draperMesh'
import { GroundCover } from './groundCover'
import { worldsApi } from '../firebase/worlds'
import { memoryDocs } from '../firebase/memoryDocs'
import { SURFACE, SURFACE_NAMES, type SurfaceKind } from './surfaces'
import { GLASS } from '../green/building'
import { SPECIES_NAMES } from '../wildform/names'
import { lawnMesh } from './lawn'
import { SeasonFx, type SeasonLook } from './seasonFx'
import { Population } from '../inhabitants/population'
import { InhabitantsView } from '../inhabitants/inhabitantMesh'
import { KINDS, KIND_NAMES, type Combo, type Kind } from './living'
import { livingObject, type LivingObject } from './livingMesh'
import { D, W } from './town'
import { TOWN_SCALE } from './townBuilding'
import { buildTown, cellX, cellZ, worldToCell } from './townMesh'

export type Tool = 'build' | 'remove' | 'plant'

/** The debug view: off, or one behaviour's suitability painted on every cell. */
export type SurfaceView = 'off' | 'climber' | 'spreader' | 'draper'

/** The Plant tool's species: Wildform's Climber (0) and Spreader (1), and the Draper. */
export const DRAPER = 2

export type GameReport = {
  left: number
  placed: number
  step: number
  bySpecies: number[]
  layered: number
  byCombo: Record<Combo, number>
  structures: number
  matured: number
  connections: number
  joined: boolean
  goal: boolean
  merged: boolean
  events: { step: number; text: string }[]
  canUndo: boolean
  drapers: number
  strands: number
  rooted: number
  /** The share of the building's growable surface Draper curtains hang over. */
  draperCoverage: number
  byKind: Record<Kind, number>
  /** The most recent mutation node and what it grew. */
  lastMutation: { combo: Combo; kind: Kind; step: number } | null
  /** The game's change count: what "unsaved changes" compares against. */
  changes: number
  /** Seeds the player has planted — Climber, Spreader, Draper — and whether that's since the world began (false: a world saved before they were counted). */
  seeds: [number, number, number]
  seedsComplete: boolean
  /** Inhabitants living in the scene (0 where there are none). */
  inhabitants: number
}

type Props = {
  game: BuildGame
  tool: Tool
  /** The species the Plant tool plants. */
  species: number
  running: boolean
  speed: number
  stepToken: number
  /** Incremented when the game changes from outside: Undo, Clear, Restart, the environment. */
  revision: number
  surfaceView: SurfaceView
  /**
   * A soft tint on every surface by how well it would suit one plant — the
   * same suitability the growth reads — over the scene, plants still showing.
   * The game shows it while a plant is picked; the Lab while weather changes.
   */
  hint?: SurfaceView
  /** After each stretch of growth, with the step: the game's seasons ease the weather here. */
  onAdvance?: (step: number) => void
  /**
   * The world's look at a step — leaf colour, lawn, sky, light, weather in
   * the air (seasonFx.ts). The game passes it to show its seasons; without
   * it the scene keeps its one clear day. Read once, at mount.
   */
  look?: (step: number) => SeasonLook
  /**
   * The inhabitants (src/inhabitants): given, they live in the scene, and
   * this says whether they're shown. Hidden, they carry on — only the models
   * are hidden. Undefined, there are none. Read once for whether they exist.
   */
  inhabitants?: boolean
  /** After a successful planting of Climber or Spreader, with the cell. */
  onPlanted?: (species: number, cell: number) => void
  onReport: (report: GameReport) => void
}

/** A press that moves less than this many pixels is a click, not an orbit. */
const CLICK_SLOP = 5
const STEPS_PER_SECOND = 8
const MAX_STEPS_PER_FRAME = 24
const NOTE_MS = 3600
const GROUND_EVERY = 16
/** Steps between redraws of the Drapers while they grow. */
const DRAPER_EVERY = 4

/**
 * The lawn, the town, the plants and what they build — one scene.
 *
 * The **Build** tool adds a block against the face you click (on the lawn
 * for the ground floor); **Remove** takes one away (not the existing
 * buildings); right-click or Shift-click removes with any tool. **Plant**
 * puts a seed of the chosen species where you click on a wall or terrace.
 * Growth runs or pauses whatever the tool: editing the town mid-growth
 * carries the plants onto the new building rather than starting again.
 */
export function BuildViewport(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  const api = useRef<{ refresh: () => void; stepOnce: () => void; wake: () => void; view: () => void; hint: () => void } | null>(null)

  useEffect(() => {
    latest.current = props
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const game = latest.current.game
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    container.appendChild(renderer.domElement)

    // A clear day (sky.ts): blue sky with soft clouds, a pale haze, a barely
    // warm sun and a cool sky fill — a playable sandbox, not a sunset.
    const scene = new THREE.Scene()
    const sunDir = new THREE.Vector3()
    const dome = daySky(sunDir)
    scene.add(dome)
    scene.fog = new THREE.Fog(DAY.haze, 34, 95)
    const camera = new THREE.PerspectiveCamera(32, container.clientWidth / Math.max(container.clientHeight, 1), 0.3, 200)
    camera.position.set(13, 12, 18)
    const controls = new OrbitControls(camera, renderer.domElement)
    applyViewControls(controls, { ground: true })
    controls.enableDamping = true
    controls.target.set(0, 1.2, 0)
    controls.maxPolarAngle = Math.PI * 0.47
    controls.minDistance = 4
    controls.maxDistance = 45
    controls.update()
    const gate = createCameraGate()

    const skyLight = new THREE.HemisphereLight(DAY.sky, DAY.bounce, 1.5)
    scene.add(skyLight)
    const sun = new THREE.DirectionalLight(DAY.sun, 2.6)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 70 })
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.02
    scene.add(sun)
    // The light comes from the growth model's sun, so the shadows you see are the light the plants answer to.
    let placedAzimuth = NaN
    const placeSun = () => {
      placedAzimuth = game.env.sunAzimuth
      const [lx, ly, lz] = sunDirection(game.env.sunAzimuth)
      sun.position.set(lx * 30, ly * 30, lz * 30)
      sunDir.set(lx, ly, lz).normalize()
    }
    placeSun()

    const lawn = lawnMesh()
    scene.add(lawn)

    // The rigid town.
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 })
    const townMesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
    townMesh.castShadow = true
    townMesh.receiveShadow = true
    scene.add(townMesh)
    const rebuildTownMesh = () => {
      const { geometry } = buildTown(game.town)
      townMesh.geometry.dispose()
      townMesh.geometry = geometry
    }

    // The plants and the living architecture, in the growth model's units.
    const grown = new THREE.Group()
    grown.scale.setScalar(1 / TOWN_SCALE)
    scene.add(grown)
    let vegetation: WildVegetation | null = null
    let vegetationFor: unknown = null
    let drawnRevision = -1
    const living = new Map<number, LivingObject>()
    // Ground spread, read from the plants: redrawn on every edit, and every
    // GROUND_EVERY steps while growing — it changes slowly, and an update
    // walks every tile of the lawn round the town.
    const ground = new GroundCover(lawn)
    grown.add(...ground.meshes)
    let groundAt = -Infinity
    // Drapers: redrawn as their strands grow, and on every edit or planting.
    const drapes = new DraperView()
    grown.add(drapes.group)
    let drapedAt = -Infinity
    const syncDrapers = (force: boolean) => {
      const step = game.sim.step
      // Still changing: a strand short of its path, a young lip, or a root base still filling out.
      const growing = game.drapers.list.some((d) => step - d.born < 120 || d.strands.some((st) => st.length < (st.path.length - 1) * SEG - 1e-3 || (st.rootedAt >= 0 && step - st.rootedAt < 120)))
      if (!force && (!growing || game.sim.step - drapedAt < DRAPER_EVERY)) return
      drapes.update(game.drapers.list, game.sim.step)
      drapedAt = game.sim.step
      renderer.shadowMap.needsUpdate = true
    }
    const syncGround = (force: boolean) => {
      if (!force && game.sim.step - groundAt < GROUND_EVERY) return
      ground.update(game)
      groundAt = game.sim.step
    }
    const maturedSeen = new Set<number>()

    // The inhabitants: they read the game and move themselves; nothing here writes to the world.
    const population = latest.current.inhabitants !== undefined ? new Population() : null
    const inhabitantsView = population ? new InhabitantsView() : null
    if (inhabitantsView) grown.add(inhabitantsView.group)

    // The seasons, if the game shows them: patched onto every leaf material as it appears.
    const fx = latest.current.look ? new SeasonFx({ sun, sky: skyLight }, lawn, dome, scene.fog as THREE.Fog) : null
    if (fx) {
      scene.add(fx.group)
      fx.tint([...ground.meshes.map((m) => m.material), drapes.leaves.material])
    }
    let lookStep = NaN
    const applyLook = () => {
      if (!fx || game.sim.step === lookStep) return
      lookStep = game.sim.step
      fx.apply(latest.current.look!(lookStep))
    }

    const syncPlants = () => {
      if (vegetationFor !== game.building) {
        if (vegetation) {
          for (const m of vegetation.meshes) grown.remove(m)
          vegetation.dispose()
        }
        vegetation = new WildVegetation(game.building)
        grown.add(...vegetation.meshes)
        fx?.tint(vegetation.foliage.map((m) => m.material))
        vegetationFor = game.building
        drawnRevision = -1
      }
      const rev = game.sim.revision * 1000 + game.revision
      vegetation!.sync(game.sim.growth, game.sim.world.moisture, rev)
      if (drawnRevision !== rev && latest.current.surfaceView !== 'off') syncView()
      if (drawnRevision !== rev && (latest.current.hint ?? 'off') !== 'off') syncHint()
      drawnRevision = rev
    }

    // --- a label beside what just happened ---
    let noteAt: THREE.Vector3 | null = null
    let noteUntil = 0
    const note = (text: string, at: number[], normal: number[]) => {
      if (!noteRef.current) return
      noteRef.current.textContent = text
      noteAt = new THREE.Vector3(at[0] + normal[0] * 1.2, at[1] + 1.2, at[2] + normal[2] * 1.2).divideScalar(TOWN_SCALE)
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

    let drawnEpoch = game.epoch
    const syncLiving = (announce: boolean) => {
      // Restart, New World or a loaded world replace the list: drop what is
      // drawn. (A loaded world can have as many structures, with the same ids.)
      if (living.size > game.living.length || drawnEpoch !== game.epoch) {
        drawnEpoch = game.epoch
        for (const o of living.values()) {
          grown.remove(o.group)
          o.dispose()
        }
        living.clear()
        maturedSeen.clear()
      }
      for (const l of game.living) {
        if (!living.has(l.id)) {
          const o = livingObject(l)
          living.set(l.id, o)
          grown.add(o.group)
          fx?.tint([o.parts.leaves.material])
          if (announce) note('Mutation node', l.node, l.normal)
        }
        if (l.matured && !maturedSeen.has(l.id)) {
          maturedSeen.add(l.id)
          if (announce) note(`A ${KIND_NAMES[l.kind]}`, l.node, l.normal)
        }
        living.get(l.id)!.grow(game.sim.step - l.born)
      }
      // Draper events with a place: label the latest.
      if (game.notes.length) {
        const last = game.notes[game.notes.length - 1]
        if (announce && last.at) note(last.text, last.at, [0, 0, 0])
        game.notes = []
      }
    }

    // Draper coverage walks every cell: worked out once a step, not every report.
    let coverageAt = -1
    let coverage = 0
    const report = () => {
      const g = game.sim.growth
      const coverageKey = game.sim.step * 1000 + game.drapers.strandCount
      if (coverageKey !== coverageAt) {
        coverage = game.drapers.coverage(game.building)
        coverageAt = coverageKey
      }
      const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>
      for (const l of game.living) byKind[l.kind]++
      const last = game.living[game.living.length - 1]
      latest.current.onReport({
        left: game.town.left,
        placed: game.town.placed(),
        step: game.sim.step,
        bySpecies: [0, 1].map((k) => g.coverageOf(k)),
        layered: g.layering(),
        byCombo: game.byCombo(),
        structures: game.living.length,
        matured: game.living.filter((l) => l.matured).length,
        connections: game.connections,
        joined: game.joined,
        goal: game.goalComplete,
        merged: game.mergedByBlocks,
        events: game.recentEvents(),
        canUndo: game.town.canUndo,
        drapers: game.drapers.list.length,
        strands: game.drapers.strandCount,
        rooted: game.drapers.rootedCount,
        draperCoverage: coverage,
        byKind,
        lastMutation: last ? { combo: last.combo, kind: last.kind, step: last.born } : null,
        changes: game.changes,
        seeds: [...game.seeds],
        seedsComplete: game.seedsComplete,
        inhabitants: population?.agents.length ?? 0,
      })
    }

    /** After anything changes the game from outside the loop. */
    const refresh = () => {
      rebuildTownMesh()
      placeSun()
      // A loaded or new world didn't wither anything here.
      game.sim.growth.drainWithered()
      applyLook()
      syncPlants()
      syncLiving(false)
      syncDrapers(true)
      syncGround(true)
      // Weather changes the fields without changing the revision: redraw the hint here too.
      if ((latest.current.hint ?? 'off') !== 'off') syncHint()
      renderer.shadowMap.needsUpdate = true
      report()
      loop.wake()
    }

    const advance = (n: number) => {
      game.advance(n)
      latest.current.onAdvance?.(game.sim.step)
      // Where plants withered, brown leaves drop: positions from growth units to the town's.
      const withered = game.sim.growth.drainWithered()
      if (fx && withered.length) {
        const b = game.building
        fx.wither(withered.map((c) => [(b.px[c] + b.nx[c] * 0.1) / TOWN_SCALE, (b.py[c] + b.ny[c] * 0.1) / TOWN_SCALE, (b.pz[c] + b.nz[c] * 0.1) / TOWN_SCALE]))
      }
      syncPlants()
      syncLiving(true)
      syncDrapers(false)
      syncGround(false)
    }

    // The ghost: where a click builds (white), or what it removes (red).
    const ghostMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false })
    const ghost = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), ghostMaterial)
    ghost.visible = false
    scene.add(ghost)

    // --- picking ---
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const ray = (event: PointerEvent | MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
    }
    /** The block a hit on the town belongs to, and the face's axis. */
    const blockOf = (hit: THREE.Intersection): { cell: [number, number, number]; step: [number, number, number] } | null => {
      const town = game.town
      const n = hit.face!.normal.clone()
      // Snap to the dominant axis: a roof slope counts as "up".
      const ax = Math.abs(n.x)
      const ay = Math.abs(n.y)
      const az = Math.abs(n.z)
      const step: [number, number, number] = ay >= ax && ay >= az ? [0, Math.sign(n.y), 0] : ax >= az ? [Math.sign(n.x), 0, 0] : [0, 0, Math.sign(n.z)]
      const p = hit.point
      let cell = [Math.floor(p.x + W / 2 - step[0] * 0.02), Math.floor(p.y - step[1] * 0.02), Math.floor(p.z + D / 2 - step[2] * 0.02)] as [number, number, number]
      // An arch hangs in the cell under its block; a roof, sill or post sits
      // outside its block's cell, above it. Find the block it belongs to.
      if (!town.filled(...cell) && town.filled(cell[0], cell[1] + 1, cell[2])) cell = [cell[0], cell[1] + 1, cell[2]]
      while (cell[1] > 0 && !town.filled(...cell)) cell = [cell[0], cell[1] - 1, cell[2]]
      return town.filled(...cell) ? { cell, step } : null
    }
    /**
     * For a Draper: the edge a click finds — the nearest valid edge of the
     * block or mature living structure clicked (draper.ts), or null.
     */
    const pickAnchor = (event: PointerEvent | MouseEvent): { edge: Edge; s: number } | null => {
      ray(event)
      const groups = [...living.values()].map((o) => o.group)
      const hit = raycaster.intersectObjects([townMesh, ...groups], true)[0]
      if (!hit) return null
      const q: [number, number, number] = [hit.point.x * TOWN_SCALE, hit.point.y * TOWN_SCALE, hit.point.z * TOWN_SCALE]
      if (hit.object !== townMesh) {
        for (const [id, o] of living) {
          let found = false
          o.group.traverse((c) => {
            if (c === hit.object) found = true
          })
          if (!found) continue
          const l = game.living.find((x) => x.id === id)
          return l ? anchorForLiving(l, q) : null
        }
        return null
      }
      const b = blockOf(hit)
      return b ? anchorForBlock(game.town, b.cell, b.step, q) : null
    }

    type Target = { add: [number, number, number] | null; remove: [number, number, number] | null }
    const pick = (event: PointerEvent | MouseEvent): Target => {
      ray(event)
      const town = game.town
      const hit = raycaster.intersectObjects([townMesh, lawn], false)[0]
      if (!hit) return { add: null, remove: null }
      if (hit.object === lawn) {
        const [x, z] = worldToCell(hit.point.x, hit.point.z)
        return { add: town.inBounds(x, 0, z) && !town.filled(x, 0, z) ? [x, 0, z] : null, remove: null }
      }
      const b = blockOf(hit)
      if (!b) return { add: null, remove: null }
      const { cell, step } = b
      const add: [number, number, number] = [cell[0] + step[0], cell[1] + step[1], cell[2] + step[2]]
      return { add: town.inBounds(...add) && !town.filled(...add) ? add : null, remove: cell }
    }
    /**
     * For planting: the growth cell nearest the point clicked — on a wall, a
     * roof of any pitch, or a mature living structure — or −1, with where the
     * click landed, so a miss can say why.
     */
    const pickCell = (event: PointerEvent | MouseEvent): { cell: number; at: THREE.Vector3 | null; onLiving: boolean } => {
      ray(event)
      const groups = [...living.values()].map((o) => o.group)
      const hit = raycaster.intersectObjects([townMesh, ...groups], true)[0]
      if (!hit) return { cell: -1, at: null, onLiving: false }
      const b = game.building
      const q = hit.point.clone().multiplyScalar(TOWN_SCALE)
      let best = -1
      let bestD = 0.8
      for (let i = 0; i < b.count; i++) {
        const d = Math.abs(b.px[i] - q.x) + Math.abs(b.py[i] - q.y) + Math.abs(b.pz[i] - q.z)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return { cell: best, at: q, onLiving: hit.object !== townMesh }
    }

    /**
     * After a planting, a word on the ground it went into — never a refusal
     * unless nothing can grow there (glass). Walls are the common case and
     * stay quiet; on a roof or a structure the label names the surface and
     * how it suits the plant: good, fair, or poor (below the suitability a
     * tip needs to spread, 0.1).
     */
    const plantNote = (cell: number, species: number, ok: boolean) => {
      const at: number[] = [game.building.px[cell], game.building.py[cell], game.building.pz[cell]]
      const n: number[] = [game.building.nx[cell], 0, game.building.nz[cell]]
      if (game.building.flags[cell] & GLASS) return note('Glass — nothing grows here', at, n)
      const kind = game.surface.kind[cell] as SurfaceKind
      if (!ok) return note(`Already a ${SPECIES_NAMES[species]} on top here`, at, n)
      if (kind === SURFACE.wall) return
      const suit = game.sim.world.suitability[species][cell]
      const rating = suit >= 0.45 ? 'good' : suit >= 0.2 ? 'fair' : suit >= 0.1 ? 'poor' : 'poor — it may not spread'
      const name = SURFACE_NAMES[kind]
      note(`${name[0].toUpperCase()}${name.slice(1)} · ${rating} for a ${SPECIES_NAMES[species]}`, at, n)
    }

    // The debug view: every cell as a dot, coloured by one behaviour's
    // suitability (Climber, Spreader: what the growth reads; Draper: how good
    // a hanging anchor it is). The plants are hidden while it shows.
    const debugMaterial = new THREE.PointsMaterial({ size: 0.2, vertexColors: true, sizeAttenuation: true })
    const debugPoints = new THREE.Points(new THREE.BufferGeometry(), debugMaterial)
    debugPoints.visible = false
    grown.add(debugPoints)
    const RAMP = [new THREE.Color('#5a2333'), new THREE.Color('#d9a441'), new THREE.Color('#86e07a')]
    const syncView = () => {
      const view = latest.current.surfaceView
      const showing = view !== 'off'
      debugPoints.visible = showing
      if (vegetation) for (const m of vegetation.meshes) m.visible = !showing
      drapes.group.visible = !showing
      for (const m of ground.meshes) m.visible = !showing
      if (!showing) return
      const b = game.building
      const w = game.sim.world
      const pos = new Float32Array(b.count * 3)
      const col = new Float32Array(b.count * 3)
      const c = new THREE.Color()
      for (let i = 0; i < b.count; i++) {
        pos[i * 3] = b.px[i] + b.nx[i] * 0.06
        pos[i * 3 + 1] = b.py[i] + b.ny[i] * 0.06
        pos[i * 3 + 2] = b.pz[i] + b.nz[i] * 0.06
        if (b.flags[i] & GLASS) {
          c.set('#3a4652')
        } else {
          const v = view === 'draper' ? game.surface.draper[i] : Math.min(1, w.suitability[view === 'climber' ? 0 : 1][i] / 0.7)
          if (v < 0.5) c.copy(RAMP[0]).lerp(RAMP[1], v * 2)
          else c.copy(RAMP[1]).lerp(RAMP[2], (v - 0.5) * 2)
        }
        c.toArray(col, i * 3)
      }
      debugPoints.geometry.dispose()
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      debugPoints.geometry = g
      loop.wake()
    }

    // The hint: soft round dots, good to poor, over the scene. Unlike the
    // debug view it hides nothing — it's for deciding where to plant.
    const dotCanvas = document.createElement('canvas')
    dotCanvas.width = dotCanvas.height = 32
    const dctx = dotCanvas.getContext('2d')!
    const grad = dctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.55, 'rgba(255,255,255,0.85)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    dctx.fillStyle = grad
    dctx.fillRect(0, 0, 32, 32)
    const dotTexture = new THREE.CanvasTexture(dotCanvas)
    const hintMaterial = new THREE.PointsMaterial({ size: 0.34, vertexColors: true, sizeAttenuation: true, map: dotTexture, transparent: true, opacity: 0.8, depthWrite: false })
    const hintPoints = new THREE.Points(new THREE.BufferGeometry(), hintMaterial)
    hintPoints.visible = false
    hintPoints.renderOrder = 5
    grown.add(hintPoints)
    const HINT = { good: new THREE.Color('#8ee868'), fair: new THREE.Color('#ecd35a'), poor: new THREE.Color('#e08a5c'), none: new THREE.Color('#8c8c8c') }
    const syncHint = () => {
      const hint = latest.current.hint ?? 'off'
      hintPoints.visible = hint !== 'off'
      if (hint === 'off') return loop.wake()
      const b = game.building
      const w = game.sim.world
      const pos: number[] = []
      const col: number[] = []
      for (let i = 0; i < b.count; i++) {
        if (b.flags[i] & GLASS) continue
        let c: THREE.Color
        if (hint === 'draper') {
          const v = game.surface.draper[i]
          if (v < 0.25) continue
          c = v >= 0.8 ? HINT.good : v >= 0.5 ? HINT.fair : HINT.poor
        } else {
          // The plant note's thresholds: good from 0.45, fair from 0.2, poor from 0.1, and under 0.1 a tip can't spread.
          const v = w.suitability[hint === 'climber' ? 0 : 1][i]
          c = v >= 0.45 ? HINT.good : v >= 0.2 ? HINT.fair : v >= 0.1 ? HINT.poor : HINT.none
        }
        pos.push(b.px[i] + b.nx[i] * 0.09, b.py[i] + b.ny[i] * 0.09, b.pz[i] + b.nz[i] * 0.09)
        col.push(c.r, c.g, c.b)
      }
      hintPoints.geometry.dispose()
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      hintPoints.geometry = g
      loop.wake()
    }

    // Where a Draper would hang: a bar along the edge it finds, and three
    // short strands below it, so the player sees it hangs before planting.
    const markerMaterial = new THREE.MeshBasicMaterial({ color: '#a6ffd6', transparent: true, opacity: 0.9, depthWrite: false })
    const marker = new THREE.Group()
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.16, 0.16), markerMaterial)
    bar.scale.x = 1.8
    marker.add(bar)
    const dripGeometry = new THREE.BoxGeometry(0.06, 1, 0.06).translate(0, -0.5, 0)
    for (const [x, h] of [[-0.6, 1.0], [-0.2, 1.6], [0.25, 1.3], [0.6, 0.8]]) {
      const drip = new THREE.Mesh(dripGeometry, markerMaterial)
      drip.position.x = x
      drip.scale.y = h
      marker.add(drip)
    }
    marker.visible = false
    grown.add(marker)
    const showMarker = (event: PointerEvent) => {
      const a = pickAnchor(event)
      marker.visible = !!a
      if (a) {
        const e = edgeAt(a.edge, a.s)
        marker.position.set(...e.p)
        marker.rotation.set(0, Math.atan2(-e.tangent[2], e.tangent[0]), 0)
      }
    }

    let shift = false
    const showGhost = (event: PointerEvent) => {
      const tool = latest.current.tool
      const draping = tool === 'plant' && latest.current.species === DRAPER
      marker.visible = false
      if (draping && !event.buttons) showMarker(event)
      if (event.buttons || tool === 'plant') {
        ghost.visible = false
        loop.wake()
        return
      }
      const t = pick(event)
      const removing = tool === 'remove' || shift
      const cell = removing ? (t.remove && !game.town.isLocked(...t.remove) ? t.remove : null) : game.town.left > 0 ? t.add : null
      ghost.visible = !!cell
      if (cell) {
        ghost.position.set(cellX(cell[0]), cell[1] + 0.5, cellZ(cell[2]))
        ghostMaterial.color.set(removing ? '#e06a5a' : '#ffffff')
      }
      loop.wake()
    }

    let down: { x: number; y: number; button: number } | null = null
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, button: e.button }
    }
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) {
        down = null
        return
      }
      const button = down.button
      down = null
      const tool = latest.current.tool
      const remove = button === 2 || e.shiftKey || (button === 0 && tool === 'remove')
      if (!remove && tool === 'plant' && button === 0 && latest.current.species === DRAPER) {
        const a = pickAnchor(e)
        if (a && game.plantDraper(a.edge, a.s)) {
          syncDrapers(true)
          report()
          loop.wake()
        }
        return
      }
      if (!remove && tool === 'plant' && button === 0) {
        const { cell, at, onLiving } = pickCell(e)
        const species = latest.current.species
        if (cell < 0) {
          // A structure is grown on once it has matured and its surfaces exist.
          if (onLiving && at) note('Not yet — a structure takes plants once it matures', [at.x, at.y, at.z], [0, 0, 0])
          return
        }
        const ok = game.plant(species, cell)
        plantNote(cell, species, ok)
        if (ok) {
          syncPlants()
          report()
          latest.current.onPlanted?.(species, cell)
        }
        loop.wake()
        return
      }
      const t = pick(e)
      let changed = false
      if (remove && t.remove) changed = game.edit(...t.remove, 0)
      else if (!remove && button === 0 && t.add) changed = game.edit(...t.add, game.town.colourFor(...t.add, t.remove))
      if (changed) refresh()
      showGhost(e)
    }
    const onMove = (e: PointerEvent) => {
      shift = e.shiftKey
      showGhost(e)
    }
    const onLeave = () => {
      ghost.visible = false
      marker.visible = false
      loop.wake()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shift = e.type === 'keydown'
    }
    const noMenu = (e: Event) => e.preventDefault()
    const canvas = renderer.domElement
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('contextmenu', noMenu)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)

    let pending = 0
    /** Fractional growth steps carried between `__buildAdvanceFrame` calls (dev only). */
    let frameCarry = 0
    let reportAt = 0
    let shadowStep = -1
    const loop = startRenderLoop((delta) => {
      // The sun follows the weather as it changes — the game's seasons ease it — not only on a refresh.
      if (game.env.sunAzimuth !== placedAzimuth) placeSun()
      applyLook()
      const { running, speed } = latest.current
      // Inhabitants keep the loop awake: at 30 fps shown, and slowly while hidden, since they carry on.
      const living = !!population && population.agents.length > 0
      const shown = latest.current.inhabitants === true
      loop.setMaxFps(running ? 30 : living ? (shown ? 30 : 8) : 60)
      if (population && inhabitantsView) {
        population.update(game, delta)
        inhabitantsView.visible = shown
        inhabitantsView.sync(population.agents, delta)
      }
      if (running) {
        pending += delta * STEPS_PER_SECOND * speed
        const whole = Math.min(Math.floor(pending), MAX_STEPS_PER_FRAME)
        if (whole > 0) advance(whole)
        pending = Math.min(pending - whole, 1)
        if (vegetation) vegetation.uStep.value = game.sim.step + pending
        // The weather moves while time does; paused, it holds still like the plants.
        fx?.update(delta, renderer.domElement.height)
      } else if (vegetation) {
        vegetation.uStep.value = game.sim.step
      }
      const now = performance.now()
      if (game.sim.revision * 1000 + game.revision !== drawnRevision) syncPlants()
      // Living structures change shape as they grow: refresh the shadow map
      // every few steps while anything is growing, not every frame.
      const growingLiving = game.living.some((l) => game.sim.step - l.born < 520)
      if (growingLiving && game.sim.step - shadowStep >= 8) {
        shadowStep = game.sim.step
        renderer.shadowMap.needsUpdate = true
      }
      controls.update()
      renderer.render(scene, camera)
      const noting = placeNote(now)
      if (running && now - reportAt > 300) {
        reportAt = now
        report()
      }
      return running || noting || (!!population && population.agents.length > 0) || gate(camera.position, controls.target)
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

    if (import.meta.env.DEV) {
      // Dev only: edit, plant and run exactly, and place the camera — for checks and figures.
      const w = window as unknown as Record<string, unknown>
      w.__buildGame = game
      w.__buildRefresh = refresh
      w.__inhabitants = population
      w.__buildGround = ground
      w.__buildDrapes = drapes
      // A store in memory for the world menu, since nobody can sign in headless (WorldMenu's devWorlds).
      w.__memoryWorlds = (uid: string, persist?: string) => {
        w.__wildformWorlds = { uid, api: worldsApi(memoryDocs(persist)) }
      }
      w.__buildDraper = (x: number, y: number, z: number, dx: number, dz: number, level: 'top' | 'bottom', at = 0.5) => {
        const e = blockEdge(game.town, x, y, z, dx, dz, level)
        const ok = !!e && game.plantDraper(e, edgeLength(e) * at)
        syncDrapers(true)
        syncGround(true)
        loop.wake()
        return ok
      }
      w.__buildGrowTo = (n: number) => {
        if (n > game.sim.step) advance(n - game.sim.step)
        if (vegetation) vegetation.uStep.value = game.sim.step
        renderer.shadowMap.needsUpdate = true
        report()
        loop.wake()
        return game.sim.step
      }
      // Dev only: advance exactly `seconds` of play — growth at `speed`, the weather, the
      // inhabitants — and draw it. A headless browser renders a frame every few seconds and
      // each frame steps at most 0.1 s, so a GIF captured in real time showed weather barely moving.
      w.__buildAdvanceFrame = (seconds: number, speed = 4) => {
        frameCarry += seconds * STEPS_PER_SECOND * speed
        const whole = Math.floor(frameCarry)
        frameCarry -= whole
        if (whole > 0) advance(whole)
        if (vegetation) vegetation.uStep.value = game.sim.step + frameCarry
        applyLook()
        fx?.update(seconds, renderer.domElement.height)
        if (population && inhabitantsView) {
          population.update(game, seconds)
          inhabitantsView.sync(population.agents, seconds)
        }
        renderer.shadowMap.needsUpdate = true
        controls.update()
        renderer.render(scene, camera)
        return game.sim.step
      }
      w.__buildProject = (p: number[]) => {
        const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera)
        const rect = container.getBoundingClientRect()
        return [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height]
      }
      w.__buildCamera = (p: number[], t: number[]) => {
        camera.position.set(p[0], p[1], p[2])
        controls.target.set(t[0], t[1], t[2])
        controls.update()
        loop.wake()
      }
    }

    api.current = {
      refresh,
      stepOnce: () => {
        advance(1)
        report()
        loop.wake()
      },
      wake: () => loop.wake(),
      view: () => syncView(),
      hint: () => syncHint(),
    }
    refresh()

    return () => {
      api.current = null
      stopWaking()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('contextmenu', noMenu)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      loop.dispose()
      observer.disconnect()
      controls.dispose()
      vegetation?.dispose()
      ground.dispose()
      drapes.dispose()
      bar.geometry.dispose()
      dripGeometry.dispose()
      markerMaterial.dispose()
      for (const o of living.values()) o.dispose()
      townMesh.geometry.dispose()
      lawn.geometry.dispose()
      for (const m of [material, ghostMaterial, lawn.material, dome.material, debugMaterial]) (m as THREE.Material).dispose()
      debugPoints.geometry.dispose()
      hintPoints.geometry.dispose()
      hintMaterial.dispose()
      dotTexture.dispose()
      dome.geometry.dispose()
      fx?.dispose()
      inhabitantsView?.dispose()
      ghost.geometry.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }, [])

  const { revision, stepToken, running, surfaceView, hint } = props
  useEffect(() => {
    api.current?.view()
  }, [surfaceView])
  useEffect(() => {
    api.current?.hint()
  }, [hint])
  const first = useRef(revision)
  useEffect(() => {
    if (revision === first.current) return
    api.current?.refresh()
  }, [revision])

  const firstStep = useRef(stepToken)
  useEffect(() => {
    if (stepToken === firstStep.current) return
    api.current?.stepOnce()
  }, [stepToken])

  useEffect(() => {
    api.current?.wake()
  }, [running])

  return (
    <div className="build-viewport" ref={containerRef}>
      <div ref={noteRef} className="wild-note" hidden />
    </div>
  )
}
