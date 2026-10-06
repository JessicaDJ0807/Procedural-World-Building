import * as THREE from 'three'
import {
  classify,
  compileBands,
  createEnvironment,
  type CompiledBands,
  type Environment,
} from './environment'
import { createTerrain } from './river'
import { normalAt, valueNoise } from './terrain'
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
  private readonly bands: CompiledBands
  private readonly env: Environment
  readonly river: ReturnType<typeof createTerrain>['river']
  private readonly material: THREE.MeshStandardMaterial
  private centre = { cx: Number.NaN, cz: Number.NaN }

  readonly group = new THREE.Group()
  readonly stats: ChunkStats = { built: 0, live: 0, triangles: 0, lastBuildMs: 0 }
  /** Rebuilt whenever the ring changes; the viewport turns these into instances. */
  scatter: ScatterInstance[] = []

  private readonly spec: WorldSpec

  constructor(spec: WorldSpec) {
    this.spec = spec
    // One surface for the whole world: the river chooses its route from the
    // bare terrain and then cuts it, so height and river are built together and
    // everything downstream takes both from here.
    const built = createTerrain(spec.terrain, spec.river)
    this.height = built.height
    this.river = built.river
    this.env = createEnvironment(spec, this.height, built.river)
    this.bands = compileBands(spec.bands)
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

  /** The environment at a point: what the scatter rules are written against. */
  siteAt(x: number, z: number) {
    return this.env.sample(x, z)
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

        // height → slope → water → moisture → material, in that order and in
        // one call. The vertex colour is the end of that chain rather than a
        // separate opinion about what a height looks like.
        classify(
          this.bands,
          this.env.at(originX + i * step, originZ + j * step, y, normals[o + 1]),
          colors,
          o,
        )
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

            // `scale` is now the object's height in world units, because every
            // geometry is normalised to one unit. Before, the geometry carried
            // its own size too and the two multiplied — which is where the
            // 70-unit tree spikes came from.
            const s = rule.scale[0] + (rule.scale[1] - rule.scale[0]) * t
            const tall = rule.stretch[0] + (rule.stretch[1] - rule.stretch[0]) * shade
            // Width varies independently of height, and the two axes vary
            // independently of each other: a boulder wider than it is deep is
            // what stops it reading as a sphere.
            const wx = 1 + (roll - 0.5) * 2 * rule.squash
            const wz = 1 + (pick - 0.5) * 2 * rule.squash
            pos.set(x, y - rule.sink * s, z)
            // Lean away from vertical, in a direction of its own. A stand of
            // perfectly plumb trees is the giveaway that nothing grew there.
            euler.set(Math.cos(leanDir) * lean * rule.tilt, spin, Math.sin(leanDir) * lean * rule.tilt)
            quat.setFromEuler(euler)
            scaleV.set(s * wx, s * tall, s * wz)
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

export { propGeometry as scatterGeometry } from './props'
