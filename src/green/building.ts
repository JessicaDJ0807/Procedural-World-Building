/**
 * The building, as the growth simulation sees it.
 *
 * ## Cells and a neighbour table
 *
 * Every surface a plant can grow on — walls and roofs — is cut into 0.25-unit
 * square cells. A cell knows where it is, which way it faces, two directions
 * across its surface, and its eight neighbours. Growth, the fields and the
 * renderer all work from that and nothing else.
 *
 * The first version unrolled the walls into one strip grid, where neighbours
 * were index arithmetic and a corner was just the next column. That was the
 * right choice for walls alone, and it is why this version still lays the
 * walls out the same way. But a roof cannot be a column of a strip, and the
 * line where a wall meets a roof is neither a row nor a column. So neighbours
 * are found geometrically instead: step one cell across the surface, in each
 * of the eight directions, and take the nearest cell to where you land. On a
 * flat wall that is the cell next door; past an outside corner it is the first
 * cell round it; up off the top of a wall it is the edge of the roof; down off
 * the foot of a wall that stands on a roof, it is the roof. No case is written
 * for any of them.
 *
 * ## The building
 *
 * The original L-shaped block, five floors (15 units), with a two-floor wing
 * (6 units) added along its west side. The wing gives the building a roof
 * terrace at the second floor, and a wall that rises from that terrace up the
 * side of the main block: a place where a wall meets a roof, which the plain L
 * did not have.
 *
 * What still cannot be represented: the underside of a balcony, a planter,
 * anything curved. Those are geometry for rendering and *features* for the
 * simulation — they change the cells near them — but nothing grows on them.
 *
 * Everything here is plain data and typed arrays, with no three.js, so the
 * simulation can be run and measured outside the browser.
 */

/** Edge length of one cell, in world units. A floor is 12 cells tall. */
export const CELL = 0.25
export const FLOOR_HEIGHT = 3
/** The main block's height: five floors. */
export const HEIGHT = 15
/** The wing's height: two floors. */
export const WING_HEIGHT = 6

/**
 * The outline of both volumes together, walked with the outside on the left.
 *
 * The L's inside corner at (3, 0) is the original reason for the shape: a
 * convex box never shades itself. The wing runs from x = −14 to −8 along the
 * L's west side.
 */
export const OUTLINE: [number, number][] = [
  [-14, 0],
  [3, 0],
  [3, 5],
  [8, 5],
  [8, -5],
  [-14, -5],
]

/** The main block's footprint (the original L) and the wing's. */
export const MAIN_FOOTPRINT: [number, number][] = [
  [-8, 0],
  [3, 0],
  [3, 5],
  [8, 5],
  [8, -5],
  [-8, -5],
]
export const WING_FOOTPRINT: [number, number][] = [
  [-14, 0],
  [-8, 0],
  [-8, -5],
  [-14, -5],
]

/** Per-cell features. A cell can be several at once. */
export const GLASS = 1
export const LEDGE = 2
export const FRAME = 4
export const SHELTER = 8
export const ROOF = 16
/** Under a rooftop unit: part of the roof, but nothing can grow there. */
export const BLOCKED = 32
/** A roof edge, a cell against a rooftop unit, or where a wall meets a roof — something to follow. */
export const EDGE = 64

/** Cells nothing can grow on. */
export const UNGROWABLE = GLASS | BLOCKED

/** A rectangle of wall: a straight run of footprint, between two heights. */
export type WallSegment = {
  ax: number
  az: number
  /** Unit direction along the wall. */
  dx: number
  dz: number
  /** Outward normal: the direction this wall faces. */
  nx: number
  nz: number
  length: number
  y0: number
  y1: number
  /** Where this segment's cells start in the field texture, in texels. */
  texU: number
  texV: number
}

/** A horizontal projection off one wall: a balcony slab, a ledge, the cornice. */
export type Overhang = {
  segment: number
  /** Span along the segment, from its start. */
  s0: number
  s1: number
  /** Height of the underside. */
  y: number
  depth: number
  thickness: number
  kind: 'balcony' | 'ledge' | 'cornice'
}

export type Window = { segment: number; s0: number; s1: number; y0: number; y1: number }

export type Roof = {
  polygon: [number, number][]
  y: number
  /** Grid origin: the minimum corner of the polygon's bounds. */
  x0: number
  z0: number
  cols: number
  rows: number
  texU: number
  texV: number
}

