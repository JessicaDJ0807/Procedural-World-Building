import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { D, H, PALETTE, W, type Town } from './town'

/**
 * Turns the grid into a town: the rules that make a block into a house.
 *
 * The user only places and removes blocks; every block becomes something that
 * depends on its neighbours, so the same click reads differently in different
 * places — the Townscaper idea.
 *
 * - **Walls** only where a side faces open air, each with a window in a
 *   frame; on the ground floor one of a house's open sides gets a door
 *   instead.
 * - **Roofs** on a block with nothing above it, chosen by its neighbours at
 *   the same height:
 *   - none — a small hip roof, a house on its own;
 *   - only along one axis — a gable running along that row, so a terrace of
 *     blocks shares one continuous ridge;
 *   - along both axes — a flat roof terrace, with a parapet on each edge that
 *     opens onto a drop.
 *   Neighbours count whether or not something stands on them: the first
 *   version counted only roofed ones, and a 3 × 3 block with a house on its
 *   centre came out as gables meeting terraces, since each edge block had
 *   lost a neighbour to the house.
 * - **Arches**: a block with nothing under it that spans between two blocks
 *   at its own height stands on an arch — a gateway, or a bridge's arcade.
 * - **Stilts**: any other block with nothing under it stands on four posts
 *   down to whatever is below, or to the ground.
 * - **A footing**: blocks on the ground floor sit on a stone plinth.
 * - **String courses**: a thin ledge where a storey meets the one above, on
 *   each open side — the ledges the growth model gives the Spreader.
 *
 * Built as merged boxes and prisms in vertex colour, rebuilt in full on each
 * edit — a full grid is 1,568 cells, which rebuilds in a few milliseconds.
 */

// After the Site page: muted terracotta roofs rather than Townscaper's
// orange; limestone trim; slate glass, the Site's façade glass tint; a quay
// in the Site's land colour.
const ROOF = new THREE.Color('#a87d66')
const ROOF_DARK = new THREE.Color('#96705c')
const TRIM = new THREE.Color('#efe5d4')
const GLASS = new THREE.Color('#5d6876')
const DOOR = new THREE.Color('#6b5546')
const STONE = new THREE.Color('#b9ab92')
const POST = new THREE.Color('#d8ccb9')
const TERRACE = new THREE.Color('#d2c5b0')

/** Grid cell to world: the grid is centred on the origin, a cell a unit wide and a storey high. */
export const cellX = (x: number) => x - W / 2 + 0.5
export const cellZ = (z: number) => z - D / 2 + 0.5
export const worldToCell = (wx: number, wz: number) => [Math.floor(wx + W / 2), Math.floor(wz + D / 2)] as const

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a * 73856093 ^ b * 19349663 ^ c * 83492791, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function paint(geo: THREE.BufferGeometry, colour: THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  if (g !== geo) geo.dispose()
  if (g.attributes.uv) g.deleteAttribute('uv')
  if (!g.attributes.normal) g.computeVertexNormals()
  const c = new Float32Array(g.attributes.position.count * 3)
  for (let i = 0; i < g.attributes.position.count; i++) colour.toArray(c, i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, colour: THREE.Color) =>
  paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), colour)

/** A gable prism: a triangle `span` wide and `rise` high, `length` long along x (or z if `alongZ`). */
function gable(span: number, rise: number, length: number, alongZ: boolean, x: number, y: number, z: number, colour: THREE.Color) {
  const shape = new THREE.Shape([new THREE.Vector2(-span / 2, 0), new THREE.Vector2(span / 2, 0), new THREE.Vector2(0, rise)])
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false })
  // Extruded along +z, centred.
  geo.translate(0, 0, -length / 2)
  if (!alongZ) geo.rotateY(Math.PI / 2)
  geo.translate(x, y, z)
  return paint(geo, colour)
}

/**
 * An arch filling the top half of the empty cell under a spanning block: a
 * semicircular opening, the voussoirs in the house's colour, extruded through
 * the block's depth across the span.
 */
function arch(spanX: boolean, wx: number, y: number, wz: number, colour: THREE.Color) {
  const r = 0.42
  const pts = [new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.5, -0.55), new THREE.Vector2(r, -0.55)]
  for (let k = 1; k < 12; k++) {
    const a = (k / 12) * Math.PI
    pts.push(new THREE.Vector2(r * Math.cos(a), -0.55 + r * Math.sin(a)))
  }
  pts.push(new THREE.Vector2(-r, -0.55), new THREE.Vector2(-0.5, -0.55))
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.98, bevelEnabled: false })
  geo.translate(0, 0, -0.49)
  if (!spanX) geo.rotateY(Math.PI / 2)
  geo.translate(wx, y, wz)
  return paint(geo, colour)
}

