import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../noise'
import type { Line } from './features'
import type { SeasonLook } from './seasonFx'
import { surfaceHeight } from './lawn'
import { CROOKED, EVERGREEN, KINDS, bankStones, bloomHue, clearingAccents, type Accent, landmarks, streamRocks, SLENDER, SPIRE, TREE_VARIANTS, WEEPING, isEvergreen, scatter, scatterTrees, type Density, type Kind, type Landscape, type Placement, type Tree } from './landscape'

/**
 * The landscape's decorations, drawn: grass tufts, shrubs, rocks and flowers,
 * where `scatter` (landscape.ts) puts them. One InstancedMesh per kind (two
 * for flowers: stem and head) — six draw calls for every decoration on the
 * land, however many there are. Geometry is built once, low-poly and flat
 * shaded to sit with the town's clean blocks; colour comes per instance.
 *
 * Purely visual: none of it is raycast (each mesh's `raycast` does nothing,
 * and the viewport's picking never lists it), none is plantable or walkable,
 * and the simulation never reads it.
 */

const noRaycast = () => {}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Blades fanning from a point: a tuft about 0.3 units tall. Their normals point
 * straight up, so a tuft is lit like the ground under it — with true normals
 * the blades faced sideways, caught little light, and read as dark weeds.
 */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const rand = mulberry32(17)
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + rand() * 0.6
    const lean = 0.45 + rand() * 0.45
    const h = 0.12 + rand() * 0.1
    const w = 0.05
    const tx = Math.cos(a) * lean * h
    const tz = Math.sin(a) * lean * h
    const px = -Math.sin(a) * w
    const pz = Math.cos(a) * w
    // Each blade twice, once each winding, drawn front-side only: a double-sided
    // material flips the normal for the back face, and half the blades went dark.
    pos.push(px, 0, pz, -px, 0, -pz, tx, h, tz, -px, 0, -pz, px, 0, pz, tx, h, tz)
    // Darker at the base, so a tuft reads with no light at all.
    for (let side = 0; side < 2; side++) col.push(0.8, 0.84, 0.78, 0.8, 0.84, 0.78, 1, 1, 0.97)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: pos.length / 3 }, () => [0, 1, 0]).flat(), 3))
  return g
}

