import * as THREE from 'three'
import { D, W } from './town'

/** The lawn's green. */
export const LAWN = '#87a35c'

/**
 * The lawn scenario's ground: a clean, gently rolling lawn in a fresh,
 * slightly muted green, mown in stripes over the buildable grid so the grid reads
 * without lines drawn on it.
 *
 * The buildable area stays within a few centimetres of level — blocks stand
 * at y = 0 on their stone footings, which reach 0.4 down — and the lawn rolls
 * more, up to a third of a storey, beyond it.
 */

function noise(x: number, z: number): number {
  return (
    Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 - 0.4) * 0.6 +
    Math.sin(x * 0.53 - z * 0.37 + 2.1) * 0.25 +
    Math.cos(x * 0.11 + z * 0.13) * 0.15
  )
}

/** How far a point (town units) is outside the buildable grid, 0 inside. */
function outside(x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x) - W / 2)
  const dz = Math.max(0, Math.abs(z) - D / 2)
  return Math.hypot(dx, dz)
}

/** Ground height at a point, town units. */
export function lawnHeight(x: number, z: number): number {
  const out = Math.min(1, outside(x, z) / 6)
  return -0.06 + noise(x, z) * (0.04 + 0.3 * out * out)
}

export function lawnMesh(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(90, 90, 180, 180).rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const colours = new Float32Array(pos.count * 3)
  // A fresh, slightly muted green. The Site's lawn sage, under the golden
  // hour this page first had, rendered a murky olive-brown; under a clear
  // day a greener lawn reads as grass without competing with the plants.
  const base = new THREE.Color(LAWN)
  const light = base.clone().offsetHSL(0, 0.01, 0.018)
  const dark = base.clone().offsetHSL(0, 0, -0.012)
  const wild = base.clone().offsetHSL(0.01, -0.02, -0.04)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, lawnHeight(x, z))
    const out = outside(x, z)
    // Mown stripes, one per grid column, fading out past the edge into rougher grass.
    const stripe = Math.floor(x + W / 2) % 2 === 0 ? light : dark
    c.copy(stripe).lerp(wild, Math.min(1, out / 3))
    c.offsetHSL(0, 0, noise(x * 2.3, z * 2.3) * 0.015)
    c.toArray(colours, i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))
  mesh.receiveShadow = true
  return mesh
}
