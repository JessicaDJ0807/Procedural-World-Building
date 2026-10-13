import * as THREE from 'three'
import { mulberry32 } from '../noise'
import type { LeafPlacement, LeafSite, Segment, Skeleton } from './skeleton'
import { branchGeometry, leafGeometry, triangles, type LeafShape, type Palette } from './treeGeometry'

/**
 * Four versions of one tree, each built from the same skeleton and the same
 * leaf sites, so a tree changing level changes detail and never changes
 * shape.
 *
 * Detail comes off in three independent ways, and each LOD takes more of all
 * three:
 *
 * - **Thin branches.** A generation is dropped once its radius falls below a
 *   fraction of the trunk's. Thickness rather than generation number,
 *   because thickness is what decides whether a branch survives on screen at
 *   a distance: an oak's fifth generation is a tenth of the trunk and
 *   vanishes at twenty units, while a coral's is still more than a third of
 *   its base and holds the whole silhouette. Cutting both at "generation ≤ 1"
 *   left the coral's tips floating in the air with nothing under them. The
 *   trunk and first generation are always kept.
 * - **Segments per limb.** `F → FF` grammars draw a trunk as dozens of short
 *   steps in almost a straight line. Merging steps whose direction differs by
 *   less than a tolerance keeps the silhouette and removes most of the rings.
 * - **Sides and leaves.** Fewer sides per tube; fewer, larger leaves. Leaf
 *   size grows as 1/√keep so the canopy covers about the same area of screen
 *   — fewer leaves at the same size would make a distant tree look bare,
 *   which is a far more visible error than lost facets.
 *
 * LOD 3 is not a reduced tree but a stand-in: trunk and main limbs as
 * three-sided sticks, and the canopy as a few blobs fitted to where the
 * leaves are. A camera-facing billboard would be cheaper still, but it needs
 * each tree rendered to a texture first and it pops visibly when the camera
 * orbits; a 3D silhouette of ~100 triangles is already a rounding error next
 * to LOD 0.
 */
export type LodSpec = {
  name: string
  short: string
  /** Sides per branch tube. */
  radial: number
  /** Drop generations thinner than this fraction of the trunk. */
  minThickness: number
  /** Merge consecutive steps along a limb that turn by less than this. */
  mergeDegrees: number
  /** Fraction of leaf sites kept. */
  leafKeep: number
  leafDetail: 'full' | 'low'
  /** The debug colour, used by Show LOD colours and the rings. */
  colour: string
}

export const LODS: LodSpec[] = [
  { name: 'Full detail', short: 'LOD 0', radial: 7, minThickness: 0, mergeDegrees: 0, leafKeep: 1, leafDetail: 'full', colour: '#5fc98a' },
  { name: 'Medium', short: 'LOD 1', radial: 5, minThickness: 0.12, mergeDegrees: 12, leafKeep: 0.4, leafDetail: 'full', colour: '#e8c84f' },
  { name: 'Low', short: 'LOD 2', radial: 4, minThickness: 0.3, mergeDegrees: 28, leafKeep: 0.2, leafDetail: 'full', colour: '#ec9445' },
  { name: 'Very low', short: 'LOD 3', radial: 3, minThickness: 0.5, mergeDegrees: 60, leafKeep: 0.12, leafDetail: 'low', colour: '#e3605c' },
]

export type LodMesh = {
  branches: THREE.BufferGeometry
  leaves: THREE.BufferGeometry | null
  branchTris: number
  leafTris: number
  segments: number
  leafCount: number
  /** LOD 3's canopy stand-in rather than leaves. */
  blobs: boolean
}

export type TreeVariant = {
  lods: LodMesh[]
  /** For culling and LOD distance: the centre of the tree, and a radius around it. */
  centreY: number
  boundRadius: number
  height: number
  skeleton: Skeleton
  sites: LeafSite[]
}

export type VariantStyle = {
  leafShape: LeafShape
  leafPlacement: LeafPlacement
  leafSize: number
  palette: Palette
  colourByGeneration: boolean
  /** Rod radius for the skeleton view, or null for real wood. */
  skeletonRadius: number | null
}

/**
 * Greedy merge of consecutive segments along each limb.
 *
 * A run grows while the next segment starts where the run ends and points
 * within `degrees` of the run's overall direction — measured against the run,
 * not the last step, so a long gentle curve cannot creep through the
 * tolerance one degree at a time. Branches leaving the middle of a merged run
 * still start on the original axis, at most `length × sin(tolerance)` from
 * the new one.
 */
