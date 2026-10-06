import * as THREE from 'three'
import { buildStopsLut, type Lut } from '../palette'
import { heightField, normalAt, valueNoise } from './terrain'
import type { WorldSpec } from './worlds'

/**
 * The terrain around the camera, as a ring of chunks that follows it.
 *
 * ## Why chunks rather than one large mesh
 *
 * A world big enough not to reach the edge of, at a resolution fine enough to
 * walk over, is more vertices than a single buffer wants. 25 chunks at 64×64
 * quads is 204,800 triangles on screen; the same ground as one mesh covering
 * the area the camera can reach would be orders of magnitude more, nearly all
 * of it behind the fog.
 *
 * Chunks line up because they do not know about each other: every vertex asks
 * `heightField` for its own world coordinate, and two chunks sharing an edge
 * ask the same question at the same place. Normals come from the height
 * function rather than from the triangles, so shading is continuous across a
 * seam too — a per-face normal would show every boundary as a crease.
 *
 * ## What is deliberately simple
 *
 * No LOD, no streaming over frames, no worker. A chunk is built in one
 * synchronous pass and the whole ring is rebuilt when the camera crosses a
 * boundary. Measured below — a chunk costs about 4 ms — so crossing a boundary
 * costs one or two chunk builds, not twenty-five: only the ring's new edge is
 * built, and the chunks that stay keep their geometry.
 */

const CHUNK = 160 // world units per chunk edge
const SEGMENTS = 64 // quads per chunk edge
export const RADIUS = 2 // chunks each way, so a 5×5 ring

export type ChunkStats = { built: number; live: number; triangles: number; lastBuildMs: number }

const key = (cx: number, cz: number) => `${cx},${cz}`

