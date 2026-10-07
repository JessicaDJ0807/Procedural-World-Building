import * as THREE from 'three'
import { classify, compileBands, createEnvironment } from './environment'
import { createTerrain } from './river'
import type { WorldSpec } from './worlds'

/**
 * A coarse mesh of the height field over a square of ground.
 *
 * Two views need this and they need it for opposite reasons, which is why it is
 * one function rather than two:
 *
 * - The **survey** needs to cover far more ground than the chunk ring, from
 *   above, where a triangle is smaller than a pixel anyway.
 * - The **backdrop** needs to cover far more ground than the chunk ring, from
 *   *within*, because the chunk ring is 5×5×160 units — terrain exists only
 *   400 units from the camera, and this world's mountains are 1,300 units out.
 *   Without a backdrop there is no distance for them to stand in.
 *
 * Both want the same thing: the same height function, sampled coarsely, shaded
 * by the same bands. So the ridge on the horizon is the ridge the survey shows
 * and the ridge you would eventually walk onto, rather than three descriptions
 * of a world that only approximately agree.
 *
 * ## Why not simply widen the chunk ring
 *
 * Reaching 1,300 units at the ring's resolution is RADIUS 8 — 289 chunks
 * against 25, and 11× the build cost and triangle count, to draw ground whose
 * detail is well past what a pixel at that distance can hold. Measured: the
 * ring builds a chunk in 2–3 ms, so 264 extra chunks is over half a second of
 * hitching for detail nobody can see. This mesh is 51k triangles in one draw
 * call, built once.
 */

export type Relief = {
  mesh: THREE.Mesh
  /** The height function it was sampled from, for callers that need it too. */
  height: (x: number, z: number) => number
  river: ReturnType<typeof createTerrain>['river']
  dispose(): void
}

export type ReliefOptions = {
  /** Full width of the square of ground covered, in world units. */
  extent: number
  /** Cells per side. Vertices are one more than this. */
  resolution: number
  /**
   * Units to sink the mesh by.
   *
   * The backdrop samples the same height function as the chunk ring, so in the
   * near field the two surfaces are coincident and z-fight — a shimmer across
   * the whole ground, which is far more noticeable than anything the backdrop
   * adds. Sinking it means the detailed ring wins where both exist. At the 400
   * units where the ring ends, a 3-unit step subtends 0.4° and is invisible.
   *
   * It does *not* keep the backdrop under the ground everywhere, which this
   * comment used to claim. A sunk vertex is under the ground, but a triangle
   * between vertices is a straight line between them — and a river channel is
   * narrower than one 32.5-unit cell, so a triangle with corners on both banks
   * bridged the channel as a flat slab. Measured, it stood above the carved
   * riverbed at 24% of the points under Verdant's water, by up to 6.6 units,
   * and showed through the water as a dark wedge. See `belowGround`.
   */
  drop?: number
  /**
   * Near the river, place each vertex at the lowest ground within one cell of
   * it, instead of the ground at the vertex.
   *
   * Every point of a triangle lies within one cell of each of its three
   * corners, so if each corner is no higher than the lowest ground in that
   * reach, the whole triangle is no higher than the ground beneath it — the
   * bridge over the channel becomes impossible rather than merely unlikely.
   * The minimum is sampled on a 9×9 grid, 8 units apart, which is finer than
   * the flat middle of the narrowest channel. Only for the backdrop: the
   * overview *is* the terrain at its scale and must not be lowered.
   */
  belowGround?: boolean
}

/** Samples per side of the window `belowGround` takes its minimum over. */
const ENVELOPE_SAMPLES = 9

export function buildRelief(spec: WorldSpec, options: ReliefOptions): Relief {
  const { extent, resolution, drop = 0, belowGround = false } = options
  const built = createTerrain(spec.terrain, spec.river)
  const height = built.height
  // The same classification the ground uses, so the pale band on the horizon is
  // the bank you were just standing on.
  const env = createEnvironment(spec, height, built.river)
  const bands = compileBands(spec.bands)

  const n = resolution + 1
  const step = extent / resolution
  const origin = -extent / 2

  const positions = new Float32Array(n * n * 3)
  const normals = new Float32Array(n * n * 3)
  const colors = new Float32Array(n * n * 3)

  // One extra ring, so the normals at the edge are differenced the same way as
  // everywhere else rather than going one-sided and lighting the border wrong.
  const m = n + 2
  const grid = new Float32Array(m * m)
  for (let j = 0; j < m; j++) {
    const z = origin + (j - 1) * step
    for (let i = 0; i < m; i++) grid[j * m + i] = height(origin + (i - 1) * step, z)
  }

  const inv = 1 / (2 * step)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const g = (j + 1) * m + (i + 1)
      const y = grid[g]
      const o = (j * n + i) * 3
      const vx = origin + i * step
      const vz = origin + j * step
      let floor = y
      // Only where the river's carve can reach a triangle touching this vertex.
      if (belowGround && built.river?.at(vx, vz, built.river.spec.influence + step * 1.5)) {
        for (let b = 0; b < ENVELOPE_SAMPLES; b++) {
          const sz = vz - step + (2 * step * b) / (ENVELOPE_SAMPLES - 1)
          for (let a = 0; a < ENVELOPE_SAMPLES; a++) {
            const h = height(vx - step + (2 * step * a) / (ENVELOPE_SAMPLES - 1), sz)
            if (h < floor) floor = h
          }
        }
      }
      positions[o] = vx
      positions[o + 1] = floor - drop
      positions[o + 2] = origin + j * step

      const dx = (grid[g + 1] - grid[g - 1]) * inv
      const dz = (grid[g + m] - grid[g - m]) * inv
      const len = Math.hypot(-dx, 1, -dz) || 1
      normals[o] = -dx / len
      normals[o + 1] = 1 / len
      normals[o + 2] = -dz / len

      // Classified at the true height, not the dropped one: the drop is a
      // depth-buffer trick and must not move a shoreline.
      classify(bands, env.at(origin + i * step, origin + j * step, y, normals[o + 1]), colors, o)
    }
  }

  const indices = new Uint32Array(resolution * resolution * 6)
  let w = 0
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
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
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.02,
  })

  const mesh = new THREE.Mesh(geometry, material)
  // It covers the whole world, so it is never off-screen and the frustum test
  // can only cost time. More to the point, a camera inside its bounding box
  // gets the wrong answer often enough to make the horizon blink.
  mesh.frustumCulled = false

  return {
    mesh,
    height,
    river: built.river,
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