export function simplify(segments: Segment[], degrees: number): Segment[] {
  if (degrees <= 0) return segments
  const cos = Math.cos((degrees * Math.PI) / 180)
  const open = new Map<number, Segment>()
  const out: Segment[] = []
  const runDir = new THREE.Vector3()
  const stepDir = new THREE.Vector3()
  for (const s of segments) {
    const run = open.get(s.chain)
    if (run && run.b.equals(s.a)) {
      runDir.subVectors(run.b, run.a).normalize()
      stepDir.subVectors(s.b, s.a).normalize()
      if (runDir.dot(stepDir) >= cos) {
        run.b = s.b
        run.r1 = s.r1
        continue
      }
    }
    const fresh = { ...s, a: s.a, b: s.b }
    out.push(fresh)
    open.set(s.chain, fresh)
  }
  return out
}

/**
 * Leaves kept at a level: a fixed pseudo-random subset, the same one every
 * rebuild, and nested — every leaf at LOD 2 is also at LOD 1 — so stepping
 * down a level only ever removes leaves, never moves one.
 */
function keepLeaves(sites: LeafSite[], keep: number): LeafSite[] {
  if (keep >= 1) return sites
  if (keep <= 0) return []
  return sites.filter((_, i) => {
    const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453
    return h - Math.floor(h) < keep
  })
}

/**
 * The LOD 3 canopy: k-means on the leaf positions, one stretched blob per
 * cluster.
 *
 * One ellipsoid round a whole canopy turns a conifer into an egg; three
 * clusters is enough to keep a spire tall and narrow, an oak wide and lumpy,
 * and a coral's separate heads separate. Each blob's radii are its cluster's
 * spread along each axis, widened to cover roughly the outer leaves.
 */