/** A lumpy low-poly ball, its vertices pushed in and out by a seeded jitter. */
function lumpy(radius: number, detail: number, jitter: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail)
  const p = g.attributes.position
  const rand = mulberry32(seed)
  // Same-position vertices must move together, or the faces split.
  const moved = new Map<string, number>()
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`
    let k = moved.get(key)
    if (k === undefined) moved.set(key, (k = 1 + (rand() - 0.5) * jitter))
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k)
  }
  return g.toNonIndexed()
}

function withColour(g: THREE.BufferGeometry, rgb: [number, number, number]): THREE.BufferGeometry {
  const n = g.attributes.position.count
  const c = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) c.set(rgb, i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}

/**
 * Shades a foliage mass from its own shape: darker low and toward its core,
 * lighter on top and at the rim — a cheap stand-in for light through leaves,
 * so a crown reads as foliage, not a solid with dark facets.
 */
function shadeFoliage(g: THREE.BufferGeometry, centre: THREE.Vector3, height: number): THREE.BufferGeometry {
  const p = g.attributes.position
  const c = new Float32Array(p.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const up = Math.min(1, Math.max(0, (v.y - centre.y) / height + 0.5))
    const out = Math.min(1, v.distanceTo(centre) / (height * 0.7))
    const k = 0.62 + 0.28 * up + 0.12 * out
    c.set([k, k, k * 0.96], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}

/** Smooth-shaded leafy balls (normals kept from the sphere, so they shade softly). */
function blob(r: number, x: number, y: number, z: number, seed: number, detail = 1): THREE.BufferGeometry {
  return lumpy(r, detail, 0.22, seed).translate(x, y, z)
}

/**
 * A blob squashed or stretched about its own centre, then placed. Every flattened clump was
 * once `blob(…).scale(…)` — placed, then scaled about the origin — which scaled its height off
 * the ground too: a slender tree's leaf clumps sank down its branches (the bare twig tips
 * poking above its crown were the branches' ends), and the weeping tree's dome sank into its
 * curtain, which read as a barrel.
 */
function shaped(r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, seed: number): THREE.BufferGeometry {
  return lumpy(r, 1, 0.22, seed).scale(sx, sy, sz).translate(x, y, z)
}

/**
 * A shrub: five to six small leafy balls in a low mound, about 1 unit across
 * at scale 1 and 0.7 high. The first version was two big faceted lumps, flat
 * shaded, which read as dark rocks.
 */
function shrubGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(31)
  const parts: THREE.BufferGeometry[] = []
  const n = 6
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rand() * 0.5
    const d = k === 0 ? 0 : 0.28 + rand() * 0.12
    parts.push(blob(0.26 + rand() * 0.1, Math.cos(a) * d, 0.24 + (k === 0 ? 0.14 : rand() * 0.08), Math.sin(a) * d, 40 + k))
  }
  return shadeFoliage(mergeGeometries(parts)!, new THREE.Vector3(0, 0.3, 0), 0.7)
}

/** A second shrub shape: low and spreading, wider than tall — so the edge isn't one repeated mound. */
function lowShrubGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(57)
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 7; k++) {
    const a = rand() * Math.PI * 2
    const d = 0.15 + rand() * 0.45
    parts.push(shaped(0.2 + rand() * 0.08, 1, 0.75, 1, Math.cos(a) * d, 0.12 + rand() * 0.06, Math.sin(a) * d, 60 + k))
  }
  return shadeFoliage(mergeGeometries(parts)!, new THREE.Vector3(0, 0.18, 0), 0.4)
}

/**
 * A third shrub shape: tall and upright, about 1.4 high — a hazel or an elder,
 * the layer between the shrubs and the young trees at the forest's edge.
 */
function tallShrubGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(93)
  const parts: THREE.BufferGeometry[] = []
  // A vase: clumps scattered through the volume, narrow at the foot and spreading toward the
  // top. Nine clumps one above another, as at first, read as a column of balls.
  for (let k = 0; k < 11; k++) {
    const a = rand() * Math.PI * 2
    const h = rand()
    const d = (0.1 + 0.42 * h) * (0.55 + rand() * 0.5)
    parts.push(blob(0.22 + 0.08 * h + rand() * 0.05, Math.cos(a) * d, 0.35 + 0.85 * h, Math.sin(a) * d, 90 + k))
  }
  return shadeFoliage(mergeGeometries(parts)!, new THREE.Vector3(0, 0.7, 0), 1.3)
}

/** A fern: eight fronds arching out and down from a crown — each a tapering strip, bent. */
function fernGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(71)
  const pos: number[] = []
  const col: number[] = []
  for (let f = 0; f < 8; f++) {
    const a = (f / 8) * Math.PI * 2 + rand() * 0.4
    const len = 0.32 + rand() * 0.14
    const rise = 0.16 + rand() * 0.08
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const side = new THREE.Vector3(-dir.z, 0, dir.x)
    const SEG = 5
    const at = (t: number) => dir.clone().multiplyScalar(len * t).add(new THREE.Vector3(0, rise * Math.sin(t * Math.PI * 0.75), 0))
    for (let k = 0; k < SEG; k++) {
      const t0 = k / SEG
      const t1 = (k + 1) / SEG
      const w0 = 0.07 * (1 - t0) + 0.01
      const w1 = 0.07 * (1 - t1) + 0.01
      const p0 = at(t0), p1 = at(t1)
      const a0 = p0.clone().addScaledVector(side, w0), b0 = p0.clone().addScaledVector(side, -w0)
      const a1 = p1.clone().addScaledVector(side, w1), b1 = p1.clone().addScaledVector(side, -w1)
      for (const v of [a0, b0, a1, b0, b1, a1, b0, a0, a1, b1, b0, a1]) pos.push(v.x, v.y, v.z)
      const shade = 0.75 + 0.3 * t0
      for (let i = 0; i < 12; i++) col.push(shade, shade, shade * 0.95)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  // Lit like the ground, as the grass is: thin fronds with true normals go dark from half the angles.
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: pos.length / 3 }, () => [0, 1, 0]).flat(), 3))
  return g
}

/** A sapling: a thin stem and two small leaf clumps, about 0.9 high — a tree starting out. */
function saplingGeometry(): THREE.BufferGeometry {
  const stem = branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.04, 0.85, 0.02), 0.025)
  const leaves = shadeFoliage(mergeGeometries([shaped(0.2, 1, 0.85, 1, 0.04, 0.88, 0.02, 81), blob(0.15, 0.13, 0.62, -0.05, 82)])!, new THREE.Vector3(0, 0.75, 0), 0.6)
  return mergeGeometries([stem, leaves])!
}

// --- trees: a trunk, and a crown in one of four shapes, sharing the trunk's matrix ---

/** A trunk 1 unit tall, tapering, its base flared a little; crowns sit from ~0.7 up. */
function trunkGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.06, 0.1, 1.1, 6, 2).translate(0, 0.55, 0)
  return withColour(g.toNonIndexed(), [0.46, 0.38, 0.3])
}

/**
 * How long each family's trunk is (×1.1 units at scale 1): the crown geometry
 * below is built to sit on it. Slender trees stand on long bare trunks;
 * evergreens' lowest tier nearly reaches the ground.
 */
// The broad trunk reaches up into its crown (it stopped short of it, leaving a bare stem under a cap).
// Fir and spire stand on short stems (their lowest tiers nearly reach the ground); the crooked
// tree's straight trunk is short, and its crown geometry carries the bend on up.
const TRUNK_LENGTH = [1.3, 1.9, 1.25, 0.55, 0.5, 0.85]
/**
 * How far out a tree can still fall in the sun's shadow map. The map is ±19 units round the
 * origin, square to a sun 38° up on any azimuth: a point is in it only within 19√2 ≈ 26.9 of
 * the light's axis. A ground point r out lies at least r·sin 38° − h·cos 38° from that axis,
 * and with a tree top up to 13 units above the town's ground (ridge plus tree) that passes
 * 26.9 at r ≈ 60. Beyond it a tree can't cast a shadow anyone sees, so it doesn't try.
 */
const SHADOW_REACH = 60

/** Rough crown radius at scale 1, for the contact shadow under it. */
export const CROWN_RADIUS = [1.25, 0.55, 1.0, 0.75, 0.45, 0.9]

/** A tapering branch from a to b, as a thin tube, in bark colour. */
function branch(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b)
  const g = new THREE.CylinderGeometry(r * 0.55, r, len, 5, 1, true).translate(0, len / 2, 0)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
  g.translate(a.x, a.y, a.z)
  return withColour(g.toNonIndexed(), [0.42, 0.36, 0.3])
}

function crownGeometry(variant: number): THREE.BufferGeometry {
  const rand = mulberry32(100 + variant * 17)
  const parts: THREE.BufferGeometry[] = []
  if (variant === EVERGREEN) {
    // Six tiers, each a cone with a hem that dips and a little offset and tilt, so the outline is
    // stepped and ragged rather than a stack of perfect discs; the top tier a narrow spike.
    for (let k = 0; k < 6; k++) {
      const f = k / 5
      const r = 0.78 * (1 - f * 0.82) * (0.9 + rand() * 0.2)
      const h = 0.62 - f * 0.2
      const cone = new THREE.ConeGeometry(r, h, 9, 1, true)
      const p = cone.attributes.position
      // The hem's vertices pushed down and out a little, unevenly: drooping boughs.
      for (let i = 0; i < p.count; i++) if (p.getY(i) < -h / 2 + 1e-3) { const w = 0.85 + rand() * 0.35; p.setXYZ(i, p.getX(i) * w, p.getY(i) - rand() * 0.08, p.getZ(i) * w) }
      cone.rotateZ((rand() - 0.5) * 0.12).translate((rand() - 0.5) * 0.06, 0.45 + k * 0.4 + h / 2, (rand() - 0.5) * 0.06)
      parts.push(cone.toNonIndexed())
    }
    return shadeFoliage(mergeGeometries(parts)!, new THREE.Vector3(0, 1.6, 0), 2.6)
  }
  if (variant === SPIRE) {
    // A tall, narrow conifer: nine tight tiers tapering to a long point, about 3.6 high at
    // scale 1 — a spruce against the fir's broader, shorter steps.
    for (let k = 0; k < 9; k++) {
      const f = k / 8
      const r = 0.46 * (1 - f * 0.88) * (0.9 + rand() * 0.2)
      const h = 0.5 - f * 0.12
      const cone = new THREE.ConeGeometry(r, h, 8, 1, true)
      const p = cone.attributes.position
      for (let i = 0; i < p.count; i++) if (p.getY(i) < -h / 2 + 1e-3) { const w = 0.85 + rand() * 0.3; p.setXYZ(i, p.getX(i) * w, p.getY(i) - rand() * 0.06, p.getZ(i) * w) }
      cone.rotateZ((rand() - 0.5) * 0.08).translate((rand() - 0.5) * 0.04, 0.35 + k * 0.34 + h / 2, (rand() - 0.5) * 0.04)
      parts.push(cone.toNonIndexed())
    }
    return shadeFoliage(mergeGeometries(parts)!, new THREE.Vector3(0, 1.8, 0), 3.2)
  }
  if (variant === CROOKED) {
    // A crooked tree: the trunk bends away as it rises, a side limb forks off, and the
    // foliage sits on them in flat, layered pads — a windswept pine, an accent, not a forest.
    const knee = new THREE.Vector3(0.12, 0.95, 0.02)
    const elbow = new THREE.Vector3(0.55, 1.75, 0.08)
    const top = new THREE.Vector3(0.95, 2.25, -0.05)
    const limb = new THREE.Vector3(-0.35, 1.85, 0.3)
    parts.push(branch(new THREE.Vector3(0, 0.85, 0), knee, 0.08), branch(knee, elbow, 0.07), branch(elbow, top, 0.05), branch(knee.clone().lerp(elbow, 0.5), limb, 0.04))
    // Each pad a cluster of small flattened clumps round a branch end, not one slab.
    const pads: THREE.BufferGeometry[] = []
    let seed = 501
    for (const [c, r] of [[top, 0.5], [elbow.clone().add(new THREE.Vector3(0.05, 0.12, 0.18)), 0.36], [limb, 0.4]] as [THREE.Vector3, number][])
      for (let j = 0; j < 4; j++) {
        const a = (j / 4) * Math.PI * 2 + rand()
        const d = j === 0 ? 0 : r * 0.55
        pads.push(shaped(r * (j === 0 ? 0.6 : 0.45), 1, 0.5, 1, c.x + Math.cos(a) * d, c.y + 0.1 + (j === 0 ? 0.06 : 0), c.z + Math.sin(a) * d, seed++))
      }
    const foliage = shadeFoliage(mergeGeometries(pads)!, new THREE.Vector3(0.4, 2.0, 0), 1.0)
    return mergeGeometries([...parts, foliage])!
  }
  if (variant === WEEPING) {
    // A rounded crown, and a curtain of foliage hanging from its rim nearly to the ground.
    parts.push(shaped(0.62, 1.25, 0.7, 1.25, 0, 1.68, 0, 300))
    const n = 14
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rand() * 0.3
      const r = 0.68 + rand() * 0.12
      const len = 1.0 + rand() * 0.45
      parts.push(lumpy(0.2, 1, 0.25, 320 + k).scale(1, len / 0.4, 1).translate(Math.cos(a) * r, 1.62 - len / 2 + 0.1, Math.sin(a) * r))
    }
    return shadeFoliage(mergeGeometries(parts)!, new THREE.Vector3(0, 1.4, 0), 1.8)
  }
  if (variant === SLENDER) {
    // A slender tree: the trunk carries on up as a leader, three or four thin branches
    // rise from it at different heights and angles, and each ends in a small, flattened
    // leaf clump — a light, open crown you can see sky through. The first version stacked
    // spheres up the trunk, which read as a column of balls.
    const top = new THREE.Vector3(0.05, 3.15, -0.03)
    const base = new THREE.Vector3(0, 2.0, 0)
    const leaves: THREE.BufferGeometry[] = []
    parts.push(branch(base, top, 0.045))
    leaves.push(shaped(0.36, 1, 0.8, 1, top.x, top.y + 0.1, top.z, 410))
    const nb = 4
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * Math.PI * 2 + rand() * 0.9
      const y = 2.05 + k * 0.28 + rand() * 0.15
      const len = 0.45 + rand() * 0.35
      const from = new THREE.Vector3(0, y, 0)
      const to = new THREE.Vector3(Math.cos(a) * len, y + 0.35 + rand() * 0.25, Math.sin(a) * len)
      parts.push(branch(from, to, 0.025))
      leaves.push(shaped(0.28 + rand() * 0.1, 1, 0.72, 1, to.x, to.y + 0.06, to.z, 420 + k))
    }
    const foliage = shadeFoliage(mergeGeometries(leaves)!, new THREE.Vector3(0, 2.7, 0), 1.4)
    return mergeGeometries([...parts, foliage])!
  }
  // Broad: a wide canopy of leafy clumps, lopsided — heavier on one side, its top uneven —
  // so it isn't a symmetric dome; each tree turns and stretches it differently.
  const shape = { n: 16, rx: 1.0, ry: 0.42, cy: 1.75, r: 0.55 }
  for (let k = 0; k < shape.n; k++) {
    const a = rand() * Math.PI * 2
    const d = k === 0 ? 0 : 0.45 + rand() * 0.55
    const lean = Math.cos(a) > 0 ? 1.25 : 0.85
    parts.push(blob(shape.r * (0.65 + rand() * 0.55), Math.cos(a) * shape.rx * d * lean, shape.cy + (rand() - 0.5) * 2 * shape.ry + (Math.cos(a) > 0 ? 0.1 : -0.05), Math.sin(a) * shape.rx * d, 200 + k))
  }
  const g = mergeGeometries(parts)!
  // The underside flattened a little, so it reads as a spreading roof, not a ball.
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) if (p.getY(i) < shape.cy - 0.3) p.setY(i, shape.cy - 0.3 - (shape.cy - 0.3 - p.getY(i)) * 0.7)
  return shadeFoliage(g, new THREE.Vector3(0, shape.cy, 0), 0.9 + shape.ry * 2)
}

/** A soft round shadow, darkest at the centre, for under trees and shrubs. */
function contactTexture(): THREE.Texture {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2)
      const a = Math.max(0, 1 - d) ** 1.6
      data.set([0, 0, 0, Math.round(a * 255)], (y * size + x) * 4)
    }
  const t = new THREE.DataTexture(data, size, size)
  t.needsUpdate = true
  return t
}

/**
 * Trees near the camera dissolve (a dithered fade over the last few units), so
 * orbiting low or zooming out past the meadow's edge never puts a trunk or a
 * crown across the view. Screen-door dithering, not transparency: no sorting,
 * and shadows unaffected.
 */
function fadeNearCamera(material: THREE.Material, uniforms: { uFadeCam: { value: THREE.Vector3 }; uFadeR: { value: number } }) {
  const inner = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    inner.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = 'varying vec3 vFadeWorld;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_INSTANCING
        vFadeWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vFadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`,
    )
    shader.fragmentShader = 'uniform vec3 uFadeCam;\nuniform float uFadeR;\nvarying vec3 vFadeWorld;\n' + shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      {
        float fade = smoothstep(uFadeR * 0.35, uFadeR, distance(vFadeWorld, uFadeCam));
        float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (fade < dither) discard;
      }`,
    )
  }
  material.customProgramCacheKey = () => 'fade-near-camera'
}

/** A small stone: a lumpy, flattened pebble, 1 across at scale 1 (they stand at 0.1–0.22). */
function stoneGeometry(): THREE.BufferGeometry {
  return withColour(lumpy(0.5, 0, 0.3, 17).scale(1, 0.55, 0.8).translate(0, 0.1, 0), [1, 1, 1])
}

function rockGeometry(): THREE.BufferGeometry {
  return withColour(lumpy(0.5, 0, 0.45, 9).scale(1, 0.6, 0.85).translate(0, 0.12, 0), [1, 1, 1])
}

function stemGeometry(): THREE.BufferGeometry {
  return withColour(new THREE.CylinderGeometry(0.008, 0.012, 0.2, 4, 1, true).translate(0, 0.1, 0), [1, 1, 1])
}

/** A small flower head: five petals round a centre, facing up. */
function headGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2
    parts.push(withColour(new THREE.SphereGeometry(0.03, 5, 3).scale(1, 0.35, 0.6).translate(0.032, 0, 0).rotateY(a).toNonIndexed(), [1, 1, 1]))
  }
  parts.push(withColour(new THREE.SphereGeometry(0.018, 5, 3).toNonIndexed(), [0.78, 0.68, 0.38]))
  return mergeGeometries(parts)!
}

// Close to the lawn's own greens: tufts add texture, not contrast.
const GRASS_TONES = ['#7f9a54', '#87a25b', '#7a9550', '#8ea85f', '#76914e']
// Lighter and softer than the first shrubs, which went near-black in shade.
const SHRUB_TONES = ['#7f9a58', '#87a05e', '#738f52', '#8fa463', '#6f8a50']
// Each family its own green: the broad canopy deep, the slender tree light and yellowish,
// the weeping tree pale silver-green, evergreens cool and dark.
const FAMILY_TONES = [
  ['#78964f', '#7f9b54', '#71904c', '#86a05a'],
  ['#9fb468', '#a7ba6f', '#97ae62'],
  ['#a2b083', '#9aab7c', '#aab78b'],
  ['#56735a', '#5d7a5d', '#506d55'],
  // The spire darker and bluer than the fir, so the two conifers read apart in a stand.
  ['#4b6754', '#52705a', '#47634f'],
  // The crooked tree an olive pine green, lighter than the firs so its pads read as foliage, not shadow.
  ['#7d9561', '#768e5b', '#869c68'],
]
const FERN_TONES = ['#6f8f4c', '#78974f', '#668748']
const SAPLING_TONES = ['#8aa65a', '#93ac60', '#80a056']
const TRUNK_TONES = ['#8a7560', '#7d6a57', '#94806a']
// The slender tree's pale bark, like a birch's.
const PALE_BARK = ['#d9d3c5', '#cfc8b8']
// Reeds a little greyer than the grass (yellower, they read as straw).
const REED_TONES = ['#7f9656', '#88a05c', '#768e52', '#91a462']
// River stones: smooth, muted grey and beige.
const RIVER_STONE_TONES = ['#a39f94', '#b2aa98', '#93918a', '#bdb5a2']
// Paler and warmer than the rocks: field stones turned up by the path.
const STONE_TONES = ['#b9b19f', '#aaa391', '#c3baa6', '#9f9988']
const ROCK_TONES = ['#a6a092', '#9a958a', '#b3ab9a', '#8f8b82', '#aaa294']
// Soft and muted, so they sit in the palette: creamy white, lavender, pale pink, muted yellow, and
// an occasional soft blue — in that order, matching `bloomHue` and the washes under the drifts.
const FLOWER_COLOURS = ['#ece4c8', '#b3a6cf', '#e0b5c0', '#d6c47a', '#8fa6cc']
// Stones with moss on them: greener and darker than the rocks.
const MOSSY_TONES = ['#8a957a', '#7e8c6e', '#94a080']
// The flowering shrub's blossom: pale pink and white, like hawthorn or wild rose.
const BLOSSOM_TONES = ['#f0d6dc', '#f4ece6', '#e8c4cf']
const CLOVER_TONES = ['#6e9150', '#78994f', '#668a4b', '#82a058']

export class LandscapeDecor {
  readonly group = new THREE.Group()
  private geometries: Record<Kind | 'head' | 'lowShrub' | 'tallShrub', THREE.BufferGeometry>
  private materials: { grass: THREE.MeshStandardMaterial; soft: THREE.MeshStandardMaterial; shrub: THREE.MeshStandardMaterial; fern: THREE.MeshStandardMaterial; flat: THREE.MeshStandardMaterial; foliage: THREE.MeshStandardMaterial; ever: THREE.MeshStandardMaterial; trunk: THREE.MeshStandardMaterial }
  private crowns: THREE.BufferGeometry[]
  private trunk: THREE.BufferGeometry
  private contact: { geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial; tex: THREE.Texture }
  /** The camera's position, for the near-camera fade, and over what distance trees dissolve. */
  private fade = { uFadeCam: { value: new THREE.Vector3(0, 1000, 0) }, uFadeR: { value: 5 } }
  /** How many trees stand. */
  trees = 0
  private meshes: THREE.InstancedMesh[] = []
  /** How many of each were placed, for the controls and tests. */
  counts: Record<Kind, number> = { grass: 0, shrub: 0, rock: 0, flower: 0, fern: 0, sapling: 0, stone: 0, reed: 0, litter: 0, clover: 0 }
  /** How long the last build took, ms. */
  ms = 0

  constructor() {
    this.group.name = 'landscape decorations'
    this.group.add(this.floating.mesh)
    this.geometries = { grass: tuftGeometry(), shrub: shrubGeometry(), lowShrub: lowShrubGeometry(), tallShrub: tallShrubGeometry(), rock: rockGeometry(), stone: stoneGeometry(), reed: reedGeometry(), litter: litterGeometry(), clover: cloverGeometry(), flower: stemGeometry(), head: headGeometry(), fern: fernGeometry(), sapling: saplingGeometry() }
    this.crowns = Array.from({ length: TREE_VARIANTS }, (_, v) => crownGeometry(v))
    this.trunk = trunkGeometry()
    const tex = contactTexture()
    this.contact = {
      geo: new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      tex,
      // Soft, not black: a contact shadow grounds a tree without a hard edge.
      mat: new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true }),
    }
    this.townContactMaterial = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    this.materials = {
      foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      ever: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
      trunk: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      grass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      soft: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
      // Shrubs and saplings, and ferns, apart from the flowers and the grass they used to share
      // a material with: each layer turns with the season by its own amount.
      shrub: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
      fern: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }),
    }
    for (const m of [this.materials.foliage, this.materials.ever, this.materials.trunk]) fadeNearCamera(m, this.fade)
    // The grass (and the clover sharing its material) stands taller or shorter with the season;
    // the seasons' tint wraps this when it's applied.
    const grassHeight = this.grassHeight
    this.materials.grass.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, grassHeight)
      shader.vertexShader = 'uniform float uScale;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y *= uScale;')
    }
    this.materials.grass.customProgramCacheKey = () => 'grassHeight'
  }

  /** The broadleaf foliage material: the seasons may tint it (seasonFx). Evergreens keep their colour. */
  get foliageMaterial(): THREE.Material {
    return this.materials.foliage
  }

  /**
   * Every leafy material and how far it follows the season (seasonFx.tint's strength). At
   * first only the broadleaf canopy turned: in autumn the shrubs, saplings, ferns and grass
   * under orange trees stayed summer green. Now the undergrowth turns nearly as far as the
   * canopy, ferns to bronze, grass partway toward straw (the lawn itself goes golden), and
   * the conifers take a touch of the season's warmth while staying green.
   */
  get seasonal(): [THREE.Material, number][] {
    return [
      [this.materials.foliage, 1],
      [this.materials.shrub, 0.85],
      [this.materials.fern, 0.8],
      [this.materials.grass, 0.45],
      // Muted: at the shrubs' 0.85 the reeds went orange; reeds go gold.
      [this.reeds.material, 0.5],
      // Only a touch: at 0.18 the firs went khaki in autumn, which reads as dying, not evergreen.
      [this.materials.ever, 0.1],
    ]
  }

  private townShadow: THREE.InstancedMesh | null = null

  /**
   * Soft contact shadows round the town's feet: one under each ground-floor
   * block, a little larger than it, so walls meet the lawn with a darkening
   * rather than a hard line. Rebuilt whenever the town changes; the
   * simulation never sees it.
   */
  groundTown(cells: [number, number][]) {
    if (this.townShadow) {
      this.group.remove(this.townShadow)
      this.townShadow.dispose()
    }
    const mesh = new THREE.InstancedMesh(this.contact.geo, this.townContactMaterial, Math.max(1, cells.length))
    mesh.count = cells.length
    const m = new THREE.Matrix4()
    cells.forEach(([x, z], i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.0, z), new THREE.Quaternion(), new THREE.Vector3(0.95, 1, 0.95))))
    mesh.raycast = noRaycast
    mesh.renderOrder = 1
    mesh.computeBoundingSphere()
    this.townShadow = mesh
    this.group.add(mesh)
  }

  private townContactMaterial!: THREE.MeshBasicMaterial

  /** Where the camera is, each frame, for the near-camera fade. */
  setCamera(p: THREE.Vector3) {
    this.fade.uFadeCam.value.copy(p)
  }

  /** Places every decoration for a landscape and density, replacing what was there. */
  build(L: Landscape, density: Density) {
    const t0 = performance.now()
    this.clear()
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const c = new THREE.Color()
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, places: Placement[], colour: (p: Placement) => THREE.Color, scale: (p: Placement) => [number, number, number], shadow: boolean, lift: (p: Placement) => number = () => 0) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, places.length))
      mesh.count = places.length
      places.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot)
        const [sx, sy, sz] = scale(p)
        m4.compose(new THREE.Vector3(p.x, p.y + lift(p), p.z), q, new THREE.Vector3(sx, sy, sz))
        mesh.setMatrixAt(i, m4)
        mesh.setColorAt(i, colour(p))
      })
      mesh.raycast = noRaycast
      mesh.castShadow = shadow
      mesh.receiveShadow = true
      mesh.computeBoundingSphere()
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
    const pick = (tones: string[], t: number) => c.set(tones[Math.floor(t * tones.length) % tones.length])
    const places: Record<Kind, Placement[]> = { grass: [], shrub: [], rock: [], flower: [], fern: [], sapling: [], stone: [], reed: [], litter: [], clover: [] }
    for (const k of KINDS) {
      places[k] = scatter(L, k, density)
      this.counts[k] = places[k].length
    }
    make(this.geometries.grass, this.materials.grass, places.grass, (p) => pick(GRASS_TONES, p.tone), (p) => [p.scale, p.scale * p.stretch, p.scale], false)
    // Three shrub shapes — a rounded mound, a low spread, and a tall upright one only at and
    // past the forest's edge, the layer between the shrubs and the young trees.
    const tall = (p: Placement) => p.tone >= 0.7 && L.pastEdge(p.x, p.z) > -3
    make(this.geometries.shrub, this.materials.shrub, places.shrub.filter((p) => p.tone >= 0.45 && !tall(p)), (p) => pick(SHRUB_TONES, p.tone), (p) => [p.scale * p.stretch, p.scale, p.scale / p.stretch], true)
    make(this.geometries.tallShrub, this.materials.shrub, places.shrub.filter(tall), (p) => pick(SHRUB_TONES, (p.tone - 0.7) / 0.3), (p) => [p.scale * p.stretch, p.scale * (0.9 + 0.3 * p.tone), p.scale / p.stretch], true)
    make(this.geometries.lowShrub, this.materials.shrub, places.shrub.filter((p) => p.tone < 0.45), (p) => pick(SHRUB_TONES, p.tone * 2), (p) => [p.scale * p.stretch * 1.2, p.scale, p.scale * 1.2 / p.stretch], true)
    make(this.geometries.fern, this.materials.fern, places.fern, (p) => pick(FERN_TONES, p.tone), (p) => [p.scale, p.scale * (0.8 + 0.4 * p.stretch), p.scale], false)
    make(this.geometries.sapling, this.materials.shrub, places.sapling, (p) => pick(SAPLING_TONES, p.tone), (p) => [p.scale, p.scale * p.stretch, p.scale], true)
    make(this.geometries.rock, this.materials.flat, places.rock, (p) => pick(ROCK_TONES, p.tone), (p) => [p.scale * p.stretch, p.scale * (0.7 + 0.5 * p.tone), p.scale], true)
    // Small stones sit a little into the ground, flatter than the rocks.
    // Stones at the water are river stones — smoother greys and beiges, a little bigger.
    const wet = (p: Placement) => L.streamEdge(p.x, p.z) < 0.8
    make(this.geometries.stone, this.materials.flat, places.stone, (p) => pick(wet(p) ? RIVER_STONE_TONES : STONE_TONES, p.tone), (p) => (wet(p) ? [p.scale * p.stretch * 1.5, p.scale * 0.8, p.scale * 1.5] : [p.scale * p.stretch, p.scale * 0.6, p.scale]), false, () => -0.02)
    // Reeds: their own material, so autumn turns them a muted gold (the shrubs' strength made them
    // orange) and winter stands them lower (`applySeason`).
    make(this.geometries.reed, this.reeds.material, places.reed, (p) => pick(REED_TONES, p.tone), (p) => [p.scale, p.scale * p.stretch, p.scale], false)
    // Stones in the stream, which the water breaks round.
    this.floating.follow(L.stream, L.seed)
    // River stones in groups on the banks: smooth, flattened, muted.
    make(this.geometries.stone, this.materials.flat, bankStones(L), (p) => pick(RIVER_STONE_TONES, p.tone), (p) => [p.scale * p.stretch, p.scale * 0.55, p.scale], false)
    const rocks = streamRocks(L)
    make(this.geometries.stone, this.materials.flat, rocks, (p) => pick(RIVER_STONE_TONES, p.tone), (p) => [p.scale * p.stretch, p.tall ?? p.scale * 0.7, p.scale], false)
    // Each ring drawn where its stone meets the water.
    this.water.uniforms.uRocks.value.forEach((v, i) => {
      const r = rocks[i]
      if (r) v.set(r.x, r.z, r.ring ?? 0.5 * r.scale)
      else v.set(0, 0, -1)
    })
    // The stream: its bed and banks as a fine mesh over the lawn, then the water in them.
    this.addLine(bankStrip(L), this.bankMaterial).renderOrder = 1
    this.addLine(waterRibbon(L), this.water.material).renderOrder = 2
    // The footpaths, as ribbons laid on the lawn's own surface.
    for (const line of L.paths) this.addLine(pathRibbon(line, (x, z) => surfaceHeight(x, z, (a, b) => L.height(a, b)), L.seed), this.pathMaterial)
    // Stem and head scaled apart: scaled together, a readable head meant a stem as tall as a person.
    const stem = (p: Placement) => 0.2 * 0.75 * p.scale
    make(this.geometries.flower, this.materials.soft, places.flower, () => c.set('#6f8a4f'), (p) => [p.scale, 0.75 * p.scale, p.scale], false)
    // Heads open and close with the year (`bloom`); the stems stay.
    // Each drift mostly one colour (the same field as the wash on the ground under it), one in
    // five flowers another, so the drifts read as drifts and not a sprinkle of every colour.
    const flowerColour = (p: Placement) => c.set(FLOWER_COLOURS[p.tone < 0.8 ? bloomHue(L.clustering(p.x, p.z, 113)) : Math.floor(((p.tone - 0.8) / 0.2) * 4)])
    make(this.geometries.head, this.bloom.material, places.flower, flowerColour, (p) => [2.4 * p.scale, 2.4 * p.scale, 2.4 * p.scale], false, stem)
    // Clover and creeping weeds, lit like the ground; the grass's material, so they turn with it.
    make(this.geometries.clover, this.materials.grass, places.clover, (p) => pick(CLOVER_TONES, p.tone), (p) => [p.scale, p.scale, p.scale], false)
    // Fallen leaves, shown in autumn only; their own colours, so white here.
    make(this.geometries.litter, this.litter.material, places.litter, () => c.set('#ffffff'), (p) => [p.scale, 1, p.scale], false)
    // The clearing's accents: a fallen log, mossy stones, mushrooms, a flowering shrub.
    this.addAccents(clearingAccents(L), make, pick)
    // The landmarks: boulder groups where the path meets the clearing and where the stream turns away.
    make(this.geometries.rock, this.materials.flat, landmarks(L), (p) => pick(ROCK_TONES, p.tone), (p) => [p.scale * p.stretch, p.scale * 0.75, p.scale], true, () => -0.05)
    // The forest: one trunk mesh, one crown mesh per shape, every tree sharing its matrix between them.
    const trees = scatterTrees(L, density)
    this.trees = trees.length
    const treeMatrix = (t: Tree, trunk: boolean) => {
      q.setFromEuler(new THREE.Euler(t.leanX, t.rot, t.leanZ, 'YXZ'))
      // A trunk is as long as its family's (slender trees thinner); a crown as wide as the tree, not its trunk.
      if (trunk) {
        const sxz = t.scale * t.girth * (t.variant === SLENDER ? 0.6 : 1)
        // An evergreen's trunk stretches with its crown, so a tall fir stands on a taller stem.
        const sy = t.scale * TRUNK_LENGTH[t.variant] * (t.variant === EVERGREEN || t.variant === SPIRE ? t.crownY : 1)
        return m4.compose(new THREE.Vector3(t.x, t.y - 0.05, t.z), q, new THREE.Vector3(sxz, sy, sxz))
      }
      return m4.compose(new THREE.Vector3(t.x, t.y - 0.05, t.z), q, new THREE.Vector3(t.scale * t.crownX, t.scale * t.crownY, t.scale * t.crownZ))
    }
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Tree[], colour: (t: Tree) => THREE.Color, trunk: boolean, shadow: boolean) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length))
      mesh.count = list.length
      list.forEach((t, i) => {
        mesh.setMatrixAt(i, treeMatrix(t, trunk))
        mesh.setColorAt(i, colour(t))
      })
      mesh.raycast = noRaycast
      mesh.receiveShadow = true
      // Trees cast real shadows where the sun's shadow map reaches (the meadow and its edge).
      mesh.castShadow = shadow
      mesh.computeBoundingSphere()
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
    // Near and far trees in separate meshes, and only the near ones cast shadows. An instanced
    // mesh is culled as a whole, so one mesh of every tree drew all 2,600 into a shadow map that
    // covers ±19 units: 4.6 of the frame's 5.9 million triangles were broad crowns, half of them
    // in the shadow pass, for trees that could never land in it.
    for (const near of [true, false]) {
      const group = trees.filter((t) => (Math.hypot(t.x, t.z) <= SHADOW_REACH) === near)
      instanced(this.trunk, this.materials.trunk, group, (t) => pick(t.variant === SLENDER ? PALE_BARK : TRUNK_TONES, t.tone), true, near)
      for (let v = 0; v < TREE_VARIANTS; v++) {
        const list = group.filter((t) => t.variant === v)
        instanced(this.crowns[v], isEvergreen(v) ? this.materials.ever : this.materials.foliage, list, (t) => pick(FAMILY_TONES[v], t.tone), false, near)
      }
    }
    // Soft contact shadows under every tree and shrub — beyond the shadow map's reach they are the only ones.
    const under = [...trees.map((t) => ({ x: t.x, z: t.z, r: CROWN_RADIUS[t.variant] * t.scale * 1.1 * (t.crownX + t.crownZ) / 2 })), ...places.shrub.map((p) => ({ x: p.x, z: p.z, r: 0.55 * p.scale }))]
    const shadows = new THREE.InstancedMesh(this.contact.geo, this.contact.mat, Math.max(1, under.length))
    shadows.count = under.length
    under.forEach((u, i) => {
      m4.compose(new THREE.Vector3(u.x, L.height(u.x, u.z) + 0.03, u.z), q.identity(), new THREE.Vector3(u.r, 1, u.r))
      shadows.setMatrixAt(i, m4)
    })
    shadows.raycast = noRaycast
    shadows.renderOrder = 1
    shadows.computeBoundingSphere()
    this.meshes.push(shadows)
    this.group.add(shadows)
    this.ms = performance.now() - t0
  }

  private clear() {
    for (const m of this.meshes) {
      this.group.remove(m)
      m.dispose()
    }
    this.meshes = []
    for (const m of this.lines) {
      this.group.remove(m)
      m.geometry.dispose()
    }
    this.lines = []
  }

  /** The water's material and the uniforms it animates and the seasons tint. */
  readonly water = waterMaterial()
  /** Flower heads, which open with the year: 1.1 in spring, 1 in summer, a third in autumn, none in winter. */
  private bloom = scaledMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }), 1)
  /** Reeds: shorter in winter (height only), and their own seasonal tint (see `seasonal`). */
  private reeds = heightScaledMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }))
  /** The grass tufts' height through the year: fuller in summer, shorter in autumn, low in winter. */
  private grassHeight = { uScale: { value: 1 } }
  /** Fallen leaves, which show only in autumn. */
  private litter = scaledMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }), 0)

  /**
   * The season, from the same blended look as everything else (seasonLook.ts): the
   * weights of spring (petals 0.5), autumn (falling leaves) and winter (snow) in the
   * air, and summer as what's left. Nothing here keeps its own calendar.
   */
  applySeason(look: SeasonLook) {
    const spring = Math.min(1, look.petals / 0.5)
    const autumn = look.leaves
    const winter = look.snow
    const summer = Math.max(0, 1 - spring - autumn - winter)
    const u = this.water.uniforms
    // Clear blue in spring; a touch greener in summer; still blue in autumn, against the
    // orange; cooler and greyer in winter, its edges frosting over.
    u.uDeep.value.copy(WATER_DEEP).lerp(WATER_DEEP_SUMMER, summer).lerp(WATER_DEEP_WINTER, winter)
    u.uShallow.value.copy(WATER_SHALLOW).lerp(WATER_SHALLOW_SUMMER, summer).lerp(WATER_SHALLOW_WINTER, winter)
    u.uFrost.value = winter
    // A little fuller in spring, a little lower in winter: the banks show more or less of themselves.
    u.uFull.value = 0.035 * spring - 0.03 * winter
    this.bloom.uniforms.uScale.value = 1.1 * spring + summer + 0.35 * autumn
    this.litter.uniforms.uScale.value = autumn
    this.mushrooms.uniforms.uScale.value = (0.55 * (spring + summer) + 1.15 * autumn) * (1 - winter)
    // The reeds die back over winter: two thirds of their height.
    this.reeds.uniforms.uScale.value = 1 - 0.35 * winter
    this.grassHeight.uScale.value = 1 + 0.1 * summer - 0.1 * autumn - 0.4 * winter
    this.floating.show = autumn
    this.pathSeason.uLitter.value = autumn
    this.pathSeason.uBare.value = winter
  }

  /** Leaves afloat on the stream in autumn. */
  readonly floating = new FloatingLeaves()

  /** Moves the water on by `dt` seconds of play (it holds still while time is paused, like the weather). */
  tick(dt: number) {
    dt = Math.min(dt, 0.1)
    this.water.uniforms.uTime.value += dt
    this.floating.tick(dt, this.water.uniforms.uFull.value)
  }

  /** Mushrooms come up in autumn and are gone by winter; their size is the season. */
  private mushrooms = scaledMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 0.6)

  /** Draws the clearing's accents, each from shared geometry. */
  private addAccents(accents: Accent[], make: (geo: THREE.BufferGeometry, mat: THREE.Material, places: Placement[], colour: (p: Placement) => THREE.Color, scale: (p: Placement) => [number, number, number], shadow: boolean, lift?: (p: Placement) => number) => void, pick: (tones: string[], t: number) => THREE.Color) {
    const at = (a: Accent, dx = 0, dz = 0, s = 1, tone = 0.5): Placement => {
      const c = Math.cos(a.rot), n = Math.sin(a.rot)
      const x = a.x + dx * c - dz * n, z = a.z + dx * n + dz * c
      return { x, y: a.y, z, rot: a.rot, scale: a.scale * s, stretch: 1, tone }
    }
    for (const a of accents) {
      if (a.kind === 'log') make(this.log, this.materials.soft, [at(a)], () => pick(['#ffffff'], 0), (p) => [p.scale, p.scale, p.scale], true)
      if (a.kind === 'mossy') {
        const stones = [at(a, 0, 0, 1.0, 0.1), at(a, 0.9, 0.4, 0.65, 0.5), at(a, -0.55, 0.7, 0.55, 0.8)]
        make(this.geometries.rock, this.materials.flat, stones, (p) => pick(MOSSY_TONES, p.tone), (p) => [p.scale * 1.1, p.scale * 0.8, p.scale], true, () => -0.04)
      }
      if (a.kind === 'mushrooms') {
        // A loose ring of seven, as mushrooms come up round where something rots.
        const ring = Array.from({ length: 7 }, (_, k) => at(a, Math.cos(k * 0.9 + 0.3) * (0.35 + 0.08 * (k % 3)), Math.sin(k * 0.9 + 0.3) * (0.35 + 0.08 * (k % 3)), 0.7 + 0.12 * (k % 3), k / 7))
        make(this.mushroom, this.mushrooms.material, ring, () => pick(['#ffffff'], 0), (p) => [p.scale, p.scale, p.scale], false)
      }
      if (a.kind === 'blossom') {
        // A shrub in flower: the shrub's leafy mound, larger, and its blossom the flowers' heads —
        // open in spring and summer, gone by winter, with the meadow's flowers (`bloom`).
        const shrub = at(a, 0, 0, 1.5)
        make(this.geometries.shrub, this.materials.shrub, [shrub], () => pick(['#7d9a58'], 0), (p) => [p.scale * 1.1, p.scale * 1.15, p.scale], true)
        // On the mound's surface (an ellipsoid round the shrub geometry's leafy balls), from its
        // shoulders up: placed inside it, the first blossoms were hidden.
        const blooms: Placement[] = []
        const rand = mulberry32(Math.floor(a.x * 1000 + a.z * 7))
        const S = shrub.scale
        for (let k = 0; k < 70; k++) {
          const t = rand() * Math.PI * 2, el = Math.asin(0.15 + 0.85 * rand())
          const x = a.x + Math.cos(t) * Math.cos(el) * 0.8 * S * 1.1
          const z = a.z + Math.sin(t) * Math.cos(el) * 0.8 * S
          blooms.push({ x, y: a.y + 0.3 * S + Math.sin(el) * 0.5 * S * 1.15, z, rot: rand() * 6.3, scale: 0.55 + 0.25 * rand(), stretch: 1, tone: rand() })
        }
        make(this.geometries.head, this.bloom.material, blooms, (p) => pick(BLOSSOM_TONES, p.tone), (p) => [2.4 * p.scale, 2.4 * p.scale, 2.4 * p.scale], false)
      }
    }
  }
  private log = logGeometry()
  private mushroom = mushroomGeometry()

  /** The ribbons laid on the ground: the footpaths (and the stream). */
  private lines: THREE.Mesh[] = []
  private addLine(geo: THREE.BufferGeometry, mat: THREE.Material) {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.raycast = noRaycast
    mesh.receiveShadow = true
    mesh.renderOrder = 1
    this.lines.push(mesh)
    this.group.add(mesh)
    return mesh
  }

  /**
   * The stream's bed and banks: the lawn's own colours on finer geometry, fading out at their
   * outer edge over the lawn. Its colour is multiplied by the season as the lawn's is
   * (`matchLawn`), so the two never part.
   */
  readonly bankMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })

  /** Copies the lawn material's seasonal colour, so the banks turn exactly as the lawn does. */
  matchLawn(colour: THREE.Color) {
    this.bankMaterial.color.copy(colour)
  }

  /**
   * Bare earth, blended at its edges by vertex alpha: transparent and drawn after the lawn,
   * nudged toward the camera so it never fights the ground it lies on.
   */
  private pathSeason = { uLitter: { value: 0 }, uBare: { value: 0 } }
  private pathMaterial = pathMaterial(this.pathSeason)

  dispose() {
    this.clear()
    for (const g of Object.values(this.geometries)) g.dispose()
    for (const g of this.crowns) g.dispose()
    this.trunk.dispose()
    this.contact.geo.dispose()
    this.contact.mat.dispose()
    this.contact.tex.dispose()
    this.townContactMaterial.dispose()
    this.townShadow?.dispose()
    for (const m of [this.materials.foliage, this.materials.ever, this.materials.trunk]) m.dispose()
    this.materials.grass.dispose()
    this.materials.soft.dispose()
    this.materials.shrub.dispose()
    this.materials.fern.dispose()
    this.materials.flat.dispose()
    this.pathMaterial.dispose()
    this.water.material.dispose()
    this.bankMaterial.dispose()
    this.bloom.material.dispose()
    this.reeds.material.dispose()
    this.mushrooms.material.dispose()
    this.log.dispose()
    this.mushroom.dispose()
    this.floating.dispose()
    this.litter.material.dispose()
  }
}

/** Points along the stream every `step` units, with its per-point values interpolated. */
function alongStream(line: Line, step: number) {
  const out: { x: number; z: number; tx: number; tz: number; half: number; skew: number; level: number; phase: number }[] = []
  const lerp = (a: number[], i: number, t: number) => a[i] + (a[i + 1] - a[i]) * t
  const total = line.s[line.s.length - 1]
  let i = 0
  for (let s = 0; s <= total; s += step) {
    while (i + 2 < line.s.length && line.s[i + 1] < s) i++
    const t = Math.max(0, Math.min(1, (s - line.s[i]) / (line.s[i + 1] - line.s[i] || 1)))
    const tx = line.x[i + 1] - line.x[i], tz = line.z[i + 1] - line.z[i]
    const len = Math.hypot(tx, tz) || 1
    out.push({ x: lerp(line.x, i, t), z: lerp(line.z, i, t), tx: tx / len, tz: tz / len, half: lerp(line.half, i, t), skew: lerp(line.skew!, i, t), level: lerp(line.level!, i, t), phase: lerp(line.phase!, i, t) })
  }
  return out
}

/** Sews rows of `w` vertices into triangles, wound to face up (with across to the left, along × across points down). */
function sew(rows: number, w: number): number[] {
  const index: number[] = []
  for (let r = 0; r + 1 < rows; r++)
    for (let j = 0; j + 1 < w; j++) {
      const p = r * w + j
      index.push(p, p + 1, p + w, p + 1, p + w + 1, p + w)
    }
  return index
}

/**
 * The stream's water: a flat ribbon at the water level, each side as wide as the water is on
 * that side (the inside of a bend is wider) and reaching just 0.12 past it — under the bank's
 * lip, which starts at exactly the water level at the edge. (The first ribbon reached 1.3× the
 * half-width under gentle banks: no gap, but no bank to see either.) Carries how far across
 * (−1…1 at the edges), how deep (1 mid-stream, 0 at the edge), and the flow phase, for the shader.
 */
function waterRibbon(L: Landscape): THREE.BufferGeometry {
  const ACROSS = [-1.12, -1, -0.8, -0.45, 0, 0.45, 0.8, 1, 1.12]
  const pos: number[] = []
  const across: number[] = []
  const depth: number[] = []
  const flow: number[] = []
  const pts = alongStream(L.stream, 0.4)
  for (const p of pts) {
    const nx = -p.tz, nz = p.tx
    for (const c of ACROSS) {
      const side = c < 0 ? -1 : 1
      const half = p.half * (1 + side * p.skew)
      // ±1.12 is the edge plus 0.12, not 12% more.
      const d = Math.abs(c) > 1 ? half + 0.12 : Math.abs(c) * half
      pos.push(p.x + nx * side * d, p.level, p.z + nz * side * d)
      across.push(Math.max(-1.1, Math.min(1.1, (side * d) / half)))
      depth.push(Math.max(0, 1 - (d / half) ** 2))
      flow.push(p.phase)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: pos.length / 3 }, () => [0, 1, 0]).flat(), 3))
  geo.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1))
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1))
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 1))
  geo.setIndex(sew(pts.length, ACROSS.length))
  geo.computeBoundingSphere()
  return geo
}

/**
 * The stream's bed and banks, finer than the lawn can be: rows every 0.3 units along it, each
 * from the middle of the bed out past the water's edge to the bank's reach (2 units, more where
 * it's cut deeper), at the land's exact height and in its exact colours (`Landscape.colour`,
 * read as the lawn reads it). The lawn is lowered 10 cm beneath it (`lawnSink`), so the lawn's
 * coarser triangles can't poke through; the strip's last unit fades out over the lawn as the
 * lawn rises back. Under the translucent water this is the bed you see; at the edge, the lip.
 */
function bankStrip(L: Landscape): THREE.BufferGeometry {
  const WET = [0, 0.35, 0.65, 0.88, 1]
  const DRY = [0.05, 0.14, 0.26, 0.42, 0.62, 0.86, 1.15]
  const pos: number[] = []
  const col: number[] = []
  const rgb: [number, number, number] = [0, 0, 0]
  const c = new THREE.Color()
  const pts = alongStream(L.stream, 0.3)
  let w = 0
  for (const p of pts) {
    const nx = -p.tz, nz = p.tx
    const row: { d: number; a: number; side: number }[] = []
    for (const side of [-1, 1]) {
      const half = p.half * (1 + side * p.skew)
      const probe = L.channelAt(p.x + nx * side * (half + 0.3), p.z + nz * side * (half + 0.3))
      const reach = L.bankReach(probe?.lift ?? 0.24)
      const list = [...WET.map((k) => ({ d: k * half, a: 1 })), ...DRY.map((k) => ({ d: half + k * reach, a: k <= 0.62 ? 1 : 1 - smooth(0.62, 1.15, k) }))]
      if (side < 0) list.reverse()
      for (const v of list) if (!(side > 0 && v.d === 0)) row.push({ ...v, side })
    }
    w = row.length
    for (const v of row) {
      const x = p.x + nx * v.side * v.d, z = p.z + nz * v.side * v.d
      pos.push(x, L.height(x, z) + 0.012, z)
      L.colour(x, z, rgb)
      c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace)
      col.push(c.r, c.g, c.b, v.a)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4))
  geo.setIndex(sew(pts.length, w))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * A shallow woodland stream, stylised: soft blue that keeps its colour against autumn's orange.
 *
 * - **Depth** from the ribbon's own `aDepth` (1 mid-stream, 0 at the edge): a deeper blue in the
 *   middle easing to a paler, greener blue in the shallows, and translucent there (opacity 0.5
 *   at the edge to 0.93 in the middle), so the bed under the edge shows — the first water was one
 *   opaque sheet and read as a ribbon laid on the grass.
 * - **Flow** along the stream, not across the world: patterns are laid out on `aFlow`, the
 *   stream's own phase (∫ ds / pace), so moving them at one rate moves them with the water —
 *   quicker through narrows, slower in pools. A sparse pattern of long, faint light flecks, and
 *   ripples in the normal only, so the sun leaves soft moving highlights (roughness 0.3, no
 *   environment map: no mirror). Time is real time, not the game's: at 4× the water is as calm.
 * - **Rocks** in the stream (`uRocks`, up to six) get a thin, faint, broken line of water at their edge.
 * - **Seasons**: `uFull` lifts the surface a little in spring, lowers it in winter; `uFrost`
 *   frosts the edges and stills the ripples.
 */
function waterMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color('#4d84a6') },
    uShallow: { value: new THREE.Color('#86b4bf') },
    uFrost: { value: 0 },
    uFull: { value: 0 },
    uRocks: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0, 0, -1)) },
  }
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0, transparent: true })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader =
      'attribute float aAcross;\nattribute float aFlow;\nattribute float aDepth;\nuniform float uFull;\nvarying float vAcross;\nvarying float vFlow;\nvarying float vDepth;\nvarying vec2 vGround;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += uFull;\nvAcross = aAcross;\nvFlow = aFlow;\nvDepth = aDepth;\nvGround = position.xz;')
    shader.fragmentShader =
      'uniform float uTime;\nuniform vec3 uDeep;\nuniform vec3 uShallow;\nuniform float uFrost;\nuniform vec3 uRocks[6];\nvarying float vAcross;\nvarying float vFlow;\nvarying float vDepth;\nvarying vec2 vGround;\n' +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          float deep = smoothstep(0.0, 0.85, vDepth);
          vec3 water = mix(uShallow, uDeep, deep);
          // Long, faint flecks of light carried downstream: the product of two slow waves, so they
          // come and go rather than marching in lines.
          float f = vFlow * 1.6 - uTime * 0.55;
          float a1 = 0.5 + 0.5 * sin(f * 1.0 + vAcross * 2.4 + sin(vFlow * 0.23) * 2.0);
          float a2 = 0.5 + 0.5 * sin(f * 2.3 - vAcross * 3.7 + 1.7);
          water += vec3(0.05, 0.06, 0.06) * pow(a1 * a2, 4.0) * (0.4 + 0.6 * deep);
          // A little broken water at a stone in the stream: a thin, faint line just off its edge,
          // in pieces round it that shift slowly. (A full bright band 0.3 wide, the first version,
          // read as a white circle — all the more when the stones sat under the water.)
          float foam = 0.0;
          for (int i = 0; i < 6; i++) {
            if (uRocks[i].z <= 0.0) continue;
            vec2 off = vGround - uRocks[i].xy;
            float r = length(off) - uRocks[i].z;
            float line = 1.0 - smoothstep(0.0, 0.045, abs(r - 0.025));
            float pieces = smoothstep(0.1, 0.8, 0.5 + 0.5 * sin(atan(off.y, off.x) * 5.0 + uTime * 0.9 + float(i) * 2.3));
            foam = max(foam, line * pieces);
          }
          water = mix(water, vec3(0.86, 0.92, 0.93), foam * 0.3 * (1.0 - uFrost));
          // Frost creeping in from the edges in winter.
          float frost = uFrost * smoothstep(0.6, 0.98, abs(vAcross));
          water = mix(water, vec3(0.86, 0.9, 0.93), frost);
          diffuseColor.rgb = water;
          diffuseColor.a = mix(0.5, 0.93, smoothstep(0.0, 0.6, vDepth)) + frost * 0.4;`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
          float g = vFlow * 3.0 - uTime * 1.1;
          vec3 ripple = vec3(0.055 * sin(g + vAcross * 2.1) + 0.03 * sin(g * 2.3 - vAcross * 4.3 + 0.8), 0.0, 0.045 * cos(g * 0.8 + vAcross * 3.1));
          normal = normalize(normal + (viewMatrix * vec4(ripple * (1.0 - uFrost * 0.8), 0.0)).xyz);`,
        )
  }
  return { material, uniforms }
}

const WATER_DEEP = new THREE.Color('#4d84a6')
const WATER_SHALLOW = new THREE.Color('#86b4bf')
const WATER_DEEP_SUMMER = new THREE.Color('#4a8798')
const WATER_SHALLOW_SUMMER = new THREE.Color('#86b8b3')
const WATER_DEEP_WINTER = new THREE.Color('#6a8698')
const WATER_SHALLOW_WINTER = new THREE.Color('#a9bfc7')

/**
 * A material whose geometry is scaled about each instance's own origin by a uniform —
 * flower heads closing, fallen leaves appearing — so the season changes them with one
 * number, no rebuilding. At 0 they vanish.
 */
/** As `scaledMaterial`, but the height only: reeds shorten in winter without thinning. */
function heightScaledMaterial(material: THREE.MeshStandardMaterial) {
  const uniforms = { uScale: { value: 1 } }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = 'uniform float uScale;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y *= uScale;')
  }
  material.customProgramCacheKey = () => 'heightScaled'
  return { material, uniforms }
}

function scaledMaterial(material: THREE.MeshStandardMaterial, initial: number) {
  const uniforms = { uScale: { value: initial } }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = 'uniform float uScale;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed *= uScale;')
  }
  material.customProgramCacheKey = () => 'scaled'
  return { material, uniforms }
}

/**
 * The footpaths' earth, faded at its edges by vertex alpha. In autumn it is speckled
 * with fallen leaves (round dots on a 1/6-unit lattice, a share of them shown as the
 * season deepens); in winter the earth shows more, and paler, as the grass dies back.
 */
function pathMaterial(season: { uLitter: { value: number }; uBare: { value: number } }) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, season)
    shader.vertexShader = 'varying vec2 vGround;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;')
    shader.fragmentShader =
      'uniform float uLitter;\nuniform float uBare;\nvarying vec2 vGround;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec2 cell = floor(vGround * 6.0);
        float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
        float dot2 = length(fract(vGround * 6.0) - 0.5);
        float leaf = step(1.0 - 0.32 * uLitter, h) * step(dot2, 0.36);
        vec3 fallen = h > 0.9 ? vec3(0.72, 0.33, 0.17) : h > 0.8 ? vec3(0.82, 0.52, 0.2) : vec3(0.55, 0.37, 0.2);
        diffuseColor.rgb = mix(diffuseColor.rgb, fallen, leaf);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.66, 0.6, 0.5), 0.3 * uBare);
        diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + 0.45 * uBare) + leaf * 0.3);`,
      )
  }
  material.customProgramCacheKey = () => 'path'
  return material
}

