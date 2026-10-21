import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Building } from '../green/building'
import { hash, ivyLeaf, vineLeaf } from '../green/vegetation'
import { CLIMBER, SPREADER, WILD_SPECIES } from './species'
import type { Platform } from './world'

/**
 * A Living Platform as scene geometry: architecture and the two plants that
 * made it, merged.
 *
 * - **The slab**: a solid of the building's own stone, its outer edge not
 *   ruled but swelling and dipping — grown rather than cast. It casts and
 *   receives shadows like the rest of the building.
 * - **Roots** of the Climber: three thick, curving struts that rise out of the
 *   wall below and carry the slab's outer edge — the climber holding it up.
 * - **Tendrils** of the Climber hanging from the rim, with a few of its leaves.
 * - **A mat** of the Spreader's broad leaves across the top: the spreader
 *   lying over what it built.
 *
 * Built in a local frame — x along the wall, y up, z out from it — with the
 * origin where the slab's top meets the wall, so growing it out of the wall
 * is a scale in z. `grow(t)` runs the formation: roots first, then the slab
 * pushing out, then the leaves.
 */

const STONE = new THREE.Color('#bdb5a7')
const STONE_UNDER = new THREE.Color('#9a9286')
const SOIL = new THREE.Color('#6f6347')

function paint(geo: THREE.BufferGeometry, colour: (y: number) => THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  if (g !== geo) geo.dispose()
  g.deleteAttribute('uv')
  const pos = g.attributes.position
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) colour(pos.getY(i)).toArray(col, i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

/** The slab's outline in (x, out): a rectangle whose outer edge swells, with rounded outer corners. */
function outline(width: number, depth: number, salt: number): THREE.Vector2[] {
  const half = width / 2
  const r = 0.45
  const pts: THREE.Vector2[] = [new THREE.Vector2(-half, 0), new THREE.Vector2(half, 0)]
  const corner = (cx: number, cz: number, a0: number) => {
    for (let k = 0; k <= 5; k++) {
      const a = a0 + (k / 5) * (Math.PI / 2)
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r))
    }
  }
  corner(half - r, depth - r, 0)
  // The outer edge, right to left, swelling by up to 0.18.
  for (let k = 1; k < 10; k++) {
    const x = half - r - ((width - 2 * r) * k) / 10
    const swell = Math.sin(k * 1.3 + salt) * 0.09 + (hash(salt * 31 + k) - 0.5) * 0.12
    pts.push(new THREE.Vector2(x, depth + swell))
  }
  corner(-half + r, depth - r, Math.PI / 2)
  return pts
}

export type PlatformObject = { group: THREE.Group; grow: (t: number) => void; dispose: () => void }