export type TownGeometry = { geometry: THREE.BufferGeometry; ms: number }

/** The four sides of a block: the step to the neighbour, which is also the wall's outward normal. */
export const SIDES: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Roof shapes, in block units, shared with the growth model's roof surfaces
 * (surfaces.ts) so the slope a plant reads is the slope drawn. Three pitches,
 * so the roofs a player gets are three different surfaces: a terrace is flat;
 * a gable over a row is moderate, about 31°; a house's hip roof is steep,
 * about 49°. Before plants could grow on roofs both pitched kinds were about
 * 41–43°, and nothing told them apart.
 */
export const ROOF_SHAPE = {
  /** The eave line: the top of the trim board under every pitched roof. */
  eave: 0.06,
  hip: { half: 0.76 * Math.SQRT1_2, rise: 0.62 },
  gable: { half: 0.56, rise: 0.34 },
}

/** Window and door sizes and heights, in block units: shared with the growth model, so the glass plants avoid is the glass drawn. */
export const OPENING = {
  window: { w: 0.32, h: 0.42, cy: 0.58 },
  door: { w: 0.34, h: 0.62, cy: 0.31 },
}

/** Which roof a block gets: none if something stands on it; else by its neighbours at the same height. */
export function roofKind(town: Town, x: number, y: number, z: number): 'hip' | 'gable-x' | 'gable-z' | 'terrace' | null {
  if (!town.filled(x, y, z) || town.filled(x, y + 1, z)) return null
  const alongX = town.filled(x + 1, y, z) || town.filled(x - 1, y, z)
  const alongZ = town.filled(x, y, z + 1) || town.filled(x, y, z - 1)
  if (alongX && alongZ) return 'terrace'
  if (alongX) return 'gable-x'
  if (alongZ) return 'gable-z'
  return 'hip'
}

/** A block's open sides, and which of them is its door: one per ground-floor block, chosen by a hash of the column. */
export function openingsOf(town: Town, x: number, y: number, z: number): { nx: number; nz: number; door: boolean }[] {
  const open = SIDES.filter(([dx, dz]) => !town.filled(x + dx, y, z + dz))
  const doorSide = y === 0 && open.length ? Math.floor(hash(x, 0, z) * open.length) : -1
  return open.map(([nx, nz], k) => ({ nx, nz, door: k === doorSide }))
}