/**
 * A fallen log, about 2.6 long and 0.4 thick, lying on its side: bark, pale cut ends, a broken
 * stub of a branch, and moss along its top — coloured in the geometry, so one instance needs none.
 */
/** A hex colour as the linear values vertex colours are read in (a raw 0.43 is far paler than it looks). */
const linear = (hex: string): [number, number, number] => {
  const c = new THREE.Color(hex)
  return [c.r, c.g, c.b]
}

function logGeometry(): THREE.BufferGeometry {
  const len = 2.6, r = 0.2
  const BARK = linear('#6b5641')
  const bark = withColour(new THREE.CylinderGeometry(r * 0.92, r, len, 14, 1, true).rotateZ(Math.PI / 2).translate(0, r * 0.85, 0).toNonIndexed(), BARK)
  const ends = [-1, 1].map((s) => withColour(new THREE.CircleGeometry(r * (s < 0 ? 1 : 0.92), 14).rotateY((s * Math.PI) / 2).translate((s * len) / 2, r * 0.85, 0).toNonIndexed(), linear('#b39a74')))
  const stub = withColour(new THREE.CylinderGeometry(0.05, 0.075, 0.42, 7).rotateZ(-0.9).translate(0.45, r * 0.85 + 0.28, 0.04).toNonIndexed(), BARK)
  // Moss: a flattened, lumpy strip along the top, a little more than half its length.
  const moss = withColour(lumpy(0.5, 1, 0.3, 77).scale(1.5, 0.12, 0.26).translate(-0.2, r * 0.85 + r * 0.88, 0), linear('#6f8a4a'))
  return mergeGeometries([bark, ...ends, stub, moss])!
}

