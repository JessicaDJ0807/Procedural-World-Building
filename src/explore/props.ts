import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { valueNoise } from './terrain'

/**
 * The things that stand on the ground.
 *
 * ## Everything here is normalised
 *
 * One unit wide, one unit tall, sitting on y = 0. That is the whole reason this
 * module exists separately from the scatter that places it.
 *
 * Before, each geometry carried its own size — a cone 4.2 units tall, a box 5 —
 * and the scatter then multiplied by a scale of up to 7 and a vertical stretch
 * of up to 2.1. Those compose: a pillar whose geometry was already 5 tall could
 * come out at 5 × 7 × 2.1 = 73 units, taller than the volcano's flank, and the
 * trees produced the same spikes. Nothing in the rule said so, because the rule
 * only knew about its own two multipliers.
 *
 * Normalised, a rule's `scale` is the object's height in world units and
 * `stretch` is a ratio around it. A number in a world spec now means what it
 * says.
 *
 * ## Why these are built rather than loaded
 *
 * A trunk and three foliage tiers merged into one buffer is about 90 triangles
 * and reads as a tree at the distance anything is actually seen from here. An
 * asset pipeline would buy detail this art direction does not want and a build
 * step this project does not have.
 */

/**
 * Merge, with every part forced non-indexed first.
 *
 * `mergeGeometries` refuses a mix: an index attribute has to exist on all of
 * them or on none. `roughen` returns non-indexed by design and the primitives
 * arrive indexed, so merging a roughened crown onto a plain trunk failed and
 * the tree came back as a bare trunk.
 */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.getIndex() ? g.toNonIndexed() : g))
  const out = mergeGeometries(flat, false)
  for (let i = 0; i < parts.length; i++) if (flat[i] !== parts[i]) parts[i].dispose()
  return out ?? flat[0]
}

/** Scales and shifts a geometry to sit on y = 0, one unit tall and wide. */
function normalise(g: THREE.BufferGeometry, width = 1): THREE.BufferGeometry {
  g.computeBoundingBox()
  const box = g.boundingBox
  if (!box) return g
  const h = box.max.y - box.min.y || 1
  const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1
  g.translate(0, -box.min.y, 0)
  g.scale(width / w, 1 / h, width / w)
  return g
}

/**
 * Displaces vertices by a hash of their own position.
 *
 * A regular solid reads as a regular solid whatever colour it is wearing.
 * Vertices are moved by position rather than by index, so faces that shared a
 * corner still share it and the surface does not tear open; the geometry is
 * split into independent faces first so the result is faceted rather than
 * smoothly lumpy, which is the difference between stone and a potato.
 */
export function roughen(
  geometry: THREE.BufferGeometry,
  amount: number,
  seed: number,
): THREE.BufferGeometry {
  const g = geometry.getIndex() ? geometry.toNonIndexed() : geometry
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const moved = new Map<string, [number, number, number]>()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
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
 * A low-poly tree: a trunk and two or three foliage tiers.
 *
 * Tiers rather than one cone because a single cone is the silhouette everyone
 * recognises as placeholder, and because stacking two slightly offset cones
 * gives a broken outline for eight more triangles. The trunk matters more than
 * it sounds: it is the gap of ground visible under the canopy that stops a
 * stand reading as a row of traffic cones.
 */
function conifer(tiers: number, lean: number, seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const trunk = new THREE.CylinderGeometry(0.055, 0.085, 0.42, 5, 1)
  trunk.translate(0, 0.21, 0)
  parts.push(trunk)

  for (let i = 0; i < tiers; i++) {
    const t = i / Math.max(1, tiers - 1)
    const radius = 0.34 - t * 0.17
    const height = 0.46 - t * 0.1
    const y = 0.3 + i * 0.3
    const cone = new THREE.ConeGeometry(radius, height, 6, 1)
    cone.translate(0, y + height / 2, 0)
    // A small sideways offset per tier, so the trunk is not a perfect axis.
    cone.translate((valueNoise(i * 3.1, seed, seed) - 0.5) * lean, 0, (valueNoise(seed, i * 5.7, seed) - 0.5) * lean)
    parts.push(cone)
  }
  return merge(parts)
}

/** A broadleaf: a short trunk under a roughened blob, for silhouette variety. */
function broadleaf(seed: number): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.06, 0.1, 0.4, 5, 1)
  trunk.translate(0, 0.2, 0)
  const crown = roughen(new THREE.IcosahedronGeometry(0.38, 0), 0.26, seed)
  crown.translate(0, 0.66, 0)
  return merge([trunk, crown])
}

