import * as THREE from 'three'
import { CELL, LEDGE, FRAME, ROOF, type Building } from './building'
import type { Growth } from './growth'
import { FLOWER_COLOURS, SPECIES, SPECIES_IDS, SPECIES_LOOK, type SpeciesId } from './species'

/**
 * Draws what the simulation grew. Decides nothing about where.
 *
 * Five instanced meshes at any size: one set of stems shared by the two
 * climbers, one leaf mesh per species — lobed ivy, flat moss clumps, oval vine
 * leaves — and the vine's flowers. Moss gets no stem: it is a carpet, not a
 * line.
 *
 * ## Age lives in the shader
 *
 * Every instance carries the step it was born at. A uniform holds the current
 * step, with a fractional part between simulation steps, and the vertex shader
 * turns the difference into size: a stem draws out over its first three steps
 * and thickens over four hundred; a leaf opens over thirty. So a simulation
 * step only *appends* instances — it never rewrites an old one — and growth
 * animates smoothly at any speed without a matrix being touched.
 *
 * A cell's leaves are born at staggered times, which is the whole of the
 * "older growth is denser" rule; flowers open on vine cells 70 steps old.
 *
 * ## Shades of green
 *
 * Four things set a leaf's colour, from coarse to fine:
 * - its **species**, each with its own young, lush and dry greens;
 * - its **age** — new leaves are the young colour and mature over 160 steps;
 * - its cell's **moisture** — a dry cell pulls the mature colour toward olive;
 * - its own **variation** — a per-leaf nudge of up to ±0.025 in hue, ±0.1 in
 *   saturation and ±0.07 in lightness, and ±20% in width, so a wall reads as
 *   foliage rather than one flat green.
 * The moisture tint is the one place a field shows through in the final view.
 */

type LeafSpec = {
  perCell: number
  delays: number[]
  size: [number, number]
  /** Tilt away from the wall, radians: [min, range]. Moss lies flat. */
  tilt: [number, number]
  /** Shift along the wall normal from the stem line. Moss sits on the wall, not on a stem. */
  offset: number
  matureSteps: number
}

const LEAVES: Record<SpeciesId, LeafSpec> = {
  ivy: { perCell: 3, delays: [2, 30, 80], size: [0.2, 0.14], tilt: [0.35, 0.6], offset: 0, matureSteps: 160 },
  moss: { perCell: 3, delays: [1, 14, 40], size: [0.3, 0.16], tilt: [0, 0.12], offset: -0.045, matureSteps: 110 },
  vine: { perCell: 2, delays: [2, 40], size: [0.18, 0.1], tilt: [0.3, 0.5], offset: 0, matureSteps: 160 },
}

const FLOWER_DELAY = 70
/** Fraction of vine cells that flower. All of them would read as a pink wall, not a vine. */
const FLOWER_SHARE = 0.25

/** Deterministic per-cell jitter, so the grid does not show through as a lattice. */
export function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const AGE_HEAD = /* glsl */ `
attribute float aBirth;
uniform float uStep;
varying float vAge;
`