/** A mushroom: a pale stem and a rounded cap, about 0.26 high at scale 1, the cap a warm brown. */
function mushroomGeometry(): THREE.BufferGeometry {
  const stem = withColour(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 7).translate(0, 0.1, 0).toNonIndexed(), linear('#e8dfcc'))
  const cap = withColour(new THREE.SphereGeometry(0.1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.65, 1).translate(0, 0.19, 0).toNonIndexed(), linear('#b07a4c'))
  return mergeGeometries([stem, cap])!
}

/**
 * Clover and creeping weeds: a low rosette of seven rounded leaves, about 0.3 across and a few
 * centimetres high, its normals up so it lights like the ground it lies on.
 */
function cloverGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(419)
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rand() * 0.6
    const d = 0.04 + rand() * 0.09
    const leaf = new THREE.CircleGeometry(0.045 + rand() * 0.02, 6).rotateX(-Math.PI / 2).translate(Math.cos(a) * d, 0.015 + rand() * 0.025, Math.sin(a) * d)
    const shade = 0.85 + 0.25 * rand()
    parts.push(withColour(leaf.toNonIndexed(), [shade, shade, shade]))
  }
  const g = mergeGeometries(parts)!
  const n = g.attributes.normal
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0)
  return g
}

/** Fallen leaves: six small flat ovals in a drift about 0.4 across, lying on the ground, in autumn's colours. */
function litterGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(331)
  const tones = [[0.85, 0.47, 0.17], [0.76, 0.33, 0.16], [0.89, 0.64, 0.23], [0.6, 0.4, 0.2]] as const
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 6; k++) {
    const a = rand() * Math.PI * 2
    const d = rand() * 0.18
    const leaf = new THREE.CircleGeometry(0.05, 5).scale(1, 0.55, 1).rotateZ(rand() * Math.PI).rotateX(-Math.PI / 2).translate(Math.cos(a) * d, 0.02 + k * 0.002, Math.sin(a) * d)
    parts.push(withColour(leaf.toNonIndexed(), [...tones[k % tones.length]] as [number, number, number]))
  }
  return mergeGeometries(parts)!
}

