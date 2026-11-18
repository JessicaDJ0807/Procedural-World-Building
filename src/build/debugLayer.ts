import * as THREE from 'three'
import type { BuildGame } from './game'
import { UNGROWABLE } from '../green/building'
import { ENTER_CUTOFF } from '../wildform/growth'
import { CLIMBER, SPREADER } from '../wildform/species'
import { COMBO_NAMES, KIND_TITLES, MATURE_AT, NODE_RULES, type NodeCandidate } from './living'
import { SEG } from './draper'
import { BEHAVIOR_NAMES, type Inhabitant } from '../inhabitants/agent'
import { GOAL_NAMES } from '../inhabitants/mind'
import type { Population } from '../inhabitants/population'

/**
 * The Debug layer: what the simulation is doing, drawn over the scene. Every
 * overlay reads the game's own data — the growth's layers and tips, the
 * fields' suitability, the node rules (`BuildGame.nodeCandidates`, which
 * shares `findNode`'s code), the inhabitants' state and routes — and draws
 * it; none of it decides anything, so turning one on or off can't change what
 * happens.
 *
 * Drawn in growth units under the scene's `grown` group. Each overlay is one
 * object whose geometry is rebuilt when its data changes, at most four times a
 * second (the inhabitants' every frame — there are six at most). Nothing casts
 * a shadow, and every object's `raycast` does nothing, so picking never sees
 * them. Off, the group is empty and hidden: the scene is as it was.
 */

export type DebugOptions = {
  nodes: boolean
  directions: boolean
  suitability: boolean
  radius: boolean
  mutations: boolean
  inhabitants: boolean
  paths: boolean
  /** Simulation timing: frozen (growth, inhabitants, weather), its time scale, and a counter each Step bumps. */
  paused: boolean
  timeScale: number
  stepToken: number
}

export const DEBUG_OFF: DebugOptions = {
  nodes: false,
  directions: false,
  suitability: false,
  radius: false,
  mutations: false,
  inhabitants: false,
  paths: false,
  paused: false,
  timeScale: 1,
  stepToken: 0,
}

/** Muted colours: one per plant, one per kind of debug information. */
export const DEBUG_COLOURS = {
  climber: '#7fbf6a',
  spreader: '#d4b04a',
  draper: '#59b3ad',
  high: '#5fbf5a',
  moderate: '#e0c548',
  low: '#d9644e',
  none: '#8a8a8a',
  radius: '#9ab4d9',
  spacing: '#c7a6d9',
  ready: '#f08a3c',
  meets: '#f0b03c',
  gathering: '#e8d27a',
  crowded: '#9a9a9a',
  formed: '#ff6fae',
  state: '#ffffff',
  target: '#f0c46a',
  path: '#7dd3fc',
  trail: '#a3a3a3',
}

const SPECIES_COLOUR = [DEBUG_COLOURS.climber, DEBUG_COLOURS.spreader]
const noRaycast = () => {}
const REBUILD_SECONDS = 0.25

/** Suitability bands, from the growth's own rule: a cell is entered only above ENTER_CUTOFF (0.1), with chance 0.05 + 0.95·s². */
export function suitabilityBand(s: number, growable: boolean): 'high' | 'moderate' | 'low' | 'none' {
  if (!growable || s <= ENTER_CUTOFF) return 'none'
  if (s >= 0.6) return 'high'
  if (s >= 0.3) return 'moderate'
  return 'low'
}

type Overlay = { obj: THREE.Object3D; key: string }

export class DebugLayer {
  readonly group = new THREE.Group()
  private overlays = new Map<string, Overlay>()
  private materials: THREE.Material[] = []
  private labelLayer: HTMLDivElement
  private labels = new Map<string, HTMLDivElement>()
  private sinceRebuild = Infinity
  private trails = new Map<number, THREE.Vector3[]>()
  private trailClock = 0
  private sinceInhabitants = 0
  private v = new THREE.Vector3()