/** A box on a roof — stair housing, a plant unit. Casts shadows, blocks growth. */
export type Unit = { x: number; z: number; w: number; d: number; h: number; roof: number }

/** A solid for shadow rays: a footprint polygon between two heights. */
export type Volume = { polygon: [number, number][]; y0: number; y1: number }

/** A vertical edge between two walls, over the heights where it exists. */
export type Corner = { x: number; z: number; y0: number; y1: number; inside: boolean }

export type Building = {
  /** Number of cells. Every per-cell array has this length. */
  count: number
  /** Surface point. */
  px: Float32Array
  py: Float32Array
  pz: Float32Array
  /** Outward normal. */
  nx: Float32Array
  ny: Float32Array
  nz: Float32Array
  /** "Across" and "up" in the surface: along the wall and up it, or +x and −z on a roof. */
  ax: Float32Array
  ay: Float32Array
  az: Float32Array
  ux: Float32Array
  uy: Float32Array
  uz: Float32Array
  flags: Uint8Array
  /**
   * Eight neighbours per cell, −1 where there is none, in the order
   * (−1,−1) (0,−1) (1,−1) (−1,0) (1,0) (−1,1) (0,1) (1,1) — (across, up).
   */
  neighbours: Int32Array
  /** Which wall segment a cell is on, or −1 for a roof cell. */
  segment: Int16Array
  /** Distance along its segment, for wall cells. */
  along: Float32Array
  /** Horizontal distance to the nearest vertical corner at this height, and whether it is an inside one. */
  cornerDist: Float32Array
  cornerInside: Uint8Array
  /** Field-texture index (row × texW + column). */
  texel: Int32Array
  texW: number
  texH: number
  /** Wall cells in columns, top to bottom, for anything that flows downward. */
  columns: Int32Array[]
  /** Cells at the foot of the wall, in order around the outline — where seeds go. */
  ground: Int32Array
  segments: WallSegment[]
  roofs: Roof[]
  units: Unit[]
  volumes: Volume[]
  corners: Corner[]
  windows: Window[]
  overhangs: Overhang[]
}

/** Neighbour slot order, as (across, up) steps. */
export const SLOTS: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
]

/** Slots for "across": left and right. Used by the sideways moisture blur. */
export const ACROSS_SLOTS = [3, 4]
/** The slot straight down. */
export const DOWN_SLOT = 1

function wallSegments(): WallSegment[] {
  const segments: WallSegment[] = []
  const add = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number, texU: number, texV: number) => {
    const length = Math.hypot(bx - ax, bz - az)
    const dx = (bx - ax) / length
    const dz = (bz - az) / length
    segments.push({ ax, az, dx, dz, nx: -dz, nz: dx, length, y0, y1, texU, texV })
  }
  // The outline, split where the height changes. Texture columns follow the
  // walk, so the walls read left to right in the texture as they do round
  // the building.
  let s = 0
  const run = (a: [number, number], b: [number, number], height: number) => {
    add(a[0], a[1], b[0], b[1], 0, height, s / CELL, 0)
    s += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  run([-14, 0], [-8, 0], WING_HEIGHT)
  run([-8, 0], [3, 0], HEIGHT)
  run([3, 0], [3, 5], HEIGHT)
  run([3, 5], [8, 5], HEIGHT)
  run([8, 5], [8, -5], HEIGHT)
  run([8, -5], [-8, -5], HEIGHT)
  run([-8, -5], [-14, -5], WING_HEIGHT)
  run([-14, -5], [-14, 0], WING_HEIGHT)
  // The main block's west wall above the wing's roof, facing −x. Its texture
  // goes below the outline strip.
  add(-8, -5, -8, 0, WING_HEIGHT, HEIGHT, 0, HEIGHT / CELL)
  return segments
}

/**
 * Windows in bays, ledges at every floor line, a cornice at every top edge,
 * balconies on the long front and the east wing.
 *
 * Bays are 2.5 units, centred on the wall, and kept 0.9 clear of each end so a
 * corner is always a strip of solid wall — which is what lets "follows the
 * corner" be told apart from "follows the window frames".
 */
