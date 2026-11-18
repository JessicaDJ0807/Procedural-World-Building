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

const smooth01 = (t: number) => {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

/** How far a point (town units) is outside the buildable grid, 0 inside. */
export function outside(x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x) - W / 2)
  const dz = Math.max(0, Math.abs(z) - D / 2)
  return Math.hypot(dx, dz)
}

/** Ground height at a point, town units. */
export function lawnHeight(x: number, z: number): number {
  const out = Math.min(1, outside(x, z) / 6)
  return -0.06 + noise(x, z) * (0.04 + 0.3 * out * out)
}

/** The lawn's extent, units: wide enough that the fog, not an edge, ends it. */
export const LAWN_SIZE = 320
const SEGMENTS = 300

/**
 * A grid coordinate in −1…1 to a position: x = 70u + 90u³, so vertices are
 * 0.47 apart at the centre (fine enough for a stripe per grid column) and 2.3
 * at the edge, where the land is far off and hazed — 90,601 vertices for a
 * 320-unit field rather than 640,000 at even spacing.
 */
const spread = (u: number) => 70 * u + 90 * u * u * u

/** The grid coordinate (−1…1) of a position: `spread` inverted by Newton's method. */
function unspread(x: number): number {
  let u = x / 160
  for (let k = 0; k < 8; k++) u -= (spread(u) - x) / (70 + 270 * u * u)
  return Math.max(-1, Math.min(1, u))
}

/**
 * The lawn mesh's own surface at a point: the height of the triangle drawn there,
 * interpolated exactly as the GPU does, from `height` at its three corners.
 * Anything laid flat on the ground — a footpath — follows this rather than the
 * true terrain, which between vertices can sit a few centimetres above or below
 * the drawn triangles, enough to bury a ribbon or float it.
 */
export function surfaceHeight(x: number, z: number, height: (x: number, z: number) => number): number {
  const fx = ((unspread(x) + 1) / 2) * SEGMENTS
  const fz = ((unspread(z) + 1) / 2) * SEGMENTS
  const ix = Math.min(SEGMENTS - 1, Math.floor(fx))
  const iz = Math.min(SEGMENTS - 1, Math.floor(fz))
  const x0 = spread((ix / SEGMENTS) * 2 - 1), x1 = spread(((ix + 1) / SEGMENTS) * 2 - 1)
  const z0 = spread((iz / SEGMENTS) * 2 - 1), z1 = spread(((iz + 1) / SEGMENTS) * 2 - 1)
  const tx = (x - x0) / (x1 - x0)
  const tz = (z - z0) / (z1 - z0)
  // PlaneGeometry splits each quad along the (ix, iz+1)–(ix+1, iz) diagonal.
  const a = height(x0, z0), b = height(x0, z1), d = height(x1, z0)
  if (tx + tz <= 1) return a + (d - a) * tx + (b - a) * tz
  const c = height(x1, z1)
  return c + (b - c) * (1 - tx) + (d - c) * (1 - tz)
}

/**
 * The ground mesh: the town's lawn — mown stripes over the buildable grid,
 * rougher grass just outside — easing into the landscape's own colours and
 * hills (landscape.ts) further out. `landscape` gives height and colour; with
 * none, the land is the town's ground alone.
 */
export function lawnMesh(landscape?: GroundSource): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(2, 2, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2)
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3))
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))
  mesh.receiveShadow = true
  shapeLawn(mesh, landscape)
  return mesh
}

/** What the lawn needs from a landscape. */
export type GroundSource = {
  height: (x: number, z: number) => number
  colour: (x: number, z: number, out: [number, number, number]) => [number, number, number]
  meadowPatch?: (x: number, z: number) => number
  /** −1…1: a broad, slow shift in the grass's green. */
  broadTone?: (x: number, z: number) => number
  /** 0–1: the low ground cover's patches. */
  groundCover?: (x: number, z: number) => number
  /** How far to lower the lawn here, under something finer laid over it (the stream's banks). */
  lawnSink?: (x: number, z: number) => number
}

/** Lays the lawn's vertices and colours over a landscape — in place, so its owners (ground cover, seasons) keep the same mesh. */
export function shapeLawn(mesh: THREE.Mesh, landscape?: GroundSource) {
  const geo = mesh.geometry
  const pos = geo.attributes.position
  const colours = geo.attributes.color.array as Float32Array
  // A fresh, slightly muted green. The Site's lawn sage, under the golden
  // hour this page first had, rendered a murky olive-brown; under a clear
  // day a greener lawn reads as grass without competing with the plants.
  const base = new THREE.Color(LAWN)
  // Half the contrast they had (+0.018 / −0.012): the stripes cover the whole 14 × 14 grid,
  // most of the meadow in the opening view, and at full strength they made it a sports lawn.
  // Faint, they still show where the grid is.
  const light = base.clone().offsetHSL(0, 0.005, 0.009)
  const dark = base.clone().offsetHSL(0, 0, -0.006)
  const wild = base.clone().offsetHSL(0.01, -0.02, -0.04)
  const c = new THREE.Color()
  const field = new THREE.Color()
  const rgb: [number, number, number] = [0, 0, 0]
  const row = SEGMENTS + 1
  for (let i = 0; i < pos.count; i++) {
    const x = spread((i % row) / SEGMENTS * 2 - 1)
    const z = spread(Math.floor(i / row) / SEGMENTS * 2 - 1)
    pos.setXYZ(i, x, landscape ? landscape.height(x, z) - (landscape.lawnSink?.(x, z) ?? 0) : lawnHeight(x, z), z)
    const out = outside(x, z)
    // Mown stripes, one per grid column, fading out past the edge into rougher grass…
    const stripe = Math.floor(x + W / 2) % 2 === 0 ? light : dark
    c.copy(stripe).lerp(wild, Math.min(1, out / 3))
    c.offsetHSL(0, 0, noise(x * 2.3, z * 2.3) * 0.015)
    // The meadow's patches reach faintly onto the grid too — colour only, never anything that
    // stands: a lighter, yellower drift here, a deeper green there, weaker than the stripes'
    // own contrast near their middle, so the open ground between the buildings isn't one flat
    // green and the grid still reads.
    if (landscape?.meadowPatch) {
      const patch = landscape.meadowPatch(x, z) - 0.5
      c.offsetHSL(patch * 0.012, patch * 0.04, patch * 0.03)
    }
    // And the meadow's broad tone, about 30 units across: the whole lawn a touch yellower toward
    // one side and deeper toward the other, so it isn't one flat green between the buildings.
    if (landscape?.broadTone) {
      const broad = landscape.broadTone(x, z)
      c.offsetHSL(broad * 0.01, broad * 0.03, broad * 0.022)
    }
    // The ground cover's patches on the lawn: a little deeper green under them, colour only.
    if (landscape?.groundCover && out < 2) {
      const cover = smooth01((landscape.groundCover(x, z) - 0.66) / 0.2)
      c.offsetHSL(0.005 * cover, 0.02 * cover, -0.03 * cover)
    }
    // …and that into the land's own colours, from moisture, fertility and height.
    if (landscape && out > 1) {
      landscape.colour(x, z, rgb)
      // The palette is sRGB hex: read as linear it came out washed-out and pale.
      field.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace).offsetHSL(0, 0, noise(x * 2.3, z * 2.3) * 0.012)
      c.lerp(field, Math.min(1, (out - 1) / 5))
    }
    c.toArray(colours, i * 3)
  }
  pos.needsUpdate = true
  geo.attributes.color.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
}