export function stemMaterial(uStep: { value: number }) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uStep = uStep
    shader.vertexShader = AGE_HEAD + shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      #include <begin_vertex>
      float age = uStep - aBirth;
      // Draw out along the segment, then thicken with age.
      transformed.y *= clamp(age / 3.0, 0.0, 1.0);
      transformed.xz *= mix(0.012, 0.04, clamp(age / 400.0, 0.0, 1.0));
      vAge = clamp(age / 400.0, 0.0, 1.0);
      `,
    )
    // New stems are green; the instance colour is the species' mature stem.
    shader.fragmentShader = 'varying float vAge;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>',
      /* glsl */ `
      #include <color_fragment>
      diffuseColor.rgb = mix(vec3(0.3, 0.42, 0.14), diffuseColor.rgb, vAge);
      `,
    )
  }
  return material
}

export function leafMaterial(uStep: { value: number }, young: string | null, matureSteps: number, openSteps: number, flat = false) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide, flatShading: flat })
  const youngLinear = young ? new THREE.Color(young) : null
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uStep = uStep
    shader.vertexShader = AGE_HEAD + shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      #include <begin_vertex>
      float age = uStep - aBirth;
      // Hidden until born, then open.
      transformed *= smoothstep(0.0, ${openSteps.toFixed(1)}, age);
      vAge = clamp(age / ${matureSteps.toFixed(1)}, 0.0, 1.0);
      `,
    )
    if (youngLinear) {
      const { r, g, b } = youngLinear
      shader.fragmentShader = 'varying float vAge;\n' + shader.fragmentShader.replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        diffuseColor.rgb = mix(vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)}), diffuseColor.rgb, vAge);
        `,
      )
    } else {
      shader.fragmentShader = 'varying float vAge;\n' + shader.fragmentShader
    }
  }
  return material
}

/** Fan-triangulates a closed outline around a raised centre point, so the leaf has a ridge. */
function fan(outline: [number, number][], centre: [number, number, number]): THREE.BufferGeometry {
  const p: number[] = []
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i]
    const [bx, by] = outline[(i + 1) % outline.length]
    p.push(...centre, ax, ay, 0, bx, by, 0)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  geo.computeVertexNormals()
  return geo
}

/** Ivy: five-pointed and lobed, along +y from the stalk at the origin. */
export function ivyLeaf() {
  const right: [number, number][] = [[0.14, 0.1], [0.44, 0.34], [0.25, 0.42], [0.32, 0.66], [0.12, 0.68]]
  const outline: [number, number][] = [[0, 0], ...right, [0, 1], ...right.slice().reverse().map(([x, y]) => [-x, y] as [number, number])]
  return fan(outline, [0, 0.45, 0.1])
}

/** Vine: a plain oval with a pointed tip. */
export function vineLeaf() {
  const outline: [number, number][] = []
  const N = 9
  for (let i = 0; i <= N; i++) {
    const t = (Math.PI * i) / N
    outline.push([0.34 * Math.sin(t) * (1 - 0.25 * (i / N)), 0.5 - 0.5 * Math.cos(t)])
  }
  for (let i = N - 1; i > 0; i--) outline.push([-outline[i][0], outline[i][1]])
  return fan(outline, [0, 0.45, 0.08])
}

/**
 * Moss: a low, faceted clump that sits on the wall rather than standing off it.
 *
 * Detail 0 — twenty faces, sixty vertices. At detail 1 (eighty faces) moss was
 * 39% of every mature frame's vertices while covering 13% of the building:
 * 1.09 million of 2.8 million. Squashed to a third of its depth and flat-shaded,
 * the coarser ball still reads as a clump.
 */
function mossClump() {
  // Polyhedra are built non-indexed already, so no toNonIndexed() here.
  const geo = new THREE.IcosahedronGeometry(0.5, 0)
  geo.scale(1, 1, 0.35)
  geo.translate(0, 0, 0.12)
  geo.deleteAttribute('uv')
  geo.computeVertexNormals()
  return geo
}

/** Flower: a flat five-petalled star, centred on the origin. */
function flower() {
  const outline: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10 + Math.PI / 2
    const r = i % 2 === 0 ? 0.5 : 0.2
    outline.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return fan(outline, [0, 0, 0.06])
}

const GEOMETRY: Record<SpeciesId, () => THREE.BufferGeometry> = { ivy: ivyLeaf, moss: mossClump, vine: vineLeaf }

/** A species' leaf shape, unit-sized along +y from its stalk — for other renderers of the same plants. */
export function leafGeometry(id: SpeciesId): THREE.BufferGeometry {
  return GEOMETRY[id]()
}

export class Batch {
  readonly mesh: THREE.InstancedMesh
  readonly birth: THREE.InstancedBufferAttribute
  count = 0
  private from = 0

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, coloured: boolean) {
    this.birth = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
    geometry.setAttribute('aBirth', this.birth)
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity)
    if (coloured) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    this.mesh.count = 0
    // Instances cover the whole building; the source geometry's bounds would
    // cull them all as soon as the origin left the frame.
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  }

  push(matrix: THREE.Matrix4, born: number, colour?: THREE.Color) {
    this.mesh.setMatrixAt(this.count, matrix)
    if (colour) this.mesh.setColorAt(this.count, colour)
    this.birth.setX(this.count, born)
    this.count++
  }

  /**
   * Marks what was appended since the last flush for upload. Ranges are added,
   * never cleared here — three.js clears them itself once uploaded — so two
   * syncs before one frame both reach the GPU. Clearing them here was a bug:
   * Reset followed by a step in the same frame lost the seeds' first instances.
   */
  flush() {
    if (this.count === this.from) return
    const range = (attr: THREE.BufferAttribute, size: number) => {
      attr.addUpdateRange(this.from * size, (this.count - this.from) * size)
      attr.needsUpdate = true
    }
    range(this.mesh.instanceMatrix, 16)
    range(this.birth, 1)
    if (this.mesh.instanceColor) range(this.mesh.instanceColor, 3)
    this.mesh.count = this.count
    this.from = this.count
  }

  clear() {
    this.count = 0
    this.from = 0
    this.mesh.count = 0
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}

export class Vegetation {
  readonly uStep = { value: 0 }
  private readonly stems: Batch
  private readonly leaves: Batch[]
  private readonly flowers: Batch
  private drawn = 0
  private readonly b: Building
  private readonly cellPos: Float32Array

  constructor(b: Building) {
    this.b = b
    const cells = b.count

    const stemGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true)
    stemGeo.translate(0, 0.5, 0)
    this.stems = new Batch(stemGeo, stemMaterial(this.uStep), cells, true)

    this.leaves = SPECIES_IDS.map((id) => {
      const spec = LEAVES[id]
      const material = leafMaterial(this.uStep, SPECIES_LOOK[id].young, spec.matureSteps, 30, id === 'moss')
      return new Batch(GEOMETRY[id](), material, cells * spec.perCell, true)
    })
    this.flowers = new Batch(flower(), leafMaterial(this.uStep, null, 1, 20), cells, true)

    // Neither stems nor leaves cast shadows: the depth pass would not run the
    // age scaling above, and would draw every stem at its unscaled one-unit radius.
    for (const batch of [...this.leaves, this.flowers]) batch.mesh.receiveShadow = true

    // Where each cell's stem runs: off the surface far enough to clear what is
    // there — further on a ledge row, which sticks out 0.2; less on a roof,
    // which has nothing on it — with a small jitter across the surface so
    // stems do not line up on the grid.
    this.cellPos = new Float32Array(cells * 3)
    for (let i = 0; i < cells; i++) {
      const f = b.flags[i]
      const off = (f & LEDGE ? 0.25 : f & FRAME ? 0.1 : f & ROOF ? 0.04 : 0.07) + hash(i * 3 + 2) * 0.03
      const ja = (hash(i * 3) - 0.5) * CELL * 0.7
      const ju = (hash(i * 3 + 1) - 0.5) * CELL * 0.7
      this.cellPos[i * 3] = b.px[i] + b.nx[i] * off + b.ax[i] * ja + b.ux[i] * ju
      this.cellPos[i * 3 + 1] = b.py[i] + b.ny[i] * off + b.ay[i] * ja + b.uy[i] * ju
      this.cellPos[i * 3 + 2] = b.pz[i] + b.nz[i] * off + b.az[i] * ja + b.uz[i] * ju
    }
  }

  /** Every mesh, for adding to a scene. */
  get meshes(): THREE.InstancedMesh[] {
    return [this.stems.mesh, ...this.leaves.map((l) => l.mesh), this.flowers.mesh]
  }

  /** Leaves and flowers — what the field views hide so the field can be read. */
  get foliage(): THREE.InstancedMesh[] {
    return [...this.leaves.map((l) => l.mesh), this.flowers.mesh]
  }

  get leafCount(): number {
    return this.leaves.reduce((sum, l) => sum + l.count, 0) + this.flowers.count
  }

  clear() {
    this.drawn = 0
    for (const batch of [this.stems, ...this.leaves, this.flowers]) batch.clear()
  }

  /** Appends instances for every cell grown since the last call. */
  sync(growth: Growth, moisture: Float32Array) {
    if (growth.grown < this.drawn) this.clear()
    if (growth.grown === this.drawn) return
    const m = new THREE.Matrix4()
    const a = new THREE.Vector3()
    const c = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const q = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const colour = new THREE.Color()
    const looks = SPECIES_IDS.map((id) => ({
      lush: new THREE.Color(SPECIES_LOOK[id].lush),
      dry: new THREE.Color(SPECIES_LOOK[id].dry),
      stem: new THREE.Color(SPECIES_LOOK[id].stem),
    }))
    const flowerColours = FLOWER_COLOURS.map((hex) => new THREE.Color(hex))
    const pos = this.cellPos
    const { b } = this

    for (let k = this.drawn; k < growth.grown; k++) {
      const cell = growth.order[k]
      const sp = growth.species[cell]
      const id = SPECIES_IDS[sp]
      const parent = growth.parent[cell]
      const born = growth.birth[cell]
      c.set(pos[cell * 3], pos[cell * 3 + 1], pos[cell * 3 + 2])

      if (SPECIES[id].stems) {
        // A seed has no parent: give it a short stub out of the ground.
        if (parent >= 0) a.set(pos[parent * 3], pos[parent * 3 + 1], pos[parent * 3 + 2])
        else a.set(c.x, 0, c.z)
        dir.subVectors(c, a)
        const length = Math.max(dir.length(), 1e-4)
        q.setFromUnitVectors(up, dir.divideScalar(length))
        m.compose(a, q, scale.set(1, length, 1))
        this.stems.push(m, born, looks[sp].stem)
      }

      // Leaves face out from the surface, each turned to its own angle around
      // its normal and tipped away from it by the species' tilt. `face` is the
      // surface's "up" — up the wall, or toward −z on a roof.
      const n = new THREE.Vector3(b.nx[cell], b.ny[cell], b.nz[cell])
      const t = new THREE.Vector3(b.ax[cell], b.ay[cell], b.az[cell])
      const face = new THREE.Vector3(b.ux[cell], b.uy[cell], b.uz[cell])
      const spec = LEAVES[id]
      const wet = Math.min(1, moisture[cell] * 1.4)
      for (let j = 0; j < spec.perCell; j++) {
        const h = cell * 7 + j * 131
        const spin = (hash(h) - 0.5) * Math.PI * 1.6
        const tilt = spec.tilt[0] + hash(h + 1) * spec.tilt[1]
        const along = new THREE.Vector3().addScaledVector(face, Math.cos(spin)).addScaledVector(t, Math.sin(spin))
        const yAxis = along.multiplyScalar(Math.cos(tilt)).addScaledVector(n, Math.sin(tilt)).normalize()
        const zAxis = n.clone().addScaledVector(yAxis, -n.dot(yAxis)).normalize()
        const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis)
        const size = spec.size[0] + hash(h + 2) * spec.size[1]
        const width = 0.8 + hash(h + 6) * 0.4
        m.makeBasis(xAxis.multiplyScalar(size * width), yAxis.multiplyScalar(size), zAxis.multiplyScalar(size))
        // Jitter across the surface only, never into it.
        const ja = (hash(h + 3) - 0.5) * 0.12
        const ju = (hash(h + 4) - 0.5) * 0.12
        m.setPosition(
          c.x + n.x * spec.offset + t.x * ja + face.x * ju,
          c.y + n.y * spec.offset + t.y * ja + face.y * ju,
          c.z + n.z * spec.offset + t.z * ja + face.z * ju,
        )
        colour.copy(looks[sp].dry).lerp(looks[sp].lush, wet)
        colour.offsetHSL((hash(h + 7) - 0.5) * 0.05, (hash(h + 8) - 0.5) * 0.2, (hash(h + 9) - 0.5) * 0.14)
        this.leaves[sp].push(m, born + spec.delays[j], colour)
      }

      if (id === 'vine' && hash(cell * 13 + 5) < FLOWER_SHARE) {
        const h = cell * 17 + 3
        // 0.26–0.36 across. At the default camera a unit is about 43 px, and the
        // first attempt, 0.10–0.15 across, drew each flower at four to six
        // pixels among leaves twice that size — in the scene, and invisible.
        const size = 0.26 + hash(h) * 0.1
        const zAxis = n.clone()
        const yAxis = new THREE.Vector3().addScaledVector(face, Math.cos(hash(h + 1) * 6.28)).addScaledVector(t, Math.sin(hash(h + 1) * 6.28))
        const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis)
        m.makeBasis(xAxis.multiplyScalar(size), yAxis.multiplyScalar(size), zAxis.multiplyScalar(size))
        // Just proud of the leaves, so a flower is not buried in its own foliage.
        const lift = (hash(h + 2) - 0.5) * 0.1
        m.setPosition(c.x + n.x * 0.16 + face.x * lift, c.y + n.y * 0.16 + face.y * lift, c.z + n.z * 0.16 + face.z * lift)
        this.flowers.push(m, born + FLOWER_DELAY, flowerColours[hash(h + 3) < 0.6 ? 0 : 1])
      }
    }
    this.drawn = growth.grown
    for (const batch of [this.stems, ...this.leaves, this.flowers]) batch.flush()
  }

  dispose() {
    for (const batch of [this.stems, ...this.leaves, this.flowers]) batch.dispose()
  }
}
