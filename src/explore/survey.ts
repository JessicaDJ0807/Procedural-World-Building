import * as THREE from 'three'
import { classify, compileBands, createEnvironment } from './environment'
import { createRiverSurface, createWater, type Water } from './water'
import { createTerrain } from './river'
import type { WorldSpec } from './worlds'

/**
 * The world from above: one coarse mesh covering far more ground than the
 * chunk ring, built from the same height function.
 *
 * ## Why a separate mesh rather than a wider ring
 *
 * Seeing the whole landmark means covering about 4,000 units. At the chunk
 * ring's resolution that is 625 chunks and five million triangles, for a view
 * where a single triangle is smaller than a pixel. Sampling the same height
 * function on a coarse grid gives the same landform in 32,768 triangles — the
 * detail that is thrown away is detail the view could not resolve anyway.
 *
 * It is the same function, so the overview and the ground agree: the ridge you
 * can see from up here is the ridge you were standing on.
 *
 * ## Why it is not a texture
 *
 * A rendered map would be flat, and the thing worth showing from above is
 * relief — where the high ground is, how the valley runs, which way the islands
 * lie. Those read from shading, and shading needs geometry.
 */

/*
 * Tighter and finer than the first version, which was 4,200 units at 128 — 33
 * units a cell, on which a river 40 units wide is one cell and reads as a
 * smudge. At 3,400 and 192 a cell is 17.7 units, so the river has a shape and
 * the banks either side of it survive.
 */
const EXTENT = 3400
const RESOLUTION = 192

export type Survey = {
  group: THREE.Group
  /** Keeps the overview's water moving too, so it reads as water from above. */
  update(elapsed: number): void
  /** Moves the marker to where the camera left off on the ground. */
  setMarker(x: number, z: number): void
  /** Half-width of the ground covered, for framing the camera. */
  readonly extent: number
  dispose(): void
}

export function buildSurvey(spec: WorldSpec): Survey {
  const built = createTerrain(spec.terrain, spec.river)
  const height = built.height
  // The same classification the ground uses, so the overview and the walk
  // agree: the pale band you can see from up here is the bank you were just
  // standing on. It was a height ramp before, which quietly disagreed with
  // everything after the bands landed.
  const env = createEnvironment(spec, height, built.river)
  const bands = compileBands(spec.bands)
  const group = new THREE.Group()

  const n = RESOLUTION + 1
  const step = EXTENT / RESOLUTION
  const origin = -EXTENT / 2

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
      positions[o] = origin + i * step
      positions[o + 1] = y
      positions[o + 2] = origin + j * step

      const dx = (grid[g + 1] - grid[g - 1]) * inv
      const dz = (grid[g + m] - grid[g - m]) * inv
      const len = Math.hypot(-dx, 1, -dz) || 1
      normals[o] = -dx / len
      normals[o + 1] = 1 / len
      normals[o + 2] = -dz / len

      classify(bands, env.at(origin + i * step, origin + j * step, y, normals[o + 1]), colors, o)
    }
  }

  const indices = new Uint32Array(RESOLUTION * RESOLUTION * 6)
  let w = 0
  for (let j = 0; j < RESOLUTION; j++) {
    for (let i = 0; i < RESOLUTION; i++) {
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
  group.add(new THREE.Mesh(geometry, material))

  // The same animated surface the ground uses, at the overview's extent — the
  // river is the thing the overview is most often read for, and a still strip
  // of flat colour is exactly what it should not look like.
  const water: Water | null = built.river
    ? createRiverSurface(built.river, spec)
    : createWater(spec, EXTENT)
  if (water) group.add(water.mesh)

  // A pin rather than a dot: from above, a flat marker on sloping ground is
  // impossible to place in depth, and a vertical line reads its own height.
  const markerGeometry = new THREE.CylinderGeometry(3, 3, 260, 6)
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.75,
    // Drawn over the terrain: half the point of the marker is finding it, and
    // on a world with mountains it would otherwise hide behind one.
    depthTest: false,
  })
  const marker = new THREE.Mesh(markerGeometry, markerMaterial)
  marker.renderOrder = 2
  group.add(marker)

  return {
    group,
    extent: EXTENT / 2,
    update(elapsed) {
      water?.update(elapsed)
    },
    setMarker(x, z) {
      marker.position.set(x, height(x, z) + 130, z)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      water?.dispose()
      markerGeometry.dispose()
      markerMaterial.dispose()
    },
  }
}