function features(segments: WallSegment[]): { windows: Window[]; overhangs: Overhang[] } {
  const windows: Window[] = []
  const overhangs: Overhang[] = []
  const BAY = 2.5
  const PANE = 1.25

  segments.forEach((seg, index) => {
    const bays = Math.floor((seg.length - 1.8) / BAY)
    const margin = (seg.length - bays * BAY) / 2
    for (let base = 0; base < seg.y1; base += FLOOR_HEIGHT) {
      if (base < seg.y0) continue
      for (let b = 0; b < bays; b++) {
        const centre = margin + (b + 0.5) * BAY
        // Ground floor windows sit higher, like a plinth; the others line up.
        const y0 = base + (base === 0 ? 1.0 : 0.75)
        windows.push({ segment: index, s0: centre - PANE / 2, s1: centre + PANE / 2, y0, y1: y0 + 1.75 })
      }
    }
    for (let y = FLOOR_HEIGHT; y < seg.y1; y += FLOOR_HEIGHT) {
      if (y <= seg.y0) continue
      overhangs.push({ segment: index, s0: 0, s1: seg.length, y, depth: 0.2, thickness: 0.25, kind: 'ledge' })
    }
    overhangs.push({ segment: index, s0: 0, s1: seg.length, y: seg.y1 - 0.35, depth: 0.35, thickness: 0.35, kind: 'cornice' })
  })

  // Balconies on the long front wall (segment 1) — floors 2 and 4, alternating
  // bays — and one on the east wing's front (segment 3). Placed under windows
  // so a balcony and its window read as a door onto it.
  const front = segments[1]
  const frontBays = Math.floor((front.length - 1.8) / BAY)
  const frontMargin = (front.length - frontBays * BAY) / 2
  for (const floor of [1, 3]) {
    for (let b = floor === 1 ? 0 : 1; b < frontBays; b += 2) {
      const centre = frontMargin + (b + 0.5) * BAY
      overhangs.push({ segment: 1, s0: centre - 1.05, s1: centre + 1.05, y: floor * FLOOR_HEIGHT + 0.25, depth: 1.2, thickness: 0.18, kind: 'balcony' })
    }
  }
  overhangs.push({ segment: 3, s0: 1.4, s1: 3.6, y: 2 * FLOOR_HEIGHT + 0.25, depth: 1.2, thickness: 0.18, kind: 'balcony' })

  return { windows, overhangs }
}