/**
 * A few autumn leaves afloat on the stream, drifting down it: each follows the stream's own
 * line (not a straight path across the world) at the water's pace there — the same rate the
 * water's pattern moves, quicker in narrows — turning slowly, and comes back in upstream when
 * it passes the reach you can see. Twenty-two matrices a frame, and only while autumn shows
 * (and play runs: like the weather, they hold still when time does). Their size is the season.
 */
class FloatingLeaves {
  readonly mesh: THREE.InstancedMesh
  /** How much of autumn is in the air, 0–1: the leaves' size. */
  show = 0
  private line: Line | null = null
  private readonly N = 22
  private s = new Float32Array(this.N)
  private across = new Float32Array(this.N)
  private turn = new Float32Array(this.N)
  private spin = new Float32Array(this.N)
  private far = 100
  private rand = mulberry32(1)
  private m4 = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private sc = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)

  constructor() {
    const leaf = new THREE.CircleGeometry(0.075, 6).scale(1, 0.55, 1).rotateX(-Math.PI / 2)
    this.mesh = new THREE.InstancedMesh(leaf, new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide }), this.N)
    this.mesh.raycast = noRaycast
    this.mesh.visible = false
    this.mesh.frustumCulled = false
    const tones = ['#d9772b', '#c2542a', '#e2a33a', '#b8452a', '#a8642c']
    const c = new THREE.Color()
    for (let i = 0; i < this.N; i++) this.mesh.setColorAt(i, c.set(tones[i % tones.length]))
  }

  /** Puts the leaves on a stream, spread down its first hundred units. */
  follow(line: Line, seed: number) {
    this.line = line
    this.rand = mulberry32(seed * 811 + 3)
    this.far = Math.min(line.s[line.s.length - 1] - 1, 100)
    for (let i = 0; i < this.N; i++) {
      this.s[i] = 4 + this.rand() * (this.far - 4)
      this.across[i] = (this.rand() - 0.5) * 1.1
      this.turn[i] = this.rand() * Math.PI * 2
      this.spin[i] = (this.rand() - 0.5) * 0.6
    }
  }

  tick(dt: number, full: number) {
    const L = this.line
    this.mesh.visible = !!L && this.show > 0.02
    if (!L || !this.mesh.visible) return
    for (let k = 0; k < this.N; k++) {
      // Where on the line it is: the segment, and how far along it.
      let lo = 0, hi = L.s.length - 2
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (L.s[mid] <= this.s[k]) lo = mid
        else hi = mid - 1
      }
      const i = lo
      const t = Math.max(0, Math.min(1, (this.s[k] - L.s[i]) / (L.s[i + 1] - L.s[i] || 1)))
      // The water's pattern moves 0.55 / 1.6 phase units a second; a phase unit is 1 / pace units of stream.
      this.s[k] += dt * 0.34 * (L.pace![i] + (L.pace![i + 1] - L.pace![i]) * t)
      if (this.s[k] > this.far) this.s[k] = 3 + this.rand() * 8
      this.turn[k] += this.spin[k] * dt
      const tx = L.x[i + 1] - L.x[i], tz = L.z[i + 1] - L.z[i]
      const len = Math.hypot(tx, tz) || 1
      const half = (L.half[i] + (L.half[i + 1] - L.half[i]) * t) * 0.8
      const x = L.x[i] + tx * t + (-tz / len) * this.across[k] * half
      const z = L.z[i] + tz * t + (tx / len) * this.across[k] * half
      const y = L.level![i] + (L.level![i + 1] - L.level![i]) * t + full + 0.01
      this.q.setFromAxisAngle(this.up, this.turn[k])
      this.m4.compose(this.v.set(x, y, z), this.q, this.sc.setScalar(this.show))
      this.mesh.setMatrixAt(k, this.m4)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}