function canopyBlobs(sites: LeafSite[], style: VariantStyle, seed: number): THREE.BufferGeometry | null {
  if (!sites.length) return null
  const k = Math.min(3, sites.length)
  const rand = mulberry32(seed + 99)
  const centres = Array.from({ length: k }, () => sites[Math.floor(rand() * sites.length)].position.clone())
  const assign = new Int32Array(sites.length)
  for (let iter = 0; iter < 8; iter++) {
    sites.forEach((site, i) => {
      let best = 0
      let bestD = Infinity
      centres.forEach((c, j) => {
        const d = c.distanceToSquared(site.position)
        if (d < bestD) {
          bestD = d
          best = j
        }
      })
      assign[i] = best
    })
    const sums = centres.map(() => new THREE.Vector3())
    const counts = new Array(k).fill(0)
    sites.forEach((site, i) => {
      sums[assign[i]].add(site.position)
      counts[assign[i]]++
    })
    sums.forEach((sum, j) => counts[j] && centres[j].copy(sum.divideScalar(counts[j])))
  }

  // Twenty faces per blob. At detail 1 (80 faces) the blobs were rounder,
  // but three of them set a floor of 240 triangles, and a sapling's whole
  // LOD 2 is 324 — the last level saved almost nothing on the smallest trees.
  const blob = new THREE.IcosahedronGeometry(1, 0)
  const shape = (blob.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
  const per = shape.length / 3
  const parts: { centre: THREE.Vector3; radii: THREE.Vector3; count: number }[] = []
  centres.forEach((centre, j) => {
    const spread = new THREE.Vector3()
    let count = 0
    sites.forEach((site, i) => {
      if (assign[i] !== j) return
      spread.x += (site.position.x - centre.x) ** 2
      spread.y += (site.position.y - centre.y) ** 2
      spread.z += (site.position.z - centre.z) ** 2
      count++
    })
    if (!count) return
    // 1.6 standard deviations covers most of a cluster without the blob
    // swelling past the canopy; the leaf size is added so a cluster of one
    // leaf is a leaf-sized blob, not a point.
    spread.divideScalar(count)
    const pad = style.leafSize * 0.8
    const radii = new THREE.Vector3(Math.sqrt(spread.x) * 1.6 + pad, Math.sqrt(spread.y) * 1.6 + pad, Math.sqrt(spread.z) * 1.6 + pad)
    parts.push({ centre, radii, count })
  })

  const positions = new Float32Array(parts.length * shape.length)
  const colours = new Float32Array(parts.length * shape.length)
  const low = new THREE.Color(style.palette.leafLow)
  const mid = low.clone().lerp(new THREE.Color(style.palette.leafHigh), 0.5)
  let p = 0
  for (const part of parts) {
    for (let j = 0; j < per; j++) {
      positions[p] = part.centre.x + shape[j * 3] * part.radii.x
      positions[p + 1] = part.centre.y + shape[j * 3 + 1] * part.radii.y
      positions[p + 2] = part.centre.z + shape[j * 3 + 2] * part.radii.z
      // Darker underneath, as the real canopy is in shadow from itself.
      const shade = 0.78 + 0.22 * (shape[j * 3 + 1] * 0.5 + 0.5)
      colours[p] = mid.r * shade
      colours[p + 1] = mid.g * shade
      colours[p + 2] = mid.b * shade
      p += 3
    }
  }
  blob.dispose()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  geometry.computeVertexNormals()
  return geometry
}

export function buildVariant(skeleton: Skeleton, sites: LeafSite[], style: VariantStyle, seed: number): TreeVariant {
  const lods = LODS.map((spec, level): LodMesh => {
    const kept = skeleton.segments.filter(
      (s) => s.generation <= 1 || skeleton.relativeRadius(s.generation) >= spec.minThickness,
    )
    // The skeleton view is for reading the graph, so it is never simplified —
    // merging steps would hide exactly the F-by-F structure it is there to show.
    const segments = style.skeletonRadius !== null ? kept : simplify(kept, spec.mergeDegrees)
    const branches = branchGeometry(segments, {
      radial: style.skeletonRadius !== null ? 3 : spec.radial,
      skeletonRadius: style.skeletonRadius,
      colourByGeneration: style.colourByGeneration,
      bark: style.palette.bark,
    })
    let leaves: THREE.BufferGeometry | null
    let leafCount: number
    // Blobs stand in for a canopy, which only twig-borne leaves make. Tip-only
    // leaves are scattered points with air between them — fitting blobs to
    // a coral's polyps turned it into a field of mushrooms — so they keep a
    // sparse, enlarged subset like the levels above.
    if (level === LODS.length - 1 && style.leafPlacement === 'twigs') {
      leaves = canopyBlobs(sites, style, seed)
      // Twenty triangles a blob; k-means can leave a cluster empty, so the
      // count is read back rather than assumed to be 3.
      leafCount = triangles(leaves) / 20
    } else {
      const subset = keepLeaves(sites, spec.leafKeep)
      leafCount = subset.length
      leaves = subset.length
        ? leafGeometry(subset, { shape: style.leafShape, detail: spec.leafDetail, size: style.leafSize, palette: style.palette }, 1 / Math.sqrt(spec.leafKeep))
        : null
    }
    return { branches, leaves, branchTris: triangles(branches), leafTris: triangles(leaves), segments: segments.length, leafCount, blobs: level === LODS.length - 1 && style.leafPlacement === 'twigs' }
  })

  const { centre, height, radius } = skeleton
  return {
    lods,
    centreY: centre.y,
    // Half the height or the full reach, whichever is larger, plus the leaf
    // overhang: generous, because culling a tree that is still on screen is
    // a visible bug and drawing one that is just off it costs nothing.
    boundRadius: Math.max(height * 0.6, radius) + style.leafSize * 2,
    height,
    skeleton,
    sites,
  }
}

export function disposeVariant(variant: TreeVariant) {
  for (const lod of variant.lods) {
    lod.branches.dispose()
    lod.leaves?.dispose()
  }
}

/**
 * Which level a tree should be at, given where it was.
 *
 * Without memory, a tree standing exactly on a threshold flips level every
 * time the camera's damping moves it a millimetre either way — which on a
 * slow orbit is a visible flicker along the whole ring. So each threshold is
 * a band: a tree only moves to a coarser level once it is `hysteresis` past
 * the threshold, and only moves back once it is `hysteresis` inside it. In
 * between it stays where it was.
 */
export function chooseLod(distance: number, current: number, thresholds: number[], hysteresis: number): number {
  let level = 0
  for (const t of thresholds) if (distance > t) level++
  if (current < 0 || level === current) return level
  // Moving coarser: require the distance past the threshold by the margin.
  if (level > current) {
    let allowed = current
    for (let i = current; i < thresholds.length; i++) if (distance > thresholds[i] * (1 + hysteresis)) allowed = i + 1
    return allowed
  }
  // Moving finer: require it inside the threshold by the margin.
  let allowed = current
  for (let i = current - 1; i >= 0; i--) if (distance < thresholds[i] * (1 - hysteresis)) allowed = i
  return allowed
}
