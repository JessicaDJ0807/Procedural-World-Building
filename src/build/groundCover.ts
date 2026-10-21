import * as THREE from 'three'
import { MAX_LAYERS } from '../wildform/growth'
import type { BuildGame } from './game'
import { lawnHeight } from './lawn'
import { STAGES, type Combo } from './living'
import { D, W } from './town'
import { TOWN_SCALE } from './townBuilding'

/**
 * Ground spread: the plants on the walls creeping out onto the lawn round
 * their feet, and round the roots of living architecture.
 *
 * It is drawn, not simulated — the growth model has no ground — but it is
 * read from the simulation, so it is where the plants are and as old as
 * they are:
 *
 * - every plant layer in a wall cell near the ground is a **source**, its
 *   reach growing with its age; a cell holding two or three layers is also a
 *   source of **layered** growth;
 * - every root or support of a living structure that comes within 1.2 units
 *   of the ground is a source of
 *   its combination's kinds, from the time its frame starts to grow, and the
 *   wall foot under its node is a source of layered growth — the denser
 *   patches by mutation zones;
 * - every Draper strand that has reached the lawn and rooted is a source of
 *   a small patch of Draper, tying hanging growth back to the ground;
 * - a source is stronger where the wall is moist and shaded, so beds are
 *   thicker in a building's lee and at its corners (where two walls'
 *   sources overlap), and thin out on a sunny, dry face.
 *
 * Each kind spreads differently, the way it grows on the wall:
 *
 * | | reach | patches |
 * | --- | --- | --- |
 * | Climber | up to 1.2 units: it goes up, not out — a fringe at the wall foot | fine-grained |
 * | Spreader | up to 5 units: the ground coverer — broad mats | large, irregular |
 * | Layered | up to 2.6 units: dense clumps | medium |
 * | Draper | up to 1.3 units round each strand rooted in the lawn | fine |
 *
 * Coverage is the sum of the sources' falloffs, saturated, then broken into
 * patches by noise; a leaf appears where a fixed per-tile random number falls
 * under the local density. The random numbers don't change between updates,
 * so as a bed grows, leaves are added to it, and none jump about.
 *
 * All in the growth model's units (the town's × 3), drawn in the `grown`
 * group: three instanced meshes of a few triangles a leaf, and a tint on the
 * lawn's vertex colours under the beds.
 */

const TILE = 0.5
/** Half the covered area's side: the grid's half-width plus the Spreader's reach and a margin. */
const HALF = (W / 2) * TOWN_SCALE + 6
const N = Math.ceil((2 * HALF) / TILE)
/** Wall cells this low feed the ground. */
const FOOT = 1.0

type Kind = 0 | 1 | 2 | 3 // climber, spreader, layered, draper

const SPREAD: { reach: number; grow: number; start: number; per: number; freq: number; cap: number }[] = [
  // reach: the most it reaches; grow: steps to reach it; start: reach of a seedling; per: leaves a tile; freq: patch noise frequency
  { reach: 1.4, grow: 260, start: 0.4, per: 4, freq: 0.9, cap: 6000 },
  { reach: 5.0, grow: 480, start: 0.6, per: 4, freq: 0.24, cap: 16000 },
  { reach: 2.6, grow: 360, start: 0.5, per: 3, freq: 0.55, cap: 9000 },
  // Round a Draper's roots: small, and it starts at once — the strand is its source.
  { reach: 1.3, grow: 220, start: 0.3, per: 3, freq: 0.8, cap: 4000 },
]

const COMBO_KINDS: Record<Combo, Kind[]> = {
  'climber+spreader': [0, 1],
  'climber+layered': [0, 2],
  'spreader+layered': [1, 2],
}