/**
 * Reeds: nine thin blades in a clump, 0.6–0.95 high, leaning out a little and
 * curving, and two cattail heads — the blades white (the instance's green
 * shows), the heads brown.
 */
function reedGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(211)
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 9; k++) {
    const a = rand() * Math.PI * 2
    const h = 0.6 + rand() * 0.35
    const lean = 0.08 + rand() * 0.18
    const blade = new THREE.ConeGeometry(0.022, h, 3, 3, true).translate(0, h / 2, 0)
    // A curve: each vertex pushed out by the square of its height.
    const p = blade.attributes.position
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / h
      p.setX(i, p.getX(i) + Math.cos(a) * lean * y * y)
      p.setZ(i, p.getZ(i) + Math.sin(a) * lean * y * y)
    }
    blade.translate(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06)
    parts.push(withColour(blade.toNonIndexed(), [1, 1, 1]))
  }
  for (let k = 0; k < 2; k++) {
    const x = (rand() - 0.5) * 0.1, z = (rand() - 0.5) * 0.1
    const h = 0.75 + rand() * 0.2
    parts.push(withColour(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 6).translate(x, h, z).toNonIndexed(), [0.62, 0.42, 0.3]))
    parts.push(withColour(new THREE.CylinderGeometry(0.008, 0.008, h, 3).translate(x, h / 2, z).toNonIndexed(), [1, 1, 1]))
  }
  const g = mergeGeometries(parts)!
  // Lit like the ground, as the grass is: thin blades with true normals go dark from half the angles.
  const nrm = g.attributes.normal
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0)
  return g
}