export function buildTown(town: Town): TownGeometry {
  const start = performance.now()
  const parts: THREE.BufferGeometry[] = []
  const tint = new THREE.Color()
  const has = (x: number, y: number, z: number) => town.filled(x, y, z)

  for (let y = 0; y < H; y++) {
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const value = town.get(x, y, z)
        if (!value) continue
        const wx = cellX(x)
        const wz = cellZ(z)
        const colour = tint.set(PALETTE[value - 1]).clone()
        // The block: a body, a hair narrower than the cell so the corners of neighbouring houses read.
        parts.push(box(0.98, 1, 0.98, wx, y + 0.5, wz, colour))

        // Windows and a door on the open sides.
        for (const { nx, nz, door: isDoor } of openingsOf(town, x, y, z)) {
          const fx = wx + nx * 0.5
          const fz = wz + nz * 0.5
          const along = nx !== 0 // the face runs along z
          const o = isDoor ? OPENING.door : OPENING.window
          const w = o.w
          const h = o.h
          const cy = y + o.cy
          const frame = (fw: number, fh: number, depth: number, colourOf: THREE.Color, out: number) =>
            parts.push(box(along ? depth : fw, fh, along ? fw : depth, fx + nx * out, cy, fz + nz * out, colourOf))
          frame(w + 0.08, h + 0.08, 0.03, TRIM, 0.005)
          frame(w, h, 0.03, isDoor ? DOOR : GLASS, 0.012)
          // A sill under each window.
          if (!isDoor) parts.push(box(along ? 0.06 : w + 0.12, 0.04, along ? w + 0.12 : 0.06, fx + nx * 0.03, cy - h / 2 - 0.05, fz + nz * 0.03, TRIM))
        }

        // An arch under a block that spans between two others at its own
        // height, with nothing beneath it — a gateway, or a bridge's arcade.
        const spanX = has(x - 1, y, z) && has(x + 1, y, z)
        const spanZ = has(x, y, z - 1) && has(x, y, z + 1)
        const arched = y > 0 && !has(x, y - 1, z) && (spanX || spanZ)
        if (arched) parts.push(arch(spanX, wx, y, wz, colour))

        // Stilts under any other block with nothing beneath it.
        if (y > 0 && !has(x, y - 1, z) && !arched) {
          let base = y - 1
          while (base >= 0 && !has(x, base, z)) base--
          const from = base + 1
          const height = y - from + (from === 0 ? 0.15 : 0)
          const bottom = from === 0 ? -0.15 : from
          for (const [cx, cz] of [
            [-0.4, -0.4],
            [0.4, -0.4],
            [-0.4, 0.4],
            [0.4, 0.4],
          ]) {
            parts.push(paint(new THREE.CylinderGeometry(0.05, 0.06, height, 6).translate(wx + cx, bottom + height / 2, wz + cz), POST))
          }
        }

        // A stone footing under a ground-floor block, down into the lawn.
        if (y === 0) parts.push(box(1.04, 0.4, 1.04, wx, -0.2, wz, STONE))

        // A string course where this storey meets the one above, on each open
        // side: the ledge a Spreader follows, drawn where the growth model has it.
        if (has(x, y + 1, z)) {
          for (const [dx, dz] of SIDES) {
            if (has(x + dx, y, z + dz) || has(x + dx, y + 1, z + dz)) continue
            parts.push(box(dx ? 0.06 : 1, 0.06, dx ? 1 : 0.06, wx + dx * 0.5, y + 1 - 0.02, wz + dz * 0.5, TRIM))
          }
        }

        // The roof.
        const kind = roofKind(town, x, y, z)
        if (kind) {
          const top = y + 1
          const alongX = kind === 'gable-x'
          const alongZ = kind === 'gable-z'
          if (kind === 'hip') {
            // A house on its own: a hip roof.
            parts.push(box(1.06, 0.06, 1.06, wx, top + 0.03, wz, TRIM))
            const { rise } = ROOF_SHAPE.hip
            const cone = new THREE.ConeGeometry(0.76, rise, 4, 1).rotateY(Math.PI / 4).translate(wx, top + ROOF_SHAPE.eave + rise / 2, wz)
            parts.push(paint(cone, hash(x, y, z) < 0.5 ? ROOF : ROOF_DARK))
          } else if (alongX || alongZ) {
            // A row: a gable along it, one ridge across the whole run.
            parts.push(box(alongX ? 1 : 1.06, 0.06, alongX ? 1.06 : 1, wx, top + 0.03, wz, TRIM))
            const { half, rise } = ROOF_SHAPE.gable
            parts.push(gable(half * 2, rise, 1, alongZ, wx, top + ROOF_SHAPE.eave, wz, ROOF))
            // Close the ends of the run with a gable wall in the house colour.
            for (const s of [-1, 1]) {
              const endOpen = alongX ? !has(x + s, y, z) : !has(x, y, z + s)
              if (!endOpen) continue
              // Thin, in the same orientation as the ridge: a wall across the run's
              // end, just outside the roof's own end face — set inside it, the two
              // were coplanar and flickered — so the roof's edge frames it.
              // The same slope as the roof, so it sits just under it.
              const end = gable(0.98, (rise * 0.98) / (half * 2), 0.012, alongZ, wx + (alongX ? s * 0.506 : 0), top + ROOF_SHAPE.eave, wz + (alongZ ? s * 0.506 : 0), colour)
              parts.push(end)
            }
          } else {
            // Neighbours both ways: a flat roof terrace, parapets where it drops away.
            parts.push(box(1, 0.08, 1, wx, top + 0.04, wz, TERRACE))
            for (const [dx, dz] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]) {
              if (has(x + dx, y, z + dz)) continue
              parts.push(box(dx ? 0.06 : 1, 0.18, dx ? 1 : 0.06, wx + dx * 0.47, top + 0.17, wz + dz * 0.47, colour))
            }
          }
        }
      }
    }
  }
  const geometry = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry()
  for (const p of parts) p.dispose()
  return { geometry, ms: performance.now() - start }
}