/** Deterministic per-chunk sequence, so a chunk scatters identically every time. */
function chunkRandom(cx: number, cz: number, seed: number): () => number {
  let s = (cx * 73856093) ^ (cz * 19349663) ^ (seed * 83492791)
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Chunk = { mesh: THREE.Mesh; cx: number; cz: number }

export type ScatterInstance = { kind: string; matrix: THREE.Matrix4; color: THREE.Color }

export class ChunkField {
  private readonly chunks = new Map<string, Chunk>()
  private readonly height: (x: number, z: number) => number
  private readonly lut: Lut
  private readonly material: THREE.MeshStandardMaterial
  private centre = { cx: Number.NaN, cz: Number.NaN }

  readonly group = new THREE.Group()
  readonly stats: ChunkStats = { built: 0, live: 0, triangles: 0, lastBuildMs: 0 }
  /** Rebuilt whenever the ring changes; the viewport turns these into instances. */
  scatter: ScatterInstance[] = []

  private readonly spec: WorldSpec

  private readonly rock: [number, number, number]
  private readonly shore: [number, number, number]
  private readonly look: {
    rockMix: number
    rockFrom: number
    rockTo: number
    shoreBand: number
    tintScale: number
    tintAmount: number
    sea: number | null
  }

  constructor(spec: WorldSpec) {
    this.spec = spec
    this.height = heightField(spec.terrain)
    const lin = (hex: string) => {
      const c = new THREE.Color(hex)
      // Vertex colours are consumed in linear light, and the ramp's own entries
      // already are. A sRGB hex dropped in raw would sit visibly lighter than
      // everything it is blended against.
      return [c.r, c.g, c.b] as [number, number, number]
    }
    this.rock = lin(spec.ground.rock)
    this.shore = lin(spec.ground.shore)
    this.look = {
      rockMix: spec.ground.rockMix,
      rockFrom: spec.ground.rockFrom,
      rockTo: spec.ground.rockTo,
      shoreBand: spec.ground.shoreBand,
      tintScale: spec.ground.tintScale,
      tintAmount: spec.ground.tintAmount,
      sea: spec.terrain.seaLevel,
    }
    this.lut = buildStopsLut(spec.stops, 0)
    // One material for every chunk: they differ only in geometry, and a
    // material per chunk would be 25 shader programs for one shader.
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.02,
      flatShading: false,
    })
  }

  heightAt(x: number, z: number): number {
    return this.height(x, z)
  }

  /**
   * Vertex colour from height, slope and a wandering tint.
   *
   * Height alone was the whole model, and it is why large areas came out one
   * flat colour: a world whose ground sits inside ten units of the median spends
   * almost the entire ramp on terrain nobody stands on, and everything within
   * walking distance lands on the same two entries.
   *
   * Three things break that up, in order of how much they do:
   *
   * **Slope exposes rock.** The single largest improvement. Anything steep
   * stops being soil or ice and becomes the rock underneath, which is both what
   * happens and what makes relief legible — a hillside now reads as a hillside
   * from its colour and not only from its shading.
   *
   * **A shoreline band.** A few units either side of the waterline, where the
   * ramp would otherwise cross from one stop to the next with nothing marking
   * the edge of the water.
   *
   * **A low-frequency tint.** Two octaves of noise at a scale far larger than
   * the terrain's own, moving the colour a few percent. Not meant to be seen as
   * a pattern — it is there so that two hillsides at the same height are not
   * the same colour, which is the thing that reads as computer-generated more
   * than any single wrong hue does.
   */
  private shade(
    out: Float32Array,
    o: number,
    x: number,
    z: number,
    y: number,
    normalY: number,
    lo: number,
    span: number,
  ) {
    const t = Math.min(1, Math.max(0, (y - lo) / span))
    const c = Math.min(255, Math.max(0, Math.round(t * 255))) * 3
    let r = this.lut.linear[c]
    let g = this.lut.linear[c + 1]
    let b = this.lut.linear[c + 2]

    const { rockMix, rockFrom, rockTo, shoreBand, tintScale, tintAmount, sea } = this.look

    if (rockMix > 0) {
      // normalY is 1 on the flat and falls toward 0 on a cliff. The band is
      // smoothstepped so the transition is a slope, not a contour line.
      const steep = Math.min(1, Math.max(0, (rockFrom - normalY) / (rockFrom - rockTo)))
      const k = steep * steep * (3 - 2 * steep) * rockMix
      if (k > 0) {
        r += (this.rock[0] - r) * k
        g += (this.rock[1] - g) * k
        b += (this.rock[2] - b) * k
      }
    }

    if (shoreBand > 0 && sea !== null) {
      const d = Math.abs(y - sea)
      if (d < shoreBand) {
        const k = (1 - d / shoreBand) ** 2
        r += (this.shore[0] - r) * k
        g += (this.shore[1] - g) * k
        b += (this.shore[2] - b) * k
      }
    }

    if (tintAmount > 0) {
      /*
       * Four octaves, each answering a different distance.
       *
       * The first two run to several hundred units and separate one hillside
       * from the next. The third, around 55 units, is what a viewer sees while
       * walking. The fourth is the one the foreground needed: the ground in the
       * bottom of a frame is a few metres away at a grazing angle, and at that
       * angle a 55-unit wavelength is one colour across the whole strip.
       *
       * It stops there because the vertex grid is 2.5 units. An octave finer
       * than about 10 units has nowhere to be sampled and would alias into the
       * triangles rather than read as ground.
       */
      const n =
        valueNoise(x * tintScale, z * tintScale, this.spec.terrain.seed + 717) * 0.36 +
        valueNoise(x * tintScale * 2.7, z * tintScale * 2.7, this.spec.terrain.seed + 919) * 0.26 +
        valueNoise(x * tintScale * 11, z * tintScale * 11, this.spec.terrain.seed + 313) * 0.22 +
        valueNoise(x * 0.09, z * 0.09, this.spec.terrain.seed + 515) * 0.16
      const k = 1 + (n - 0.5) * 2 * tintAmount
      r *= k
      g *= k
      b *= k
    }

    out[o] = r < 0 ? 0 : r > 1 ? 1 : r
    out[o + 1] = g < 0 ? 0 : g > 1 ? 1 : g
    out[o + 2] = b < 0 ? 0 : b > 1 ? 1 : b
  }

  /** True when the ring moved, so the caller knows the scatter changed too. */
  update(camX: number, camZ: number): boolean {
    const cx = Math.round(camX / CHUNK)
    const cz = Math.round(camZ / CHUNK)
    if (cx === this.centre.cx && cz === this.centre.cz) return false
    this.centre = { cx, cz }

    const wanted = new Set<string>()
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) wanted.add(key(cx + dx, cz + dz))
    }

    // Drop first, so the peak live count is the ring rather than two rings.
    for (const [k, chunk] of this.chunks) {
      if (wanted.has(k)) continue
      this.group.remove(chunk.mesh)
      chunk.mesh.geometry.dispose()
      this.chunks.delete(k)
    }

    const started = performance.now()
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const k = key(cx + dx, cz + dz)
        if (this.chunks.has(k)) continue
        const chunk = this.build(cx + dx, cz + dz)
        this.chunks.set(k, chunk)
        this.group.add(chunk.mesh)
        this.stats.built++
      }
    }
    this.stats.lastBuildMs = performance.now() - started
    this.stats.live = this.chunks.size
    this.stats.triangles = this.chunks.size * SEGMENTS * SEGMENTS * 2

    this.rebuildScatter(cx, cz)
    return true
  }

  private build(cx: number, cz: number): Chunk {
    const n = SEGMENTS + 1
    const originX = cx * CHUNK - CHUNK / 2
    const originZ = cz * CHUNK - CHUNK / 2
    const step = CHUNK / SEGMENTS

    const positions = new Float32Array(n * n * 3)
    const normals = new Float32Array(n * n * 3)
    const colors = new Float32Array(n * n * 3)
    const [lo, hi] = this.spec.colorRange
    const span = hi - lo || 1

    /*
     * Heights first, with one extra ring, then normals from the grid.
     *
     * Asking `normalAt` per vertex costs four more height evaluations each —
     * five calls where one would do, and the height function is the whole cost
     * of building a chunk. Measured: that put a boundary crossing at 7-12 ms
     * against a 16.7 ms frame, which is a dropped frame about once a second
     * while sprinting.
     *
     * The extra ring is what keeps this identical across a seam. Differencing
     * only the chunk's own vertices would make the edge normals one-sided and
     * every boundary would show as a crease; sampling one row beyond means an
     * edge vertex is differenced against the same neighbours its counterpart in
     * the next chunk uses.
     */
    const m = n + 2
    const grid = new Float32Array(m * m)
    for (let j = 0; j < m; j++) {
      const z = originZ + (j - 1) * step
      for (let i = 0; i < m; i++) grid[j * m + i] = this.height(originX + (i - 1) * step, z)
    }

    const inv = 1 / (2 * step)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const g = (j + 1) * m + (i + 1)
        const y = grid[g]
        const o = (j * n + i) * 3

        // Chunk-local positions with the mesh placed at the chunk origin: at
        // 10,000 units out, world-space vertex coordinates lose enough float
        // precision to make the surface visibly shimmer.
        positions[o] = i * step
        positions[o + 1] = y
        positions[o + 2] = j * step

        const dx = (grid[g + 1] - grid[g - 1]) * inv
        const dz = (grid[g + m] - grid[g - m]) * inv
        const len = Math.hypot(-dx, 1, -dz) || 1
        normals[o] = -dx / len
        normals[o + 1] = 1 / len
        normals[o + 2] = -dz / len

        this.shade(colors, o, originX + i * step, originZ + j * step, y, normals[o + 1], lo, span)
      }
    }

    const indices = new Uint32Array(SEGMENTS * SEGMENTS * 6)
    let w = 0
    for (let j = 0; j < SEGMENTS; j++) {
      for (let i = 0; i < SEGMENTS; i++) {
        const a = j * n + i
        indices[w++] = a
        indices[w++] = a + n
        indices[w++] = a + 1
        indices[w++] = a + 1
        indices[w++] = a + n
        indices[w++] = a + n + 1
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    // Computed rather than left to three.js, which would otherwise walk every
    // vertex again for the same answer.
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CHUNK / 2, 0, CHUNK / 2),
      CHUNK * 1.2,
    )

    const mesh = new THREE.Mesh(geometry, this.material)
    mesh.position.set(originX, 0, originZ)
    return { mesh, cx, cz }
  }

  /**
   * Candidate positions per chunk, filtered by the rules.
   *
   * Rejection rather than solving for valid ground: asking the height function
   * at a point is cheap, and a rule that rejects most of its attempts is how a
   * band produces clustering — trees crowd where the ground is flat and low
   * because that is where the attempts survive, not because anything clusters
   * them.
   */
  private rebuildScatter(cx: number, cz: number) {
    const out: ScatterInstance[] = []
    const matrix = new THREE.Matrix4()
    const quat = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const scaleV = new THREE.Vector3()
    const pos = new THREE.Vector3()

    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const gx = cx + dx
        const gz = cz + dz
        for (const rule of this.spec.scatter) {
          const seed = this.spec.terrain.seed + rule.kind.length * 7919
          const rnd = chunkRandom(gx, gz, seed)
          const base = new THREE.Color(rule.color)
          for (let a = 0; a < rule.attempts; a++) {
            const x = (gx - 0.5) * CHUNK + rnd() * CHUNK
            const z = (gz - 0.5) * CHUNK + rnd() * CHUNK
            const spin = rnd() * Math.PI * 2
            const t = rnd()
            const roll = rnd()
            const lean = rnd()
            const leanDir = rnd() * Math.PI * 2
            const shade = rnd()
            const pick = rnd()

            const y = this.height(x, z)
            if (y < rule.minHeight || y > rule.maxHeight) continue
            const [, ny] = normalAt(this.height, x, z, 1.2)
            if (ny < rule.minFlatness) continue

            /*
             * Clustering.
             *
             * A low-frequency field decides where this kind is allowed to be
             * dense. Without it the survivors of the bands are spread evenly
             * across everything that qualifies, which is what made the first
             * pass read as confetti — real stands have edges and real boulder
             * fields have gaps. Two octaves, because one gives round blobs and
             * the second breaks their outline.
             */
            if (rule.clump > 0) {
              const f =
                valueNoise(x * rule.clumpScale, z * rule.clumpScale, seed + 31) * 0.7 +
                valueNoise(x * rule.clumpScale * 2.3, z * rule.clumpScale * 2.3, seed + 57) * 0.3
              // Lifted so clump 1 still leaves a few strays rather than a hard
              // boundary with nothing outside it.
              if (roll > (1 - rule.clump) + rule.clump * f * 1.15) continue
            }

            const s = rule.scale[0] + (rule.scale[1] - rule.scale[0]) * t
            const tall = rule.stretch[0] + (rule.stretch[1] - rule.stretch[0]) * shade
            pos.set(x, y - rule.sink * s, z)
            // Lean away from vertical, in a direction of its own. A stand of
            // perfectly plumb trees is the giveaway that nothing grew there.
            euler.set(Math.cos(leanDir) * lean * rule.tilt, spin, Math.sin(leanDir) * lean * rule.tilt)
            quat.setFromEuler(euler)
            scaleV.set(s, s * tall, s)
            matrix.compose(pos, quat, scaleV)

            // Per-instance colour, not per rule: two trees side by side being
            // the same green is as flat as two hillsides being the same green.
            const drift = (shade - 0.5) * 2 * rule.colorJitter
            const colour = base.clone()
            colour.offsetHSL(drift * 0.05, drift * 0.12, drift * 0.16)

            out.push({
              kind: `${rule.kind}:${Math.min(rule.variants - 1, Math.floor(pick * rule.variants))}`,
              matrix: matrix.clone(),
              color: colour,
            })
          }
        }
      }
    }
    this.scatter = out
  }

  dispose() {
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.mesh)
      chunk.mesh.geometry.dispose()
    }
    this.chunks.clear()
    this.material.dispose()
  }
}