/**
 * A footpath as a ribbon of seven vertices across: a worn middle, its edges
 * fading to nothing over the grass (vertex alpha), each edge vertex pushed in
 * or out by noise so the outline is ragged rather than ruled. Laid at the
 * lawn's drawn surface plus 2.5 cm. The earth varies along it and is a little
 * darker in the two wheel-less ruts feet wear either side of the middle.
 */
function pathRibbon(line: Line, surface: (x: number, z: number) => number, seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed * 977 + 5)
  const ACROSS = [-1.45, -1, -0.5, 0, 0.5, 1, 1.45]
  const ALPHA = [0, 0.6, 0.95, 1, 0.95, 0.6, 0]
  const pos: number[] = []
  const col: number[] = []
  const index: number[] = []
  const base = new THREE.Color()
  const earth = [new THREE.Color('#a48b67'), new THREE.Color('#9a8160'), new THREE.Color('#ad9670')]
  const jitter = Array.from({ length: line.x.length * 2 }, () => rand())
  const n = line.x.length
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
    const tx = line.x[b] - line.x[a], tz = line.z[b] - line.z[a]
    const len = Math.hypot(tx, tz) || 1
    const nx = -tz / len, nz = tx / len
    const half = line.half[i]
    const wear = line.wear![i]
    // A slow drift through the earth tones along the path.
    const k = (Math.sin(line.s[i] * 0.21 + seed) + 1) / 2
    base.copy(earth[0]).lerp(earth[k < 0.5 ? 1 : 2], Math.abs(k - 0.5) * 2)
    ACROSS.forEach((c, j) => {
      // Ragged edges: the outer vertices wander in and out, smoothed a little along the path.
      const edge = Math.abs(c) >= 1 ? 1 + (jitter[i * 2 + (c < 0 ? 0 : 1)] - 0.5) * 0.45 : 1
      const x = line.x[i] + nx * c * half * edge
      const z = line.z[i] + nz * c * half * edge
      pos.push(x, surface(x, z) + 0.025, z)
      const rut = Math.abs(c) === 0.5 ? 0.93 : 1
      col.push(base.r * rut, base.g * rut, base.b * rut, ALPHA[j] * wear * 0.92)
    })
    if (i + 1 < n) {
      const w = ACROSS.length
      for (let j = 0; j + 1 < w; j++) {
        const p = i * w + j
        // Wound so the face points up (along × across, with across to the left, points down).
        index.push(p, p + 1, p + w, p + 1, p + w + 1, p + w)
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4))
  geo.setIndex(index)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}