  constructor(host: HTMLElement) {
    this.group.name = 'debug'
    this.labelLayer = document.createElement('div')
    this.labelLayer.className = 'debug-labels'
    host.appendChild(this.labelLayer)
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m)
    return m
  }

  // Drawn over the scene (no depth test), as debug views are: placed just off the surface, the
  // growth nodes and tips were hidden inside the plants' own foliage. Suitability tiles are the
  // exception — they sit on their surfaces.
  private pointsMat = (colour: string, size: number) => this.mat(new THREE.PointsMaterial({ color: colour, size, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }))
  private lineMat = (colour: string, opacity = 0.75, vertexColors = false) => this.mat(new THREE.LineBasicMaterial({ color: vertexColors ? '#ffffff' : colour, vertexColors, transparent: true, opacity, depthWrite: false, depthTest: false }))

  /** Puts an overlay's object in place of the last, disposing the old one's geometry. */
  private place(name: string, key: string, obj: THREE.Object3D) {
    this.drop(name)
    obj.traverse((o) => {
      o.raycast = noRaycast
      o.castShadow = false
      o.receiveShadow = false
      o.renderOrder = 8
    })
    this.overlays.set(name, { obj, key })
    this.group.add(obj)
  }

  private drop(name: string) {
    const o = this.overlays.get(name)
    if (!o) return
    this.group.remove(o.obj)
    o.obj.traverse((x) => (x as THREE.Mesh).geometry?.dispose())
    this.overlays.delete(name)
  }

  private keyOf(name: string) {
    return this.overlays.get(name)?.key
  }

  /**
   * Brings the overlays up to date. `species` is the plant the player has picked (the
   * suitability overlay shows its rule; the Draper has none of its own on walls, so it shows
   * the Climber's). `dt` is real seconds, for the throttle and the inhabitants' trails.
   */
  update(game: BuildGame, population: Population | null, o: DebugOptions, species: number, camera: THREE.Camera, width: number, height: number, dt: number) {
    const any = o.nodes || o.directions || o.suitability || o.radius || o.mutations || o.inhabitants || o.paths
    this.group.visible = any
    this.labelLayer.hidden = !any
    if (!any) {
      if (this.overlays.size) for (const name of [...this.overlays.keys()]) this.drop(name)
      this.hideLabels(new Set())
      this.trails.clear()
      return
    }
    const sim = game.sim
    const stamp = `${sim.revision}:${sim.step}:${game.revision}:${game.building.count}`
    this.sinceRebuild += dt
    // A different world (restart, new, loaded) is drawn at once, not after the throttle.
    if (game.epoch !== this.epoch || game.building !== this.building) {
      this.epoch = game.epoch
      this.building = game.building
      this.sinceRebuild = Infinity
      this.lastCandidates = null
      this.trails.clear()
    }
    const due = this.sinceRebuild >= REBUILD_SECONDS
    let rebuilt = false
    const want = (name: string, on: boolean, key: string, build: () => THREE.Object3D) => {
      if (!on) return this.drop(name)
      if (this.keyOf(name) === key || (!due && this.keyOf(name) !== undefined)) return
      this.place(name, key, build())
      rebuilt = true
    }
    want('nodes', o.nodes, stamp, () => this.buildNodes(game))
    want('directions', o.directions, stamp, () => this.buildDirections(game))
    const sp = species === SPREADER ? SPREADER : CLIMBER
    want('suitability', o.suitability, `${game.building.count}:${sp}:${sim.revision}:${game.env.rain}:${game.env.sunAzimuth}`, () => this.buildSuitability(game, sp))
    const needNodes = o.radius || o.mutations
    const candidates = needNodes && (due || !this.lastCandidates) ? (this.lastCandidates = thin(game.nodeCandidates(), game)) : this.lastCandidates
    want('radius', o.radius, stamp, () => this.buildRadius(game, candidates ?? []))
    want('mutations', o.mutations, stamp, () => this.buildMutations(game, candidates ?? []))
    if (rebuilt) this.sinceRebuild = 0

    // The inhabitants: ten times a second — they move.
    const agents = population?.agents ?? []
    this.sinceInhabitants += dt
    if (!(o.inhabitants || o.paths) || !agents.length || !population?.nav) this.drop('inhabitants')
    else if (this.sinceInhabitants >= 0.1 || !this.overlays.has('inhabitants')) {
      this.place('inhabitants', '', this.buildInhabitants(agents, population, o, this.sinceInhabitants))
      this.sinceInhabitants = 0
    }

    // Labels, projected.
    const shown = new Set<string>()
    const placed: [number, number, number][] = []
    const label = (id: string, p: THREE.Vector3, text: string, cls: string) => {
      // Growth units → the scene, through the `grown` group this layer sits in, → the screen.
      this.v.copy(p).applyMatrix4(this.group.matrixWorld).project(camera)
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) return
      // Never on top of another: the first placed (the more important) wins.
      const sx = ((this.v.x + 1) / 2) * width
      const sy = ((1 - this.v.y) / 2) * height
      // Its width from its text (10.5 px monospace is about 6.4 px a character, plus padding).
      const w = text.length * 6.4 + 14
      if (placed.some(([x, y, pw]) => Math.abs(x - sx) < (w + pw) / 2 && Math.abs(y - sy) < 17)) return
      placed.push([sx, sy, w])
      let el = this.labels.get(id)
      if (!el) {
        el = document.createElement('div')
        this.labelLayer.appendChild(el)
        this.labels.set(id, el)
      }
      el.className = `debug-label ${cls}`
      if (el.textContent !== text) el.textContent = text
      el.hidden = false
      el.style.transform = `translate(${((this.v.x + 1) / 2) * width}px, ${((1 - this.v.y) / 2) * height}px) translate(-50%, -100%)`
      shown.add(id)
    }
    if (o.mutations) {
      for (const l of game.living) {
        const grownFor = sim.step - l.born
        label(`formed-${l.id}`, new THREE.Vector3(...l.node).add(new THREE.Vector3(0, 1.2, 0)), `${KIND_TITLES[l.kind]} · ${COMBO_NAMES[l.combo]}${l.matured ? '' : ` · ${Math.round((100 * grownFor) / MATURE_AT)}% to mature`}`, 'is-formed')
      }
      // Labelled: the one to form next, those that qualify, and the closest few still gathering —
      // not those too near a structure (their marker is grey), which crowded every label out.
      const gathering = (candidates ?? []).filter((x) => !x.meets && !x.crowded).slice(0, 4)
      for (const c of [...(candidates ?? []).filter((x) => x.meets), ...gathering]) {
        const b = game.building
        label(`cand-${c.cell}`, new THREE.Vector3(b.px[c.cell], b.py[c.cell] + 0.9, b.pz[c.cell]), `${shortCombo(c.combo)} ${c.count}/${c.need} · ${Math.round(c.age)}/${c.minAge} steps${c.crowded ? ' · too near a structure' : c.ready ? ` · forms at step ${game.nextNodeCheck}` : c.meets ? ' · qualifies' : ''}`, c.ready ? 'is-ready' : c.meets ? 'is-meets' : c.crowded ? 'is-crowded' : 'is-gathering')
      }
    }
    if (o.inhabitants) {
      for (const a of agents) {
        if (a.cell < 0 && a.behavior !== 'stranded') continue
        const up = new THREE.Vector3(...a.up).multiplyScalar(1.7)
        label(`inh-${a.id}`, new THREE.Vector3(...a.pos).add(up), `#${a.id} ${BEHAVIOR_NAMES[a.behavior]}${a.goal && !a.sent ? ` · ${GOAL_NAMES[a.goal]}` : a.sent ? ' · sent' : ''}`, `is-inhabitant is-${a.behavior}`)
      }
    }
    this.hideLabels(shown)
  }

  private lastCandidates: NodeCandidate[] | null = null
  private epoch = -1
  private building: unknown = null

  /** Whether any overlay is on: the render loop stays awake (slowly) while one is, so it follows the world. */
  static active(o: DebugOptions | undefined): boolean {
    return !!o && (o.nodes || o.directions || o.suitability || o.radius || o.mutations || o.inhabitants || o.paths)
  }

  private hideLabels(keep: Set<string>) {
    for (const [id, el] of this.labels) if (!keep.has(id)) el.hidden = true
  }

  // --- vegetation ---

  /** Every layer of growth — the cells the growth model filled, each with its species — and the link to the layer it grew from. */
  private buildNodes(game: BuildGame): THREE.Object3D {
    const g = game.sim.growth
    const b = game.building
    const ML = g.stack.length / g.N
    const pos: number[] = []
    const col: number[] = []
    const lines: number[] = []
    const lineCol: number[] = []
    const c = new THREE.Color()
    const at = (cell: number, level: number) => {
      const o = 0.12 + 0.1 * level
      return [b.px[cell] + b.nx[cell] * o, b.py[cell] + b.ny[cell] * o, b.pz[cell] + b.nz[cell] * o]
    }
    for (let cell = 0; cell < g.N; cell++) {
      for (let k = 0; k < g.depth[cell]; k++) {
        const e = g.stack[cell * ML + k]
        const sp = g.entrySpecies[e]
        c.set(SPECIES_COLOUR[sp] ?? DEBUG_COLOURS.climber)
        pos.push(...at(cell, k))
        col.push(c.r, c.g, c.b)
        const parent = g.entryParent[e]
        if (parent >= 0) {
          const pc = g.entryCell[parent]
          lines.push(...at(pc, g.levelOf(parent)), ...at(cell, k))
          lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b)
        }
      }
    }
    // The Draper's strands: the nodes of their paths as far as each has grown (every second node, SEG apart).
    for (const d of game.drapers.list)
      for (const s of d.strands) {
        const n = Math.min(s.path.length - 1, Math.floor(s.length / SEG))
        c.set(DEBUG_COLOURS.draper)
        for (let k = 0; k <= n; k += 2) {
          pos.push(...s.path[k])
          col.push(c.r, c.g, c.b)
          if (k + 2 <= n) {
            lines.push(...s.path[k], ...s.path[k + 2])
            lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b)
          }
        }
      }
    const group = new THREE.Group()
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    pg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    const pm = this.pointsMaterial ?? (this.pointsMaterial = this.mat(new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false })))
    group.add(new THREE.Points(pg, pm))
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3))
    group.add(new THREE.LineSegments(lg, this.nodeLines ?? (this.nodeLines = this.lineMat('#ffffff', 0.22, true))))
    return group
  }
  private pointsMaterial?: THREE.PointsMaterial
  private nodeLines?: THREE.LineBasicMaterial

  /** An arrow at every active tip, along the direction `advance` will score its neighbours by; and each growing Draper strand's next step. */
  private buildDirections(game: BuildGame): THREE.Object3D {
    const g = game.sim.growth
    const b = game.building
    const cells = g.tipCells()
    const dirs = g.tipDirections()
    const sps = g.tipSpecies()
    const pos: number[] = []
    const col: number[] = []
    const c = new THREE.Color()
    const arrow = (p: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, len: number) => {
      const tip = p.clone().addScaledVector(d, len)
      const side = new THREE.Vector3().crossVectors(n, d).normalize().multiplyScalar(len * 0.22)
      const back = tip.clone().addScaledVector(d, -len * 0.35)
      for (const [a, z] of [[p, tip], [tip, back.clone().add(side)], [tip, back.clone().sub(side)]] as const) {
        pos.push(a.x, a.y, a.z, z.x, z.y, z.z)
        col.push(c.r, c.g, c.b, c.r, c.g, c.b)
      }
    }
    for (let t = 0; t < cells.length; t++) {
      const cell = cells[t]
      c.set(SPECIES_COLOUR[sps[t]] ?? DEBUG_COLOURS.climber)
      const n = new THREE.Vector3(b.nx[cell], b.ny[cell], b.nz[cell])
      const p = new THREE.Vector3(b.px[cell], b.py[cell], b.pz[cell]).addScaledVector(n, 0.25)
      const d = new THREE.Vector3(dirs[t * 3], dirs[t * 3 + 1], dirs[t * 3 + 2])
      if (d.lengthSq() < 1e-6) continue
      arrow(p, d.normalize(), n, 1.8)
    }
    for (const dr of game.drapers.list)
      for (const s of dr.strands) {
        const k = Math.floor(s.length / SEG)
        if (s.length <= 0 || k + 1 >= s.path.length) continue
        c.set(DEBUG_COLOURS.draper)
        const p = new THREE.Vector3(...s.path[k])
        const d = new THREE.Vector3(...s.path[k + 1]).sub(p).normalize()
        const n = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
        arrow(p, d, n, 1.2)
      }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    return new THREE.LineSegments(geo, this.arrowMat ?? (this.arrowMat = this.lineMat('#ffffff', 0.95, true)))
  }
  private arrowMat?: THREE.LineBasicMaterial

  /** Each cell's suitability for a species — the fields' own number — as a translucent tile in its band. */
  private buildSuitability(game: BuildGame, sp: number): THREE.Object3D {
    const b = game.building
    const suit = game.sim.world.suitability[sp]
    const flags = game.sim.world.building.flags
    const size = b.cell * 0.82
    const geo = new THREE.PlaneGeometry(size, size)
    const mat = this.suitMat ?? (this.suitMat = this.mat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })))
    const mesh = new THREE.InstancedMesh(geo, mat, b.count)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const z = new THREE.Vector3(0, 0, 1)
    const n = new THREE.Vector3()
    const p = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)
    const c = new THREE.Color()
    for (let i = 0; i < b.count; i++) {
      n.set(b.nx[i], b.ny[i], b.nz[i])
      q.setFromUnitVectors(z, n)
      p.set(b.px[i], b.py[i], b.pz[i]).addScaledVector(n, 0.05)
      m4.compose(p, q, one)
      mesh.setMatrixAt(i, m4)
      mesh.setColorAt(i, c.set(DEBUG_COLOURS[suitabilityBand(suit[i], !(flags[i] & UNGROWABLE))]))
    }
    mesh.computeBoundingSphere()
    return mesh
  }
  private suitMat?: THREE.MeshBasicMaterial

  /**
   * The node rules' distances, where they apply: a ring of NODE_RADIUS (1.2) round each place
   * a combination is gathering — the cells inside it are the ones counted — and a ring of
   * SPACING (5) round each structure's node, inside which no new node may form. And every cell
   * where the two plants overlap (both in its stack): the contacts the rules start from.
   */
  private buildRadius(game: BuildGame, candidates: NodeCandidate[]): THREE.Object3D {
    const b = game.building
    const g = game.sim.growth
    const group = new THREE.Group()
    const ring: number[] = []
    const spacing: number[] = []
    const circle = (out: number[], centre: THREE.Vector3, normal: THREE.Vector3, r: number, seg = 28) => {
      const u = new THREE.Vector3().crossVectors(normal, Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize()
      const v = new THREE.Vector3().crossVectors(normal, u).normalize()
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2
        const a1 = ((k + 1) / seg) * Math.PI * 2
        const p0 = centre.clone().addScaledVector(u, Math.cos(a0) * r).addScaledVector(v, Math.sin(a0) * r)
        const p1 = centre.clone().addScaledVector(u, Math.cos(a1) * r).addScaledVector(v, Math.sin(a1) * r)
        out.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
      }
    }
    for (const c of candidates) {
      const n = new THREE.Vector3(b.nx[c.cell], b.ny[c.cell], b.nz[c.cell])
      circle(ring, new THREE.Vector3(b.px[c.cell], b.py[c.cell], b.pz[c.cell]).addScaledVector(n, 0.2), n, NODE_RULES.NODE_RADIUS)
    }
    for (const l of game.living) {
      const centre = new THREE.Vector3(...l.node)
      circle(spacing, centre, new THREE.Vector3(0, 1, 0), NODE_RULES.SPACING, 48)
      circle(spacing, centre, new THREE.Vector3(1, 0, 0), NODE_RULES.SPACING, 48)
    }
    const add = (pos: number[], mat: THREE.Material) => {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      group.add(new THREE.LineSegments(geo, mat))
    }
    add(ring, this.ringMat ?? (this.ringMat = this.lineMat(DEBUG_COLOURS.radius, 0.85)))
    add(spacing, this.spacingMat ?? (this.spacingMat = this.lineMat(DEBUG_COLOURS.spacing, 0.4)))
    const contacts = g.contacts()
    const pts: number[] = []
    for (const cell of contacts) pts.push(b.px[cell] + b.nx[cell] * 0.3, b.py[cell] + b.ny[cell] * 0.3, b.pz[cell] + b.nz[cell] * 0.3)
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    group.add(new THREE.Points(pg, this.contactMat ?? (this.contactMat = this.pointsMat('#ffffff', 3))))
    return group
  }
  private ringMat?: THREE.LineBasicMaterial
  private spacingMat?: THREE.LineBasicMaterial
  private contactMat?: THREE.PointsMaterial

  /** Where the rules find a node forming, and where they have: markers by status, labelled. */
  private buildMutations(game: BuildGame, candidates: NodeCandidate[]): THREE.Object3D {
    const b = game.building
    const group = new THREE.Group()
    const byStatus: Record<string, number[]> = { ready: [], meets: [], gathering: [], crowded: [], formed: [] }
    for (const c of candidates) {
      const status = c.ready ? 'ready' : c.meets ? 'meets' : c.crowded ? 'crowded' : 'gathering'
      byStatus[status].push(b.px[c.cell] + b.nx[c.cell] * 0.35, b.py[c.cell] + b.ny[c.cell] * 0.35, b.pz[c.cell] + b.nz[c.cell] * 0.35)
    }
    for (const l of game.living) byStatus.formed.push(...l.node)
    const sizes: Record<string, number> = { ready: 13, meets: 10, gathering: 7, crowded: 6, formed: 14 }
    for (const [status, pos] of Object.entries(byStatus)) {
      if (!pos.length) continue
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      const key = `mut-${status}`
      const mat = (this.mutMats[key] ??= this.pointsMat(DEBUG_COLOURS[status as keyof typeof DEBUG_COLOURS], sizes[status]))
      group.add(new THREE.Points(geo, mat))
    }
    return group
  }
  private mutMats: Record<string, THREE.PointsMaterial> = {}

  // --- inhabitants ---

  /** Each one's target (a line to where it's going), its planned route (A*'s cells, still to step), and where it has been (recorded while this view is on). */
  private buildInhabitants(agents: Inhabitant[], population: Population, o: DebugOptions, dt: number): THREE.Object3D {
    const nav = population.nav!
    const group = new THREE.Group()
    const target: number[] = []
    const route: number[] = []
    const waypoints: number[] = []
    const trail: number[] = []
    const marks: number[] = []
    this.trailClock += dt
    const record = this.trailClock >= 0.25
    if (record) this.trailClock = 0
    const lift = (p: readonly number[], up: readonly number[], k = 0.35) => [p[0] + up[0] * k, p[1] + up[1] * k, p[2] + up[2] * k]
    for (const a of agents) {
      const here = lift(a.pos, a.up)
      if (o.inhabitants && a.destinationPos) {
        const d = a.destination >= 0 ? lift(a.destinationPos, nav.normal(a.destination)) : a.destinationPos
        target.push(...here, ...d)
        marks.push(...d)
      }
      if (o.paths) {
        let prev = here
        for (const c of a.path) {
          const p = lift(nav.pos(c), nav.normal(c), 0.25)
          route.push(...prev, ...p)
          waypoints.push(...p)
          prev = p
        }
        const list = this.trails.get(a.id) ?? []
        if (record) {
          list.push(new THREE.Vector3(...here))
          if (list.length > 40) list.shift()
          this.trails.set(a.id, list)
        }
        for (let k = 1; k < list.length; k++) trail.push(list[k - 1].x, list[k - 1].y, list[k - 1].z, list[k].x, list[k].y, list[k].z)
      }
    }
    const lines = (pos: number[], mat: THREE.Material) => {
      if (!pos.length) return
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      group.add(new THREE.LineSegments(geo, mat))
    }
    const points = (pos: number[], mat: THREE.Material) => {
      if (!pos.length) return
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      group.add(new THREE.Points(geo, mat))
    }
    lines(target, (this.targetMat ??= this.lineMat(DEBUG_COLOURS.target, 0.9)))
    points(marks, (this.markMat ??= this.pointsMat(DEBUG_COLOURS.target, 8)))
    lines(route, (this.routeMat ??= this.lineMat(DEBUG_COLOURS.path, 0.9)))
    points(waypoints, (this.waypointMat ??= this.pointsMat(DEBUG_COLOURS.path, 3)))
    lines(trail, (this.trailMat ??= this.lineMat(DEBUG_COLOURS.trail, 0.5)))
    return group
  }
  private targetMat?: THREE.LineBasicMaterial
  private markMat?: THREE.PointsMaterial
  private routeMat?: THREE.LineBasicMaterial
  private waypointMat?: THREE.PointsMaterial
  private trailMat?: THREE.LineBasicMaterial

  dispose() {
    for (const name of [...this.overlays.keys()]) this.drop(name)
    for (const m of this.materials) m.dispose()
    this.labelLayer.remove()
    this.labels.clear()
  }
}