export const CHUNK_SIZE = CHUNK

/**
 * Deforms a geometry's vertices by a hash of their own position.
 *
 * An icosahedron reads as an icosahedron no matter what colour it is, and three
 * of them side by side read as three of the same icosahedron. Displacing each
 * vertex along its normal by a repeatable amount makes a boulder instead, and a
 * different seed makes a different boulder — at no runtime cost, because this
 * happens once per variant when the geometry is built.
 *
 * Non-indexed first, so each face gets its own vertices and the result is
 * faceted rather than smoothly lumpy. That matters: a smooth blob reads as
 * organic, and these are stone.
 */
function roughen(geometry: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  // Polyhedron geometries arrive non-indexed already; calling this on one logs
  // a warning on every variant built, three per kind, on every world entered.
  const g = geometry.getIndex() ? geometry.toNonIndexed() : geometry
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const moved = new Map<string, [number, number, number]>()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    // Keyed on the position, so vertices that were shared before the split are
    // displaced together and the surface does not tear open.
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`
    let d = moved.get(key)
    if (!d) {
      const n = valueNoise(x * 7.3 + seed, z * 7.3 - y * 4.1, seed)
      const k = 1 + (n - 0.5) * 2 * amount
      d = [x * k, y * k, z * k]
      moved.set(key, d)
    }
    pos.setXYZ(i, d[0], d[1], d[2])
  }
  g.computeVertexNormals()
  if (g !== geometry) geometry.dispose()
  return g
}

/**
 * Geometry per scatter kind and variant, built once and shared by its instances.
 *
 * Three silhouettes per kind rather than one. A stand of identical cones is the
 * single clearest tell that a scene was generated, and it costs nothing to
 * avoid — three geometries is three draw calls instead of one, against a scatter
 * that is already instanced.
 */
export function scatterGeometry(key: string): THREE.BufferGeometry {
  const [kind, index] = key.split(':')
  const v = Number(index) || 0
  switch (kind) {
    case 'tree':
      // Narrow conifer, broader conifer, and a rounded crown — enough that a
      // wood has a skyline rather than a sawtooth.
      if (v === 0) return new THREE.ConeGeometry(0.8, 4.2, 7, 1)
      if (v === 1) return new THREE.ConeGeometry(1.25, 2.9, 6, 1)
      return roughen(new THREE.IcosahedronGeometry(1.15, 0), 0.22, 11)
    case 'pillar':
      if (v === 0) return roughen(new THREE.CylinderGeometry(0.45, 1, 6, 6, 1), 0.16, 3)
      if (v === 1) return roughen(new THREE.CylinderGeometry(0.2, 0.8, 8, 5, 1), 0.2, 7)
      return roughen(new THREE.BoxGeometry(1.1, 5, 1.1), 0.12, 13)
    case 'tuft':
      // Deliberately crude and tiny: at this size a viewer reads density and
      // colour, never silhouette, so three cheap solids are enough and anything
      // more detailed is triangles spent where nobody looks.
      if (v === 0) return new THREE.ConeGeometry(0.4, 1.1, 4, 1)
      if (v === 1) return roughen(new THREE.TetrahedronGeometry(0.55, 0), 0.3, 41)
      return roughen(new THREE.IcosahedronGeometry(0.45, 0), 0.35, 43)
    case 'berg':
      if (v === 0) return roughen(new THREE.OctahedronGeometry(1, 0), 0.3, 5)
      if (v === 1) return roughen(new THREE.ConeGeometry(1.2, 2.2, 5, 1), 0.26, 17)
      return roughen(new THREE.DodecahedronGeometry(1, 0), 0.22, 23)
    default:
      // Boulders. Three different roughenings of three different solids, so a
      // scree slope is not one stone repeated two hundred times.
      if (v === 0) return roughen(new THREE.IcosahedronGeometry(1, 0), 0.34, 2)
      if (v === 1) return roughen(new THREE.DodecahedronGeometry(0.9, 0), 0.3, 19)
      return roughen(new THREE.OctahedronGeometry(1.1, 1), 0.38, 29)
  }
}