function hash(i: number, j: number, k: number): number {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function valueNoise(x: number, z: number, k: number): number {
  const i = Math.floor(x)
  const j = Math.floor(z)
  const fx = x - i
  const fz = z - j
  const u = fx * fx * (3 - 2 * fx)
  const v = fz * fz * (3 - 2 * fz)
  const a = hash(i, j, k)
  const b = hash(i + 1, j, k)
  const c = hash(i, j + 1, k)
  const d = hash(i + 1, j + 1, k)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function patchNoise(x: number, z: number, freq: number, k: number): number {
  return valueNoise(x * freq, z * freq, k) * 0.65 + valueNoise(x * freq * 2.7, z * freq * 2.7, k + 7) * 0.35
}

/** A leaf lying nearly flat, pointing along +x: a low diamond, slightly cupped. */
function leafGeometry(length: number, width: number): THREE.BufferGeometry {
  const l = length
  const w = width / 2
  // prettier-ignore
  const p = [
    0, 0, 0,   l * 0.45, 0.06 * l, w,   l * 0.45, 0.14 * l, 0,
    0, 0, 0,   l * 0.45, 0.14 * l, 0,   l * 0.45, 0.06 * l, -w,
    l * 0.45, 0.06 * l, w,   l, 0.1 * l, 0,   l * 0.45, 0.14 * l, 0,
    l * 0.45, 0.14 * l, 0,   l, 0.1 * l, 0,   l * 0.45, 0.06 * l, -w,
  ]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  g.computeVertexNormals()
  return g
}

/** An upright tuft: three blades leaning out from a point. */
function tuftGeometry(height: number): THREE.BufferGeometry {
  const p: number[] = []
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const w = height * 0.16
    const lean = height * 0.35
    p.push(-sa * w, 0, ca * w, sa * w, 0, -ca * w, ca * lean, height, sa * lean)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  g.computeVertexNormals()
  return g
}

/** Colours, darker and lighter: greens, fresher than the wall growth's look so the beds don't read as dry. */
const PALETTE: [string, string][] = [
  ['#34603a', '#558548'],
  ['#4a7a33', '#74a046'],
  ['#3a6531', '#62903f'],
  ['#2d6450', '#5e9c74'],
]
const MOSS = new THREE.Color('#4d7330')

export class GroundCover {
  readonly meshes: THREE.InstancedMesh[]
  private field = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)]
  private blocked = new Uint8Array(N * N)
  private lawnBase: Float32Array | null = null
  /** Leaves drawn, per kind, after the last update. */
  readonly counts = [0, 0, 0, 0]

  private lawn: THREE.Mesh

  constructor(lawn: THREE.Mesh) {
    this.lawn = lawn
    const geometries = [leafGeometry(0.28, 0.18), leafGeometry(0.34, 0.24), tuftGeometry(0.42), leafGeometry(0.3, 0.14)]
    this.meshes = geometries.map((g, k) => {
      const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide }), SPREAD[k].cap)
      m.count = 0
      m.receiveShadow = true
      m.frustumCulled = false
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SPREAD[k].cap * 3), 3)
      return m
    })
  }

  update(game: BuildGame) {
    const b = game.building
    const g = game.sim.growth
    const world = game.sim.world
    const step = game.sim.step
    for (const f of this.field) f.fill(0)

    const splat = (kind: Kind, x: number, z: number, age: number, strength: number) => {
      if (age <= 0 || strength <= 0) return
      const s = SPREAD[kind]
      const r = Math.min(s.reach, s.start + (s.reach - s.start) * (age / s.grow))
      const f = this.field[kind]
      const i0 = Math.max(0, Math.floor((x - r + HALF) / TILE))
      const i1 = Math.min(N - 1, Math.ceil((x + r + HALF) / TILE))
      const j0 = Math.max(0, Math.floor((z - r + HALF) / TILE))
      const j1 = Math.min(N - 1, Math.ceil((z + r + HALF) / TILE))
      for (let j = j0; j <= j1; j++) {
        const tz = (j + 0.5) * TILE - HALF
        for (let i = i0; i <= i1; i++) {
          const tx = (i + 0.5) * TILE - HALF
          const d = Math.hypot(tx - x, tz - z) / r
          if (d < 1) f[j * N + i] += strength * (1 - d) * (1 - d) * (1 - d)
        }
      }
    }

    // Wall feet.
    for (let c = 0; c < b.count; c++) {
      const depth = g.depth[c]
      if (!depth || b.py[c] > FOOT || b.ny[c] > 0.5) continue
      // Moist and shaded walls feed thicker beds.
      const strength = 0.35 + 0.45 * world.moisture[c] + 0.35 * (1 - world.sun[c])
      const x = b.px[c] + b.nx[c] * 0.3
      const z = b.pz[c] + b.nz[c] * 0.3
      let oldest = 0
      for (let k = 0; k < depth; k++) {
        const e = g.stack[c * MAX_LAYERS + k]
        const age = step - g.entryBirth[e]
        oldest = Math.max(oldest, age)
        const sp = g.entrySpecies[e]
        splat(sp === 0 ? 0 : 1, x, z, age, sp === 0 ? strength * 1.6 : strength)
      }
      if (depth >= 2) splat(2, x, z, oldest * 0.8, strength * 0.9)
    }

    // Living architecture: roots and supports that come down near the ground, and the wall foot under the node.
    for (const l of game.living) {
      const age = step - l.born - STAGES.frame[0]
      if (age <= 0) continue
      const kinds = COMBO_KINDS[l.combo]
      for (const curve of [...l.roots, ...l.frame]) {
        let low = curve[0]
        for (const p of curve) if (p[1] < low[1]) low = p
        if (low[1] > 1.2) continue
        const strength = 0.9 - 0.4 * Math.max(0, low[1]) / 1.2
        for (const kind of kinds) splat(kind, low[0], low[2], age, strength)
        splat(2, low[0], low[2], age * 0.7, strength * 0.6)
      }
      splat(2, l.node[0] + l.normal[0] * 0.4, l.node[2] + l.normal[2] * 0.4, age * 0.6, 0.9)
    }

    // Where a Draper's strand has rooted in the lawn.
    for (const d of game.drapers.list) {
      for (const st of d.strands) {
        if (st.rootedAt < 0) continue
        const end = st.path[st.path.length - 1]
        splat(3, end[0], end[2], step - st.rootedAt + 30, 1.1)
      }
    }

    // No leaves under a block.
    const town = game.town
    for (let j = 0; j < N; j++) {
      const tz = ((j + 0.5) * TILE - HALF) / TOWN_SCALE
      for (let i = 0; i < N; i++) {
        const tx = ((i + 0.5) * TILE - HALF) / TOWN_SCALE
        const ci = Math.floor(tx + W / 2)
        const cj = Math.floor(tz + D / 2)
        this.blocked[j * N + i] = town.inBounds(ci, 0, cj) && town.filled(ci, 0, cj) ? 1 : 0
      }
    }

    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const col = new THREE.Color()
    const colours = PALETTE.map(([a, b]) => [new THREE.Color(a), new THREE.Color(b)])
    const total = new Float32Array(N * N)

    for (let kind = 0 as Kind; kind < 4; kind = (kind + 1) as Kind) {
      const s = SPREAD[kind]
      const f = this.field[kind]
      const mesh = this.meshes[kind]
      let n = 0
      for (let j = 0; j < N && n < s.cap; j++) {
        for (let i = 0; i < N && n < s.cap; i++) {
          const t = j * N + i
          if (!f[t] || this.blocked[t]) continue
          const tx = (i + 0.5) * TILE - HALF
          const tz = (j + 0.5) * TILE - HALF
          // Saturate, then break into patches: noise lifts some places and empties others.
          // Near the wall the cover is high and nearly every place passes;
          // farther out only the noise's peaks do, so a bed frays into islands
          // rather than ending at a circle.
          const cover = 1 - Math.exp(-0.7 * f[t])
          const noise = patchNoise(tx, tz, s.freq, 11 + kind * 31)
          const pass = smooth(0.4, 0.6, noise + (cover - 0.6) * 1.1)
          const density = cover * pass
          if (density <= 0.02) continue
          total[t] += density
          for (let k = 0; k < s.per && n < s.cap; k++) {
            if (hash(i, j, kind * 8 + k) > density) continue
            const jx = hash(i, j, 100 + k) - 0.5
            const jz = hash(i, j, 200 + k) - 0.5
            const x = tx + jx * TILE * 1.2
            const z = tz + jz * TILE * 1.2
            pos.set(x, lawnHeight(x / TOWN_SCALE, z / TOWN_SCALE) * TOWN_SCALE + 0.02, z)
            // Smaller at a bed's thin edge.
            const size = (0.55 + 0.45 * density) * (0.75 + 0.5 * hash(i, j, 300 + k))
            e.set(kind === 2 ? 0 : (hash(i, j, 400 + k) - 0.4) * 0.35, hash(i, j, 500 + k) * Math.PI * 2, kind === 2 ? 0 : (hash(i, j, 600 + k) - 0.5) * 0.5)
            q.setFromEuler(e)
            scl.setScalar(size)
            m4.compose(pos, q, scl)
            mesh.setMatrixAt(n, m4)
            const [dark, light] = colours[kind]
            col.copy(dark).lerp(light, hash(i, j, 700 + k) * 0.8 + (1 - density) * 0.2)
            mesh.setColorAt(n, col)
            n++
          }
        }
      }
      mesh.count = n
      this.counts[kind] = n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    this.tintLawn(total)
  }

  /** Darken and green the lawn under the beds: the soil and moss between the leaves. */
  private tintLawn(total: Float32Array) {
    const geo = this.lawn.geometry
    const colour = geo.attributes.color as THREE.BufferAttribute
    const position = geo.attributes.position
    if (!this.lawnBase) this.lawnBase = Float32Array.from(colour.array as Float32Array)
    const base = this.lawnBase
    const out = colour.array as Float32Array
    const c = new THREE.Color()
    for (let v = 0; v < position.count; v++) {
      const x = position.getX(v) * TOWN_SCALE
      const z = position.getZ(v) * TOWN_SCALE
      const i = Math.floor((x + HALF) / TILE)
      const j = Math.floor((z + HALF) / TILE)
      let a = 0
      if (i >= 1 && j >= 1 && i < N - 1 && j < N - 1) {
        // A vertex is three tiles apart: average the tiles round it.
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) a += total[(j + dj) * N + i + di]
        a = Math.min(1, a / 9)
      }
      c.fromArray(base, v * 3)
      if (a > 0) c.lerp(MOSS, a * 0.7)
      c.toArray(out, v * 3)
    }
    colour.needsUpdate = true
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
      m.dispose()
    }
  }
}