export function platformObject(b: Building, p: Platform, salt: number): PlatformObject {
  const seg = b.segments[p.segment]
  const width = p.s1 - p.s0
  const mid = (p.s0 + p.s1) / 2
  const group = new THREE.Group()
  group.position.set(seg.ax + seg.dx * mid + seg.nx * 0.02, p.y, seg.az + seg.dz * mid + seg.nz * 0.02)
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(seg.dx, 0, seg.dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(seg.nx, 0, seg.nz)))

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })

  // --- the slab ---
  const shape = new THREE.Shape(outline(width, p.depth, salt))
  const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: p.thickness, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 })
  // Shape in (x, out), extruded downward: rotate so the extrusion runs −y and "out" runs +z.
  slabGeo.rotateX(Math.PI / 2)
  const slab = paint(slabGeo, (y) => (y > -0.05 ? SOIL : y > -p.thickness * 0.6 ? STONE : STONE_UNDER))
  const slabMesh = new THREE.Mesh(slab, material)
  slabMesh.castShadow = true
  slabMesh.receiveShadow = true
  const slabPivot = new THREE.Group()
  slabPivot.add(slabMesh)

  // --- the climber's roots, carrying the outer edge ---
  const stem = new THREE.Color(WILD_SPECIES[CLIMBER].look.stem)
  const lush = new THREE.Color(WILD_SPECIES[CLIMBER].look.lush)
  const roots: THREE.BufferGeometry[] = []
  const rootXs = [-width * 0.33, 0.05, width * 0.31]
  rootXs.forEach((x, k) => {
    const drop = 1.3 + hash(salt * 7 + k) * 0.5
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x + (hash(salt + k) - 0.5) * 0.4, -p.thickness - drop, 0.06),
      new THREE.Vector3(x, -p.thickness - drop * 0.45, 0.25),
      new THREE.Vector3(x * 0.95, -p.thickness - 0.12, p.depth * 0.55),
      new THREE.Vector3(x * 0.9, -p.thickness * 0.5, p.depth * 0.82),
    ])
    roots.push(paint(new THREE.TubeGeometry(curve, 24, 0.075 - k * 0.008, 6, false), () => stem))
  })
  // Tendrils hanging from the rim, thin and green.
  const tendrils: THREE.BufferGeometry[] = []
  for (let k = 0; k < 6; k++) {
    const x = -width / 2 + 0.35 + (k / 5) * (width - 0.7)
    const len = 0.45 + hash(salt * 13 + k) * 0.6
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, -p.thickness * 0.4, p.depth + 0.02),
      new THREE.Vector3(x + 0.05, -p.thickness - len * 0.5, p.depth + 0.07),
      new THREE.Vector3(x - 0.04, -p.thickness - len, p.depth + 0.03),
    ])
    tendrils.push(paint(new THREE.TubeGeometry(curve, 10, 0.022, 4, false), () => lush))
  }
  const rootMesh = new THREE.Mesh(mergeGeometries([...roots, ...tendrils]), material)
  rootMesh.castShadow = true
  for (const g of [...roots, ...tendrils]) g.dispose()
  const rootCount = rootMesh.geometry.index ? rootMesh.geometry.index.count : rootMesh.geometry.attributes.position.count

  // --- leaves: the spreader's mat on top, the climber's on the tendrils ---
  const leaves: THREE.BufferGeometry[] = []
  const leafMatrix = new THREE.Matrix4()
  const addLeaf = (base: THREE.BufferGeometry, colour: THREE.Color, pos: THREE.Vector3, normal: THREE.Vector3, spin: number, size: number) => {
    const g = base.clone()
    const yAxis = new THREE.Vector3(Math.cos(spin), 0, Math.sin(spin))
    if (Math.abs(normal.y) < 0.5) yAxis.set(0, -1, 0).applyAxisAngle(normal, spin * 0.3)
    const zAxis = normal.clone().normalize()
    yAxis.addScaledVector(zAxis, -yAxis.dot(zAxis)).normalize()
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis)
    leafMatrix.makeBasis(xAxis.multiplyScalar(size), yAxis.multiplyScalar(size), zAxis.multiplyScalar(size)).setPosition(pos)
    g.applyMatrix4(leafMatrix)
    leaves.push(paint(g, () => colour))
  }
  const spreaderLeaf = ivyLeaf()
  const climberLeaf = vineLeaf()
  const sLush = new THREE.Color(WILD_SPECIES[SPREADER].look.lush)
  const tint = new THREE.Color()
  for (let k = 0; k < 46; k++) {
    const h = salt * 101 + k * 7
    const x = (hash(h) - 0.5) * (width - 0.3)
    const z = 0.1 + hash(h + 1) * (p.depth - 0.15)
    tint.copy(sLush).offsetHSL((hash(h + 2) - 0.5) * 0.05, 0, (hash(h + 3) - 0.5) * 0.12)
    addLeaf(spreaderLeaf, tint.clone(), new THREE.Vector3(x, 0.02 + hash(h + 4) * 0.05, z), new THREE.Vector3((hash(h + 5) - 0.5) * 0.5, 1, (hash(h + 6) - 0.5) * 0.5), hash(h + 7) * Math.PI * 2, 0.26 + hash(h + 8) * 0.14)
  }
  for (let k = 0; k < 14; k++) {
    const h = salt * 211 + k * 5
    const x = -width / 2 + 0.3 + hash(h) * (width - 0.6)
    tint.copy(lush).offsetHSL(0, 0, (hash(h + 1) - 0.5) * 0.1)
    addLeaf(climberLeaf, tint.clone(), new THREE.Vector3(x, -p.thickness - 0.15 - hash(h + 2) * 0.6, p.depth + 0.08), new THREE.Vector3(0, 0, 1), (hash(h + 3) - 0.5) * 2, 0.17 + hash(h + 4) * 0.08)
  }
  spreaderLeaf.dispose()
  climberLeaf.dispose()
  const leafMesh = new THREE.Mesh(mergeGeometries(leaves), material)
  for (const g of leaves) g.dispose()
  leafMesh.receiveShadow = true

  group.add(rootMesh, slabPivot, leafMesh)

  const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
  const grow = (t: number) => {
    // Roots draw out along their length first…
    const r = ease(t / 0.55)
    rootMesh.geometry.setDrawRange(0, Math.max(3, Math.floor((rootCount * r) / 3) * 3))
    // …the slab pushes out of the wall…
    const s = ease((t - 0.2) / 0.6)
    slabPivot.scale.set(0.3 + 0.7 * s, 0.4 + 0.6 * s, Math.max(0.02, s))
    slabPivot.visible = s > 0
    // …and the leaves open last.
    const l = ease((t - 0.6) / 0.4)
    leafMesh.scale.set(1, Math.max(0.01, l), Math.max(0.01, l))
    leafMesh.visible = l > 0
  }
  grow(0)

  return {
    group,
    grow,
    dispose: () => {
      for (const mesh of [slabMesh, rootMesh, leafMesh]) mesh.geometry.dispose()
      material.dispose()
    },
  }
}