function inside(polygon: [number, number][], x: number, z: number): boolean {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]
    const [xj, zj] = polygon[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

export function buildBuilding(): Building {
  const segments = wallSegments()
  const { windows, overhangs } = features(segments)

  // Roofs: the main block's L, and the wing's terrace. Their texture regions
  // sit beside the upper wall's, below the outline strip.
  const roofOf = (polygon: [number, number][], y: number, texU: number, texV: number): Roof => {
    const xs = polygon.map((p) => p[0])
    const zs = polygon.map((p) => p[1])
    const x0 = Math.min(...xs)
    const z0 = Math.min(...zs)
    return {
      polygon,
      y,
      x0,
      z0,
      cols: Math.round((Math.max(...xs) - x0) / CELL),
      rows: Math.round((Math.max(...zs) - z0) / CELL),
      texU,
      texV,
    }
  }
  const stripRows = HEIGHT / CELL
  const upperCols = Math.round(segments[8].length / CELL)
  const roofs = [
    roofOf(MAIN_FOOTPRINT, HEIGHT, upperCols + 4, stripRows),
    roofOf(WING_FOOTPRINT, WING_HEIGHT, upperCols + 4 + 64 + 4, stripRows),
  ]
  const units: Unit[] = [
    { x: -4.5, z: -2.6, w: 3.2, d: 2.6, h: 2.2, roof: 0 },
    { x: 1.5, z: -3.2, w: 1.6, d: 1.2, h: 0.8, roof: 0 },
    { x: 5.6, z: 1.8, w: 1.2, d: 1.0, h: 0.7, roof: 0 },
  ]

  // --- create cells ---
  type Proto = {
    p: [number, number, number]
    n: [number, number, number]
    a: [number, number, number]
    u: [number, number, number]
    flags: number
    segment: number
    along: number
    texel: [number, number]
  }
  const protos: Proto[] = []
  const columns: number[][] = []
  const ground: number[] = []

  segments.forEach((seg, si) => {
    const cols = Math.round(seg.length / CELL)
    const rows = Math.round((seg.y1 - seg.y0) / CELL)
    for (let c = 0; c < cols; c++) {
      const along = (c + 0.5) * CELL
      const x = seg.ax + seg.dx * along
      const z = seg.az + seg.dz * along
      const column: number[] = []
      for (let r = rows - 1; r >= 0; r--) {
        const y = seg.y0 + (r + 0.5) * CELL
        let flags = 0
        for (const w of windows) {
          if (w.segment !== si) continue
          const inPane = along > w.s0 && along < w.s1 && y > w.y0 && y < w.y1
          // The frame is the ring of wall cells immediately around the pane.
          const inFrame = along > w.s0 - CELL && along < w.s1 + CELL && y > w.y0 - CELL && y < w.y1 + CELL
          if (inPane) flags |= GLASS
          else if (inFrame) flags |= FRAME
        }
        for (const o of overhangs) {
          if (o.segment !== si || along < o.s0 || along > o.s1) continue
          if (o.kind !== 'balcony' && y > o.y && y < o.y + o.thickness) flags |= LEDGE
          // Sheltered from rain: under the slab, down to about its own depth
          // below — rain falls at an angle, so the dry patch is that tall.
          if (o.kind === 'balcony' && y < o.y && y > o.y - o.depth * 1.5) flags |= SHELTER
        }
        column.push(protos.length)
        if (seg.y0 === 0 && r === 0) ground.push(protos.length)
        protos.push({
          p: [x, y, z],
          n: [seg.nx, 0, seg.nz],
          a: [seg.dx, 0, seg.dz],
          u: [0, 1, 0],
          flags,
          segment: si,
          along,
          texel: [seg.texU + c, seg.texV + r],
        })
      }
      columns.push(column)
    }
  })

  roofs.forEach((roof, ri) => {
    for (let j = 0; j < roof.rows; j++) {
      for (let i = 0; i < roof.cols; i++) {
        const x = roof.x0 + (i + 0.5) * CELL
        const z = roof.z0 + (j + 0.5) * CELL
        if (!inside(roof.polygon, x, z)) continue
        let flags = ROOF
        for (const unit of units) {
          if (unit.roof === ri && Math.abs(x - unit.x) < unit.w / 2 && Math.abs(z - unit.z) < unit.d / 2) flags |= BLOCKED
        }
        protos.push({
          p: [x, roof.y, z],
          n: [0, 1, 0],
          a: [1, 0, 0],
          u: [0, 0, -1],
          flags,
          segment: -1,
          along: 0,
          texel: [roof.texU + i, roof.texV + j],
        })
      }
    }
  })

  const count = protos.length
  const f32 = () => new Float32Array(count)
  const b: Building = {
    count,
    px: f32(), py: f32(), pz: f32(),
    nx: f32(), ny: f32(), nz: f32(),
    ax: f32(), ay: f32(), az: f32(),
    ux: f32(), uy: f32(), uz: f32(),
    flags: new Uint8Array(count),
    neighbours: new Int32Array(count * 8).fill(-1),
    segment: new Int16Array(count),
    along: f32(),
    cornerDist: f32(),
    cornerInside: new Uint8Array(count),
    texel: new Int32Array(count),
    texW: 256,
    texH: stripRows + 40,
    columns: columns.map((c) => Int32Array.from(c)),
    ground: Int32Array.from(ground),
    segments,
    roofs,
    units,
    volumes: [
      { polygon: MAIN_FOOTPRINT, y0: 0, y1: HEIGHT },
      { polygon: WING_FOOTPRINT, y0: 0, y1: WING_HEIGHT },
      ...units.map((u) => ({
        polygon: [
          [u.x - u.w / 2, u.z - u.d / 2],
          [u.x + u.w / 2, u.z - u.d / 2],
          [u.x + u.w / 2, u.z + u.d / 2],
          [u.x - u.w / 2, u.z + u.d / 2],
        ] as [number, number][],
        y0: roofs[u.roof].y,
        y1: roofs[u.roof].y + u.h,
      })),
    ],
    corners: [
      { x: -14, z: 0, y0: 0, y1: WING_HEIGHT, inside: false },
      { x: 3, z: 0, y0: 0, y1: HEIGHT, inside: true },
      { x: 3, z: 5, y0: 0, y1: HEIGHT, inside: false },
      { x: 8, z: 5, y0: 0, y1: HEIGHT, inside: false },
      { x: 8, z: -5, y0: 0, y1: HEIGHT, inside: false },
      { x: -14, z: -5, y0: 0, y1: WING_HEIGHT, inside: false },
      // Where the wall above the terrace turns the corner onto the main front and back.
      { x: -8, z: 0, y0: WING_HEIGHT, y1: HEIGHT, inside: false },
      { x: -8, z: -5, y0: WING_HEIGHT, y1: HEIGHT, inside: false },
    ],
    windows,
    overhangs,
  }
  protos.forEach((c, i) => {
    ;[b.px[i], b.py[i], b.pz[i]] = c.p
    ;[b.nx[i], b.ny[i], b.nz[i]] = c.n
    ;[b.ax[i], b.ay[i], b.az[i]] = c.a
    ;[b.ux[i], b.uy[i], b.uz[i]] = c.u
    b.flags[i] = c.flags
    b.segment[i] = c.segment
    b.along[i] = c.along
    b.texel[i] = c.texel[1] * b.texW + c.texel[0]
  })

  // --- corners ---
  for (let i = 0; i < count; i++) {
    let best = Infinity
    let insideCorner = 0
    if (b.segment[i] >= 0) {
      for (const c of b.corners) {
        if (b.py[i] < c.y0 || b.py[i] > c.y1) continue
        const d = Math.hypot(b.px[i] - c.x, b.pz[i] - c.z)
        if (d < best) {
          best = d
          insideCorner = c.inside ? 1 : 0
        }
      }
    }
    b.cornerDist[i] = best
    b.cornerInside[i] = insideCorner
  }

  // --- neighbours: step across the surface, take the nearest cell ---
  // A spatial hash at cell resolution; a step lands within 0.18 units of its
  // neighbour on a flat surface (exactly on it, in fact) and around a corner
  // or over an edge (0.177 = the diagonal of half a cell). 0.2 accepts both
  // and is still less than a cell, so it never reaches two cells over.
  // Integer keys: the building fits in ±128 cells on every axis, and string
  // keys made this loop 278 ms of page load.
  const key = (cx: number, cy: number, cz: number) => ((cx + 128) * 256 + (cy + 128)) * 256 + (cz + 128)
  const buckets = new Map<number, number[]>()
  for (let i = 0; i < count; i++) {
    const k = key(Math.floor(b.px[i] / CELL), Math.floor(b.py[i] / CELL), Math.floor(b.pz[i] / CELL))
    const list = buckets.get(k)
    if (list) list.push(i)
    else buckets.set(k, [i])
  }
  const REACH = 0.2
  for (let i = 0; i < count; i++) {
    SLOTS.forEach(([da, du], slot) => {
      const qx = b.px[i] + (b.ax[i] * da + b.ux[i] * du) * CELL
      const qy = b.py[i] + (b.ay[i] * da + b.uy[i] * du) * CELL
      const qz = b.pz[i] + (b.az[i] * da + b.uz[i] * du) * CELL
      let best = -1
      let bestD = REACH
      const cx = Math.floor(qx / CELL)
      const cy = Math.floor(qy / CELL)
      const cz = Math.floor(qz / CELL)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const list = buckets.get(key(cx + ox, cy + oy, cz + oz))
            if (!list) continue
            for (const j of list) {
              if (j === i) continue
              const d = Math.hypot(b.px[j] - qx, b.py[j] - qy, b.pz[j] - qz)
              if (d < bestD) {
                bestD = d
                best = j
              }
            }
          }
        }
      }
      b.neighbours[i * 8 + slot] = best
    })
  }

  // --- edges worth following: roof borders, cells against units, and where a
  // wall meets a roof (a wall cell with a roof cell below it, or a roof cell
  // beside a wall that rises from it) ---
  for (let i = 0; i < count; i++) {
    if (b.flags[i] & BLOCKED) continue
    for (let k = 0; k < 8; k++) {
      const j = b.neighbours[i * 8 + k]
      if (b.flags[i] & ROOF) {
        // A roof cell whose neighbour is a wall, or a blocked cell, or nothing.
        if (j < 0 || !(b.flags[j] & ROOF) || b.flags[j] & BLOCKED) b.flags[i] |= EDGE
      } else if (k === DOWN_SLOT && j >= 0 && b.flags[j] & ROOF) {
        b.flags[i] |= EDGE
      }
    }
  }

  return b
}

export function isWall(b: Building, i: number) {
  return b.segment[i] >= 0
}