const shortCombo = (c: string) => (c === 'climber+spreader' ? 'C+S' : c === 'climber+layered' ? 'C+layered' : 'S+layered')

/**
 * Thins the candidates for drawing: where cells of one combination crowd together, the one
 * nearest to qualifying stands for its neighbours within NODE_RADIUS. The one that would form
 * next always stays. At most 40.
 */
function thin(all: NodeCandidate[], game: BuildGame): NodeCandidate[] {
  // (Drawn ones only: `BuildGame.nodeCandidates` returns them all.)
  const b = game.building
  const progress = (c: NodeCandidate) => (c.ready ? 3 : c.meets ? 2 : 0) + Math.min(1, c.count / c.need) + Math.min(1, c.age / c.minAge) * 0.5
  const sorted = [...all].sort((p, q) => progress(q) - progress(p))
  const kept: NodeCandidate[] = []
  for (const c of sorted) {
    if (kept.length >= 40) break
    const near = kept.some((k) => k.combo === c.combo && Math.hypot(b.px[k.cell] - b.px[c.cell], b.py[k.cell] - b.py[c.cell], b.pz[k.cell] - b.pz[c.cell]) < NODE_RULES.NODE_RADIUS * 1.5)
    if (!near) kept.push(c)
  }
  return kept
}
