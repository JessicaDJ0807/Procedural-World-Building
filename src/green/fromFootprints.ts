import { assembleBuilding, roofOf, type Building, type Corner, type Roof, type Volume, type WallSegment } from './building'

/**
 * A building as the city records it: an outline (outer ring, then any
 * courtyards) and one roof height. +x east, +z south, metres.
 */
export type Footprint = { outline: [number, number][][]; height: number }

/** Corners sharper than this are corners; shallower ones are a curved façade's facets. */
const CORNER_ANGLE = (20 * Math.PI) / 180
/** Field-texture width, and the gap left round each block so nearest sampling never bleeds. */
const ATLAS_WIDTH = 1024
const GAP = 1

/**
 * Shoelace area in (x, z). The invented building's outline, walked with the
 * outside on the left so that (−dz, dx) is the outward normal, comes out
 * negative, so every outer ring is turned to match, and every courtyard the
 * other way — then the same formula points each wall out of the solid.
 */
function signedArea(ring: [number, number][]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i]
    const [x1, z1] = ring[(i + 1) % ring.length]
    s += x0 * z1 - x1 * z0
  }
  return s / 2
}

const oriented = (ring: [number, number][], outer: boolean) =>
  (signedArea(ring) < 0) === outer ? ring : [...ring].reverse()

/**
 * Shelf packing: blocks sorted tallest first, laid left to right, a new shelf
 * when a row is full. Wastes some texture for no complexity at all, and the
 * texture is a few megabytes at most.
 */
function pack(blocks: { w: number; h: number; place: (u: number, v: number) => void }[]): number {
  const order = [...blocks].sort((a, b) => b.h - a.h)
  let u = 0
  let v = 0
  let shelf = 0
  for (const block of order) {
    if (u + block.w + GAP > ATLAS_WIDTH) {
      u = 0
      v += shelf + GAP
      shelf = 0
    }
    block.place(u, v)
    u += block.w + GAP
    shelf = Math.max(shelf, block.h)
  }
  return v + shelf
}

/**
 * Cells for real buildings, from footprints and heights alone.
 *
 * Every outline edge becomes a wall from the ground to the roof, every
 * footprint a flat roof, every vertex that turns by more than 20° a corner.
 * That is all the city's data holds: no windows, ledges, balconies or rooftop
 * plant, so none of the features the invented building's growth follows exist
 * here except corners, roof edges and the line where a wall meets a lower
 * neighbour's roof.
 *
 * `context` is more volumes that cast shadows on these buildings without
 * being grown on — the neighbours across the street. Returns the cells and,
 * for each cell, the index of the footprint it belongs to.
 */
export function buildFromFootprints(
  footprints: Footprint[],
  cell: number,
  context: Volume[] = [],
): { building: Building; owner: Int16Array } {
  const segments: WallSegment[] = []
  const roofs: Roof[] = []
  const corners: Corner[] = []
  const volumes: Volume[] = []
  const solids: Volume[] = []
  const blocks: { w: number; h: number; place: (u: number, v: number) => void }[] = []
  const segmentOwner: number[] = []

  footprints.forEach((fp, owner) => {
    const rings = fp.outline.map((ring, k) => oriented(ring, k === 0))
    const [outer, ...holes] = rings
    solids.push({ polygon: outer, holes, y0: 0, y1: fp.height })
    // Shadow rays test edges, so a courtyard's walls are simply more edges.
    for (const ring of rings) volumes.push({ polygon: ring, y0: 0, y1: fp.height })

    for (const ring of rings) {
      for (let k = 0; k < ring.length; k++) {
        const [ax, az] = ring[k]
        const [bx, bz] = ring[(k + 1) % ring.length]
        const length = Math.hypot(bx - ax, bz - az)
        const cols = Math.round(length / cell)
        if (cols === 0) continue
        const dx = (bx - ax) / length
        const dz = (bz - az) / length
        const seg: WallSegment = {
          ax, az, dx, dz, nx: -dz, nz: dx, length,
          y0: 0, y1: fp.height,
          cols, rows: Math.max(1, Math.round(fp.height / cell)),
          texU: 0, texV: 0,
        }
        segments.push(seg)
        segmentOwner.push(owner)
        blocks.push({ w: seg.cols, h: seg.rows, place: (u, v) => ((seg.texU = u), (seg.texV = v)) })

        // The turn at this edge's far end: positive is an inside corner.
        const [cx, cz] = ring[(k + 2) % ring.length]
        const nl = Math.hypot(cx - bx, cz - bz)
        const ex = (cx - bx) / nl
        const ez = (cz - bz) / nl
        const turn = Math.atan2(dx * ez - dz * ex, dx * ex + dz * ez)
        if (Math.abs(turn) > CORNER_ANGLE) corners.push({ x: bx, z: bz, y0: 0, y1: fp.height, inside: turn > 0 })
      }
    }

    const roof = roofOf(outer, fp.height, 0, 0, cell)
    if (holes.length) roof.holes = holes
    roofs.push(roof)
    blocks.push({ w: roof.cols, h: roof.rows, place: (u, v) => ((roof.texU = u), (roof.texV = v)) })
  })

  const texH = pack(blocks)
  const building = assembleBuilding({
    cell,
    segments,
    roofs,
    units: [],
    volumes: [...volumes, ...context],
    solids,
    corners,
    windows: [],
    overhangs: [],
    texW: ATLAS_WIDTH,
    texH,
  })

  // Which footprint each cell belongs to: a wall by its segment, a roof cell
  // by the roof whose texture block holds it.
  const owner = new Int16Array(building.count).fill(-1)
  for (let i = 0; i < building.count; i++) {
    if (building.segment[i] >= 0) {
      owner[i] = segmentOwner[building.segment[i]]
      continue
    }
    const u = building.texel[i] % building.texW
    const v = Math.floor(building.texel[i] / building.texW)
    owner[i] = roofs.findIndex((r) => u >= r.texU && u < r.texU + r.cols && v >= r.texV && v < r.texV + r.rows)
  }
  return { building, owner }
}
