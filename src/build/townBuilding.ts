import { CELL, assembleBuilding, roofOf, type Building, type Corner, type Overhang, type Roof, type Volume, type Window, type WallSegment } from '../green/building'
import { ATLAS_WIDTH, pack } from '../green/fromFootprints'
import { D, H, W, type Town } from './town'
import { OPENING, SIDES, cellX, cellZ, openingsOf, roofKind } from './townMesh'

/**
 * A town from the Build page, as a building the growth model can grow on.
 *
 * The growth model works on cells with neighbours (building.ts), and any
 * building can be described to it as walls, roofs and the solids that cast
 * shadows; `assembleBuilding` does the rest — cutting the surfaces into
 * cells, finding neighbours across corners and over edges by stepping across
 * the surface. So the town only has to be described:
 *
 * - **Scale.** A block is 3 units, one storey of the invented building, so
 *   the cells (0.25), the leaves and the platforms keep their size; the
 *   Build page draws the plants in a group scaled back down to the town.
 * - **Walls.** Each side of a column that faces the open becomes a wall
 *   segment, a run of exposed faces stacked into one, so rain runs down the
 *   whole of it. A floating block's walls start where it does.
 * - **Ledges** at every storey line inside a wall run: the string courses
 *   townMesh draws, which hold water and which the Spreader follows.
 * - **Windows and doors** are the town's own (townMesh's `openingsOf`), so the
 *   glass the plants avoid is the glass drawn.
 * - **Roofs.** Only flat roof terraces grow: a hip or gable roof is drawn as a
 *   solid shape, and plants on a flat surface under it would be hidden inside.
 * - **Solids.** Every vertical run of blocks is a box, for the sun's shadow
 *   rays and for the platform's free-space test.
 * - **Corners**, outside and inside, at every vertical edge where two open
 *   walls meet, or two walls meet round an empty cell.
 */

export const TOWN_SCALE = 3
/** The terrace slab's thickness, in blocks: townMesh draws it on top of the block. */
const TERRACE_SLAB = 0.08

export type TownBuilding = { building: Building; ms: number }

export function townToBuilding(town: Town): TownBuilding {
  const start = performance.now()
  const S = TOWN_SCALE
  const segments: WallSegment[] = []
  const windows: Window[] = []
  const roofs: Roof[] = []
  const volumes: Volume[] = []
  const corners: Corner[] = []
  const overhangs: Overhang[] = []
  const blocks: { w: number; h: number; place: (u: number, v: number) => void }[] = []
  const filled = (x: number, y: number, z: number) => town.filled(x, y, z)

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const cx = cellX(x) * S
      const cz = cellZ(z) * S
      // Vertical runs of blocks in this column: solids for shadows.
      for (let y = 0; y < H; ) {
        if (!filled(x, y, z)) {
          y++
          continue
        }
        const y0 = y
        while (y < H && filled(x, y, z)) y++
        const h = S / 2
        volumes.push({ polygon: [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]], y0: y0 * S, y1: y * S })
      }

      // Walls: for each side, runs of blocks whose face on that side is open.
      for (const [nx, nz] of SIDES) {
        for (let y = 0; y < H; ) {
          const open = filled(x, y, z) && !filled(x + nx, y, z + nz)
          if (!open) {
            y++
            continue
          }
          const y0 = y
          while (y < H && filled(x, y, z) && !filled(x + nx, y, z + nz)) y++
          // Along the wall so that (−dz, dx) is the outward normal, as building.ts expects.
          const dx = nz
          const dz = -nx
          const ax = cx + nx * (S / 2) - dx * (S / 2)
          const az = cz + nz * (S / 2) - dz * (S / 2)
          const seg: WallSegment = {
            ax, az, dx, dz, nx, nz,
            length: S,
            y0: y0 * S,
            y1: y * S,
            cols: Math.round(S / CELL),
            rows: Math.round(((y - y0) * S) / CELL),
            texU: 0,
            texV: 0,
          }
          const si = segments.length
          segments.push(seg)
          blocks.push({ w: seg.cols, h: seg.rows, place: (u, v) => ((seg.texU = u), (seg.texV = v)) })
          // A ledge at each storey line inside the run: the string course drawn there.
          for (let yy = y0 + 1; yy < y; yy++) overhangs.push({ segment: si, s0: 0, s1: S, y: yy * S, depth: 0.2, thickness: 0.25, kind: 'ledge' })
          // The town's own window or door on each storey of the run.
          for (let yy = y0; yy < y; yy++) {
            const opening = openingsOf(town, x, yy, z).find((o) => o.nx === nx && o.nz === nz)
            if (!opening) continue
            const o = opening.door ? OPENING.door : OPENING.window
            const mid = S / 2
            windows.push({ segment: si, s0: mid - (o.w * S) / 2, s1: mid + (o.w * S) / 2, y0: (yy + o.cy - o.h / 2) * S, y1: (yy + o.cy + o.h / 2) * S })
          }
        }
      }

      // Corners: at each of the column's four vertical edges, per storey.
      for (let y = 0; y < H; y++) {
        for (const [sx, sz] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          const ex = cx + sx * (S / 2)
          const ez = cz + sz * (S / 2)
          const here = filled(x, y, z)
          const a = filled(x + sx, y, z)
          const b = filled(x, y, z + sz)
          const diag = filled(x + sx, y, z + sz)
          // Outside: a block whose two sides at this edge are both open.
          if (here && !a && !b && !diag) corners.push({ x: ex, z: ez, y0: y * S, y1: (y + 1) * S, inside: false })
          // Inside: an empty cell with blocks on both sides of the edge.
          if (!here && a && b) corners.push({ x: ex, z: ez, y0: y * S, y1: (y + 1) * S, inside: true })
        }
      }

      // Roof terraces: the flat roofs, the only ones plants can grow on.
      for (let y = 0; y < H; y++) {
        if (roofKind(town, x, y, z) !== 'terrace') continue
        const h = S / 2
        // On the terrace slab townMesh draws (0.08 of a block thick), not at
        // the top of the block under it: there the cells, and every plant on
        // them, were buried inside the slab — invisible until the surface
        // debug view showed a terrace with no cells on it.
        const roof = roofOf([[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]], (y + 1 + TERRACE_SLAB) * S, 0, 0, CELL)
        roofs.push(roof)
        blocks.push({ w: roof.cols, h: roof.rows, place: (u, v) => ((roof.texU = u), (roof.texV = v)) })
      }
    }
  }

  const texH = Math.max(1, pack(blocks))
  const building = assembleBuilding({
    cell: CELL,
    segments,
    roofs,
    units: [],
    volumes,
    corners,
    windows,
    overhangs,
    texW: ATLAS_WIDTH,
    texH,
  })
  return { building, ms: performance.now() - start }
}