/** A dead tree: trunk and two bare limbs. Rare, and worth it for the contrast. */
function snag(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const trunk = new THREE.CylinderGeometry(0.045, 0.1, 0.92, 5, 1)
  trunk.translate(0, 0.46, 0)
  parts.push(trunk)
  for (let i = 0; i < 2; i++) {
    const limb = new THREE.CylinderGeometry(0.02, 0.035, 0.34, 4, 1)
    limb.rotateZ(i === 0 ? 0.9 : -0.75)
    limb.translate(i === 0 ? 0.11 : -0.1, 0.58 + i * 0.16, (valueNoise(i, seed, seed) - 0.5) * 0.1)
    parts.push(limb)
  }
  return merge(parts)
}

/**
 * Geometry per scatter kind and variant.
 *
 * Several silhouettes per kind, because a stand of one shape repeated is the
 * clearest tell that a scene was generated, and three geometries is three draw
 * calls against a scatter that is already instanced.
 */
export function propGeometry(key: string): THREE.BufferGeometry {
  const [kind, index] = key.split(':')
  const v = Number(index) || 0

  switch (kind) {
    case 'tree':
      // Tall pine, short broad pine, broadleaf, young pine, and a snag.
      if (v === 0) return normalise(conifer(3, 0.05, 11), 0.62)
      if (v === 1) return normalise(conifer(2, 0.08, 23), 0.86)
      if (v === 2) return normalise(broadleaf(31), 0.84)
      if (v === 3) return normalise(conifer(2, 0.03, 47), 0.5)
      return normalise(snag(59), 0.42)

    case 'pillar':
      // Basalt columns: tall, flat-sided, and irregular rather than boxes.
      if (v === 0) return normalise(roughen(new THREE.CylinderGeometry(0.4, 0.5, 1, 6, 1), 0.14, 3), 0.5)
      if (v === 1) return normalise(roughen(new THREE.CylinderGeometry(0.22, 0.42, 1, 5, 1), 0.18, 7), 0.42)
      return normalise(roughen(new THREE.BoxGeometry(0.5, 1, 0.5), 0.16, 13), 0.55)

    case 'berg':
      if (v === 0) return normalise(roughen(new THREE.OctahedronGeometry(0.6, 0), 0.32, 5), 1.1)
      if (v === 1) return normalise(roughen(new THREE.ConeGeometry(0.6, 1, 5, 1), 0.28, 17), 1)
      return normalise(roughen(new THREE.DodecahedronGeometry(0.6, 0), 0.24, 23), 1.2)

    case 'tuft':
      // Small and crude on purpose: at this size a viewer reads density and
      // colour, never silhouette.
      if (v === 0) return normalise(new THREE.ConeGeometry(0.3, 1, 4, 1), 0.7)
      if (v === 1) return normalise(roughen(new THREE.TetrahedronGeometry(0.5, 0), 0.3, 41), 1)
      return normalise(roughen(new THREE.IcosahedronGeometry(0.5, 0), 0.34, 43), 1.1)

    default:
      // Boulders. Three solids roughened three different ways, so a scree slope
      // is not one stone repeated two hundred times.
      if (v === 0) return normalise(roughen(new THREE.IcosahedronGeometry(0.6, 0), 0.36, 2), 1.3)
      if (v === 1) return normalise(roughen(new THREE.DodecahedronGeometry(0.55, 0), 0.32, 19), 1.15)
      return normalise(roughen(new THREE.OctahedronGeometry(0.65, 1), 0.4, 29), 1.25)
  }
}
