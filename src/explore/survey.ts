import * as THREE from 'three'
import { buildRelief, type Relief } from './relief'
import { createRiverSurface, createWater, type Water } from './water'
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
 *
 * The mesh itself is `buildRelief`, shared with the ground view's backdrop.
 * What is left here is the framing: extent, the water, and the marker.
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
  const relief: Relief = buildRelief(spec, { extent: EXTENT, resolution: RESOLUTION })
  const group = new THREE.Group()
  group.add(relief.mesh)

  // The same animated surface the ground uses, at the overview's extent — the
  // river is the thing the overview is most often read for, and a still strip
  // of flat colour is exactly what it should not look like.
  const water: Water | null = relief.river
    ? createRiverSurface(relief.river, spec)
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
      marker.position.set(x, relief.height(x, z) + 130, z)
    },
    dispose() {
      relief.dispose()
      water?.dispose()
      markerGeometry.dispose()
      markerMaterial.dispose()
    },
  }
}
